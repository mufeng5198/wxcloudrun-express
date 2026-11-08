// 支付：微信支付（JSAPI）——两个独立入口
//   1) 充值到钱包：POST /recharge       （我的 → 充值，金额自选自付）
//   2) 直接支付订单：POST /order        （下单页选「微信支付」，服务端按价目表重算金额后才允许支付）
// 共用：POST /notify 微信回调（验签 + AES-GCM 解密 + 幂等记账）、状态查询接口
// 金额可信来源：充值 = 用户自付自收；订单 = lib/pricing.js 按价目表重算
const express = require('express')
const fs = require('fs')
const db = require('../db')
const config = require('../config')
const { requireAuth } = require('../middleware/auth')
const pricing = require('../lib/pricing')

const router = express.Router()

function fail(res, msg, code) { return res.json({ code: code || 1, msg: msg }) }
function num(v) { return Number(v) || 0 }

/** 微信支付单笔充值限额（元，整数） */
const MIN_RECHARGE = 1
const MAX_RECHARGE = 2000

let wxpay = null

/** 懒加载微信支付 SDK（四项配置齐了才可用） */
function getWxPay() {
  if (wxpay) return wxpay
  const p = config.pay
  if (!p.mchid || !p.serial || !p.apiv3Key || !p.keyPath || !fs.existsSync(p.keyPath)) {
    const err = new Error('微信支付未配置：需环境变量 WXPAY_MCHID / WXPAY_SERIAL_NO / WXPAY_APIV3_KEY / WXPAY_KEY_PATH')
    err.code = 'PAY_NOT_CONFIGURED'
    throw err
  }
  const WxPay = require('wechatpay-node-v3')
  wxpay = new WxPay({
    appid: config.wx.appid,
    mchid: p.mchid,
    // 公钥证书（apiclient_cert.pem）与私钥（apiclient_key.pem）在同一目录
    publicKey: fs.readFileSync(p.keyPath.replace('apiclient_key.pem', 'apiclient_cert.pem')),
    privateKey: fs.readFileSync(p.keyPath)
  })
  return wxpay
}

function payConfigured() {
  const p = config.pay
  return !!(p.mchid && p.serial && p.apiv3Key && p.keyPath && p.notifyUrl && fs.existsSync(p.keyPath))
}

function genOutTradeNo() {
  return 'T' + Date.now() + String(Math.floor(Math.random() * 9000) + 1000)
}

/** JSAPI 预下单：建支付单 + 调微信下单，成功返回 payment 参数 */
async function prepay(res, row) {
  const pay = getWxPay()
  const result = await pay.transactions_jsapi({
    description: row.type === 'order' ? '桃熹电竞 · 服务订单' : '桃熹电竞余额充值',
    out_trade_no: row.out_trade_no,
    notify_url: config.pay.notifyUrl,
    amount: { total: Math.round(num(row.amount) * 100), currency: 'CNY' },
    payer: { openid: row.openid }
  })
  if (!result || result.status !== 200 || !result.payment) {
    await db.query('UPDATE pay_orders SET status = "failed" WHERE out_trade_no = ?', [row.out_trade_no])
    fail(res, (result && result.code) || '发起支付失败，请稍后重试')
    return null
  }
  return result.payment
}

/* ==================== 入口一：充值到钱包 ==================== */

router.post('/recharge', requireAuth, async function (req, res) {
  if (!payConfigured()) return fail(res, '支付功能暂未配置，请联系管理员')
  if (!req.account.openid) return fail(res, '当前账号缺少 openid，请用微信登录后再充值')
  const amount = Number((req.body || {}).amount)
  if (!(amount >= MIN_RECHARGE && amount <= MAX_RECHARGE) || Math.round(amount) !== amount) {
    return fail(res, '充值金额需为 ' + MIN_RECHARGE + '-' + MAX_RECHARGE + ' 的整数（元）')
  }

  const outTradeNo = genOutTradeNo()
  await db.query(
    'INSERT INTO pay_orders (out_trade_no, account_id, type, amount) VALUES (?, ?, "recharge", ?)',
    [outTradeNo, req.account.id, amount]
  )
  const payment = await prepay(res, { out_trade_no: outTradeNo, type: 'recharge', amount: amount, openid: req.account.openid })
  if (!payment) return
  return res.json({ code: 0, data: { outTradeNo: outTradeNo, payment: payment } })
})

