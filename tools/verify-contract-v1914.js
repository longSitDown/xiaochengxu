/**
 * v1.9.14 契约在线核验（零依赖 Node 18+，直接跑：node tools/verify-contract-v1914.js）
 *
 * 目的：在改代码之前，用「无写库副作用」的方式验证线上工作流是否真的按新文档契约实现。
 * 手段：
 *   1) 端点必填校验：发空 body / 空 query，平台层返回
 *      {"status":2,"msg":"[A, B] 参数缺少必填项"} —— 借此读回**线上真实入参键名**；
 *   2) API-01 → API-02 全链路：核对 MuseumInfo / ExhibitionAreaList / ReservationDateList
 *      的实际字段，重点看 v1.9.13 是否已移除 SessionId / SessionName；
 *   3) API-09 分别用 GET 与 POST 打一次（伪 ReservationId，不产生业务变更），
 *      判断文档「HTTPS GET」与旧实现「POST」哪个是对的；
 *   4) 端点可达性：空请求是否有正常 JSON 响应（而非「未找到流程」/ 纯文本）。
 *
 * ⚠️ 全部请求都刻意不传齐参数，平台层必填校验会在进入业务逻辑前拦截，不会写库。
 *    唯一例外是 API-01（只签令牌）与 API-02（纯查询），均无副作用。
 *
 * 结果写入 tools/verify-contract-v1914.txt，控制台只打印一行摘要。
 */
const https = require('https')
const fs = require('fs')
const path = require('path')
const VENUE = require('../config/venue')

const OUT = path.join(__dirname, 'verify-contract-v1914.txt')
const lines = []
function w(s) { lines.push(String(s == null ? '' : s)) }

function httpJson(url, method, body, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const payload = body === undefined ? null : JSON.stringify(body)
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: method || 'GET',
      timeout: timeoutMs || 15000
    }
    if (payload !== null) {
      opts.headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }
    const req = https.request(opts, (res) => {
      const chunks = []
      res.on('data', (d) => chunks.push(d))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = text
        try { data = JSON.parse(text) } catch (e) { /* 非 JSON 原样保留 */ }
        resolve({ status: res.statusCode, data: data, text: text })
      })
    })
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null, text: 'TIMEOUT' }) })
    req.on('error', (e) => resolve({ status: 0, data: null, text: 'ERROR ' + e.message }))
    if (payload !== null) req.write(payload)
    req.end()
  })
}

function brief(r) {
  if (!r || typeof r.data !== 'object' || r.data === null) {
    return String(r && r.text || '').replace(/\s+/g, ' ').slice(0, 160)
  }
  return JSON.stringify(r.data).slice(0, 400)
}

/** 从 "status:2" 的 msg 里抽出必填键名 */
function requiredKeys(r) {
  const msg = r && r.data && typeof r.data === 'object' ? String(r.data.msg || '') : ''
  const m = /\[([^\]]+)\]/.exec(msg)
  if (!m) return { keys: [], msg: msg }
  return {
    keys: m[1].split(',').map((s) => s.trim()).filter(Boolean),
    msg: msg
  }
}

function diff(expected, actual) {
  const missing = expected.filter((k) => actual.indexOf(k) < 0)
  const extra = actual.filter((k) => expected.indexOf(k) < 0)
  return { missing: missing, extra: extra }
}

/**
 * 文档 v1.9.14 声明的入参键。
 * 探针策略：只给一小部分合法参数（必须让 body 非空，否则平台层回「未解析到数据」），
 * 平台层必填校验会把「其余缺失键」列在 msg 的方括号里，借此反推线上真实入参键名。
 * `expectMissing` = 文档声明的键 - 本次已提供的键。
 */
const HOOK_FEEDBACK = 'https://api.mingdao.com/workflow/hooks2/NmFmNDU3ODk5NGIxODBlMjcyZjUyOWNl'
const HOOK_VERIFY = 'https://api.mingdao.com/workflow/hooks2/NmFmNDRiZjhmMmU2M2RlM2ZiMDA2ZmRm'
const CODE_Q = '?Code=' + encodeURIComponent(VENUE.DEFAULT_CODE)

