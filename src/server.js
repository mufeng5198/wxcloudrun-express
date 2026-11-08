// 服务启动
const app = require('./app')
const config = require('./config')
const db = require('./db')

/** 启动时自动补建缺失的表（幂等，失败只告警不影响服务） */
async function ensureSchema() {
  const DDL = [
    `CREATE TABLE IF NOT EXISTS wallets (
      account_id  BIGINT PRIMARY KEY,
      balance     DECIMAL(10,2) NOT NULL DEFAULT 0,
      points      INT NOT NULL DEFAULT 0,
      update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS coupons (
      id          BIGINT PRIMARY KEY AUTO_INCREMENT,
      account_id  BIGINT NOT NULL,
      name        VARCHAR(64) NOT NULL DEFAULT '',
      amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
      min_order   DECIMAL(10,2) NOT NULL DEFAULT 0,
      status      VARCHAR(16) NOT NULL DEFAULT 'unused',
      expire_time DATETIME NULL,
      used_time   DATETIME NULL,
      create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_account (account_id),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS settings (
      k           VARCHAR(64) PRIMARY KEY,
      v           JSON NULL,
      update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `ALTER TABLE invite_refers ALTER COLUMN reward SET DEFAULT 10`
  ]
  for (let i = 0; i < DDL.length; i++) {
    try {
      await db.query(DDL[i])
    } catch (e) {
      console.warn('[ensureSchema] 跳过一条 DDL：', e.message)
    }
  }
}

ensureSchema().then(function () {
  app.listen(config.port, function () {
    console.log('[taoxi] api server listening on port ' + config.port)
  })
}).catch(function (e) {
  console.error('[taoxi] ensureSchema 失败，仍尝试启动：', e.message)
  app.listen(config.port, function () {
    console.log('[taoxi] api server listening on port ' + config.port)
  })
})
