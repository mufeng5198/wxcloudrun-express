// 初始化数据库：node server/scripts/init-db.js
// 会读取 .env 里的 DB_* 配置，并执行 server/src/schema.sql
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')
require('dotenv').config()

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  })
  const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8')
  await conn.query(sql)
  console.log('[init-db] 数据库与表结构已就绪')
  await conn.end()
}

main().catch(function (e) {
  console.error('[init-db] 失败：', e.message)
  process.exit(1)
})
