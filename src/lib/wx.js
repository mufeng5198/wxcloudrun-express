// 微信开放接口：code2Session / access_token / 手机号换取
// 只用 Node 自带 https，不引第三方网络库
const https = require('https')
const config = require('../config')

let tokenCache = { token: '', expireAt: 0 }

function getJSON(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      let body = ''
      res.on('data', function (c) { body += c })
      res.on('end', function () {
        try { resolve(JSON.parse(body)) } catch (e) { reject(new Error('微信返回解析失败')) }
      })
    }).on('error', reject)
  })
}

function postJSON(url, data) {
  return new Promise(function (resolve, reject) {
    const payload = JSON.stringify(data || {})
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload)
        }
      },
      function (res) {
        let body = ''
        res.on('data', function (c) { body += c })
        res.on('end', function () {
          try { resolve(JSON.parse(body)) } catch (e) { reject(new Error('微信返回解析失败')) }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/** 小程序 code 换 openid / session_key */
async function code2Session(jsCode) {
  const url = 'https://api.weixin.qq.com/sns/jscode2session?appid=' + config.wx.appid +
    '&secret=' + config.wx.secret + '&js_code=' + encodeURIComponent(jsCode) +
    '&grant_type=authorization_code'
  const res = await getJSON(url)
  if (!res || !res.openid) {
    throw new Error((res && res.errmsg) || 'code2Session 失败')
  }
  return res
}

/** 全局 access_token（内存缓存，云托管多实例各自缓存，够用） */
async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expireAt) return tokenCache.token
  const url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential' +
    '&appid=' + config.wx.appid + '&secret=' + config.wx.secret
  const res = await getJSON(url)
  if (!res || !res.access_token) {
    throw new Error((res && res.errmsg) || '获取 access_token 失败')
  }
  tokenCache = {
    token: res.access_token,
    expireAt: Date.now() + ((res.expires_in || 7200) - 300) * 1000
  }
  return tokenCache.token
}

/** getPhoneNumber 的 code 换真实手机号（基础库 2.21.2+） */
async function getPhoneNumber(code) {
  const token = await getAccessToken()
  const res = await postJSON(
    'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=' + token,
    { code: code }
  )
  if (!res || res.errcode !== 0 || !res.phone_info) {
    throw new Error((res && res.errmsg) || '手机号换取失败')
  }
  return res.phone_info.purePhoneNumber || res.phone_info.phoneNumber || ''
}

module.exports = { code2Session, getPhoneNumber }
