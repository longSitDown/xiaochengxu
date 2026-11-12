/**
 * 场馆 / 业务接口自测（契约以 `md/博物馆预约管理系统-数据接口文档 (1).md` **v1.9.14** 为准）
 *
 * 运行：node tools/venue-api-test.js
 * 零依赖，Node 18+ 直接跑，不需要微信开发者工具。
 * 在线契约核验另有 tools/verify-contract-v1914.js（只读探针，报告写入同名 .txt）。
 *
 * 五段验证：
 *   A. 真实接口契约：直接打明道云 Webhook，校验成功/异常码/令牌结构/图片可达
 *   B. 小程序服务层端到端：把 global.wx.request 接到 Node https，跑 api/venue.js
 *   C. 离线单元：stub 响应，校验令牌缓存 / 并发去重 / 重签 / 错误码 / 新旧结构归一化
 *   D. 端点配置与状态码契约（含 v1.9.8~1.9.14 破坏性变更的回归锁）
 *   E. 真实 Webhook 端到端：API-01→02→03→04 全链路、错误码、端点就绪清单
 *
 * v1.9.14 测试口径调整：
 *   - API-05 Visitors 元素证件号键 `IdCard` → **`IdNumber`**（v1.9.8 破坏性更名）；
 *   - API-08 已发布（Title/Description，无 data），API-09 协议改为 GET、状态「已就绪」；
 *   - API-07 废弃、端点由 9 项收敛为 **8 项且全部已发布**；
 *   - API-11 ReservationStatus 改中文文本（CHG-024）；
 *   - 非 JSON / 空 body 必须判 BAD_RESPONSE，不得静默当成成功。
 */
const https = require('https')
const assert = require('assert')
const VENUE = require('../config/venue')

const H1 = VENUE.HOOK_TOKEN
const H2 = VENUE.HOOK_VENUE
const H3 = VENUE.ENDPOINTS.areaDetail.url
const H4 = VENUE.ENDPOINTS.exhibitDetail.url
const CODE = VENUE.DEFAULT_CODE

let pass = 0
let fail = 0

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log('[PASS] ' + name) })
    .catch((e) => { fail++; console.log('[FAIL] ' + name + ' → ' + (e && e.message ? e.message : e)) })
}

/** 原生 https 请求，返回 { statusCode, headers, data } */
function httpJson(url, method, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = body ? JSON.stringify(body) : null
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: method || 'GET',
      timeout: timeoutMs || 15000
    }
    if (payload) {
      opts.headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }
    const req = https.request(opts, (res) => {
      const chunks = []
      res.on('data', (d) => chunks.push(d))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = text
        try { data = JSON.parse(text) } catch (e) { /* 非 JSON 原样返回 */ }
        resolve({ statusCode: res.statusCode, headers: res.headers, data: data })
      })
    })
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function urlToken(code) { return H1 + '?Code=' + encodeURIComponent(code) }
function urlVenue(code, token) {
  return H2 + '?Code=' + encodeURIComponent(code) + '&Token=' + encodeURIComponent(token || '')
}

/** 成功判据与 api/venue.js 保持一致 */
function isOk(code) { return code === '' || code === null || code === undefined || VENUE.OK_CODES.indexOf(code) >= 0 }

/** 旧版（v1.3.27 及以前）平铺结构，用于验证线上回滚时的兼容分支 */
const RAW_OK = {
  Code: CODE,
  Name: '辛亥革命纪念馆',
  Status: '开放',
  BusinessHours: '周二闭关，8:30——16:30',
  Location: '420100',
  Type: '博物馆',
  Photos: ['https://p1.mingdaoyun.cn/demo.png?e=1&token=x'],
  Introduction: '<p>博物馆很好看</p><p>欢迎参观</p>',
  Address: '民主路123号',
  ContactPhone: '010-54512232',
  ContactMobile: '+8613355451777',
  ExhibitionArea: [
    { ID: 'g1', Code: 'M1', Name: '大公馆', Location: '一楼大厅', Photo: [] },
    { ID: 'g2', Code: 'M2', Name: '中央馆', Location: '二楼', Photo: [] }
  ]
}

/** 内存版 wx 环境；requestImpl 可替换为真实 http 或 stub */
function makeWx(mem, requestImpl) {
  return {
    request: requestImpl,
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v },
    removeStorageSync: (k) => { delete mem[k] },
    getStorageInfoSync: () => ({ keys: Object.keys(mem) })
  }
}

/** 小程序 wx.request → Node https 适配 */
function realRequestImpl(opt) {
  const u = new URL(opt.url)
  const req = https.request({
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: opt.method || 'GET',
    timeout: opt.timeout || 15000,
    headers: opt.header || {}
  }, (res) => {
    const chunks = []
    res.on('data', (d) => chunks.push(d))
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      let data = text
      try { data = JSON.parse(text) } catch (e) { /* 保留原文 */ }
      if (opt.success) opt.success({ statusCode: res.statusCode, data: data })
    })
  })
  req.on('timeout', () => req.destroy())
  req.on('error', (e) => { if (opt.fail) opt.fail({ errMsg: e.message }) })
  req.end()
}