/** 充值结果查询（通知延迟时兜底查微信侧订单状态） */
router.get('/recharge/status', requireAuth, async function (req, res) {
  const out = String(req.query.outTradeNo || '')
  if (!out) return fail(res, '缺少订单号')
  const rec = await db.queryOne(
    'SELECT out_trade_no, status FROM pay_orders WHERE out_trade_no = ? AND account_id = ? AND type = "recharge"',
    [out, req.account.id]
  )
  if (!rec) return fail(res, '充值单不存在', 404)
  if (rec.status === 'pending' && payConfigured()) {
    await syncFromWechat(rec.out_trade_no)
  }
  const fresh = await db.queryOne('SELECT status FROM pay_orders WHERE out_trade_no = ?', [out])
  return res.json({ code: 0, data: { status: fresh ? fresh.status : rec.status } })
})

/* ==================== 入口二：直接支付订单 ==================== */

router.post('/order', requireAuth, async function (req, res) {
  if (!payConfigured()) return fail(res, '支付功能暂未配置，请联系管理员')
  if (!req.account.openid) return fail(res, '当前账号缺少 openid，请用微信登录后再支付')
  const input = req.body || {}
  const orderId = String(input.orderId || '')
  if (!orderId) return fail(res, '缺少订单号')

  // 服务端按价目表重算金额（防客户端篡改价格）
  const check = pricing.validateAmount(input)
  if (!check.ok) return fail(res, check.msg)

  // 优惠券校验（云端优惠券跟账号绑定）
  let discount = 0
  const couponId = num(input.couponId)
  if (input.couponId && couponId) {
    const c = await db.queryOne(
      'SELECT * FROM coupons WHERE id = ? AND account_id = ? AND status = "unused"',
      [couponId, req.account.id]
    )
    if (!c) return fail(res, '优惠券无效或已使用')
    if (check.total < num(c.min_order)) return fail(res, '未达到优惠券使用门槛')
    if (num(c.amount) !== check.discount) return fail(res, '优惠金额不符')
    discount = check.discount
  } else if (check.discount > 0) {
    return fail(res, '优惠券无效')
  }
  if (check.discount !== discount) return fail(res, '优惠金额不符')

  const outTradeNo = genOutTradeNo()
  const payload = {
    orderId: orderId,
    pkgId: input.pkgId || '',
    pkgName: input.pkgName || '',
    unit: input.unit || '单',
    price: num(input.price),
    count: Math.floor(num(input.count)) || 1,
    total: check.total,
    discount: discount,
    payAmount: num(input.payAmount),
    map: input.map || '',
    serviceTime: input.serviceTime || '',
    remark: String(input.remark || '').slice(0, 200),
    designatedPlayerId: input.designatedPlayerId || '',
    designatedPlayerName: input.designatedPlayerName || '',
    playmateGender: input.playmateGender === 'female' ? 'female' : 'male',
    femaleFee: num(input.femaleFee),
    sectionId: input.sectionId || '',
    couponId: couponId || ''
  }
  await db.query(
    'INSERT INTO pay_orders (out_trade_no, account_id, type, order_id, amount, payload) VALUES (?, ?, "order", ?, ?, ?)',
    [outTradeNo, req.account.id, orderId, num(input.payAmount), JSON.stringify(payload)]
  )
  const payment = await prepay(res, { out_trade_no: outTradeNo, type: 'order', amount: input.payAmount, openid: req.account.openid })
  if (!payment) return
  return res.json({ code: 0, data: { outTradeNo: outTradeNo, payment: payment } })
})

/** 订单支付结果查询 */
router.get('/order/status', requireAuth, async function (req, res) {
  const orderId = String(req.query.orderId || '')
  if (!orderId) return fail(res, '缺少订单号')
  const rec = await db.queryOne(
    'SELECT out_trade_no, status FROM pay_orders WHERE order_id = ? AND account_id = ? AND type = "order" ORDER BY create_time DESC LIMIT 1',
    [orderId, req.account.id]
  )
  if (!rec) return fail(res, '支付单不存在', 404)
  if (rec.status === 'pending' && payConfigured()) {
    await syncFromWechat(rec.out_trade_no)
  }
  const fresh = await db.queryOne('SELECT status FROM pay_orders WHERE out_trade_no = ?', [rec.out_trade_no])
  return res.json({ code: 0, data: { status: fresh ? fresh.status : rec.status } })
})

