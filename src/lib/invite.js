// 邀请码：与小程序端 utils/invite.js 同一套规则（9 位、唯一、一人一码）
// 返现规则：每邀请 1 人得 ¥10，以【优惠券】形式发放（不是现金/余额）
const db = require('../db')

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN = 9
const REWARD_PER_PERSON = 10

function randomCode() {
  let s = ''
  for (let i = 0; i < CODE_LEN; i++) {
    s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length))
  }
  return s
}

async function genUniqueCode() {
  const rows = await db.query('SELECT code FROM invite_codes')
  const used = {}
  rows.forEach(function (r) { used[r.code] = 1 })
  let code = randomCode()
  let guard = 0
  while (used[code] && guard < 500) {
    code = randomCode()
    guard++
  }
  return code
}

/** 手机号入库并返回其专属码（已存在直接返回原码） */
async function ensureCode(phone) {
  const hit = await db.queryOne('SELECT * FROM invite_codes WHERE phone = ?', [phone])
  if (hit) return { code: hit.code, isNew: false }
  const code = await genUniqueCode()
  await db.query('INSERT INTO invite_codes (code, phone) VALUES (?, ?)', [code, phone])
  return { code: code, isNew: true }
}

async function getCode(phone) {
  const hit = await db.queryOne('SELECT code FROM invite_codes WHERE phone = ?', [phone])
  return hit ? hit.code : ''
}

/**
 * 新用户绑定邀请人
 * @returns {Object} { ok, msg, inviterPhone, reward }
 */
async function useCode(newPhone, code) {
  const k = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LEN)
  if (!k) return { ok: true, msg: '未填写邀请码', inviterPhone: '', reward: 0 }

  const rec = await db.queryOne('SELECT * FROM invite_codes WHERE code = ?', [k])
  if (!rec) return { ok: false, msg: '邀请码不存在，可留空或找好友确认' }
  if (rec.phone === newPhone) return { ok: false, msg: '不能使用自己的邀请码' }

  const dup = await db.queryOne('SELECT id FROM invite_refers WHERE new_phone = ?', [newPhone])
  if (dup) return { ok: false, msg: '该手机号已使用过邀请码' }

  await db.query(
    'INSERT INTO invite_refers (code, inviter_phone, new_phone, reward) VALUES (?, ?, ?, ?)',
    [k, rec.phone, newPhone, REWARD_PER_PERSON]
  )

  // 给邀请人发 ¥10 优惠券（钱包在 utils/wallet.js / routes/wallet.js）
  const inviter = await db.queryOne('SELECT id FROM accounts WHERE phone = ?', [rec.phone])
  if (inviter) {
    await db.query(
      "INSERT INTO coupons (account_id, name, amount, min_order, status) VALUES (?, ?, ?, 0, 'unused')",
      [inviter.id, '邀请好友奖励券', REWARD_PER_PERSON]
    )
  }
  return { ok: true, msg: '已绑定邀请人，邀请人获得 ¥' + REWARD_PER_PERSON + ' 优惠券', inviterPhone: rec.phone, reward: REWARD_PER_PERSON }
}

async function statsOf(phone) {
  const rows = await db.query('SELECT * FROM invite_refers WHERE inviter_phone = ?', [phone])
  let reward = 0
  rows.forEach(function (r) { reward += Number(r.reward) || 0 })
  return { count: rows.length, reward: reward, list: rows }
}

module.exports = { REWARD_PER_PERSON, ensureCode, getCode, useCode, statsOf }
