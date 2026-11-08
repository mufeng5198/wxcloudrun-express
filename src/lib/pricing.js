// 服务端定价校验：微信支付下单前重算金额，与客户端报价不一致直接拒绝
// 数据来源与小程序端完全一致：
//   - 价目表文案档位：lib/price-docs.js（utils/price.js 的服务端副本，改价需两边同步）
//   - 陪玩小时价（k3）：按打手段位计价（utils/data.js PLAYER_LIST 的 base）
//   - 固定价：k1 体验单 99 / k2 保底单 168；女陪加价 15/单位；趣味单指定地图加价 100
const priceDocs = require('./price-docs')
const DOCS = priceDocs.DOCS

const PKG_FIXED = { k1: 99, k2: 168 }
const FEMALE_FEE = 15
const FUN_MAP_FEE = 100

/** 陪玩小时价（与 utils/data.js PLAYER_LIST 的 base 一致） */
const PLAYER_BASE = {
  p1: 80, p2: 45, p3: 80, p4: 100, p5: 45, p6: 45, p7: 45, p8: 120
}

/** 从表格行提取金额（与 utils/price.js parseAmount 保持一致） */
function parseAmount(row) {
  for (let i = 0; i < row.length; i++) {
    const s = String(row[i] || '').trim()
    let m = s.match(/(\d+(?:\.\d+)?)\s*(?:元|块|rmb)/i)
    if (!m) m = s.match(/(\d+(?:\.\d+)?)\s*\/\s*[hH]/)
    if (!m) m = s.match(/(\d+(?:\.\d+)?)\s+保\s*\d+/)
    if (!m) m = s.match(/^(\d+(?:\.\d+)?)$/)
    if (m) return Math.round(Number(m[1]))
  }
  return 0
}

/** 按 sectionId 在全部价目文档中找专区，并收集该专区所有合法档位价 */
function findSectionPrices(sectionId) {
  if (!sectionId) return null
  let section = null
  Object.keys(DOCS).forEach(function (docId) {
    const tabs = (DOCS[docId] && DOCS[docId].tabs) || []
    tabs.forEach(function (tab) {
      ;(tab.sections || []).forEach(function (s) {
        if (s.id === sectionId) section = s
      })
    })
  })
  if (!section) return null
  const prices = []
  ;(section.blocks || []).forEach(function (b) {
    if (b.type === 'table' && Array.isArray(b.rows)) {
      b.rows.forEach(function (r) {
        const p = parseAmount(r)
        if (p > 0) prices.push(p)
      })
    } else if (b.type === 'text') {
      const m = String(b.value || '').match(/(\d+)\s*(?:元|R|块)/i)
      if (m) {
        const p = Math.round(Number(m[1]))
        if (p > 0) prices.push(p)
      }
    }
  })
  return { section: section, prices: prices }
}

/**
 * 校验下单金额
 * @param input {pkgId, sectionId, designatedPlayerId, price, count, mapFee, femaleFee,
 *               fun, fixedMap, map, playmateGender, discount, couponId, payAmount}
 * @returns {ok:true, total, discount} 或 {ok:false, msg}
 */
function validateAmount(input) {
  input = input || {}
  const count = Math.floor(Number(input.count))
  if (!(count >= 1 && count <= 20)) return { ok: false, msg: '数量不合法' }
  const price = Number(input.price)
  if (!(price > 0)) return { ok: false, msg: '价格不合法' }

  // 1) 单价校验
  let expectedPrice = null
  let fixedMap = input.fixedMap || ''
  if (PKG_FIXED[input.pkgId] !== undefined) {
    expectedPrice = PKG_FIXED[input.pkgId]
  } else if (input.pkgId === 'k3') {
    const base = PLAYER_BASE[input.designatedPlayerId]
    if (!base) return { ok: false, msg: '打手不存在或价目未配置' }
    expectedPrice = base
  } else {
    // 价目表页下单（pkgId=auto）：价格必须是该专区档位表里出现过的价格
    const found = findSectionPrices(input.sectionId)
    if (!found) return { ok: false, msg: '下单专区不存在' }
    if (found.prices.indexOf(Math.round(price)) === -1) return { ok: false, msg: '价格与价目表不符' }
    expectedPrice = price
    // 固定地图专区的地图以服务端数据为准
    fixedMap = found.section.fixedMap || ''
    if (fixedMap && input.fixedMap !== fixedMap) return { ok: false, msg: '该专区地图固定，不可修改' }
  }
  if (Number(price) !== Number(expectedPrice)) return { ok: false, msg: '价格与价目表不符' }

  // 2) 地图加价：趣味单指定地图 +100；固定地图专区不算选图
  const expectedMapFee = (input.fun && input.map && !fixedMap) ? FUN_MAP_FEE : 0
  if (Number(input.mapFee) !== expectedMapFee) return { ok: false, msg: '地图加价不符' }

  // 3) 女陪加价：15 × 数量
  const expectedFemaleFee = input.playmateGender === 'female' ? FEMALE_FEE * count : 0
  if (Number(input.femaleFee) !== expectedFemaleFee) return { ok: false, msg: '女陪加价不符' }

  // 4) 合计与实付
  const total = Number((price * count + expectedMapFee + expectedFemaleFee).toFixed(2))
  const discount = Number(input.discount) || 0
  if (discount < 0 || discount > 50) return { ok: false, msg: '优惠金额不合法' }
  if (discount > 0 && !input.couponId) return { ok: false, msg: '优惠需绑定优惠券' }
  const payAmount = Number(input.payAmount)
  if (payAmount !== Number((total - discount).toFixed(2))) return { ok: false, msg: '实付金额不符' }

  return { ok: true, total: total, discount: discount, fixedMap: fixedMap }
}

module.exports = {
  validateAmount: validateAmount,
  FEMALE_FEE: FEMALE_FEE,
  FUN_MAP_FEE: FUN_MAP_FEE
}
