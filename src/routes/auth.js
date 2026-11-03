// 登录 / 账号 / 邀请码
const express = require('express')
const db = require('../db')
const config = require('../config')
const wx = require('../lib/wx')
const sms = require('../lib/sms')
const invite = require('../lib/invite')
const { signToken, requireAuth } = require('../middleware/auth')

const router = express.Router()

function normalizePhone(v) {
  return String(v || '').replace(/[^\d]/g, '')
}

function rowToAccount(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    short: r.role === 'admin' ? '店长' : (r.role === 'agent' ? '客服' : (r.role === 'player' ? '打手' : '老板')),
    avatarText: r.avatar_text,
    avatarColors: String(r.avatar_colors || '').split(',').filter(function (s) { return s }),
    phone: r.phone,
    role: r.role,
    playerId: r.player_id,
    openid: r.openid,
    invitedBy: r.invited_by || ''
  }
}

function fail(res, msg, code) {
  return res.json({ code: code || 1, msg: msg })
}

/** 建号 / 更新资料的公共逻辑 */
async function upsertByPhone(phone, patch) {
  let acc = await db.queryOne('SELECT * FROM accounts WHERE phone = ?', [phone])
  if (acc) {
    await db.query(
      'UPDATE accounts SET name = ?, avatar_text = ?, avatar_colors = ?, openid = IF(openid = "" OR openid IS NULL, ?, openid) WHERE id = ?',
      [patch.name || acc.name, patch.avatarText || acc.avatar_text, patch.avatarColors || acc.avatar_colors, patch.openid || '', acc.id]
    )
    return db.queryOne('SELECT * FROM accounts WHERE id = ?', [acc.id])
  }
  const info = await db.query(
    'INSERT INTO accounts (phone, openid, name, avatar_text, avatar_colors, role, player_id, invited_by) VALUES (?, ?, ?, ?, ?, "customer", "", ?)',
    [phone, patch.openid || '', patch.name || ('玩家' + phone.slice(-4)), patch.avatarText || phone.slice(-2), patch.avatarColors || '#FF6F91,#FF3D6E', patch.invitedBy || '']
  )
  return db.queryOne('SELECT * FROM accounts WHERE id = ?', [info.insertId])
}

/**
 * 微信手机号一键登录
 * body: { loginCode, phoneCode, nickname, avatarText, inviteCode }
 */
router.post('/wx-login', async function (req, res) {
  const body = req.body || {}
  let openid = ''
  try {
    const s = await wx.code2Session(body.loginCode)
    openid = s.openid
  } catch (e) {
    return fail(res, e.message || '微信登录失败')
  }

  let phone = ''
  // 旧基础库会把 encryptedData/iv 当凭证传上来，这里直接拒绝，避免换取手机号时莫名失败
  if (body.phoneCode && typeof body.phoneCode !== 'string') {
    return fail(res, '手机号凭证格式不支持，请升级微信后重试')
  }
  if (body.phoneCode) {
    try {
      phone = normalizePhone(await wx.getPhoneNumber(body.phoneCode))
    } catch (e) {
      return fail(res, e.message || '手机号获取失败')
    }
  }

  // 只拿到 openid：必须之前绑定过手机号
  if (!phone) {
    const bound = await db.queryOne('SELECT * FROM accounts WHERE openid = ?', [openid])
    if (!bound) return fail(res, '该微信还没绑定手机号，请授权手机号登录')
    return res.json({ code: 0, data: { token: signToken(bound), account: rowToAccount(bound), isNew: false } })
  }

  let invitedBy = ''
  if (body.inviteCode) {
    const r = await invite.useCode(phone, body.inviteCode)
    if (r.ok && r.inviterPhone) invitedBy = r.inviterPhone
  }

  const existed = !!(await db.queryOne('SELECT id FROM accounts WHERE phone = ?', [phone]))
  const acc = await upsertByPhone(phone, {
    openid: openid,
    name: body.nickname,
    avatarText: body.avatarText,
    invitedBy: invitedBy
  })
  return res.json({
    code: 0,
    data: { token: signToken(acc), account: rowToAccount(acc), isNew: !existed },
    msg: existed ? '登录成功' : '已登录，新账号默认为顾客'
  })
})

/**
 * 手机号登录（无微信授权时的备用链路；正式上线请在此接入短信验证码）
 * body: { phone, inviteCode }
 */
router.post('/phone-login', async function (req, res) {
  const phone = normalizePhone((req.body || {}).phone)
  if (!/^1[3-9]\d{9}$/.test(phone)) return fail(res, '请输入正确的 11 位手机号')

  const existed = !!(await db.queryOne('SELECT id FROM accounts WHERE phone = ?', [phone]))
  let invitedBy = ''
  let inviteMsg = ''
  if (!existed && req.body.inviteCode) {
    const r = await invite.useCode(phone, req.body.inviteCode)
    inviteMsg = r.msg || ''
    if (r.ok && r.inviterPhone) invitedBy = r.inviterPhone
  }
  const acc = await upsertByPhone(phone, { invitedBy: invitedBy })
  return res.json({
    code: 0,
    data: { token: signToken(acc), account: rowToAccount(acc), isNew: !existed, inviteMsg: inviteMsg },
    msg: existed ? '登录成功' : '已登录，新账号默认为顾客'
  })
})

