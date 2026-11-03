// 鉴权中间件：Authorization: Bearer <token>
const jwt = require('jsonwebtoken')
const config = require('../config')
const db = require('../db')

const ADMIN_ROLES = ['admin', 'agent']

function signToken(account) {
  return jwt.sign({ uid: account.id, role: account.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn
  })
}

/** 解析出当前账号并挂到 req.account；token 无效返回 401 */
async function requireAuth(req, res, next) {
  const raw = String(req.headers.authorization || '')
  const token = raw.indexOf('Bearer ') === 0 ? raw.slice(7) : ''
  if (!token) return res.json({ code: 401, msg: '未登录' })
  let payload
  try {
    payload = jwt.verify(token, config.jwt.secret)
  } catch (e) {
    return res.json({ code: 401, msg: '登录已过期，请重新登录' })
  }
  const account = await db.queryOne('SELECT * FROM accounts WHERE id = ?', [payload.uid])
  if (!account) return res.json({ code: 401, msg: '账号不存在' })
  req.account = account
  next()
}

/** 只允许管理员 / 客服 */
function requireAdmin(req, res, next) {
  if (!req.account || ADMIN_ROLES.indexOf(req.account.role) === -1) {
    return res.json({ code: 403, msg: '没有权限' })
  }
  next()
}

module.exports = { signToken, requireAuth, requireAdmin, ADMIN_ROLES }