const CONTRACT = {
  'API-05 场馆预约提交': {
    url: VENUE.ENDPOINTS.reservation.url, method: 'POST',
    body: { Code: VENUE.DEFAULT_CODE }, provided: ['Code'],
    expect: ['Code', 'Token', 'UserId', 'ReservateDateId', 'Visitors'],
    expectMissing: ['Token', 'UserId', 'ReservateDateId', 'Visitors']
  },
  'API-06 微信登录': {
    url: VENUE.ENDPOINTS.wxLogin.url, method: 'POST',
    body: { Code: VENUE.DEFAULT_CODE }, provided: ['Code'],
    expect: ['Code', 'JsCode', 'IsPhone'],
    expectMissing: ['JsCode', 'IsPhone']
  },
  'API-08 提交反馈': {
    url: HOOK_FEEDBACK, method: 'POST',
    body: { Code: VENUE.DEFAULT_CODE }, provided: ['Code'],
    expect: ['Code', 'Token', 'UserId', 'Title', 'Description'],
    expectMissing: ['Token', 'UserId', 'Title', 'Description']
  },
  'API-09 取消预约': {
    url: VENUE.ENDPOINTS.cancelReservation.url + CODE_Q, method: 'GET',
    provided: ['Code'],
    expect: ['Code', 'Token', 'UserId', 'ReservationId'],
    expectMissing: ['Token', 'UserId', 'ReservationId']
  },
  'API-10 更新用户信息': {
    // 混合传参：Code / Token / UserId 走 query，NickName / Avatar 走 body
    url: VENUE.ENDPOINTS.updateUser.url + CODE_Q, method: 'POST',
    body: { NickName: 'probe' }, provided: ['Code', 'NickName'],
    expect: ['Code', 'Token', 'UserId', 'NickName', 'Avatar'],
    expectMissing: ['Token', 'UserId', 'Avatar']
  },
  'API-11 个人信息与预约列表': {
    url: VENUE.ENDPOINTS.profileReservations.url, method: 'POST',
    body: { Code: VENUE.DEFAULT_CODE }, provided: ['Code'],
    expect: ['Code', 'Token', 'UserId'],
    expectMissing: ['Token', 'UserId']
  },
  'API-12 核销预约': {
    url: HOOK_VERIFY, method: 'POST',
    body: { Code: VENUE.DEFAULT_CODE }, provided: ['Code'],
    expect: ['Code', 'Token', 'UserId', 'ReservationId'],
    expectMissing: ['Token', 'UserId', 'ReservationId']
  }
}

