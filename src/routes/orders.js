// 订单：下单 / 派单 / 接单 / 拒单 / 推进 / 取消 / 改派 / 离线同步
const express = require('express')
const db = require('../db')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

const JSON_FIELDS = ['taken_by', 'rejected_by', 'timeline']

function num(v) { return Number(v) || 0 }
function jsonStr(v) { return JSON.stringify(v === undefined || v === null ? null : v) }

function parseJson(v, fallback) {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch (e) { return fallback }
}

/** 数据库行 → 小程序端订单对象 */
function rowToOrder(r) {
  if (!r) return null
  return {
    id: r.id,
    accountId: r.account_id,
    customerPhone: r.customer_phone,
    pkgId: r.pkg_id || '',
    pkgName: r.pkg_name || '',
    unit: r.unit || '',
    price: num(r.price),
    count: num(r.count) || 1,
    total: num(r.total),
    discount: num(r.discount),
    payAmount: num(r.pay_amount),
    payType: r.pay_type || '',
    map: r.map || '',
    serviceTime: r.service_time || '',
    remark: r.remark || '',
    status: r.status,
    dispatchMode: r.dispatch_mode || 'broadcast',
    designatedPlayerId: r.designated_player_id || '',
    designatedPlayerName: r.designated_player_name || '',
    playerId: r.player_id || '',
    playerName: r.player_name || '',
    playmateGender: r.playmate_gender || 'male',
    playmateGenderName: r.playmate_gender === 'female' ? '女陪' : '男陪',
    femaleFee: num(r.female_fee),
    takenBy: parseJson(r.taken_by, null),
    rejectedBy: parseJson(r.rejected_by, []),
    timeline: parseJson(r.timeline, []),
    dispatchCount: num(r.dispatch_count) || 1,
    createTime: r.create_time ? new Date(r.create_time).getTime() : 0,
    createTimeText: r.create_time ? fmt(r.create_time) : '',
    updateTime: r.update_time ? new Date(r.update_time).getTime() : 0
  }
}

function pad(n) { return n < 10 ? '0' + n : '' + n }
function fmt(d) {
  const t = new Date(d)
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes())
}

function fail(res, msg, code) { return res.json({ code: code || 1, msg: msg }) }

/** 客户端订单对象 → 入库参数 */
function orderToParams(o, accountId) {
  return [
    o.id,
    accountId || 0,
    o.customerPhone || '',
    o.pkgId || '',
    o.pkgName || '',
    o.unit || '',
    num(o.price),
    num(o.count) || 1,
    num(o.total),
    num(o.discount),
    num(o.payAmount),
    o.payType || '',
    o.map || '',
    o.serviceTime || '',
    o.remark || '',
    o.status || 'pending',
    o.dispatchMode || 'broadcast',
    o.designatedPlayerId || '',
    o.designatedPlayerName || '',
    o.playerId || '',
    o.playerName || '',
    o.playmateGender || 'male',
    num(o.femaleFee),
    jsonStr(o.takenBy),
    jsonStr(o.rejectedBy || []),
    jsonStr(o.timeline || []),
    num(o.dispatchCount) || 1
  ]
}

const INSERT_SQL = 'INSERT INTO orders (id, account_id, customer_phone, pkg_id, pkg_name, unit, price, `count`, total, discount, pay_amount, pay_type, map, service_time, remark, status, dispatch_mode, designated_player_id, designated_player_name, player_id, player_name, playmate_gender, female_fee, taken_by, rejected_by, timeline, dispatch_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'

const UPDATE_SQL = 'UPDATE orders SET account_id = ?, customer_phone = ?, pkg_id = ?, pkg_name = ?, unit = ?, price = ?, `count` = ?, total = ?, discount = ?, pay_amount = ?, pay_type = ?, map = ?, service_time = ?, remark = ?, status = ?, dispatch_mode = ?, designated_player_id = ?, designated_player_name = ?, player_id = ?, player_name = ?, playmate_gender = ?, female_fee = ?, taken_by = ?, rejected_by = ?, timeline = ?, dispatch_count = ? WHERE id = ?'

/**
 * 订单列表
 * scope: mine（我的）| pool（待接单池，打手用）| player（打手：可接的 + 自己接的）| all（全部，管理员/客服）
 */
