/**
 * 明道云 HAP API V3 签名与转发
 *
 * 为什么必须放在服务端：HAP-Appkey / HAP-Sign 代表「应用管理员」身份，
 * 拿到即可读写整库。若写进小程序包，反编译即可获得，等同于把后台密钥公开。
 *
 * 签名算法说明（重要）：
 *   官方 help.mingdao.com/api/v3 未给出算法，只在组织 API 文档里提供了一个 C# 参考实现：
 *     1. 参数 { AppKey, SecretKey, Timestamp } 按 key 排序拼接
 *     2. SHA256(拼接串) → 小写 hex 字符串
 *     3. Base64(该 hex 字符串的 UTF8 字节)
 *   其中「拼接格式」官方未明确（是 k=v&k=v 还是别的，是否参与 Timestamp 也未写清）。
 *   因此这里把拼接方式与摘要编码做成可切换的变体，用 tools/sign-probe.js 实测后
 *   把正确变体写进 HAP_SIGN_VARIANT 环境变量即可，无需改代码。
 */
const crypto = require('crypto')
const { config } = require('./config')

/** 拼装待签名原文 */
function buildPlain(appKey, secret, timestamp, join) {
  const pairs = [
    ['AppKey', appKey],
    ['SecretKey', secret],
    ['Timestamp', String(timestamp)]
  ]
  // 字典序：AppKey < SecretKey < Timestamp，排序后与声明顺序一致
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1))
  if (join === 'kvnl') return pairs.map((p) => p[0] + '=' + p[1]).join('\n')
  if (join === 'plain') return pairs.map((p) => p[1]).join('')
  if (join === 'json') {
    const o = {}
    pairs.forEach((p) => {
      o[p[0]] = p[1]
    })
    return JSON.stringify(o)
  }
  return pairs.map((p) => p[0] + '=' + p[1]).join('&')
}

/** 生成签名 */
function sign(appKey, secret, timestamp, variant) {
  const parts = String(variant || config.HAP_SIGN_VARIANT).split('|')
  const join = parts[0] || 'kv'
  const encode = parts[1] || 'b64hex'
  const plain = buildPlain(appKey, secret, timestamp, join)
  const digest = crypto.createHash('sha256').update(plain, 'utf8').digest()
  const hex = digest.toString('hex')
  if (encode === 'b64raw') return digest.toString('base64')
  if (encode === 'hex') return hex
  return Buffer.from(hex, 'utf8').toString('base64')
}

/** 取某个变体的签名原文，便于日志排查 */
function debugPlain(appKey, secret, timestamp, variant) {
  const join = String(variant || config.HAP_SIGN_VARIANT).split('|')[0]
  // 日志里隐去密钥中段
  const masked = String(secret).length > 8
    ? secret.slice(0, 4) + '****' + secret.slice(-4)
    : '****'
  return buildPlain(appKey, masked, timestamp, join)
}

/**
 * 透传到明道云
 * @param {{method:string, path:string, query?:string, body?:object, variant?:string}} req
 * @returns {Promise<{status:number, body:object}>}
 */
async function forward(req) {
  const method = String(req.method || 'GET').toUpperCase()
  const path = req.path.charAt(0) === '/' ? req.path : '/' + req.path
  const timestamp = Date.now()
  const signature = sign(config.HAP_APPKEY, config.HAP_SECRET, timestamp, req.variant)

  const headers = {
    'Content-Type': 'application/json',
    'HAP-Appkey': config.HAP_APPKEY,
    'HAP-Sign': signature
  }
  // 部分实现要求把时间戳一并回传；多带一个头对校验无副作用
  headers['HAP-Timestamp'] = String(timestamp)

  const url = config.HAP_BASE + path + (req.query ? '?' + req.query : '')
  const init = { method, headers }
  // GET 不能带 body；明道云的列表查询用 POST，故非 GET 才序列化
  if (method !== 'GET' && method !== 'HEAD' && req.body !== undefined) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  }

  let res
  try {
    res = await fetch(url, init)
  } catch (e) {
    return {
      status: 502,
      body: { success: false, error_code: -1, error_msg: '明道云连接失败：' + (e && e.message), data: {} }
    }
  }

  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch (e) {
    body = {
      success: false,
      error_code: -1,
      error_msg: '明道云返回非 JSON（HTTP ' + res.status + '）：' + text.slice(0, 200),
      data: {}
    }
  }
  return { status: res.status, body }
}

module.exports = { sign, buildPlain, debugPlain, forward }
