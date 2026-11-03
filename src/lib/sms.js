// 短信验证码发送：默认「开发模式」（不真发短信，验证码回传前端，方便未接短信服务时联调）
//
// 接入真实短信服务有两种方式：
//   1) 配置环境变量 SMS_WEBHOOK_URL，本服务会 POST { phone, code, sign } 到该地址，
//      由你自己的中转服务去调阿里云 / 腾讯云短信（推荐，签名鉴权放在中转服务里）；
//   2) 直接在本文件 send() 里接入服务商 SDK（需要 npm 安装对应 SDK）。
const http = require('http')
const https = require('https')
const config = require('../config')

/** 生成 6 位数字验证码 */
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function postJSON(url, data) {
  return new Promise(function (resolve, reject) {
    const payload = JSON.stringify(data || {})
    const u = new URL(url)
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload)
        },
        timeout: 8000
      },
      function (res) {
        let body = ''
        res.on('data', function (c) { body += c })
        res.on('end', function () {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body)
          else reject(new Error('短信网关返回 ' + res.statusCode))
        })
      }
    )
    req.on('timeout', function () { req.destroy(new Error('短信网关超时')) })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/**
 * 发送验证码
 * @returns {Promise<{dev: Boolean}>} dev=true 表示未配置短信服务，验证码未真正发出
 */
async function send(phone, code) {
  const hook = config.sms.webhook
  if (!hook) {
    console.log('[sms][dev] ' + phone + ' 验证码 ' + code + '（未配置 SMS_WEBHOOK_URL，仅打印不发送）')
    return { dev: true }
  }
  await postJSON(hook, { phone: phone, code: code, sign: config.sms.sign })
  return { dev: false }
}

module.exports = { genCode, send }
