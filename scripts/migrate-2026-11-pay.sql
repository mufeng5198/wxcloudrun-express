-- 迁移：新增微信支付支付单表（充值 + 订单直付共用）
-- 已有数据库执行一次即可（重复执行会报 Table already exists，忽略即可）
-- 说明：若之前已执行过创建 recharge_orders 的旧迁移，本脚本照常执行即可，旧表不影响运行
-- 用法：mysql -u root -p taoxi < server/scripts/migrate-2026-11-pay.sql
USE taoxi;
CREATE TABLE IF NOT EXISTS pay_orders (
  out_trade_no   VARCHAR(32) PRIMARY KEY,
  account_id     BIGINT       NOT NULL,
  type           VARCHAR(16)  NOT NULL DEFAULT 'recharge',
  order_id       VARCHAR(40)  NOT NULL DEFAULT '',
  amount         DECIMAL(10,2) NOT NULL,
  payload        JSON NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'pending',
  transaction_id VARCHAR(64)  NOT NULL DEFAULT '',
  create_time    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pay_time       DATETIME NULL,
  KEY idx_account (account_id),
  KEY idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