router.get('/', requireAuth, async function (req, res) {
  const scope = req.query.scope || 'mine'
  const me = req.account

  if (scope === 'all') {
    if (me.role !== 'admin' && me.role !== 'agent') return fail(res, '没有权限', 403)
    const rows = await db.query('SELECT * FROM orders ORDER BY create_time DESC LIMIT 200')
    return res.json({ code: 0, data: { orders: rows.map(rowToOrder) } })
  }

  if (scope === 'player') {
    if (me.role !== 'player' || !me.player_id) return res.json({ code: 0, data: { orders: [] } })
    const rows = await db.query(
      "SELECT * FROM orders WHERE status = 'pending' OR player_id = ? ORDER BY create_time DESC LIMIT 200",
      [me.player_id]
    )
    const list = rows.map(rowToOrder).filter(function (o) {
      if (o.status === 'pending') {
        const rejected = o.rejectedBy || []
        if (rejected.indexOf(me.player_id) > -1) return false
        if (o.dispatchMode === 'designated') return o.designatedPlayerId === me.player_id
        return true
      }
      return o.playerId === me.player_id
    })
    return res.json({ code: 0, data: { orders: list } })
  }

  if (scope === 'pool') {
    if (me.role !== 'player' || !me.player_id) return res.json({ code: 0, data: { orders: [] } })
    const rows = await db.query("SELECT * FROM orders WHERE status = 'pending' ORDER BY create_time DESC LIMIT 100")
    const list = rows.map(rowToOrder).filter(function (o) {
      const rejected = o.rejectedBy || []
      if (rejected.indexOf(me.player_id) > -1) return false
      if (o.dispatchMode === 'designated') return o.designatedPlayerId === me.player_id
      return true
    })
    return res.json({ code: 0, data: { orders: list } })
  }

  const rows = await db.query('SELECT * FROM orders WHERE account_id = ? ORDER BY create_time DESC LIMIT 200', [me.id])
  return res.json({ code: 0, data: { orders: rows.map(rowToOrder) } })
})

/** 下单 */
router.post('/', requireAuth, async function (req, res) {
  const o = req.body || {}
  if (!o.id) return fail(res, '缺少订单号')
  const dup = await db.queryOne('SELECT id FROM orders WHERE id = ?', [o.id])
  if (dup) {
    await db.query(UPDATE_SQL, orderToParams(o, req.account.id).slice(1).concat([o.id]))
    return res.json({ code: 0, data: { order: rowToOrder(await db.queryOne('SELECT * FROM orders WHERE id = ?', [o.id])) } })
  }
  await db.query(INSERT_SQL, orderToParams(o, req.account.id))
  return res.json({ code: 0, data: { order: rowToOrder(await db.queryOne('SELECT * FROM orders WHERE id = ?', [o.id])) } })
})

/** 离线补偿同步：整单覆盖写（幂等） */
router.put('/:id', requireAuth, async function (req, res) {
  const o = req.body || {}
  if (!o.id || o.id !== req.params.id) return fail(res, '订单号不一致')
  const exist = await db.queryOne('SELECT id FROM orders WHERE id = ?', [req.params.id])
  if (exist) {
    await db.query(UPDATE_SQL, orderToParams(o, req.account.id).slice(1).concat([req.params.id]))
  } else {
    await db.query(INSERT_SQL, orderToParams(o, req.account.id))
  }
  return res.json({ code: 0, data: { order: rowToOrder(await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])) } })
})

router.get('/:id', requireAuth, async function (req, res) {
  const row = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
  if (!row) return fail(res, '订单不存在', 404)
  return res.json({ code: 0, data: { order: rowToOrder(row) } })
})

/** 打手接单 */
router.post('/:id/accept', requireAuth, async function (req, res) {
  const me = req.account
  if (me.role !== 'player' || !me.player_id) return fail(res, '只有打手能接单')
  const row = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
  if (!row) return fail(res, '订单不存在', 404)
  const o = rowToOrder(row)
  if (o.status !== 'pending') return fail(res, '手慢了，这单已被接走')
  if (o.dispatchMode === 'designated' && o.designatedPlayerId !== me.player_id) return fail(res, '这单是别人的指定单')

  const nowText = fmt(new Date())
  const timeline = (o.timeline || []).slice()
  if (timeline[2]) timeline[2] = Object.assign({}, timeline[2], { done: true, time: nowText, title: '打手「' + me.name + '」已接单' })
  await db.query(
    'UPDATE orders SET status = "accepted", player_id = ?, player_name = ?, taken_by = ?, timeline = ? WHERE id = ?',
    [me.player_id, me.name, jsonStr({ playerId: me.player_id, playerName: me.name, timeText: nowText }), jsonStr(timeline), req.params.id]
  )
  return res.json({ code: 0, data: { order: rowToOrder(await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])) }, msg: '接单成功' })
})

