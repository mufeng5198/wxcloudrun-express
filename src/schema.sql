-- 桃熹电竞小程序 · 数据库初始化脚本
-- 用法：mysql -u root -p < server/src/schema.sql  或  npm run initdb

CREATE DATABASE IF NOT EXISTS taoxi DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
USE taoxi;

-- 账号表（顾客 / 打手 / 客服 / 管理员）
CREATE TABLE IF NOT EXISTS accounts (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  openid        VARCHAR(64)  NOT NULL DEFAULT '',
  phone         VARCHAR(20)  NOT NULL DEFAULT '',
  name          VARCHAR(64)  NOT NULL DEFAULT '',
  avatar_text   VARCHAR(16)  NOT NULL DEFAULT '',
  avatar_colors VARCHAR(64)  NOT NULL DEFAULT '',
  role          VARCHAR(16)  NOT NULL DEFAULT 'customer',
  player_id     VARCHAR(32)  NOT NULL DEFAULT '',
  invited_by    VARCHAR(20)  NOT NULL DEFAULT '',
  create_time   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_phone  (phone),
  KEY idx_openid (openid),
  KEY idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订单表
CREATE TABLE IF NOT EXISTS orders (
  id                      VARCHAR(40) PRIMARY KEY,
  account_id              BIGINT NOT NULL DEFAULT 0,
  customer_phone          VARCHAR(20)  NOT NULL DEFAULT '',
  pkg_id                  VARCHAR(32)  NOT NULL DEFAULT '',
  pkg_name                VARCHAR(128) NOT NULL DEFAULT '',
  unit                    VARCHAR(16)  NOT NULL DEFAULT '',
  price                   DECIMAL(10,2) NOT NULL DEFAULT 0,
  count                   INT          NOT NULL DEFAULT 1,
  total                   DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount                DECIMAL(10,2) NOT NULL DEFAULT 0,
  pay_amount              DECIMAL(10,2) NOT NULL DEFAULT 0,
  pay_type                VARCHAR(32)  NOT NULL DEFAULT '',
  map                     VARCHAR(64)  NOT NULL DEFAULT '',
  service_time            VARCHAR(64)  NOT NULL DEFAULT '',
  remark                  TEXT,
  status                  VARCHAR(16)  NOT NULL DEFAULT 'pending',
  dispatch_mode           VARCHAR(16)  NOT NULL DEFAULT 'broadcast',
  designated_player_id    VARCHAR(32)  NOT NULL DEFAULT '',
  designated_player_name  VARCHAR(64)  NOT NULL DEFAULT '',
  player_id               VARCHAR(32)  NOT NULL DEFAULT '',
  player_name             VARCHAR(64)  NOT NULL DEFAULT '',
  playmate_gender         VARCHAR(8)   NOT NULL DEFAULT 'male',
  female_fee              DECIMAL(10,2) NOT NULL DEFAULT 0,
  taken_by                JSON,
  rejected_by             JSON,
  timeline                JSON,
  dispatch_count          INT NOT NULL DEFAULT 1,
  create_time             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_status  (status),
  KEY idx_account (account_id),
  KEY idx_player  (player_id),
  KEY idx_create  (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 邀请码表（顾客点「邀请好友赚佣金」时手机号入库并生成唯一 9 位码）
CREATE TABLE IF NOT EXISTS invite_codes (
  code        CHAR(9) PRIMARY KEY,
  phone       VARCHAR(20) NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 短信验证码表（手机号 + 验证码登录）
CREATE TABLE IF NOT EXISTS sms_codes (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  phone       VARCHAR(20) NOT NULL,
  code        VARCHAR(10) NOT NULL,
  expire_at   BIGINT      NOT NULL,
  used        TINYINT     NOT NULL DEFAULT 0,
  attempts    INT         NOT NULL DEFAULT 0,
  create_at   BIGINT      NOT NULL,
  KEY idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 邀请关系 / 返现流水表（返现以 ¥10 优惠券形式发放，见 coupons 表）
CREATE TABLE IF NOT EXISTS invite_refers (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  code          CHAR(9) NOT NULL,
  inviter_phone VARCHAR(20) NOT NULL,
  new_phone     VARCHAR(20) NOT NULL,
  reward        DECIMAL(10,2) NOT NULL DEFAULT 10,
  create_time   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_new_phone (new_phone),
  KEY idx_inviter (inviter_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 钱包表（余额 / 电竞积分，跟账户绑定，新账号默认 0）
CREATE TABLE IF NOT EXISTS wallets (
  account_id  BIGINT PRIMARY KEY,
  balance     DECIMAL(10,2) NOT NULL DEFAULT 0,
  points      INT NOT NULL DEFAULT 0,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 优惠券表（邀请返现等以优惠券发放；每单限用一张）
CREATE TABLE IF NOT EXISTS coupons (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
