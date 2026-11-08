-- 迁移：新增微信支付充值单表
-- 已有数据库执行一次即可（重复执行会报 Table already exists，忽略即可）
-- 用法：mysql -u root -p taoxi < server/scripts/migrate-2026-11-recharge.sql
USE taoxi;
CREATE TABLE IF NOT EXISTS recharge_orders (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  out_trade_no   VARCHAR(32)  NOT NULL,
  account_id     BIGINT       NOT NULL,
  amount         DECIMAL(10,2) NOT NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'pending',
  transaction_id VARCHAR(64)  NOT NULL DEFAULT '',
  create_time    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pay_time       DATETIME NULL,
  UNIQUE KEY uk_out (out_trade_no),
  KEY idx_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