/** 注册前判断手机号是否已存在（用于决定是否弹「选填邀请码」） */
router.post('/phone-check', async function (req, res) {
  const phone = normalizePhone((req.body || {}).phone)
  if (!/^1[3-9]\d{9}$/.test(phone)) return fail(res, '请输入正确的 11 位手机号')
  const hit = await db.queryOne('SELECT id FROM accounts WHERE phone = ?', [phone])
  return res.json({ code: 0, data: { exists: !!hit } })
})

/**
 * 发送短信验证码
 * body: { phone }
 * 未配置短信服务时返回 devCode，前端直接提示（便于未接短信时测试）
 */
router.post('/sms/send', async function (req, res) {
  const phone = normalizePhone((req.body || {}).phone)
  if (!/^1[3-9]\d{9}$/.test(phone)) return fail(res, '请输入正确的 11 位手机号')

  const now = Date.now()
  const last = await db.queryOne('SELECT create_at FROM sms_codes WHERE phone = ? ORDER BY id DESC LIMIT 1', [phone])
  if (last && now - Number(last.create_at) < config.sms.cooldown * 1000) {
    const wait = Math.ceil((config.sms.cooldown * 1000 - (now - Number(last.create_at))) / 1000)
    return fail(res, '请 ' + wait + ' 秒后再获取验证码')
  }

  const code = sms.genCode()
  await db.query(
    'INSERT INTO sms_codes (phone, code, expire_at, used, attempts, create_at) VALUES (?, ?, ?, 0, 0, ?)',
    [phone, code, now + config.sms.expire * 1000, now]
  )

  let sent = { dev: true }
  try {
    sent = await sms.send(phone, code)
  } catch (e) {
    return fail(res, '短信发送失败：' + (e.message || '请稍后重试'))
  }

  return res.json({
    code: 0,
    data: {
      expire: config.sms.expire,
      cooldown: config.sms.cooldown,
      dev: !!sent.dev,
      devCode: sent.dev ? code : ''
    },
    msg: sent.dev ? '验证码已生成' : '验证码已发送'
  })
})

/**
 * 验证码登录：未注册的手机号自动建号
 * body: { phone, code, inviteCode }
 */
router.post('/sms-login', async function (req, res) {
  const body = req.body || {}
  const phone = normalizePhone(body.phone)
  const code = String(body.code || '').replace(/[^\d]/g, '')
  if (!/^1[3-9]\d{9}$/.test(phone)) return fail(res, '请输入正确的 11 位手机号')
  if (code.length !== 6) return fail(res, '请输入 6 位验证码')

  const row = await db.queryOne(
    'SELECT * FROM sms_codes WHERE phone = ? AND used = 0 ORDER BY id DESC LIMIT 1',
    [phone]
  )
  if (!row) return fail(res, '请先获取验证码')
  if (Number(row.expire_at) < Date.now()) return fail(res, '验证码已过期，请重新获取')
  if (Number(row.attempts) >= config.sms.maxAttempts) return fail(res, '错误次数过多，请重新获取验证码')
  if (String(row.code) !== code) {
    await db.query('UPDATE sms_codes SET attempts = attempts + 1 WHERE id = ?', [row.id])
    return fail(res, '验证码不正确')
  }
  // 一次性使用
  await db.query('UPDATE sms_codes SET used = 1 WHERE id = ?', [row.id])

  const existed = !!(await db.queryOne('SELECT id FROM accounts WHERE phone = ?', [phone]))
  let invitedBy = ''
  if (!existed && body.inviteCode) {
    const r = await invite.useCode(phone, body.inviteCode)
    if (r.ok && r.inviterPhone) invitedBy = r.inviterPhone
  }
  const acc = await upsertByPhone(phone, { invitedBy: invitedBy })
  return res.json({
    code: 0,
    data: { token: signToken(acc), account: rowToAccount(acc), isNew: !existed },
    msg: existed ? '登录成功' : '已登录，新账号默认为顾客'
  })
})

/** 当前登录账号 */
router.get('/me', requireAuth, function (req, res) {
  return res.json({ code: 0, data: { account: rowToAccount(req.account) } })
})

/** 注册后再补填邀请码（新用户注册成功后弹窗引导） */
router.post('/use-invite', requireAuth, async function (req, res) {
  const phone = normalizePhone(req.account.phone)
  if (!phone) return fail(res, '账号没有手机号')
  const r = await invite.useCode(phone, (req.body || {}).code)
  if (!r.ok) return fail(res, r.msg)
  if (r.inviterPhone) {
    await db.query('UPDATE accounts SET invited_by = ? WHERE id = ?', [r.inviterPhone, req.account.id])
  }
  return res.json({ code: 0, data: { inviterPhone: r.inviterPhone, reward: r.reward }, msg: r.msg })
})

/** 我的专属邀请码：手机号入库并生成（已存在返回原码） */
router.post('/invite-code', requireAuth, async function (req, res) {
  const phone = normalizePhone(req.account.phone)
  if (!phone) return fail(res, '账号没有手机号')
  const r = await invite.ensureCode(phone)
  const st = await invite.statsOf(phone)
  return res.json({ code: 0, data: { code: r.code, isNew: r.isNew, count: st.count, reward: st.reward, rewardPer: invite.REWARD_PER_PERSON } })
})

/** 邀请统计 */
router.get('/invite-stats', requireAuth, async function (req, res) {
  const st = await invite.statsOf(normalizePhone(req.account.phone))
  return res.json({ code: 0, data: { count: st.count, reward: st.reward, rewardPer: invite.REWARD_PER_PERSON, code: await invite.getCode(req.account.phone) } })
})

module.exports = router
