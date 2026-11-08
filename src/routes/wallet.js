// 钱包：余额 / 积分 / 优惠券（跟账户绑定，存云端 MySQL，新账号默认 0）
// 邀请好友返现规则：每邀请 1 人发 1 张 ¥10 优惠券（不是现金/余额），每单限用一张。
const express = require('express')
const db = require('../db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

function num(v) { return Number(v) || 0 }

function pad(n) { return n < 10 ? '0' + n : '' + n }
function fmt(d) {
  const t = new Date(d)
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) +
    ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes())
}

function fail(res, msg, code) { return res.json({ code: code || 1, msg: msg }) }

/** 钱包行不存在则建（默认 0 / 0） */
async function ensureWallet(accountId) {
  let w = await db.queryOne('SELECT * FROM wallets WHERE account_id = ?', [accountId])
  if (!w) {
    await db.query('INSERT IGNORE INTO wallets (account_id, balance, points) VALUES (?, 0, 0)', [accountId])
    w = await db.queryOne('SELECT * FROM wallets WHERE account_id = ?', [accountId])
  }
  return w
}

function walletView(w) {
  return { balance: num(w.balance), points: num(w.points) }
}

function couponView(c) {
  return {
    id: c.id,
    name: c.name,
    amount: num(c.amount),
    minOrder: num(c.min_order),
    status: c.status,
    expireText: c.expire_time ? (fmt(c.expire_time) + ' 前有效') : '长期有效'
  }
}

/** 我的钱包 + 优惠券列表 */
router.get('/', requireAuth, async function (req, res) {
  const w = await ensureWallet(req.account.id)
  const rows = await db.query(
    "SELECT * FROM coupons WHERE account_id = ? AND status = 'unused' ORDER BY id DESC LIMIT 100",
    [req.account.id]
  )
  const now = Date.now()
  const coupons = rows.map(couponView).filter(function (c) {
    return !c.expireText || c.expireText.indexOf('长期') > -1 || new Date(c.expireText).getTime() > now
  })
  return res.json({ code: 0, data: Object.assign(walletView(w), { coupons: coupons }) })
})

/** 充值：微信支付接入前关闭（防止无支付凭证直接加余额） */
router.post('/recharge', requireAuth, async function (req, res) {
  return fail(res, '充值功能暂未开放，请联系客服', 403)
})

/** 余额支付扣款 */
router.post('/pay', requireAuth, async function (req, res) {
  const amount = num((req.body || {}).amount)
  if (!(amount > 0)) return fail(res, '支付金额不正确')
  const w = await ensureWallet(req.account.id)
  if (num(w.balance) < amount) return fail(res, '余额不足')
  await db.query('UPDATE wallets SET balance = balance - ? WHERE account_id = ?', [amount, req.account.id])
  const w2 = await db.queryOne('SELECT * FROM wallets WHERE account_id = ?', [req.account.id])
  return res.json({ code: 0, data: walletView(w2), msg: '支付成功' })
})

/** 退款回充：必须对应本人已取消的余额支付订单，金额与实付一致，且未退过 */
router.post('/refund', requireAuth, async function (req, res) {
  const body = req.body || {}
  const orderId = body.orderId || body.id || ''
  const amount = num(body.amount)
  if (!orderId) return fail(res, '缺少订单号')
  if (!(amount > 0)) return fail(res, '退款金额不正确')
  const o = await db.queryOne('SELECT id, account_id, pay_type, pay_amount, status, refunded FROM orders WHERE id = ?', [orderId])
  if (!o) return fail(res, '订单不存在')
  if (String(o.account_id) !== String(req.account.id)) return fail(res, '只能退自己的订单', 403)
  if (o.status !== 'cancel') return fail(res, '仅已取消的订单可退款')
  if ((o.pay_type || '') !== '余额支付') return fail(res, '该订单非余额支付，无需退款')
  if (num(o.pay_amount) !== amount) return fail(res, '退款金额与实付不一致')
  if (num(o.refunded)) return fail(res, '该订单已退款，请勿重复操作')
  await ensureWallet(req.account.id)
  await db.query('UPDATE orders SET refunded = 1 WHERE id = ?', [orderId])
  await db.query('UPDATE wallets SET balance = balance + ? WHERE account_id = ?', [amount, req.account.id])
  const w = await db.queryOne('SELECT * FROM wallets WHERE account_id = ?', [req.account.id])
  return res.json({ code: 0, data: walletView(w), msg: '已退回余额' })
})

/** 积分变动（正负均可，不为负；限单笔幅度，防刷分） */
router.post('/points', requireAuth, async function (req, res) {
  const delta = Number((req.body || {}).delta) || 0
  if (Math.abs(delta) > 100) return fail(res, '积分变动幅度超出限制')
  await ensureWallet(req.account.id)
  await db.query('UPDATE wallets SET points = GREATEST(0, points + ?) WHERE account_id = ?', [delta, req.account.id])
  const w = await db.queryOne('SELECT * FROM wallets WHERE account_id = ?', [req.account.id])
  return res.json({ code: 0, data: walletView(w) })
})

/** 使用一张优惠券（校验归属 + 未使用；每单限用一张由前端下单时只传一张保证） */
router.post('/coupon/use', requireAuth, async function (req, res) {
  const id = num((req.body || {}).id)
  if (!id) return fail(res, '缺少优惠券 id')
  const c = await db.queryOne(
    'SELECT * FROM coupons WHERE id = ? AND account_id = ?',
    [id, req.account.id]
  )
  if (!c) return fail(res, '优惠券不存在')
  if (c.status !== 'unused') return fail(res, '该优惠券已使用')
  await db.query("UPDATE coupons SET status = 'used', used_time = NOW() WHERE id = ?", [id])
  return res.json({ code: 0, msg: '优惠券已使用' })
})

module.exports = router