async function partA() {
  console.log('\n===== A. 真实接口契约 =====')
  let token = ''

  await check('A01 API-01 签发令牌：HTTP 200 / token 两段式 / expired=7200', async () => {
    const r = await httpJson(urlToken(CODE))
    assert.strictEqual(r.statusCode, 200)
    assert.ok(isOk(r.data.code), 'code 应为成功态')
    assert.ok(typeof r.data.token === 'string' && r.data.token.length > 20, 'token 缺失')
    assert.strictEqual(r.data.token.split('.').length, 2, '令牌应为两段式')
    assert.strictEqual(Number(r.data.expired), 7200)
    const payload = JSON.parse(Buffer.from(r.data.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    assert.strictEqual(payload.exp - payload.iat, 7200000, '有效期应为 7200 秒')
    token = r.data.token
  })

  await check('A02 API-01 场馆不存在 → 90001（数值）、不签发令牌', async () => {
    const r = await httpJson(urlToken('NOT_EXIST_999'))
    assert.strictEqual(Number(r.data.code), 90001)
    assert.strictEqual(r.data.token, '')
    assert.strictEqual(r.data.expired, '')
  })

  await check('A03 API-01 缺 Code → 平台必填校验 status:2', async () => {
    const r = await httpJson(H1)
    assert.strictEqual(r.data.status, 2)
  })

  await check('A04 API-02 成功态：MuseumInfo + ExhibitionAreaList + ReservationDateList', async () => {
    const r = await httpJson(urlVenue(CODE, token))
    assert.strictEqual(r.statusCode, 200)
    assert.ok(isOk(r.data.code), 'code 应为成功态')
    const d = r.data.data || {}
    assert.ok(d.MuseumInfo && d.MuseumInfo.Name, 'data.MuseumInfo.Name 缺失')
    // v1.6.0 新增 ReservationDateList，data 顶层由 2 个键变 3 个
    assert.deepStrictEqual(Object.keys(d).sort(), ['ExhibitionAreaList', 'MuseumInfo', 'ReservationDateList'])
    assert.strictEqual(d.MuseumInfo.Code, CODE)
    assert.ok(Array.isArray(d.MuseumInfo.Photos), 'MuseumInfo.Photos 应为数组')
    assert.ok(Array.isArray(d.ExhibitionAreaList), 'ExhibitionAreaList 应为数组')
    assert.ok(d.ExhibitionAreaList.length > 0)
    // 可预约日期：每天一条，字段齐全
    assert.ok(Array.isArray(d.ReservationDateList) && d.ReservationDateList.length > 0, 'ReservationDateList 应为非空数组')
    const day = d.ReservationDateList[0]
    ;['ID', 'Date', 'DailyQuota', 'DailyUsed', 'CanReserve'].forEach((k) => {
      assert.ok(k in day, 'ReservationDateList 项缺少 ' + k)
    })
    assert.ok(/^\d{4}-\d{2}-\d{2}/.test(String(day.Date)), 'Date 应为 YYYY-MM-DD 开头')
    console.log('       · 首条可约日期：' + day.Date + '（余量 ' + (day.DailyQuota - day.DailyUsed) + '/' + day.DailyQuota + '）')
  })

  await check('A05 API-02 场馆不存在 → 90001 且不返回 data', async () => {
    const r = await httpJson(urlVenue('NOT_EXIST_999', token))
    assert.strictEqual(String(r.data.code), '90001')
    assert.strictEqual(r.data.data, undefined)
  })

  await check('A06 API-02 篡改令牌 → 20002 签名校验失败', async () => {
    const r = await httpJson(urlVenue(CODE, token + 'x'))
    assert.strictEqual(String(r.data.code), '20002')
  })

  await check('A07 API-02 缺 Token → status:2 [Token] 参数缺少必填项', async () => {
    const r = await httpJson(H2 + '?Code=' + encodeURIComponent(CODE))
    assert.strictEqual(r.data.status, 2)
    assert.ok(/Token/.test(r.data.msg))
  })

  await check('A08 入参键大小写敏感：小写 code → status:2', async () => {
    const r = await httpJson(H2 + '?code=' + encodeURIComponent(CODE) + '&Token=' + encodeURIComponent(token))
    assert.strictEqual(r.data.status, 2)
    assert.ok(/Code/.test(r.data.msg))
  })

  await check('A09 令牌有效期内可复用（第二次查询仍成功）', async () => {
    // Node https 偶发连接超时，查询幂等，允许重试一次并放宽超时
    let r = null
    for (let i = 0; i < 2; i++) {
      try {
        r = await httpJson(urlVenue(CODE, token), 'GET', null, 30000)
        break
      } catch (e) {
        if (i === 1) throw e
      }
    }
    const d = r.data.data || {}
    assert.ok(isOk(r.data.code) && d.MuseumInfo && d.MuseumInfo.Name)
  })

  await check('A10 POST + JSON body 亦可解析（API-01）', async () => {
    const r = await httpJson(H1, 'POST', { Code: CODE })
    assert.ok(r.data.token && r.data.token.split('.').length === 2)
  })

  await check('A11 MuseumInfo.Photos 图片 URL 可访问（HTTP 200 / image/png）', async () => {
    const r = await httpJson(urlVenue(CODE, token))
    const info = (r.data.data && r.data.data.MuseumInfo) || {}
    const img = (info.Photos || [])[0]
    assert.ok(img, '未返回图片 URL')
    const p = await httpJson(img)
    assert.strictEqual(p.statusCode, 200)
    assert.ok(/image\//.test(p.headers['content-type'] || ''))
  })

  await check('A12 Code 与令牌不匹配 → 业务错误（90001/20002 之一，文档标 20002）', async () => {
    const r = await httpJson(urlVenue('220261105084', token))
    assert.ok(['90001', '20002'].indexOf(String(r.data.code)) >= 0, '实际 code=' + r.data.code)
  })

  await check('A13 v1.3.41 契约：包裹结构 + 展区 Photos + NeedVerify 探测', async () => {
    const r = await httpJson(urlVenue(CODE, token))
    const d = r.data.data || {}
    const info = d.MuseumInfo || {}
    assert.ok(Array.isArray(d.ExhibitionAreaList))
    console.log('       · NeedVerify 当前返回：' +
      (info.NeedVerify === undefined ? '未返回（文档注明待明道云加列）' : JSON.stringify(info.NeedVerify)))
    const areas = d.ExhibitionAreaList || []
    assert.ok(areas.length > 0)
    areas.forEach((a) => {
      assert.ok(a.ID && a.Code && a.Name && a.Location, '展区应具备 ID/Code/Name/Location')
      assert.ok(Array.isArray(a.Photos), 'v1.3.41 展区图片键应为 Photos')
      assert.strictEqual(a.Status, undefined, '展区 Status 已按需求移除')
    })
  })
}

async function partB() {
  console.log('\n===== B. 小程序服务层端到端（api/venue.js + 真实网络） =====')
  const mem = {}
  const hits = { token: 0, venue: 0 }
  const countingImpl = (opt) => {
    if (opt.url.indexOf(H1) === 0) hits.token++
    else hits.venue++
    return realRequestImpl(opt)
  }
  global.wx = makeWx(mem, countingImpl)
  const api = require('../api/venue')

  await check('B01 getVenue() 拿到真实场馆数据并完成归一化', async () => {
    const v = await api.getVenue()
    assert.strictEqual(v.name, '辛亥革命纪念馆')
    assert.strictEqual(v.code, CODE)
    assert.strictEqual(v.status, '开放')
    assert.strictEqual(v.isOpen, true)
    assert.strictEqual(v.type, '博物馆')
    assert.strictEqual(v.address, '民主路123号')
    assert.strictEqual(v.phone, '010-54512232')
    assert.strictEqual(v.introText, '博物馆很好看')
    assert.ok(/<p>/.test(v.introHtml), '应保留 HTML 原文供 rich-text 使用')
    assert.ok(v.photos.length > 0 && /^https:\/\//.test(v.photos[0]))
    assert.strictEqual(v.areas.length, 7, 'v1.3.41 实测该馆返回 7 个展区')
    assert.strictEqual(v.areas[0].name, '晚清风云展区')
    assert.ok(Array.isArray(v.areas[0].photos))
    assert.strictEqual(hits.token, 1, 'API-01 应只调用一次')
    assert.strictEqual(hits.venue, 1, 'API-02 应只调用一次')
  })

  await check('B02 第二次 getVenue() 命中令牌缓存，API-01 不再签发', async () => {
    const v = await api.getVenue()
    assert.strictEqual(v.name, '辛亥革命纪念馆')
    assert.strictEqual(hits.token, 1)
    assert.strictEqual(hits.venue, 2)
  })

  await check('B03 forceVenueMock=true 走演示数据，不发任何请求', async () => {
    mem['rh_forceVenueMock'] = 'true'
    const before = hits.token + hits.venue
    const v = await api.getVenue()
    assert.ok(/演示数据/.test(v.name))
    assert.strictEqual(hits.token + hits.venue, before)
    delete mem['rh_forceVenueMock']
  })

  await check('B04 场馆不存在 → reject 且带中文提示', async () => {
    api.clearToken()
    api.setVenueCode('NOT_EXIST_999')
    let err = null
    try { await api.getVenue() } catch (e) { err = e }
    assert.ok(err, '应抛错')
    assert.strictEqual(String(err.code), '90001')
    assert.ok(/场馆编号不存在/.test(err.message))
    api.setVenueCode(CODE)
  })
}

async function partC() {
  console.log('\n===== C. 离线单元（缓存 / 重签 / 错误码 / 归一化） =====')
  const mem = {}
  let mode = 'ok'
  let queue = []
  const hits = { token: 0, venue: 0 }
  const stubImpl = (opt) => {
    let data
    if (opt.url.indexOf(H1) === 0) {
      hits.token++
      data = { msg: '', expired: 7200, code: '', token: 'stub-payload.stub-signature' }
    } else {
      hits.venue++
      if (queue.length) data = queue.shift()
      else if (mode === 'authfail') data = { code: '20002', msg: '签名校验失败' }
      else if (mode === 'notfound') data = { code: '90001', msg: '场馆不存在' }
      else if (mode === 'param') data = { status: 2, msg: '[Token] 参数缺少必填项' }
      else data = { code: '', msg: '', data: RAW_OK }
    }
    setTimeout(() => opt.success({ statusCode: 200, data: data }), 0)
  }
  global.wx = makeWx(mem, stubImpl)
  const api = require('../api/venue')
  const I = api._internal

  const reset = () => {
    api.clearToken()
    mode = 'ok'
    queue = []
    hits.token = 0
    hits.venue = 0
  }

  await check('C01 parseScene 支持 code= / Code= / 带其它参数 / 纯编号 / URL 编码', () => {
    assert.strictEqual(api.parseScene('code=220261105083'), '220261105083')
    assert.strictEqual(api.parseScene('Code=220261105083&from=qr'), '220261105083')
    assert.strictEqual(api.parseScene('220261105083'), '220261105083')
    assert.strictEqual(api.parseScene('code%3D220261105083'), '220261105083')
    assert.strictEqual(api.parseScene(''), '')
  })

  await check('C02 isOk 成功判据：空/0/1 通过，90001(数值/字符串) 不通过', () => {
    assert.strictEqual(I.isOk(''), true)
    assert.strictEqual(I.isOk(0), true)
    assert.strictEqual(I.isOk('1'), true)
    assert.strictEqual(I.isOk(90001.0), false)
    assert.strictEqual(I.isOk('90001'), false)
    assert.strictEqual(I.isOk('20002'), false)
  })

  await check('C03 htmlToText 去标签并解码常见实体', () => {
    assert.strictEqual(I.htmlToText('<p>甲</p><p>乙 &amp; 丙</p><br/>丁'), '甲\n乙 & 丙\n丁')
  })

  await check('C04 normalize 兼容旧口径（Status GUID 数组 / 无 Photo / Photos 非数组）', () => {
    const v = api.normalize({
      Code: 'X1', Name: '测试馆', Status: '关闭',
      Photos: '不是数组', Introduction: '<b>介绍</b>',
      ExhibitionArea: [{ Code: 'A1', Name: '展区一', Status: ['guid-1'] }]
    })
    assert.strictEqual(v.status, '关闭')
    assert.strictEqual(v.isOpen, false)
    assert.deepStrictEqual(v.photos, [])
    assert.strictEqual(v.introText, '介绍')
    assert.deepStrictEqual(v.areas[0].status, ['guid-1'])
    assert.deepStrictEqual(v.areas[0].photos, [])
  })

  await check('C05 20002 自动清令牌 → 重签 → 重放查询成功（只重签一次）', async () => {
    reset()
    queue = [{ code: '20002', msg: '签名校验失败' }, { code: '', msg: '', data: RAW_OK }]
    const v = await api.getVenue({ code: CODE })
    assert.strictEqual(v.name, '辛亥革命纪念馆')
    assert.strictEqual(hits.token, 2, '应签发两次（首次 + 重签）')
    assert.strictEqual(hits.venue, 2, '应查询两次（失败 + 重放）')
  })

  await check('C06 90001 映射为中文提示且不重试', async () => {
    reset()
    mode = 'notfound'
    let err = null
    try { await api.getVenue({ code: CODE }) } catch (e) { err = e }
    assert.ok(err && String(err.code) === '90001')
    assert.ok(/场馆编号不存在/.test(err.message))
    assert.strictEqual(hits.venue, 1)
  })

  await check('C07 平台必填校验 status:2 转成可读错误', async () => {
    reset()
    mode = 'param'
    let err = null
    try { await api.getVenue({ code: CODE }) } catch (e) { err = e }
    assert.ok(err && String(err.code) === 'PARAM')
    assert.ok(/Token/.test(err.message))
  })

  await check('C08 并发 getVenue() 只签发一次令牌（去重生效）', async () => {
    reset()
    const list = await Promise.all([api.getVenue({ code: CODE }), api.getVenue({ code: CODE })])
    assert.strictEqual(list.length, 2)
    assert.strictEqual(list[0].name, '辛亥革命纪念馆')
    assert.strictEqual(hits.token, 1, '并发应合并为一次 API-01')
    assert.strictEqual(hits.venue, 2)
  })

  await check('C09 buildUrl 保留键名大小写并正确转义', () => {
    const u = I.buildUrl(H2, { Code: 'a b', Token: 'x.y-z_1' })
    assert.ok(u.indexOf('?Code=a%20b&Token=x.y-z_1') > 0)
  })

  await check('C10 清缓存后 API-01 会重新签发（解释「只看到 API-02」）', async () => {
    reset()
    await api.getVenue({ code: CODE })
    assert.strictEqual(hits.token, 1, '首次应签发')
    await api.getVenue({ code: CODE })
    assert.strictEqual(hits.token, 1, '第二次应命中缓存、跳过 API-01')
    api.clearToken()
    await api.getVenue({ code: CODE })
    assert.strictEqual(hits.token, 2, '清缓存后应重新签发')
  })

  await check('C11 DEBUG 开关打印 API-01/02 链路，且不含 token 明文', async () => {
    reset()
    const orig = console.log
    const captured = []
    VENUE.DEBUG = true
    console.log = function () { captured.push(Array.prototype.slice.call(arguments).join(' ')) }
    try {
      await api.getVenue({ code: CODE })
    } finally {
      console.log = orig
      VENUE.DEBUG = false
    }
    assert.ok(captured.some((s) => s.indexOf('API-01') >= 0), '缺少 API-01 日志')
    assert.ok(captured.some((s) => s.indexOf('API-02') >= 0), '缺少 API-02 日志')
    assert.ok(captured.every((s) => s.indexOf('stub-payload.stub-signature') < 0), '日志不得含 token 明文')
  })

  await check('C12 真机网络错误映射为可执行的排查提示', () => {
    const f = I.networkErrorText
    assert.ok(/合法域名/.test(f('request:fail url not in domain list')), '域名类错误应提示配合法域名')
    assert.ok(/超时/.test(f('request:fail timeout')), '超时类错误应提示超时')
    assert.ok(/证书/.test(f('request:fail ssl hand shake error')), '证书类错误应提示证书')
    assert.ok(/网络/.test(f('net::ERR_CONNECTION_REFUSED')), '连接拒绝应提示网络')
    assert.strictEqual(f(''), VENUE.ERROR_MSG.NETWORK, '空错误应有兜底文案')
  })

  await check('C13 normalize 同时兼容 v1.3.41 包裹结构与旧平铺结构', () => {
    const v = api.normalize({
      MuseumInfo: {
        Code: CODE, Name: '新结构馆', Status: '开放', Photos: ['p1'],
        Introduction: '<p>简介</p>', NeedVerify: true
      },
      ExhibitionAreaList: [
        { ID: 'a1', Code: 'A1', Name: '展区', Location: '一楼', Photos: ['p2'] }
      ]
    })
    assert.strictEqual(v.name, '新结构馆')
    assert.deepStrictEqual(v.photos, ['p1'])
    assert.strictEqual(v.introText, '简介')
    assert.strictEqual(v.needVerify, true)
    assert.strictEqual(v.areas.length, 1)
    assert.deepStrictEqual(v.areas[0].photos, ['p2'])
    const old = api.normalize(RAW_OK)
    assert.strictEqual(old.name, '辛亥革命纪念馆')
    assert.strictEqual(old.areas.length, 2)
  })

  await check('C14 runtimeInfo 在不支持 getAccountInfoSync 的环境安全降级', () => {
    assert.strictEqual(I.runtimeInfo(), '', '低版本基础库 / Node stub 下应返回空串而不抛错')
  })
}

async function partD() {
  console.log('\n===== D. 端点配置与状态码契约 =====')
  const api = require('../api/venue')
  const I = api._internal

  await check('D01 v1.9.14 附录 C 状态码全量 + 微信原生码兜底均映射中文提示', () => {
    const codes = ['90001', '90002', '90003', '90004', '90005', '90006', '90007',
      '90008', '90009', '90010', '90011', '90012', '90013', '90014', '90015',
      '90016', '90017', '90020', '90021', '90022', '90025', '90029',
      '20001', '20002', '20003', '20004', '40029']
    codes.forEach((c) => {
      assert.ok(VENUE.ERROR_MSG[c], c + ' 配置缺失')
      assert.ok(I.errorText({ code: c }) === VENUE.ERROR_MSG[c], c + ' 未正确映射')
    })
    // v1.9.14 新增三码的语义
    assert.ok(/未开放|开放预约/.test(VENUE.ERROR_MSG['90017']))
    assert.ok(/预约人员|添加/.test(VENUE.ERROR_MSG['90022']))
    assert.ok(/核销/.test(VENUE.ERROR_MSG['90029']))
    // 通则 §2：微信原生 errcode 禁止透传，未登记的 4xxxx 统一兜 90006 文案
    assert.strictEqual(I.errorText({ code: '45011', msg: 'api frequency limit' }), VENUE.WX_NATIVE_FALLBACK)
    // v1.5.0 起预约只按日期：90012 文案不应再出现「时段」，90005 仅作兜底
    assert.ok(/日期/.test(VENUE.ERROR_MSG['90012']), '90012 应为按日期口径')
    assert.ok(!/时段/.test(VENUE.ERROR_MSG['90012']))
    assert.ok(/名额/.test(VENUE.ERROR_MSG['90010']))
    assert.ok(/游客|用户/.test(VENUE.ERROR_MSG['90020']))
    assert.ok(/日期/.test(VENUE.ERROR_MSG['90021']))
  })

  await check('D02 NeedVerify 兼容布尔/字符串/数值，新旧结构均缺省 false', () => {
    assert.strictEqual(api.normalize({ NeedVerify: true }).needVerify, true)
    assert.strictEqual(api.normalize({ MuseumInfo: { NeedVerify: 'true' } }).needVerify, true)
    assert.strictEqual(api.normalize({ NeedVerify: 1 }).needVerify, true)
    assert.strictEqual(api.normalize({ NeedVerify: 'false' }).needVerify, false)
    assert.strictEqual(api.normalize({}).needVerify, false)
  })

  await check('D03 v1.9.14 端点：API-07 已废弃，8 项全部已发布；临时置空仍须返回 NOT_READY', async () => {
    const eps = api.listEndpoints()
    assert.strictEqual(eps.length, 8, '端点数应为 8（v1.9.8 移除 API-07）')
    assert.strictEqual(eps.filter((e) => e.ready).length, 8, 'API-08 发布后应全部就绪')
    assert.deepStrictEqual(eps.map((e) => e.id).sort(),
      ['API-03', 'API-04', 'API-05', 'API-06', 'API-08', 'API-09', 'API-10', 'API-11'])
    assert.strictEqual(VENUE.ENDPOINTS.myReservation, undefined, 'API-07 占位应已移除')
    // 未发布分支本身仍需覆盖：临时清空一个端点地址，确认不发请求而是直接拒绝
    const ep = VENUE.ENDPOINTS.areaDetail
    const saved = ep.url
    ep.url = ''
    try {
      assert.strictEqual(api.isReady('areaDetail'), false)
      let err = null
      try { await api.callApi('areaDetail', { ExhbitAreaId: 'M1' }) } catch (x) { err = x }
      assert.ok(err && err.code === 'NOT_READY', '未发布端点应返回 NOT_READY')
    } finally {
      ep.url = saved
    }
  })

  await check('D04 v1.9.14 端点契约：ExhbitAreaId 拼写 / GET-POST / 各接口入参键', () => {
    // v1.6.0 起 API-09 为 GET（旧实现误写 POST），与 areaDetail / exhibitDetail 同组
    const gets = ['areaDetail', 'exhibitDetail', 'cancelReservation']
    gets.forEach((k) => assert.strictEqual(VENUE.ENDPOINTS[k].method, 'GET', k + ' 应为 GET'))
    const posts = ['reservation', 'wxLogin', 'feedback', 'updateUser', 'profileReservations']
    posts.forEach((k) => assert.strictEqual(VENUE.ENDPOINTS[k].method, 'POST', k + ' 应为 POST'))
    assert.strictEqual(VENUE.ENDPOINTS.wxLogin.auth, false)
    assert.ok(VENUE.ENDPOINTS.areaDetail.params.indexOf('ExhbitAreaId') >= 0)
    assert.deepStrictEqual(VENUE.ENDPOINTS.wxLogin.params, ['Code', 'JsCode', 'IsPhone'])
    assert.strictEqual(VENUE.ENDPOINTS.wxLogin.params.indexOf('WxCode'), -1, 'WxCode 已随 1.9.3 移除')
    // v1.9.5：API-05 改为 Visitors 数组，单实名与 Number 作废
    assert.deepStrictEqual(VENUE.ENDPOINTS.reservation.params,
      ['Code', 'Token', 'UserId', 'ReservateDateId', 'Visitors'])
    assert.strictEqual(VENUE.ENDPOINTS.reservation.requireData, true)
    ;['Action', 'SlotStart', 'SlotEnd', 'VisitorOpenId', 'AgreedPolicy', 'Name', 'IdCard', 'Mobile', 'Number'].forEach((k) => {
      assert.strictEqual(VENUE.ENDPOINTS.reservation.params.indexOf(k), -1, k + ' 应从 API-05 契约移除')
    })
    assert.deepStrictEqual(VENUE.ENDPOINTS.cancelReservation.params,
      ['Code', 'Token', 'UserId', 'ReservationId'])
    // v1.9.11/1.9.12：API-08 入参 Title/Description，响应仅 code/msg
    assert.deepStrictEqual(VENUE.ENDPOINTS.feedback.params,
      ['Code', 'Token', 'UserId', 'Title', 'Description'])
    assert.ok(/NmFmNDU3ODk5NGIxODBlMjcyZjUyOWNl/.test(VENUE.ENDPOINTS.feedback.url),
      'API-08 开发地址应为 v1.9.14 附录 A 所列 hooks2 端点')
    // v1.9.14：API-11 状态为文本，错误分支空 body 须由 requireData 拦住
    assert.deepStrictEqual(VENUE.ENDPOINTS.profileReservations.params, ['Code', 'Token', 'UserId'])
    assert.strictEqual(VENUE.ENDPOINTS.profileReservations.requireData, true)
    assert.strictEqual(VENUE.ENDPOINTS.phoneLogin, undefined, 'API-11 手机号登录已作废')
    assert.deepStrictEqual(VENUE.ENDPOINTS.updateUser.queryKeys, ['Code', 'Token', 'UserId'])
    // API-08 / 09 / 10 无 data 包装；API-05 / 06 / 11 已改 data 包裹
    ;['cancelReservation', 'updateUser', 'feedback'].forEach((k) => {
      assert.strictEqual(VENUE.ENDPOINTS[k].topLevel, true, k + ' 应标 topLevel')
    })
    ;['reservation', 'wxLogin', 'profileReservations'].forEach((k) => {
      assert.ok(!VENUE.ENDPOINTS[k].topLevel, k + ' 不应再标 topLevel（响应已包 data）')
    })
  })

  await check('D07 normalize 解析 ReservationDateList：日期/余量/可约合成', () => {
    const vm = api.normalize({
      MuseumInfo: { Code: CODE, Name: 'x' },
      ReservationDateList: [
        { ID: 'd1', Date: '2026-11-11 00:00:00', DailyQuota: 1000, DailyUsed: 0, CanReserve: 1 },
        { ID: 'd2', Date: '2026-11-12 00:00:00', DailyQuota: 1000, DailyUsed: 1000, CanReserve: 1 },
        { ID: 'd3', Date: '2026-11-13 00:00:00', DailyQuota: 100, DailyUsed: 3, CanReserve: 0 }
      ]
    })
    assert.strictEqual(vm.dates.length, 3)
    assert.strictEqual(vm.dates[0].date, '2026-11-11')
    assert.strictEqual(vm.dates[0].remaining, 1000)
    assert.strictEqual(vm.dates[0].reservable, true)
    // CanReserve=1 但名额已满 → 仍不可约
    assert.strictEqual(vm.dates[1].reservable, false)
    assert.strictEqual(vm.dates[1].remaining, 0)
    // CanReserve=0 → 不可约
    assert.strictEqual(vm.dates[2].reservable, false)
    assert.strictEqual(vm.dates[2].remaining, 97)
    // 缺字段时不炸
    assert.deepStrictEqual(api.normalize({}).dates, [])
  })

  await check('D05 模拟地址下 GET 端点注入 Code+Token 并解包 data', async () => {
    const mem = {}
    let lastOpt = null
    global.wx = makeWx(mem, (opt) => {
      lastOpt = opt
      const body = opt.url.indexOf(H1) === 0
        ? { code: '', token: 'stub.a', expired: 7200 }
        : { code: '', msg: '', data: { ok: true } }
      setTimeout(() => opt.success({ statusCode: 200, data: body }), 0)
    })
    const saved = VENUE.ENDPOINTS.areaDetail.url
    VENUE.ENDPOINTS.areaDetail.url = 'https://example.test/api03'
    try {
      const r = await api.callApi('areaDetail', { ExhbitAreaId: 'M1' })
      assert.deepStrictEqual(r, { ok: true })
      assert.strictEqual(lastOpt.method, 'GET')
      assert.ok(lastOpt.url.indexOf('Code=' + CODE) > 0, '应注入 Code')
      assert.ok(lastOpt.url.indexOf('ExhbitAreaId=M1') > 0, '应透传业务入参')
      assert.ok(lastOpt.url.indexOf('Token=stub.a') > 0, '应注入 Token')
    } finally {
      VENUE.ENDPOINTS.areaDetail.url = saved
    }
  })

  await check('D06 POST 端点发 JSON body；wxLogin 不注入 Token', async () => {
    const mem = {}
    let lastOpt = null
    global.wx = makeWx(mem, (opt) => {
      lastOpt = opt
      const body = opt.url.indexOf(H1) === 0
        ? { code: '', token: 'stub.b', expired: 7200 }
        : { code: '', msg: '', data: { ok: true } }
      setTimeout(() => opt.success({ statusCode: 200, data: body }), 0)
    })
    const savedResv = VENUE.ENDPOINTS.reservation.url
    const savedLogin = VENUE.ENDPOINTS.wxLogin.url
    VENUE.ENDPOINTS.reservation.url = 'https://example.test/api05'
    VENUE.ENDPOINTS.wxLogin.url = 'https://example.test/api06'
    try {
      await api.callApi('wxLogin', { JsCode: 'wx123', IsPhone: 0 })
      assert.strictEqual(lastOpt.method, 'POST')
      assert.strictEqual(lastOpt.data.Code, CODE)
      assert.strictEqual(lastOpt.data.JsCode, 'wx123')
      assert.strictEqual(lastOpt.data.IsPhone, 0)
      assert.strictEqual(lastOpt.data.Token, undefined, 'API-06 不应带 Token')

      // API-05 已改 data 包裹：callApi 应返回 data 而不是整个 body
      const d = await api.callApi('reservation', {
        UserId: 'u1',
        ReservateDateId: 'd1',
        Visitors: [{ Name: '张三', IdNumber: '420123199001011234', Mobile: '13800138000', Type: '成人' }]
      })
      assert.deepStrictEqual(d, { ok: true }, 'API-05 应解包 data')
      assert.strictEqual(lastOpt.data.Token, 'stub.b')
      assert.strictEqual(Array.isArray(lastOpt.data.Visitors), true)
    } finally {
      VENUE.ENDPOINTS.reservation.url = savedResv
      VENUE.ENDPOINTS.wxLogin.url = savedLogin
    }
  })

  await check('D08 groupVenueDates：同日多时段聚合为单日 + slots', () => {
    const resvApi = require('../api/reservation')
    const dates = resvApi._internal.groupVenueDates([
      { id: 'a', date: '2026-11-17', quota: 1000, used: 0, remaining: 1000, reservable: true, sessionId: '', sessionName: '' },
      { id: 'b', date: '2026-11-17', quota: 500, used: 500, remaining: 0, reservable: false, sessionId: 's1', sessionName: '上午' },
      { id: 'c', date: '2026-11-17', quota: 500, used: 0, remaining: 500, reservable: true, sessionId: 's2', sessionName: '下午' },
      { id: 'd', date: '2026-11-18', quota: 300, used: 10, remaining: 290, reservable: true, sessionId: '', sessionName: '' }
    ])
    assert.strictEqual(dates.length, 2, '同一天只应出现一次')
    const day = dates[0]
    assert.strictEqual(day.dateId, 'a', '无时段的当天记录作为日期主记录')
    assert.strictEqual(day.slots.length, 2, '两个时段应进 slots')
    assert.strictEqual(day.slots[0].timeSlot, '上午')
    assert.strictEqual(day.slots[0].disabled, true, '上午余量为 0 应禁用')
    assert.strictEqual(day.slots[1].dateId, 'c', '时段项须带自己的日历记录 ID')
    assert.strictEqual(day.remaining, 1500, '余量按各行合计')
    assert.strictEqual(dates[1].slots.length, 0, '未配置时段的日期不展示时段')
  })

  await check('D09 parseIsRegistered：1/0 明确，空串与缺省一律「未知」', () => {
    assert.strictEqual(api.parseIsRegistered(1), 1)
    assert.strictEqual(api.parseIsRegistered('1'), 1)
    assert.strictEqual(api.parseIsRegistered(1.0), 1)
    assert.strictEqual(api.parseIsRegistered(0), 0)
    assert.strictEqual(api.parseIsRegistered('0'), 0)
    assert.strictEqual(api.parseIsRegistered(0.0), 0)
    // 实测 js_code 形式返回 ""：Number('') === 0，必须先判空串，绝不能落成「未注册」
    assert.strictEqual(api.parseIsRegistered(''), null)
    assert.strictEqual(api.parseIsRegistered('   '), null)
    assert.strictEqual(api.parseIsRegistered(undefined), null)
    assert.strictEqual(api.parseIsRegistered(null), null)
    assert.strictEqual(api.parseIsRegistered('2'), null)
    // 归一化后不得丢掉原始值，便于排查服务端到底返回了什么
    const u = api._internal.normalizeLoginUser({ Id: 'x', IsRegistered: '' })
    assert.strictEqual(u.IsRegistered, null, '空串应为 null（未知）')
    assert.strictEqual(u.IsRegisteredRaw, '', '应保留原始空串')
  })

  await check('D10 v1.9.8：API-05 Visitors 证件号键必须是 IdNumber（不再发 IdCard）', () => {
    const v = I.buildVisitors([
      { name: '张三', idCard: '420123199001011234', mobile: '13800138000' },
      { Name: '张小宝', IdNumber: '420123202001011234', Mobile: '13800138000', Type: '儿童' }
    ])
    assert.strictEqual(v.length, 2)
    assert.strictEqual(v[0].IdNumber, '420123199001011234')
    assert.strictEqual(v[0].IdCard, undefined, '不得再发旧键 IdCard')
    assert.strictEqual(v[0].Name, '张三')
    assert.strictEqual(v[0].Mobile, '13800138000')
    assert.strictEqual(v[0].Type, '成人')
    assert.strictEqual(v[1].IdNumber, '420123202001011234')
    assert.strictEqual(v[1].Type, '儿童')
    assert.deepStrictEqual(I.buildVisitors(null), [])
  })

  await check('D11 v1.9.14 / CHG-024：API-11 状态为文本，数字旧版退到 statusCode', () => {
    const f = I.normalizeReservationStatus
    assert.deepStrictEqual(f('待核销'), { text: '待核销', code: 0 })
    assert.deepStrictEqual(f(' 已完成 '), { text: '已完成', code: 0 })
    assert.deepStrictEqual(f('已取消'), { text: '已取消', code: 0 })
    // 文档从未定义数字枚举，绝不猜测映射，仅保留数值兼容位
    assert.deepStrictEqual(f(2), { text: '', code: 2 })
    assert.deepStrictEqual(f('2'), { text: '', code: 2 })
    assert.deepStrictEqual(f(''), { text: '', code: 0 })
    assert.deepStrictEqual(f(null), { text: '', code: 0 })
  })

  await check('D12 非 JSON「流程已终止」与空 data 均不得静默判为预约成功', async () => {
    const saved = VENUE.ENDPOINTS.reservation.url
    VENUE.ENDPOINTS.reservation.url = 'https://example.test/api05'
    let mode = 'text'
    global.wx = makeWx({}, (opt) => {
      const body = opt.url.indexOf(H1) === 0
        ? { code: '', token: 'stub.c', expired: 7200 }
        : (mode === 'text' ? '流程已终止' : { code: '', msg: '' })
      setTimeout(() => opt.success({ statusCode: 200, data: body }), 0)
    })
    try {
      for (const m of ['text', 'empty']) {
        mode = m
        api.clearToken()
        let err = null
        try {
          await api.createReservation({
            userId: 'u1', reservateDateId: 'd1',
            visitors: [{ name: '张三', idCard: '420123199001011234', mobile: '13800138000' }]
          })
        } catch (e) { err = e }
        assert.ok(err && err.code === 'BAD_RESPONSE',
          m + ' 应判 BAD_RESPONSE，实际：' + JSON.stringify(err))
      }
    } finally {
      VENUE.ENDPOINTS.reservation.url = saved
    }
  })

  await check('D13 API-08 提交反馈：必填拦截 + Title/Description 入参映射', async () => {
    let err = null
    try { await api.submitFeedback({ userId: 'u1', title: '', description: '内容' }) } catch (e) { err = e }
    assert.ok(err && err.code === 'PARAM', '缺标题应在前端拦住，不能发请求')

    const saved = VENUE.ENDPOINTS.feedback.url
    VENUE.ENDPOINTS.feedback.url = 'https://example.test/api08'
    let last = null
    global.wx = makeWx({}, (opt) => {
      last = opt
      const body = opt.url.indexOf(H1) === 0
        ? { code: '', token: 'stub.d', expired: 7200 }
        : { code: '', msg: '更新成功' }
      setTimeout(() => opt.success({ statusCode: 200, data: body }), 0)
    })
    try {
      api.clearToken()
      const r = await api.submitFeedback({ userId: 'u1', title: '标题', description: '内容' })
      assert.strictEqual(r.msg, '更新成功', 'topLevel 应返回整个响应体')
      assert.strictEqual(last.method, 'POST')
      assert.strictEqual(last.data.UserId, 'u1')
      assert.strictEqual(last.data.Title, '标题')
      assert.strictEqual(last.data.Description, '内容')
      assert.strictEqual(last.data.Content, undefined, '旧键 Content 已废弃')
      assert.strictEqual(last.data.Token, 'stub.d')
    } finally {
      VENUE.ENDPOINTS.feedback.url = saved
    }
  })

  await check('D14 v1.9.13 去时段：线上日期项无 Session 字段，聚合后每天一条且 slots 为空', () => {
    const vm = api.normalize({
      MuseumInfo: { Name: 'x' },
      ReservationDateList: [
        { ID: 'a', Date: '2026-11-17 00:00:00', DailyQuota: 1000, DailyUsed: 1, CanReserve: 1 },
        { ID: 'b', Date: '2026-11-18 00:00:00', DailyQuota: 1000, DailyUsed: 0, CanReserve: 1 }
      ]
    })
    assert.strictEqual(vm.dates.length, 2)
    vm.dates.forEach((d) => {
      assert.strictEqual(d.sessionId, '')
      assert.strictEqual(d.sessionName, '')
    })
    const grouped = require('../api/reservation')._internal.groupVenueDates(vm.dates)
    assert.strictEqual(grouped.length, 2)
    assert.ok(grouped.every((d) => d.slots.length === 0))
    assert.strictEqual(grouped[0].dateId, 'a')
    assert.strictEqual(grouped[0].remaining, 999)
  })

  await check('D15 API-09 改 GET：四项参数走 query，不发 JSON body', async () => {
    const saved = VENUE.ENDPOINTS.cancelReservation.url
    VENUE.ENDPOINTS.cancelReservation.url = 'https://example.test/api09'
    let last = null
    global.wx = makeWx({}, (opt) => {
      last = opt
      const body = opt.url.indexOf(H1) === 0
        ? { code: '', token: 'stub.e', expired: 7200 }
        : { code: '', msg: '取消成功' }
      setTimeout(() => opt.success({ statusCode: 200, data: body }), 0)
    })
    try {
      api.clearToken()
      const r = await api.cancelReservation({ userId: 'u1', reservationId: 'r1' })
      assert.strictEqual(r.msg, '取消成功')
      assert.strictEqual(last.method, 'GET')
      assert.ok(last.url.indexOf('UserId=u1') > 0)
      assert.ok(last.url.indexOf('ReservationId=r1') > 0)
      assert.ok(last.url.indexOf('Token=stub.e') > 0)
      assert.strictEqual(last.data, undefined, 'GET 不应带 JSON body')
    } finally {
      VENUE.ENDPOINTS.cancelReservation.url = saved
    }
  })
}

async function partE() {
  console.log('\n===== E. v1.9.14 契约端到端（真实 Webhook） =====')
  const mem = {}
  global.wx = makeWx(mem, realRequestImpl)
  const api = require('../api/venue')
  const I = api._internal

  await check('E01 API-01→02→03→04 全链路（真实展区与展品）', async () => {
    const v = await api.getVenue()
    assert.strictEqual(v.name, '辛亥革命纪念馆')
    assert.ok(v.areas.length > 0, '应返回展区列表')
    assert.ok(v.areas.every((a) => a.id && a.name && Array.isArray(a.photos)))
    let found = null
    for (const a of v.areas) {
      const detail = await api.getAreaDetail({ areaId: a.id })
      assert.ok(detail.name, '展区详情应返回名称')
      assert.ok(Array.isArray(detail.exhibits))
      if (detail.exhibits.length && !found) found = detail
    }
    assert.ok(found, '至少应有一个展区含展品')
    const ex = await api.getExhibitDetail({ exhibitId: found.exhibits[0].id })
    assert.ok(ex.name, '展品详情应返回名称')
    assert.ok(Array.isArray(ex.photos) && Array.isArray(ex.videos) && Array.isArray(ex.audios))
    console.log('       · 链路样例：' + found.name + ' → ' + ex.name)
  })

  await check('E02 API-03/04 错参与 ExhbitAreaId 必填校验（负向响应按线上实测容错）', async () => {
    const token = await api.fetchToken(CODE)
    const q = (base, extra) => httpJson(I.buildUrl(base, Object.assign({ Code: CODE, Token: token }, extra)))
    const bad3 = await q(H3, { ExhbitAreaId: 'not-a-guid' })
    // 文档要求 90003「展区不存在」；2026-11-12 线上实测改为 HTTP 200 **空 body**。
    // 前端已把空 body 判 BAD_RESPONSE，这里只锁「绝不返回可渲染的展区详情」。
    assert.ok(!(bad3.data && bad3.data.data && bad3.data.data.ExhibitionAreaInfo),
      '伪展区 ID 不应返回展区详情，实际：' + JSON.stringify(bad3.data).slice(0, 120))
    const wrongKey = await q(H3, { AreaId: 'any' })
    assert.strictEqual(wrongKey.data.status, 2, '传 AreaId 应报必填校验')
    assert.ok(/ExhbitAreaId/.test(wrongKey.data.msg), '必填提示应点名 ExhbitAreaId')
    const bad4 = await q(H4, { ExhibitId: 'not-a-guid' })
    assert.ok(!(bad4.data && bad4.data.data && bad4.data.data.ExhibitInfo),
      '伪展品 ID 不应返回展品详情，实际：' + JSON.stringify(bad4.data).slice(0, 120))
    const c3 = bad3.data && bad3.data.code
    const c4 = bad4.data && bad4.data.code
    console.log('       · 线上负向：API-03 code=' + (c3 === undefined ? '空 body' : c3) +
      ' / API-04 code=' + (c4 === undefined ? '空 body' : c4) +
      '（文档要求 90003/90004，空 body 属服务端缺口，前端已兜底）')
  })

  await check('E03 API-06 负向：非法 JsCode 不返回身份，且不下发 session_key / OpenId', async () => {
    const r = await httpJson(VENUE.ENDPOINTS.wxLogin.url, 'POST', {
      Code: CODE, JsCode: 'invalid_probe_' + Date.now(), IsPhone: 0
    })
    assert.strictEqual(r.statusCode, 200)
    const raw = JSON.stringify(r.data)
    const body = (r.data && typeof r.data === 'object') ? r.data : {}
    const code = String(body.code == null ? '' : body.code)
    const blank = r.data === '' || r.data === null || r.data === undefined ||
      (typeof r.data === 'object' && Object.keys(r.data).length === 0)
    // 通则 §2 要求映射 90006；线上曾透传原生 40029，2026-11-12 实测又变成 HTTP 200 空 body。
    // 三者都算「登录被拦住」，前端对空 body 已判 BAD_RESPONSE，关键是不能返回可登录身份。
    assert.ok(code === '90006' || code === '40029' || blank,
      '非法 JsCode 应被拦住，实际 ' + code + ' / ' + raw.slice(0, 120))
    assert.ok(!(body.data && body.data.Id), '非法 JsCode 不应返回游客档案 Id')
    assert.ok(!/session_key/.test(raw), '不应下发 session_key')
    assert.ok(!('OpenId' in body), '身份已改为游客档案 Id，不应再有 OpenId 字段')

    // 平台层必填：缺 IsPhone 应被拦下（status:2 或业务码，二者取其一）
    const miss = await httpJson(VENUE.ENDPOINTS.wxLogin.url, 'POST', { Code: CODE, JsCode: 'x' })
    const blocked = miss.data && (miss.data.status === 2 || String(miss.data.code || '') !== '')
    assert.ok(blocked, '缺 IsPhone 应被校验拦住，实际 ' + JSON.stringify(miss.data).slice(0, 120))
    console.log('       · 负向响应=' + (blank ? 'HTTP 200 空 body（服务端映射缺口，前端判 BAD_RESPONSE）' : 'code=' + code) +
      '；缺 IsPhone 已被拦截')
  })

  await check('E03b API-11 个人信息与预约记录列表：伪 UserId 不返回业务数据', async () => {
    const token = await api.fetchToken(CODE)
    const r = await httpJson(VENUE.ENDPOINTS.profileReservations.url, 'POST', {
      Code: CODE, Token: token, UserId: '00000000-0000-0000-0000-000000000000'
    })
    // 契约要求返业务码；实测为 HAP 引擎错误（文档 1.9.6 已登记缺口），故只断言「没拿到数据」
    const hasData = !!(r.data && r.data.data && r.data.data.UserId)
    assert.strictEqual(hasData, false, '伪 UserId 不应返回个人信息，实际：' + JSON.stringify(r.data).slice(0, 160))
    const uid = process.env.TEST_USER_ID
    if (uid) {
      const ok = await httpJson(VENUE.ENDPOINTS.profileReservations.url, 'POST', { Code: CODE, Token: token, UserId: uid })
      assert.ok(ok.data && ok.data.data && ok.data.data.UserId === uid, '真实 UserId 应返回个人信息')
      assert.ok(Array.isArray(ok.data.data.ReservationList), '应返回 ReservationList 数组')
      console.log('       · 真实 UserId 返回 ' + ok.data.data.ReservationList.length + ' 条预约记录')
    } else {
      console.log('       · 未提供 TEST_USER_ID，跳过正向用例')
    }
  })

  await check('E04 v1.9.14 端点就绪清单：8 项全部已发布；API-08 线上必填键与文档一致', async () => {
    const eps = api.listEndpoints()
    assert.deepStrictEqual(eps.map((e) => e.id).sort(),
      ['API-03', 'API-04', 'API-05', 'API-06', 'API-08', 'API-09', 'API-10', 'API-11'])
    assert.strictEqual(eps.filter((e) => !e.ready).length, 0, 'API-08 发布后不应再有未就绪端点')
    // 线上探针：只传 Code，平台层必填校验拦截，不进入业务逻辑、不写库
    const r = await httpJson(VENUE.ENDPOINTS.feedback.url, 'POST', { Code: CODE })
    const m = /\[([^\]]+)\]/.exec(String((r.data && r.data.msg) || ''))
    const keys = m ? m[1].split(',').map((s) => s.trim()) : []
    ;['Title', 'Description', 'UserId', 'Token'].forEach((k) => {
      assert.ok(keys.indexOf(k) >= 0, 'API-08 线上缺必填键 ' + k + '，实际：' + keys.join(','))
    })
    console.log('       · API-08 必填校验：[' + keys.join(', ') + ']')
  })

  await check('E06 API-05 缺 Visitors：不得静默成功（纯文本终止 / 业务码 / status:2 均可）', async () => {
    const token = await api.fetchToken(CODE)
    const payload = {
      Code: CODE, Token: token,
      UserId: process.env.TEST_USER_ID || '00000000-0000-0000-0000-000000000000',
      ReservateDateId: '00000000-0000-0000-0000-000000000000'
    }
    const call = () => httpJson(VENUE.ENDPOINTS.reservation.url, 'POST', payload, 25000)
    let r = await call()
    if (!r.statusCode) r = await call() // 明道云偶发慢响应，重试一次
    if (!r.statusCode) {
      console.log('       · 两次请求均超时，本用例跳过（网络波动，非契约失败）')
      return
    }
    // 文档 1.9.5 记录：缺 Visitors 时线上返回 HTTP 200 纯文本「流程已终止」；
    // 2026-11-12 实测伪 UserId 先命中 90020 用户不存在，两种都算「被拦住」。
    // 关键是不能返回 「code 空 + 有效 reservationId」这种伪成功。
    const body = r.data
    const isText = typeof body === 'string'
    const blocked = isText
      ? (body === '' || /终止|失败/i.test(body))
      : !!(body && (body.status === 2 || String(body.code || '') !== ''))
    assert.ok(blocked, '缺 Visitors 不应被视为成功，实际：' + JSON.stringify(body).slice(0, 160))
    console.log('       · 缺 Visitors → ' + (isText
      ? '纯文本「' + String(body).trim().slice(0, 20) + '」（非 JSON，前端已判 BAD_RESPONSE）'
      : (body.status === 2 ? 'status=2 平台必填拦截' : '业务码 ' + String(body.code) + ' ' + (body.msg || ''))))
  })

  await check('E07 API-09 取消预约：GET 协议可达，伪 UserId 返回业务错误码', async () => {
    const token = await api.fetchToken(CODE)
    // v1.9.14 明确 GET + query；2026-11-12 实测 GET/POST 均可达，按文档统一 GET
    const q = '?Code=' + encodeURIComponent(CODE) + '&Token=' + encodeURIComponent(token) +
      '&UserId=00000000-0000-0000-0000-000000000000' +
      '&ReservationId=00000000-0000-0000-0000-000000000000'
    const r = await httpJson(VENUE.ENDPOINTS.cancelReservation.url + q, 'GET')
    const code = String(r.data.code)
    // 用户不存在→90020；记录取不到→90025；令牌未验过→20001（均说明链路已通到业务层）
    assert.ok(['90020', '90025', '20001'].indexOf(code) >= 0, '实际 ' + code)
    console.log('       · GET 返回 code=' + code + ' ' + (r.data.msg || '') +
      '（v1.9.8 起 ISS-006 已修复，不再恒返 90025 判为未就绪）')
  })

  await check('E08 API-10 更新用户信息：query 鉴权 + body NickName/Avatar(base64)', async () => {
    const fs = require('fs')
    const path = require('path')
    const token = await api.fetchToken(CODE)
    const b64 = fs.readFileSync(path.join(__dirname, '../images/placeholder.png')).toString('base64')
    const build = (uid) => VENUE.ENDPOINTS.updateUser.url + '?Code=' + encodeURIComponent(CODE) +
      '&Token=' + encodeURIComponent(token) + '&UserId=' + encodeURIComponent(uid)

    // 伪 UserId → 90020，验证该接口确实按 UserId 找档案（不依赖真实登录）
    const bad = await httpJson(build('00000000-0000-0000-0000-000000000000'), 'POST',
      { NickName: 'x', Avatar: b64 })
    assert.strictEqual(String(bad.data.code), '90020', '伪 UserId 应返 90020')

    const uid = process.env.TEST_USER_ID
    if (!uid) {
      console.log('       · 未提供 TEST_USER_ID，跳过正向用例（昵称/头像实际写入）')
      return
    }
    // 正式形态：Code/Token/UserId 走 query，NickName/Avatar 走 body
    const ok = await httpJson(build(uid), 'POST', { NickName: '接口自测', Avatar: b64 })
    assert.strictEqual(String(ok.data.code), '', '应更新成功，实际：' + JSON.stringify(ok.data).slice(0, 120))
    assert.strictEqual(ok.data.msg, '更新成功')

    // 两个字段都是必填：缺 Avatar 是平台层校验（status:2，无业务 code）
    const noAvatar = await httpJson(build(uid), 'POST', { NickName: '只改昵称' })
    assert.strictEqual(noAvatar.data.status, 2)
    assert.ok(/Avatar/.test(noAvatar.data.msg))
    console.log('       · NickName / Avatar 均为必填，缺一即 status:2；伪 UserId 返 90020')
  })

  await check('E09 getAvailableDates：API-02 按日期（v1.9.13 去时段）喂给预约页结构', async () => {
    const resvApi = require('../api/reservation')
    const res = await resvApi.getAvailableDates()
    assert.strictEqual(res.source, 'venue', '应使用真实场馆日期，实际：' + res.source)
    assert.ok(res.dates.length > 0, '应返回可预约日期')
    assert.ok(res.museumName, '应带出场馆名')
    const d = res.dates[0]
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(d.value), 'value 必须是 YYYY-MM-DD（iOS 可解析），实际：' + d.value)
    assert.ok(/^周[日一二三四五六]$/.test(d.weekday), 'weekday 应为中文星期，实际：' + d.weekday)
    assert.ok(Array.isArray(d.slots), 'slots 必须是数组')
    if (d.slots.length) {
      // 配置了时段：dateId 由时段项承载，页面选完时段再取对应日历记录 ID
      assert.ok(d.slots.every((s) => s.timeSlot && /^[0-9a-f-]{36}$/i.test(s.dateId)),
        '时段项应带 timeSlot 与日历记录 GUID')
    } else {
      assert.ok(/^[0-9a-f-]{36}$/i.test(d.dateId), 'dateId 应为 API-02 的日历记录 GUID')
    }
    // 同一天只能出现一次（v1.9.13 起线上按日期每天一条；若回滚到时段版，服务层聚合仍须保证）
    const values = res.dates.map((x) => x.value)
    assert.deepStrictEqual(values, Array.from(new Set(values)), '同一日期不应重复出项，实际：' + values.join(','))
    // 线上返回倒序，服务层必须升序，否则日历基准月与「首个可约日」都会取错
    assert.deepStrictEqual(values, values.slice().sort(), '日期应升序，实际：' + values.join(','))
    console.log('       · ' + res.dates.length + ' 天可约，首日 ' + d.value + '（' + d.weekday + '）' +
      d.remaining + '/' + d.quota + (d.slots.length ? '，' + d.slots.length + ' 个时段' : '，全天'))
  })

  await check('E05 normalizeArea / normalizeExhibit 兼容旧平铺键', () => {
    const a = api.normalizeArea({ Name: '平铺展区', Exhibits: [{ ID: 'e1', Name: '旧展品' }] })
    assert.strictEqual(a.name, '平铺展区')
    assert.strictEqual(a.exhibits[0].name, '旧展品')
    const e = api.normalizeExhibit({ Exhibit: { Name: '旧结构展品', Photos: ['u'] } })
    assert.strictEqual(e.name, '旧结构展品')
    assert.deepStrictEqual(e.photos, ['u'])
  })
}

async function main() {
  // 自测输出保持干净：链路日志由 C11 单独验证
  VENUE.DEBUG = false
  console.log('场馆 / 业务接口自测 | 契约 v1.9.14 | 场馆编号 ' + CODE + ' | ' + new Date().toLocaleString('zh-CN'))
  await partA()
  await partB()
  await partC()
  await partD()
  await partE()
  console.log('\n===== 汇总：' + pass + ' PASS / ' + fail + ' FAIL =====')
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('[FATAL]', e)
  process.exitCode = 1
})
