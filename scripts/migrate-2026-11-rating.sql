-- 迁移：订单表增加打手评分字段（rating）
-- 已有数据库执行一次即可（幂等性说明：重复执行会报 Duplicate column，忽略即可）
-- 用法：mysql -u root -p taoxi < server/scripts/migrate-2026-11-rating.sql
USE taoxi;
ALTER TABLE orders ADD COLUMN rating TINYINT NOT NULL DEFAULT 0 COMMENT '老板结单后给打手的打分 1-5 星，0=未评' AFTER dispatch_count;
