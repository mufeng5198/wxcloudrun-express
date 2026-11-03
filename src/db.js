// MySQL 连接池与查询封装
const mysql = require('mysql2/promise')
const config = require('./config')

const pool = mysql.createPool(config.db)

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params || [])
  return rows
}

async function queryOne(sql, params) {
  const rows = await query(sql, params)
  return rows && rows.length ? rows[0] : null
}

/** 事务：fn(conn) 里用 tx(sql, params) 执行语句 */
async function transaction(fn) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(function tx(sql, params) {
      return conn.execute(sql, params || []).then(function (r) { return r[0] })
    })
    await conn.commit()
    return result
  } catch (e) {
    try { await conn.rollback() } catch (e2) { /* ignore */ }
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { pool, query, queryOne, transaction }