/* ==================== 回调与记账 ==================== */

/** 微信侧查单兜底（状态查询时用；失败按仍待支付处理，等回调） */
async function syncFromWechat(outTradeNo) {
  try {
    const pay = getWxPay()
    const q = await pay.query({ out_trade_no: outTradeNo })
    if (q && q.status === 200 && q.trade_state === 'SUCCESS') {
      await markPaid(outTradeNo, q.transaction_id || '')
    }
  } catch (e) { /* 忽略，等回调 */ }
}

/** 记账：支付单 pending → paid（幂等，affectedRows=1 才继续），并按类型入账 */
async function markPaid(outTradeNo, transactionId) {
  const r = await db.query(
    'UPDATE pay_orders SET status = "paid", transaction_id = ?, pay_time = NOW() WHERE out_trade_no = ? AND status = "pending"',
    [transactionId || '', outTradeNo]
  )
  if (!r || !r.affectedRows) return false
  const rec = await db.queryOne('SELECT * FROM pay_orders WHERE out_trade_no = ?', [outTradeNo])
  if (!rec) return false

  if (rec.type === 'recharge') {
    await db.query('UPDATE wallets SET balance = balance + ? WHERE account_id = ?', [num(rec.amount), rec.account_id])
    return true
  }

  // 订单支付：建订单（客户端支付成功后也会走 /api/orders 同步，重复则跳过）
  const p = rec.payload && typeof rec.payload === 'object' ? rec.payload : null
  if (!p) return true
  const exist = await db.queryOne('SELECT id FROM orders WHERE id = ?', [p.orderId])
  if (exist) return true
  const acc = await db.queryOne('SELECT phone FROM accounts WHERE id = ?', [rec.account_id])
  const gender = p.playmateGender === 'female' ? 'female' : 'male'
  const dId = p.designatedPlayerId || ''
  await db.query(
    'INSERT INTO orders (id, account_id, customer_phone, pkg_id, pkg_name, unit, price, `count`, total, discount, pay_amount, pay_type, map, service_time, remark, status, dispatch_mode, designated_player_id, designated_player_name, player_id, player_name, playmate_gender, female_fee, taken_by, rejected_by, timeline, dispatch_count, rating) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      p.orderId, rec.account_id, (acc && acc.phone) || '',
      p.pkgId, p.pkgName, p.unit, num(p.price), p.count, num(p.total), num(p.discount), num(p.payAmount),
      '微信支付', p.map || '', p.serviceTime || '', p.remark || '', 'pending',
      dId ? 'designated' : 'broadcast', dId, p.designatedPlayerName || '', dId, p.designatedPlayerName || '',
      gender, num(p.femaleFee), null, '[]', '[]', 1, 0
    ]
  )
  // 核销优惠券
  if (p.couponId) {
    await db.query('UPDATE coupons SET status = "used", used_time = NOW() WHERE id = ? AND account_id = ? AND status = "unused"',
      [p.couponId, rec.account_id])
  }
  return true
}

/** 微信支付回调（微信服务器调用，不走登录鉴权；必须验签） */
router.post('/notify', async function (req, res) {
  try {
    const pay = getWxPay()
    const raw = (req.rawBody || Buffer.from(JSON.stringify(req.body || {}))).toString()
    const ok = pay.verifySign({
      timestamp: req.headers['wechatpay-timestamp'],
      nonce: req.headers['wechatpay-nonce'],
      body: raw,
      serial: req.headers['wechatpay-serial'],
      signature: req.headers['wechatpay-signature']
    })
    if (!ok) return res.status(401).json({ code: 'FAIL', message: '验签失败' })

    const resource = req.body && req.body.resource
    if (!resource) return res.json({ code: 'SUCCESS', message: 'OK' })
    const data = pay.decipher_gcm(resource.ciphertext, resource.associated_data, resource.nonce)
    if (!data || data.trade_state !== 'SUCCESS') {
      return res.json({ code: 'SUCCESS', message: 'OK' })
    }
    await markPaid(data.out_trade_no, data.transaction_id)
    return res.json({ code: 'SUCCESS', message: 'OK' })
  } catch (e) {
    console.error('[pay notify error]', e)
    return res.status(500).json({ code: 'FAIL', message: '处理失败' })
  }
})

module.exports = router
