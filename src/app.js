// Express 应用装配
const express = require('express')

// ── 关键补丁：Express 4 不会捕获 async 路由的异常 ──
// async handler 里 await 抛错时请求会挂死（表现为网关 504 超时），而不是走错误中间件。
// 在所有路由注册之前给 Router 原型包一层：Promise reject 一律转给 next(err)。
;(() => {
  const proto = Object.getPrototypeOf(express.Router())
  ;['get', 'post', 'put', 'delete', 'patch'].forEach(function (m) {
    const orig = proto[m]
    if (typeof orig !== 'function') return
    proto[m] = function (path) {
      const args = [path]
      for (let i = 1; i < arguments.length; i++) {
        const h = arguments[i]
        if (typeof h !== 'function') { args.push(h); continue }
        args.push(function (req, res, next) {
          const r = h(req, res, next)
          if (r && typeof r.catch === 'function') r.catch(next)
        })
      }
      return orig.apply(this, args)
    }
  })
})()

const config = require('./config')
const db = require('./db')

const authRoutes = require('./routes/auth')
const accountRoutes = require('./routes/accounts')
const orderRoutes = require('./routes/orders')
const walletRoutes = require('./routes/wallet')
const payRoutes = require('./routes/pay')
const noticeRoutes = require('./routes/notice')

const app = express()

app.use(express.json({
  limit: '1mb',
  // 保留原始请求体：微信支付回调 /api/pay/notify 验签必须用 raw body
  verify: function (req, res, buf) { req.rawBody = buf }
}))
app.use(express.urlencoded({ extended: false }))

// 健康检查（云托管探活）：顺便验一下数据库是否连通，方便上线排查
app.get('/health', async function (req, res) {
  const info = {
    code: 0,
    msg: 'ok',
    wx: !!(config.wx.appid && config.wx.secret),
    db: false
  }
  try {
    await db.query('SELECT 1 AS ok')
    info.db = true
  } catch (e) {
    info.dbError = e.message
  }
  res.json(info)
})

app.get('/', function (req, res) {
  res.json({ code: 0, msg: 'taoxi esports api' })
})

app.use('/api/auth', authRoutes)
app.use('/api/accounts', accountRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/wallet', walletRoutes)
app.use('/api/pay', payRoutes)
app.use('/api/notice', noticeRoutes)

app.use(function (req, res) {
  res.status(404).json({ code: 404, msg: '接口不存在' })
})

// eslint-disable-next-line no-unused-vars
app.use(function (err, req, res, next) {
  console.error('[api error]', err)
  res.status(500).json({ code: 500, msg: '服务器开小差了，请稍后重试' })
})

module.exports = app
