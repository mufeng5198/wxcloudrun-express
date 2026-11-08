// 统一配置：全部从环境变量读取，云托管在「服务配置 → 环境变量」里注入
require('dotenv').config()

// 云托管会注入 MYSQL_ADDRESS=10.x.x.x:3306 这种合并格式，读不到 DB_HOST 时自动解析
function parseMysqlAddress() {
  const addr = process.env.MYSQL_ADDRESS || ''
  if (!addr) return null
  const idx = addr.lastIndexOf(':')
  if (idx === -1) return { host: addr, port: 3306 }
  return { host: addr.slice(0, idx), port: Number(addr.slice(idx + 1)) || 3306 }
}

const mysqlAddr = parseMysqlAddress()

module.exports = {
  port: Number(process.env.PORT) || 80,
  wx: {
    appid: process.env.WX_APPID || '',
    secret: process.env.WX_SECRET || ''
  },
  db: {
    host: process.env.DB_HOST || (mysqlAddr ? mysqlAddr.host : '127.0.0.1'),
    port: Number(process.env.DB_PORT) || (mysqlAddr ? mysqlAddr.port : 3306),
    user: process.env.DB_USER || process.env.MYSQL_USERNAME || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || 'taoxi',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'taoxi_dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES || '30d'
  },
  // 短信验证码登录：未配置 SMS_WEBHOOK_URL 时为开发模式（不真发短信，验证码直接返回给前端便于联调）
  sms: {
    webhook: process.env.SMS_WEBHOOK_URL || '',
    sign: process.env.SMS_SIGN || '桃熹电竞',
    expire: 300,      // 验证码有效期（秒）
    cooldown: 60,     // 同一手机号重发间隔（秒）
    maxAttempts: 5    // 单个验证码最多试错次数
  },
  // 微信支付（JSAPI，充值到钱包）：四项都配置后支付功能才生效
  pay: {
    mchid: process.env.WXPAY_MCHID || '',                  // 商户号
    serial: process.env.WXPAY_SERIAL_NO || '',             // 商户 API 证书序列号
    apiv3Key: process.env.WXPAY_APIV3_KEY || '',           // APIv3 密钥
    keyPath: process.env.WXPAY_KEY_PATH || '',             // apiclient_key.pem 绝对路径
    notifyUrl: process.env.WXPAY_NOTIFY_URL || ''          // 回调地址 https://公网域名/api/pay/notify
  }
}

