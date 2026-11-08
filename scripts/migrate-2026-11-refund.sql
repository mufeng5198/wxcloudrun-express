-- 迁移：订单表增加退款标记字段（refunded），配合服务端退款接口防重复退款
-- 已有数据库执行一次即可（重复执行会报 Duplicate column，忽略即可）
-- 用法：mysql -u root -p taoxi < server/scripts/migrate-2026-11-refund.sql
USE taoxi;
ALTER TABLE orders ADD COLUMN refunded TINYINT NOT NULL DEFAULT 0 COMMENT '余额支付订单退款标记 0=未退 1=已退（防重复退款）' AFTER rating;
