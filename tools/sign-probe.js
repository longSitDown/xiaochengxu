/**
 * HAP-Sign 签名变体探测
 *
 * 背景：明道云官方 help.mingdao.com/api/v3 没有给出签名算法，只在组织 API 文档里
 * 提供了一个 C# 参考实现（参数排序 → SHA256 → 小写 hex → Base64）。但「参数怎么拼接」
 * 「时间戳用秒还是毫秒」都没写清，纯靠猜无法联调。
 *
 * 这个脚本把常见组合全跑一遍，用 GET /v3/app 探出哪一种能通过，
 * 然后把结果写进 server/.env 的 HAP_SIGN_VARIANT，后端即可正常代签。
 *
 * 用法：
 *   1. 在 server/.env 里填好 HAP_BASE / HAP_APPKEY / HAP_SECRET
 *   2. node tools/sign-probe.js
 */
const crypto = require('crypto')
const { config } = require('../server/config')

const JOINS = [
  ['kv', 'AppKey=xx&SecretKey=yy&Timestamp=zz'],
  ['kvnl', '同上，换行分隔'],
  ['plain', '三个值直接相连'],
  ['json', '{"AppKey":"xx","SecretKey":"yy","Timestamp":"zz"}']
]
const ENCODES = [
  ['b64hex', 'Base64(小写hex字符串)  ← C# 示例'],
  ['b64raw', 'Base64(原始摘要字节)'],
  ['hex', '小写hex']
]
const TS_UNITS = [
  ['ms', '毫秒'],
  ['s', '秒']
]

function plain(appKey, secret, timestamp, join) {
  const pairs = [['AppKey', appKey], ['SecretKey', secret], ['Timestamp', String(timestamp)]]
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

function sign(appKey, secret, timestamp, join, encode) {
  const digest = crypto.createHash('sha256').update(plain(appKey, secret, timestamp, join), 'utf8').digest()
  if (encode === 'b64raw') return digest.toString('base64')
  if (encode === 'hex') return digest.toString('hex')
  return Buffer.from(digest.toString('hex'), 'utf8').toString('base64')
}

async function probe(join, encode, tsUnit) {
  const ts = tsUnit === 's' ? Math.floor(Date.now() / 1000) : Date.now()
  const signature = sign(config.HAP_APPKEY, config.HAP_SECRET, ts, join, encode)
  let res
  try {
    res = await fetch(config.HAP_BASE + '/v3/app', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'HAP-Appkey': config.HAP_APPKEY,
        'HAP-Sign': signature,
        'HAP-Timestamp': String(ts)
      }
    })
  } catch (e) {
    return { ok: false, note: '网络失败：' + (e && e.message) }
  }
  const text = await res.text()
  let body = {}
  try {
    body = JSON.parse(text)
  } catch (e) {
    return { ok: false, note: 'HTTP ' + res.status + ' 非 JSON：' + text.slice(0, 80) }
  }
  const ok = body.success === true && body.error_code === 1
  return {
    ok,
    note: ok ? '通过（HTTP ' + res.status + '）' : 'HTTP ' + res.status + ' / code=' + body.error_code + ' / ' + (body.error_msg || '')
  }
}

async function main() {
  if (!config.HAP_APPKEY || !config.HAP_SECRET) {
    console.error('请先在 server/.env 里填写 HAP_APPKEY 与 HAP_SECRET')
    process.exit(1)
  }
  console.log('HAP_BASE   :', config.HAP_BASE)
  console.log('AppKey     :', config.HAP_APPKEY.slice(0, 4) + '****' + config.HAP_APPKEY.slice(-4))
  console.log('待测组合   :', JOINS.length * ENCODES.length * TS_UNITS.length, '种\n')

  const hits = []
  let index = 0
  for (const [join] of JOINS) {
    for (const [encode] of ENCODES) {
      for (const [tsUnit] of TS_UNITS) {
        index += 1
        const variant = join + '|' + encode + '|' + tsUnit
        const r = await probe(join, encode, tsUnit)
        const mark = r.ok ? '✅' : '  '
        console.log(mark, String(index).padStart(2, ' ') + '.', variant.padEnd(18, ' '), r.note)
        if (r.ok) hits.push(variant)
      }
    }
  }

  console.log('')
  if (!hits.length) {
    console.log('❌ 24 种组合全部失败。请按以下顺序排查：')
    console.log('   1. AppKey / Secret 是否抄错或已失效（回明道云后台重新生成一次）')
    console.log('   2. HAP_BASE 是否与账号环境匹配（SaaS 固定 https://api.mingdao.com）')
    console.log('   3. 该授权密钥是否已绑定到这个应用、是否赋了工作表读写范围')
    console.log('   4. 若返回 401/403 且报错信息提到 sign，说明算法仍不匹配：')
    console.log('      可在浏览器登录明道云后打开「应用 → API 开发文档」，')
    console.log('      那里通常有带签名的实际请求示例，照抄其 Sign 值反推即可')
    process.exit(2)
  }

  console.log('✅ 可用变体：')
  hits.forEach((h) => {
    const parts = h.split('|')
    console.log('   HAP_SIGN_VARIANT=' + parts[0] + '|' + parts[1] + '    (时间戳单位：' + (parts[2] === 's' ? '秒' : '毫秒') + ')')
  })
  console.log('\n把上面这行写进 server/.env，重启后端即可。')
  if (hits.length > 1) {
    console.log('注：多个变体同时通过时，取第一个即可。')
  }
}

main().catch((e) => {
  console.error('探测异常：', e && e.message)
  process.exit(1)
})