/** 打手拒单 */
router.post('/:id/reject', requireAuth, async function (req, res) {
  const me = req.account
  const row = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
  if (!row) return fail(res, '订单不存在', 404)
  const o = rowToOrder(row)
  if (o.status !== 'pending') return fail(res, '该单已不可操作')
  const rejected = (o.rejectedBy || []).slice()
  if (me.player_id && rejected.indexOf(me.player_id) === -1) rejected.push(me.player_id)

  if (o.dispatchMode === 'broadcast') {
    await db.query('UPDATE orders SET rejected_by = ? WHERE id = ?', [jsonStr(rejected), req.params.id])
    return res.json({ code: 0, msg: '已跳过该单，其他打手仍可接' })
  }
  const timeline = (o.timeline || []).map(function (t, i) {
    return i >= 2 ? Object.assign({}, t, { done: false, time: '' }) : t
  })
  await db.query('UPDATE orders SET status = "rejected", rejected_by = ?, timeline = ? WHERE id = ?',
    [jsonStr(rejected), jsonStr(timeline), req.params.id])
  return res.json({ code: 0, msg: '已拒单，等待客服改派' })
})

/** 推进状态：accepted → checking → done */
router.post('/:id/advance', requireAuth, async function (req, res) {
  const row = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
  if (!row) return fail(res, '订单不存在', 404)
  const o = rowToOrder(row)
  const next = o.status === 'accepted' ? 'checking' : (o.status === 'checking' ? 'done' : '')
  if (!next) return fail(res, '当前状态不可推进')
  const idx = next === 'checking' ? 3 : 4
  const timeline = (o.timeline || []).slice()
  if (timeline[idx]) timeline[idx] = Object.assign({}, timeline[idx], { done: true, time: fmt(new Date()) })
  await db.query('UPDATE orders SET status = ?, timeline = ? WHERE id = ?', [next, jsonStr(timeline), req.params.id])
  return res.json({ code: 0, data: { order: rowToOrder(await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])) } })
})

/** 取消订单 */
router.post('/:id/cancel', requireAuth, async function (req, res) {
  const row = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
  if (!row) return fail(res, '订单不存在', 404)
  const o = rowToOrder(row)
  const me = req.account
  if (me.role !== 'admin' && me.role !== 'agent' && String(o.accountId) !== String(me.id)) {
    return fail(res, '只能取消自己的订单', 403)
  }
  if (o.status === 'done' || o.status === 'cancel') return fail(res, '该订单已结束')
  await db.query('UPDATE orders SET status = "cancel" WHERE id = ?', [req.params.id])
  return res.json({ code: 0, data: { order: rowToOrder(await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])) } })
})

/** 改派（管理员 / 客服） */
router.post('/:id/assign', requireAuth, requireAdmin, async function (req, res) {
  const playerId = (req.body || {}).playerId || ''
  const playerName = (req.body || {}).playerName || ''
  if (!playerId) return fail(res, '请选择改派的打手')
  const row = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])
  if (!row) return fail(res, '订单不存在', 404)
  const o = rowToOrder(row)
  const timeline = (o.timeline || []).slice()
  if (timeline[1]) {
    timeline[1] = Object.assign({}, timeline[1], {
      done: true,
      time: fmt(new Date()),
      title: '已改派给「' + playerName + '」'
    })
  }
  await db.query(
    'UPDATE orders SET status = "pending", dispatch_mode = "designated", designated_player_id = ?, designated_player_name = ?, player_id = ?, player_name = ?, dispatch_count = dispatch_count + 1, timeline = ? WHERE id = ?',
    [playerId, playerName, playerId, playerName, jsonStr(timeline), req.params.id]
  )
  return res.json({ code: 0, data: { order: rowToOrder(await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id])) }, msg: '已改派给「' + playerName + '」' })
})

module.exports = router
