// 首页公告：管理员可编辑，全员可见
//   GET  /api/notice          公开读取（无需登录）
//   POST /api/notice          仅管理员（admin）可写，body: { notices: ['...', ...] }
// 存储：settings 键值表（key = notice），值为字符串数组 JSON
const express = require('express')
const db = require('../db')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

const KEY = 'notice'
const MAX_COUNT = 5      // 最多 5 条
const MAX_LEN = 60       // 单条最长 60 字

function fail(res, msg, code) { return res.json({ code: code || 1, msg: msg }) }

/** 仅管理员（客服/打手/顾客均无权限） */
function requireAdminOnly(req, res, next) {
  if (!req.account || req.account.role !== 'admin') {
    return res.json({ code: 403, msg: '仅管理员可编辑公告' })
  }
  next()
}

function normalize(list) {
  if (!Array.isArray(list)) return null
  const out = []
  for (let i = 0; i < list.length; i++) {
    const s = String(list[i] || '').trim()
    if (!s) continue
    if (s.length > MAX_LEN) return { err: '单条公告不能超过 ' + MAX_LEN + ' 字' }
    out.push(s)
    if (out.length >= MAX_COUNT) break
  }
  return { list: out }
}

async function readNotices() {
  const rows = await db.queryOne('SELECT v FROM settings WHERE k = ?', [KEY])
  if (!rows || !rows.v) return []
  try {
    const parsed = typeof rows.v === 'string' ? JSON.parse(rows.v) : rows.v
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

router.get('/', async function (req, res) {
  const notices = await readNotices()
  res.json({ code: 0, data: { notices: notices } })
})

router.post('/', requireAuth, requireAdminOnly, async function (req, res) {
  const body = req.body || {}
  const norm = normalize(body.notices)
  if (!norm) return fail(res, '公告格式不正确')
  if (norm.err) return fail(res, norm.err)
  if (!norm.list.length) return fail(res, '至少保留一条公告')

  await db.query(
    'INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    [KEY, JSON.stringify(norm.list)]
  )
  res.json({ code: 0, msg: '已保存', data: { notices: norm.list } })
})

module.exports = router