async function main() {
  w('博物馆预约管理系统 数据接口文档 v1.9.14 — 在线契约核验')
  w('时间：' + new Date().toLocaleString('zh-CN'))
  w('场馆编号：' + VENUE.DEFAULT_CODE)
  w('说明：全部为空参数探测，平台层必填校验拦截，不写库。')
  w('')

  w('===== 一、端点必填键名（线上实际 vs 文档声明） =====')
  w('探针：只传 Code（API-10 另传 NickName），平台层回「[缺失键] 参数缺少必填项」。')
  for (const name of Object.keys(CONTRACT)) {
    const c = CONTRACT[name]
    const r = await httpJson(c.url, c.method, c.body)
    const rk = requiredKeys(r)
    const d = diff(c.expectMissing, rk.keys)
    const ok = rk.keys.length > 0 && d.missing.length === 0 && d.extra.length === 0
    w('')
    w((ok ? '[一致] ' : '[差异] ') + name + '  HTTP ' + r.status)
    w('  文档声明全量入参：' + c.expect.join(', '))
    w('  本次已提供：' + c.provided.join(', '))
    w('  预期缺失键：' + c.expectMissing.join(', '))
    w('  线上实际缺失键：' + (rk.keys.length ? rk.keys.join(', ') : '（无必填键提示）'))
    w('  原始 msg：' + (rk.msg || brief(r)))
    if (d.missing.length) w('  ⚠ 文档有、线上未要求：' + d.missing.join(', '))
    if (d.extra.length) w('  ⚠ 线上多出：' + d.extra.join(', '))
  }

  w('')
  w('===== 二、API-09 GET / POST 协议对比（伪参数，不产生业务变更） =====')
  const base = VENUE.ENDPOINTS.cancelReservation.url
  const fake = '?Code=' + encodeURIComponent(VENUE.DEFAULT_CODE) +
    '&Token=fake&UserId=00000000-0000-0000-0000-000000000000' +
    '&ReservationId=00000000-0000-0000-0000-000000000000'
  const g = await httpJson(base + fake, 'GET')
  const p = await httpJson(base, 'POST', {
    Code: VENUE.DEFAULT_CODE,
    Token: 'fake',
    UserId: '00000000-0000-0000-0000-000000000000',
    ReservationId: '00000000-0000-0000-0000-000000000000'
  })
  w('  GET  → HTTP ' + g.status + '  ' + brief(g))
  w('  POST → HTTP ' + p.status + '  ' + brief(p))

  w('')
  w('===== 三、API-01 → API-02 真实链路（字段核对） =====')
  const t = await httpJson(VENUE.HOOK_TOKEN + '?Code=' + encodeURIComponent(VENUE.DEFAULT_CODE), 'GET')
  const token = t && t.data && typeof t.data === 'object' ? t.data.token : ''
  w('  API-01：HTTP ' + t.status + '，code=' + (t.data && t.data.code) + '，expired=' + (t.data && t.data.expired) + '，token=' + (token ? '已签发' : '空'))
  if (!token) {
    w('  ⚠ 未取到令牌，跳过 API-02')
  } else {
    const v = await httpJson(VENUE.HOOK_VENUE + '?Code=' + encodeURIComponent(VENUE.DEFAULT_CODE) + '&Token=' + encodeURIComponent(token), 'GET')
    const d = v && v.data && v.data.data
    w('  API-02：HTTP ' + v.status + '，code=' + (v.data && v.data.code) + '，msg=' + (v.data && v.data.msg))
    if (!d || typeof d !== 'object') {
      w('  响应体：' + brief(v))
    } else {
      const info = d.MuseumInfo || {}
      w('  MuseumInfo 字段：' + Object.keys(info).join(', '))
      w('  NeedVerify 是否返回：' + (Object.prototype.hasOwnProperty.call(info, 'NeedVerify') ? '是 → ' + JSON.stringify(info.NeedVerify) : '否（缺省 false）'))
      w('  Status 实际值：' + JSON.stringify(info.Status))
      const areas = Array.isArray(d.ExhibitionAreaList) ? d.ExhibitionAreaList : []
      w('  ExhibitionAreaList 条数：' + areas.length + '，首项字段：' + (areas[0] ? Object.keys(areas[0]).join(', ') : '—'))
      const dates = Array.isArray(d.ReservationDateList) ? d.ReservationDateList : []
      w('  ReservationDateList 条数：' + dates.length)
      const allKeys = {}
      dates.forEach((x) => Object.keys(x || {}).forEach((k) => { allKeys[k] = true }))
      w('  ReservationDateList 全量字段：' + Object.keys(allKeys).join(', '))
      const hasSession = dates.some((x) => x && (x.SessionId !== undefined || x.SessionName !== undefined))
      w('  是否仍含时段字段 SessionId/SessionName：' + (hasSession ? '是' : '否（与 v1.9.13 去时段一致）'))
      w('  首项样本：' + JSON.stringify(dates[0] || {}).slice(0, 500))
    }
  }

  w('')
  w('===== 四、API-11 响应结构（伪 UserId，观察状态字段类型） =====')
  const pr = await httpJson(VENUE.ENDPOINTS.profileReservations.url, 'POST', {
    Code: VENUE.DEFAULT_CODE, Token: 'fake', UserId: '00000000-0000-0000-0000-000000000000'
  })
  w('  HTTP ' + pr.status + '  ' + brief(pr))

  w('')
  w('===== 五、负向响应实测（用于校准回归断言） =====')
  if (token) {
    const q = (base, extra) => base + '?' + Object.keys(extra)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(extra[k])).join('&')
    const a3 = await httpJson(q(VENUE.ENDPOINTS.areaDetail.url,
      { Code: VENUE.DEFAULT_CODE, Token: token, ExhbitAreaId: 'not-a-guid' }), 'GET')
    w('  API-03 伪 ExhbitAreaId：HTTP ' + a3.status + '  ' + brief(a3))
    const wrong = await httpJson(q(VENUE.ENDPOINTS.areaDetail.url,
      { Code: VENUE.DEFAULT_CODE, Token: token, AreaId: 'any' }), 'GET')
    w('  API-03 错键 AreaId   ：HTTP ' + wrong.status + '  ' + brief(wrong))
    const a4 = await httpJson(q(VENUE.ENDPOINTS.exhibitDetail.url,
      { Code: VENUE.DEFAULT_CODE, Token: token, ExhibitId: 'not-a-guid' }), 'GET')
    w('  API-04 伪 ExhibitId  ：HTTP ' + a4.status + '  ' + brief(a4))
  }
  const a6 = await httpJson(VENUE.ENDPOINTS.wxLogin.url, 'POST',
    { Code: VENUE.DEFAULT_CODE, JsCode: 'invalid_probe_' + Date.now(), IsPhone: 0 })
  w('  API-06 非法 JsCode    ：HTTP ' + a6.status + '  ' + brief(a6))
  const a5 = await httpJson(VENUE.ENDPOINTS.reservation.url, 'POST', {
    Code: VENUE.DEFAULT_CODE, Token: token,
    UserId: '00000000-0000-0000-0000-000000000000',
    ReservateDateId: '00000000-0000-0000-0000-000000000000'
  }, 25000)
  w('  API-05 缺 Visitors    ：HTTP ' + a5.status + '  ' + brief(a5))

  w('')
  w('===== 六、核验结论（供代码改动决策） =====')
  w('  · 端点键名以「一」为准；文档与线上不一致处需在前端做兼容而不是二选一。')
  w('  · API-09 协议以「二」为准；若 GET/POST 均可，按文档统一为 GET。')
  w('  · v1.9.13 去时段以「三」为准；若线上仍回时段字段，前端保留聚合兼容层。')
  w('  · 负向响应以「五」为准；线上波动导致的空 body / 超时需纳入回归容错。')
  w('')
  w('报告生成完毕。')

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log('契约核验报告已写入：' + OUT)
}

main().catch((e) => {
  w('脚本异常：' + (e && e.stack ? e.stack : e))
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.error('契约核验异常，部分结果已写入：' + OUT)
  process.exitCode = 1
})
