// 账号管理（管理员 / 客服）
const express = require('express')
const db = require('../db')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

function rowToAccount(r) {
  return {
    id: r.id,
    name: r.name,
    avatarText: r.avatar_text,
    avatarColors: String(r.avatar_colors || '').split(',').filter(function (s) { return s }),
    phone: r.phone,
    role: r.role,
    playerId: r.player_id,
    openid: r.openid
  }
}

/** 账号列表 */
router.get('/', requireAuth, requireAdmin, async function (req, res) {
  const rows = await db.query('SELECT * FROM accounts ORDER BY id ASC LIMIT 500')
  return res.json({ code: 0, data: { accounts: rows.map(rowToAccount) } })
})

/** 修改权限：admin / agent / player / customer */
router.post('/:id/role', requireAuth, requireAdmin, async function (req, res) {
  const role = (req.body || {}).role
  const targetId = req.params.id
  const allow = ['admin', 'agent', 'player', 'customer']
  if (allow.indexOf(role) === -1) return res.json({ code: 1, msg: '未知角色' })
  if (String(targetId) === String(req.account.id)) return res.json({ code: 1, msg: '不能修改自己的权限' })

  const target = await db.queryOne('SELECT * FROM accounts WHERE id = ?', [targetId])
  if (!target) return res.json({ code: 1, msg: '账号不存在' })

  const patch = [role]
  let sql = 'UPDATE accounts SET role = ?'
  if (role === 'player' && !target.player_id) {
    const used = await db.query("SELECT player_id FROM accounts WHERE player_id <> ''")
    const taken = {}
    used.forEach(function (r) { taken[r.player_id] = 1 })
    for (let i = 1; i <= 8; i++) {
      const pid = 'p' + i
      if (!taken[pid]) {
        sql += ', player_id = ?'
        patch.push(pid)
        break
      }
    }
  }
  sql += ' WHERE id = ?'
  patch.push(targetId)
  await db.query(sql, patch)
  return res.json({ code: 0, msg: '已将「' + target.name + '」设为' + role })
})

module.exports = router
