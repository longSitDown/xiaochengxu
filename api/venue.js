/**
 * 场馆 / 业务接口服务 —— 契约以 `md/博物馆预约管理系统-数据接口文档 (1).md` **v1.9.14** 为准
 *
 * 与 api/request.js 的 HAP API V3 通道完全独立，原因：
 *   协议（GET+query / POST+JSON vs POST rows/list）、鉴权（Webhook token vs AppKey/Sign）、
 *   响应结构（{code,msg,data} vs {success,error_code,data}）三者都不同。
 *   强行塞进 request.js 会污染别名重写、envelope 校验和重试策略。
 *
 * 已可调用（2026-11-12 在线核验，tools/verify-contract-v1914.js）：
 *   API-01/02/03/04/05/06/08/09/10/11 全部端点已发布；API-07 已废弃、API-12 属核销端不接入。
 *
 * 响应结构（通则 §1）：
 *   - 单对象包裹为 xxxxInfo：API-02 data.MuseumInfo、API-03 data.ExhibitionAreaInfo、
 *     API-04 data.ExhibitInfo
 *   - 集合包裹为 xxxxList：API-02 data.ExhibitionAreaList / ReservationDateList、API-03 data.ExhibitList
 *   - 例外：API-08 / 09 / 10 无 data 包装，结果直接平铺在顶层（见 ENDPOINTS 的 topLevel）；
 *     API-05（v1.9.5）、API-06（v1.9.3）已改为 data 包裹，勿再按平铺解析
 *   normalize / normalizeArea / normalizeExhibit 同时兼容旧平铺结构，避免线上回滚时页面白屏
 *
 * 其它实测口径：
 *   - API-01 顶层返回 { msg, expired, code, token }；expired 实测 7200；失败 code 为数值 90001.0
 *   - API-03/04 错误返回 { code:"90003"/"90004", msg:"xx不存在", data:{} }
 *   - API-03 入参必须叫 ExhbitAreaId（线上流程拼写如此），传 AreaId 报必填校验
 *   - API-05 响应 data{ reservationId, reservationCode }；**Visitors 元素证件号键为 IdNumber**
 *     （v1.9.8 破坏性更名，不是 IdCard）；同参重复提交记录级幂等，但随行人员会重复累加
 *     （ISS-005 未修复）；缺 Visitors 时返回 HTTP 200 纯文本「流程已终止」，本文件已显式拦截，
 *     绝不能让 isOk(undefined) 把它当成预约成功
 *   - API-06 入参 Code / JsCode / IsPhone（1=手机号授权 code，0=wx.login code）；
 *     响应 data{ Id, NickName, Avatar(base64), Phone, IsRegistered }，Id 即游客档案 GUID，
 *     可直接作为 API-05/08/09/11 的 UserId 入参
 *   - API-11 ReservationStatus 为**中文文本**（待核销/已完成/已取消），错误分支返回空 body
 *   - 平台层必填校验返回 {"status":2,"msg":"[字段] 参数缺少必填项"}，无业务 code
 *   - NeedVerify 实测仍未返回（待明道云场馆工作表加列），缺省 false
 *   - 图片 URL 带 e= / token= 临时签名（约 1 小时失效），随查随用，禁止长期缓存
 */
var config = require('../config/venue')
var storage = require('../utils/storage')

var HOOK_TOKEN = config.USE_PROD && config.PROD_HOOK_TOKEN ? config.PROD_HOOK_TOKEN : config.HOOK_TOKEN
var HOOK_VENUE = config.USE_PROD && config.PROD_HOOK_VENUE ? config.PROD_HOOK_VENUE : config.HOOK_VENUE

/** 并发签发去重：同一 Code 的多个页面同时进来只发一次 API-01 */
var tokenPending = null

/** 内置演示数据（v1.3.41 新包裹结构，不含临时签名 URL） */
var MOCK_VENUE = {
  MuseumInfo: {
    Code: '220261105083',
    Name: '辛亥革命纪念馆（演示数据）',
    Status: '开放',
    BusinessHours: '周二闭馆，8:30—16:30',
    Location: '420100',
    Type: '博物馆',
    Photos: [],
    Introduction: '<p>这里是场馆接口的演示数据。关闭演示开关后，将读取明道云工作流返回的真实场馆信息。</p>',
    Address: '民主路123号',
    ContactPhone: '010-54512232',
    ContactMobile: '',
    NeedVerify: false
  },
  ExhibitionAreaList: [
    { ID: 'demo-m1', Code: 'M1', Name: '大公馆', Location: '一楼大厅', Photos: [] },
    { ID: 'demo-m2', Code: 'M2', Name: '中央馆', Location: '二楼', Photos: [] }
  ],
  // 预约页的日期列表也由 API-02 提供；v1.9.13 起按日期每天一条，**不再有 SessionId/SessionName**
  // （2026-11-12 线上实测 7 条，字段仅 ID/Date/DailyQuota/DailyUsed/CanReserve）
  ReservationDateList: (function () {
    var list = []
    for (var i = 0; i < 3; i++) {
      var d = new Date(Date.now() + i * 86400000)
      var y = d.getFullYear()
      var m = ('0' + (d.getMonth() + 1)).slice(-2)
      var day = ('0' + d.getDate()).slice(-2)
      list.push({
        ID: 'demo-date-' + i,
        Date: y + '-' + m + '-' + day + ' 00:00:00',
        DailyQuota: 1000,
        DailyUsed: i === 0 ? 0 : 12,
        CanReserve: 1
      })
    }
    return list
  })()
}

/** 是否走演示数据：可被 storage 运行时覆盖，便于真机免重编译切换 */
function isMock() {
  var forced = storage.getItem(config.FORCE_MOCK_KEY, null)
  if (forced === null || forced === undefined) return config.USE_MOCK
  return !!forced
}

/** 联调日志开关：默认随 config.DEBUG，可用 storage 运行时覆盖 */
function debugEnabled() {
  var forced = storage.getItem(config.DEBUG_KEY, null)
  if (forced === null || forced === undefined) return !!config.DEBUG
  return !!forced
}

/** 只打印接口编号与业务标识，绝不打印 token 明文 / 完整 URL / 原始响应 */
function log() {
  if (!debugEnabled()) return
  var args = ['[venue]'].concat(Array.prototype.slice.call(arguments))
  console.log.apply(console, args)
}

/** 成功判据：code 为空 / 0 / 1（附录 C） */
function isOk(code) {
  if (code === '' || code === null || code === undefined) return true
  return config.OK_CODES.indexOf(code) >= 0
}

/** 拼 query：手工 encode，避免 wx.request 对键名大小写与特殊字符的处理差异 */
function buildUrl(base, query) {
  var parts = []
  Object.keys(query).forEach(function (k) {
    var v = query[k] == null ? '' : query[k]
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v))
  })
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + parts.join('&')
}

/**
 * 单次请求；GET 传拼好 query 的 url，POST 传 JSON body。
 * 兼容返回体是字符串的情况。
 */
function requestJson(url, method, body) {
  return new Promise(function (resolve, reject) {
    if (typeof wx === 'undefined' || typeof wx.request !== 'function') {
      reject({ code: 'NETWORK', message: '当前环境不支持 wx.request' })
      return
    }
    wx.request({
      url: url,
      method: method || 'GET',
      data: body || undefined,
      timeout: config.TIMEOUT,
      header: { 'Content-Type': 'application/json' },
      success: function (res) {
        if (res.statusCode !== 200) {
          reject({ code: 'HTTP_' + res.statusCode, message: '网络异常（' + res.statusCode + '）' })
          return
        }
        var data = res.data
        if (typeof data === 'string') {
          var raw = data
          try {
            data = JSON.parse(raw)
          } catch (e) {
            // 2026-11-12 实测：API-05 缺 Visitors 会返回 HTTP 200 纯文本「流程已终止」，
            // API-11 错误分支会返回 HTTP 200 空 body。若吞成 {}，callApi 的
            // isOk(undefined) 会把它们判成成功 → 页面弹出「预约成功」但根本没下单。
            // 这里保留可识别标记，交由 callApi 转成 BAD_RESPONSE。
            resolve({ __parseError: true, __raw: String(raw).trim().slice(0, 120) })
            return
          }
        }
        resolve(data || {})
      },
      fail: function (err) {
        var raw = (err && err.errMsg) || ''
        var msg = networkErrorText(raw)
        // 真机调试时 vConsole 能直接看到「域名 / 超时 / 证书」的具体原因，
        // 并带上当前 AppID / 环境版本，便于核对域名是否配在了同一个小程序上。
        if (debugEnabled()) {
          var env = runtimeInfo()
          console.warn('[venue] 请求失败：' + msg + (raw ? ' | 原始错误：' + raw : '') + (env ? ' | ' + env : ''))
        }
        reject({ code: 'NETWORK', message: msg, errMsg: raw })
      }
    })
  })
}

/** 统一错误文案：平台必填校验 {status:2,msg} → 业务 code 映射 → 微信原生码兜底 → 原始 msg */
function errorText(body, fallback) {
  if (!body) return fallback
  if (body.status === 2) return body.msg || fallback
  var key = String(body.code == null ? '' : body.code)
  if (config.ERROR_MSG[key]) return config.ERROR_MSG[key]
  // 通则 §2：微信原生 errcode（40029 / 45011 等）禁止透传，须映射 90006。
  // 线上工作流尚未补该映射，这里一律给「微信登录失败」文案，不把 errmsg 原文展示给游客。
  if (/^4\d{4}$/.test(key)) return config.WX_NATIVE_FALLBACK || config.ERROR_MSG['90006']
  return body.msg || body.message || fallback
}

/**
 * 把 wx.request 的 errMsg 翻译成可执行的排查提示。
 * 真机调试最常见的是「域名未加入 request 合法域名」——开发者工具的
 * urlCheck=false 只在模拟器生效，真机/体验版会实际校验。
 */
function networkErrorText(raw) {
  var s = String(raw || '')
  if (/not in domain list|domain|不在.*域名|合法域名/i.test(s)) {
    return '请求域名未加入小程序后台 request 合法域名（请重启小程序/重新推送真机调试，并核对 AppID）'
  }
  if (/timeout/i.test(s)) return '请求超时，请检查手机网络或稍后重试'
  if (/ssl|cert|certificate/i.test(s)) return 'HTTPS 证书校验失败，请检查域名证书'
  if (/net::ERR|ERR_/i.test(s)) return '网络不可用或请求被拦截，请检查手机网络与代理'
  return s ? '网络异常：' + s : config.ERROR_MSG.NETWORK
}

/**
 * 当前运行的小程序环境（用于排查「域名配在另一个 AppID 上」）。
 * wx.getAccountInfoSync 需基础库 ≥2.2.2，以官方文档核实；低版本走 catch 降级为空。
 */
function runtimeInfo() {
  try {
    var a = typeof wx.getAccountInfoSync === 'function' ? wx.getAccountInfoSync() : null
    var m = a && a.miniProgram
    if (m) return 'appid=' + m.appId + ' env=' + (m.envVersion || '?')
  } catch (e) { /* 低版本基础库不支持，忽略 */ }
  return ''
}

function readToken(code) {
  var c = storage.getItem(config.TOKEN_KEY, null)
  if (!c || c.code !== code || !c.token) return ''
  if (!c.expireAt || Date.now() >= c.expireAt) return ''
  return c.token
}

function saveToken(code, token, expired) {
  var ttl = Number(expired) || 7200
  storage.setItem(config.TOKEN_KEY, {
    code: code,
    token: token,
    expireAt: Date.now() + Math.max(30, ttl - (config.EXPIRE_SKEW || 60)) * 1000
  })
}

function clearToken() {
  storage.removeItem(config.TOKEN_KEY)
}

/** 取令牌：缓存命中直接返回；force=true 时强制重签（用于 20001~20004 自愈） */
function fetchToken(code, force) {
  if (!force) {
    var cached = readToken(code)
    if (cached) {
      log('API-01 命中缓存，跳过签发（Code=' + code + '）；强制重签可执行 wx.removeStorageSync("rh_venueToken")')
      return Promise.resolve(cached)
    }
    if (tokenPending && tokenPending.code === code) {
      log('API-01 并发请求合并，复用同一次签发')
      return tokenPending.promise
    }
  }

  log('API-01 签发令牌（Code=' + code + (force ? '，强制重签' : '') + '）')
  var p = requestJson(buildUrl(HOOK_TOKEN, { Code: code }))
    .then(function (body) {
      var token = body && body.token
      if (!token || !isOk(body && body.code)) {
        var key = String((body && body.code) == null ? '' : body.code)
        throw { code: key || 'UNKNOWN', message: errorText(body, '访问令牌签发失败') }
      }
      saveToken(code, token, body.expired)
      log('API-01 签发成功，有效期 ' + body.expired + 's（已写入缓存）')
      return token
    })
    .then(
      function (t) { tokenPending = null; return t },
      function (e) { tokenPending = null; throw e }
    )

  tokenPending = { code: code, promise: p }
  return p
}

/**
 * 解析小程序码 scene：支持 "code=220261105083"、"Code=xxx&foo=bar"、纯编号。
 * 微信传入的 scene 可能已被编码，decodeURIComponent 失败时按原值处理。
 */
function parseScene(scene) {
  if (!scene) return ''
  var s = String(scene)
  try { s = decodeURIComponent(s) } catch (e) { /* 非法转义则沿用原值 */ }
  var m = /(?:^|&)code=([^&]+)/i.exec(s)
  if (m) return m[1]
  return /^[0-9A-Za-z_-]{4,}$/.test(s) ? s : ''
}

function getVenueCode() {
  return storage.getItem(config.CODE_KEY, '') || config.DEFAULT_CODE
}

function setVenueCode(code) {
  if (code) storage.setItem(config.CODE_KEY, String(code))
}

/** Code 优先级：显式入参 > scene > 本地已存场馆 > 默认联调馆 */
function resolveCode(params) {
  var code = params.code || parseScene(params.scene) || getVenueCode() || config.DEFAULT_CODE
  return String(code)
}

/** 富文本 → 纯文本（首页简介用；详情页可直接用 rich-text 渲染 introHtml） */
function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 布尔兼容：明道云可能返回 true / "true" / 1 / "1" */
function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'Y'
}

/** 取数组：兼容新旧键名与非数组返回值 */
function listOf() {
  for (var i = 0; i < arguments.length; i++) {
    if (Array.isArray(arguments[i])) return arguments[i].filter(Boolean)
  }
  return []
}

/** API-02 原始 data → 页面视图模型（兼容 v1.6.0 包裹结构与旧平铺结构） */
function normalize(raw) {
  raw = raw || {}
  var info = raw.MuseumInfo || raw
  var statusText = String(info.Status || '')
  var closed = /关闭|闭馆|停用/.test(statusText)
  var areas = listOf(raw.ExhibitionAreaList, raw.ExhibitionArea)
  // v1.6.0 新增、v1.8.0 扩为日期×时段：同一天可能返回多条（每条一个时段）
  var dates = listOf(raw.ReservationDateList).map(normalizeDate).filter(function (d) {
    return !!d.id || !!d.date
  })
  return {
    code: info.Code || '',
    name: info.Name || '',
    status: statusText,
    isOpen: statusText !== '' && !closed,
    type: info.Type || '未知',
    location: info.Location || '',
    hours: info.BusinessHours || '',
    address: info.Address || '',
    phone: info.ContactPhone || '',
    mobile: info.ContactMobile || '',
    photos: listOf(info.Photos),
    introHtml: info.Introduction || '',
    introText: htmlToText(info.Introduction || ''),
    // NeedVerify 待明道云加列；新旧结构都可能承载，缺省 false
    needVerify: toBool(info.NeedVerify !== undefined ? info.NeedVerify : raw.NeedVerify),
    areas: areas.map(function (a) {
      return {
        id: a.ID || a.Code || '',
        code: a.Code || '',
        name: a.Name || '',
        location: a.Location || '',
        photos: listOf(a.Photos, a.Photo),
        // 旧版文档写 GUID 数组，v1.3.41 展区已移除 Status；保留兼容
        status: Array.isArray(a.Status) ? a.Status : (a.Status || '')
      }
    }),
    dates: dates
  }
}

/**
 * API-02 ReservationDateList 单项 → 页面视图模型
 * 线上实测 Date 为 'YYYY-MM-DD 00:00:00'，这里同时给出 date（YYYY-MM-DD）与原始串；
 * canReserve 为 1/0，但余量为 0 时也应视为不可约，故合成 reservable 供页面直接用。
 * v1.9.13 起按日期每天一条、不再返回 SessionId/SessionName（2026-11-12 线上实测一致）；
 * 这里仍保留两个字段的读取，仅作线上回滚到时段版的兼容层：
 * api/reservation.js 的 groupVenueDates 会据此聚合，当前恒为空 → 每天一条、slots 为空数组。
 */
function normalizeDate(d) {
  d = d || {}
  var quota = Number(d.DailyQuota) || 0
  var used = Number(d.DailyUsed) || 0
  var raw = String(d.Date || '')
  var canReserve = toBool(d.CanReserve)
  return {
    id: d.ID || '',
    date: raw.slice(0, 10),
    dateRaw: raw,
    sessionId: d.SessionId ? String(d.SessionId) : '',
    sessionName: d.SessionName ? String(d.SessionName) : '',
    quota: quota,
    used: used,
    remaining: Math.max(0, quota - used),
    canReserve: canReserve,
    reservable: canReserve && quota > 0 && used < quota
  }
}

/** API-03 原始 data → 展区详情视图模型（兼容 ExhibitionAreaInfo / 平铺、ExhibitList / Exhibits） */
function normalizeArea(data) {
  data = data || {}
  var info = data.ExhibitionAreaInfo || data
  var exhibits = listOf(data.ExhibitList, data.Exhibits)
  return {
    id: info.ID || info.Code || '',
    code: info.Code || '',
    name: info.Name || '',
    location: info.Location || '',
    introHtml: info.Introduction || '',
    introText: htmlToText(info.Introduction || ''),
    photos: listOf(info.Photos, info.Photo),
    exhibits: exhibits.map(function (e) {
      return {
        id: e.ID || e.Code || '',
        code: e.Code || '',
        name: e.Name || '',
        introHtml: e.Introduction || '',
        introText: htmlToText(e.Introduction || ''),
        photos: listOf(e.Photos, e.Photo),
        videos: listOf(e.Videos),
        audios: listOf(e.Audios),
        location: e.Location || ''
      }
    })
  }
}

/** API-04 原始 data → 展品详情视图模型（兼容 ExhibitInfo / 平铺） */
function normalizeExhibit(data) {
  data = data || {}
  var info = data.ExhibitInfo || data.Exhibit || data
  return {
    id: info.ID || info.Code || '',
    code: info.Code || '',
    name: info.Name || '',
    introHtml: info.Introduction || '',
    introText: htmlToText(info.Introduction || ''),
    photos: listOf(info.Photos, info.Photo),
    videos: listOf(info.Videos),
    audios: listOf(info.Audios),
    location: info.Location || ''
  }
}

/** 调 API-02；令牌类错误清缓存重签一次，避免循环重放 */
function queryVenue(code, token, retried) {
  log('API-02 查询场馆主页（Code=' + code + (retried ? '，令牌重签后重放' : '') + '）')
  return requestJson(buildUrl(HOOK_VENUE, { Code: code, Token: token }))
    .then(function (body) {
      // 平台层必填校验：{"status":2,"msg":"[Token] 参数缺少必填项"}
      if (body && body.status === 2) {
        throw { code: 'PARAM', message: body.msg || config.ERROR_MSG.PARAM }
      }
      var d = body && body.data
      // v1.3.41：data.MuseumInfo.Name；旧结构：data.Name
      var info = d && (d.MuseumInfo || d)
      if (isOk(body && body.code) && info && info.Name) {
        return normalize(d)
      }
      var key = String((body && body.code) == null ? '' : body.code)
      if (config.AUTH_CODES.indexOf(key) >= 0 && !retried) {
        clearToken()
        return fetchToken(code, true).then(function (t) {
          return queryVenue(code, t, true)
        })
      }
      throw { code: key || 'UNKNOWN', message: errorText(body, '场馆信息查询失败') }
    })
}

/**
 * 页面主入口：取场馆主页数据
 * @param {{code?: string, scene?: string}} params 一般无需传，扫码时传 scene 即可
 * @returns {Promise<Object>} normalize 后的视图模型；失败 reject({code, message})
 */
function getVenue(params) {
  params = params || {}
  var code = resolveCode(params)
  if (isMock()) return Promise.resolve(normalize(MOCK_VENUE))
  return fetchToken(code).then(function (token) {
    return queryVenue(code, token, false)
  })
}

/* ---------------- API-03~09 通用通道 ---------------- */

function endpoint(key) {
  return config.ENDPOINTS[key] || null
}

/** 端点是否已填入工作流地址（未发布时 callApi 会直接拒绝） */
function isReady(key) {
  var ep = endpoint(key)
  if (!ep) return false
  var url = config.USE_PROD && ep.prodUrl ? ep.prodUrl : ep.url
  return !!url
}

/** 列出全部端点及就绪状态，便于联调期自查 */
function listEndpoints() {
  return Object.keys(config.ENDPOINTS).map(function (key) {
    var ep = config.ENDPOINTS[key]
    return { key: key, id: ep.id, name: ep.name, method: ep.method, ready: isReady(key), params: ep.params }
  })
}

/**
 * 调用 API-03~11：自动注入 Code（及 Token，auth:false 除外），
 * GET 拼 query、POST 发 JSON body（声明 queryKeys 的接口按位置拆分，如 API-10 的混合传参），
 * 复用令牌缓存 / 20001~20004 重签 / 全量错误码映射。
 * @param {string} key ENDPOINTS 的键，如 'areaDetail' / 'reservation'
 * @param {Object} params 业务入参（按 v1.9.14 文档，可含 code / scene）
 * @returns {Promise<Object>} 响应的 data（已解包）；topLevel 接口返回整个响应体
 */
function callApi(key, params) {
  params = params || {}
  var ep = endpoint(key)
  if (!ep) {
    return Promise.reject({ code: 'UNKNOWN_API', message: '未定义的接口：' + key })
  }
  var base = config.USE_PROD && ep.prodUrl ? ep.prodUrl : ep.url
  if (!base) {
    return Promise.reject({
      code: 'NOT_READY',
      message: ep.id + '「' + ep.name + '」工作流未发布，请在 config/venue.js 的 ENDPOINTS.' + key + '.url 填入地址'
    })
  }

  var code = resolveCode(params)
  var payload = { Code: code }
  Object.keys(params).forEach(function (k) {
    if (k === 'code' || k === 'scene') return
    if (params[k] === undefined || params[k] === null) return
    payload[k] = params[k]
  })
  var withToken = ep.auth !== false

  /** 按 queryKeys 拆分 payload → { url, body } */
  function buildRequest(token) {
    if (withToken) payload.Token = token
    if (ep.method !== 'POST') {
      return { url: buildUrl(base, payload), body: null }
    }
    var queryKeys = ep.queryKeys || []
    if (!queryKeys.length) {
      return { url: base, body: payload }
    }
    var query = {}
    var rest = {}
    Object.keys(payload).forEach(function (k) {
      if (queryKeys.indexOf(k) >= 0) query[k] = payload[k]
      else rest[k] = payload[k]
    })
    return { url: buildUrl(base, query), body: rest }
  }

  function run(token, retried) {
    log(ep.id + ' 调用（' + ep.method + (retried ? '，令牌重签后重放' : '') + '）')
    var req = buildRequest(token)
    return requestJson(req.url, ep.method, req.body)
      .then(function (body) {
        // 非 JSON / 空 body：线上 API-05 缺 Visitors 返纯文本「流程已终止」、
        // API-11 错误分支返 HTTP 200 空 body。二者都绝不能按成功处理。
        if (body && body.__parseError) {
          var raw = body.__raw || ''
          log(ep.id + ' 返回非 JSON 响应：' + raw)
          throw {
            code: 'BAD_RESPONSE',
            message: /终止|失败|错误|null/.test(raw)
              ? ep.id + ' 未受理本次请求（' + raw + '），请检查提交内容后重试'
              : (config.ERROR_MSG.BAD_RESPONSE || ep.name + '暂时不可用，请稍后重试')
          }
        }
        // 平台层必填校验：{"status":2,"msg":"[Name] 参数缺少必填项"}，无业务 code
        if (body && body.status === 2) {
          throw { code: 'PARAM', message: body.msg || config.ERROR_MSG.PARAM }
        }
        if (isOk(body && body.code)) {
          // topLevel：API-08 / 09 / 10 无 data 包装，结果直接平铺在顶层
          if (ep.topLevel) return body || {}
          var d = (body && body.data) || {}
          // 防御性兜底：契约要求包 data，但线上曾出现平铺（API-06 早期版本）。
          // 仅当 data 为空且顶层确有业务字段时回退，避免把 {code,msg} 当成数据返回。
          if (!Object.keys(d).length && hasBusinessFields(body)) {
            log(ep.id + ' 响应未按契约包 data，已启用顶层兜底')
            d = body
          }
          // 契约要求成功态必须带非空 data（API-05 预约、API-11 个人信息）。
          // 空 data 通常是工作流异常或空 body，若静默返回会让页面显示「预约成功」却没下单。
          if (ep.requireData && !Object.keys(d).length) {
            throw { code: 'BAD_RESPONSE', message: config.ERROR_MSG.BAD_RESPONSE }
          }
          return d
        }
        var errCode = String((body && body.code) == null ? '' : body.code)
        if (withToken && config.AUTH_CODES.indexOf(errCode) >= 0 && !retried) {
          clearToken()
          return fetchToken(code, true).then(function (t) { return run(t, true) })
        }
        throw { code: errCode || 'UNKNOWN', message: errorText(body, ep.name + '调用失败') }
      })
  }

  return (withToken ? fetchToken(code) : Promise.resolve('')).then(function (token) {
    return run(token, false)
  })
}

/** 顶层是否承载了业务字段（判断「未包 data」用；code / msg / status 不算） */
function hasBusinessFields(body) {
  if (!body) return false
  return Object.keys(body).some(function (k) {
    return ['code', 'msg', 'status', 'message'].indexOf(k) < 0
  })
}

/** API-03 展区详情：接受 areaId 简写，内部映射为线上实际键 ExhbitAreaId */
function getAreaDetail(params) {
  params = params || {}
  var p = Object.assign({}, params)
  if (p.ExhbitAreaId === undefined && p.areaId !== undefined) p.ExhbitAreaId = p.areaId
  delete p.areaId
  return callApi('areaDetail', p).then(normalizeArea)
}

/** API-04 展品详情：接受 exhibitId 简写，内部映射为 ExhibitId */
function getExhibitDetail(params) {
  params = params || {}
  var p = Object.assign({}, params)
  if (p.ExhibitId === undefined && p.exhibitId !== undefined) p.ExhibitId = p.exhibitId
  delete p.exhibitId
  return callApi('exhibitDetail', p).then(normalizeExhibit)
}

/**
 * 解析 API-06 的 `IsRegistered`：`1` 已注册 / `0` 未注册 / **`null` 未知**。
 *
 * ⚠️ 2026-11-11 实测：**js_code 形式（IsPhone=0）返回空字符串 `""`**，
 *   即工作流在该分支没有给该字段赋值（文档写 0/1，异常态为空串）。
 *   空串不能当 0 用 —— 会把已注册的老用户误判成新用户，进而触发重复注册引导。
 *   故此处只承认明确的 0 / 1（含字符串与 1.0 浮点），其余一律返回 null 表示「未知」。
 *
 * 注意 `Number('') === 0`，因此必须先判空串再做数值判断。
 */
function parseIsRegistered(v) {
  if (v === 1 || v === 1.0) return 1
  if (v === 0 || v === 0.0) return 0
  if (v === null || v === undefined) return null
  // 字符串先 trim：全空白的字段与空串同义，不能因为 Number('  ') === 0 就判成「未注册」
  if (typeof v === 'string') {
    var s = v.trim()
    if (s === '') return null
    if (s === '1') return 1
    if (s === '0') return 0
    return null
  }
  var n = Number(v)
  if (isNaN(n)) return null
  if (n === 1) return 1
  if (n === 0) return 0
  return null
}

/**
 * API-06 响应 data → 统一登录身份（两种形式完全一致）
 *
 * v1.9.3/1.9.4 契约：data{ Id, NickName, Avatar, Phone, IsRegistered }
 *   - Id          游客档案记录 ID（GUID），取代旧版 `UserId`，即后续接口的 UserId 入参
 *   - Avatar      **base64 字符串**（不带 data: 前缀，取自游客档案 AvatarBase64 文本字段）
 *   - Phone       手机号明文（形式一写入并返回；形式二档案已存则返回）
 *   - IsRegistered 0 未注册 / 1 已注册 / 空串=未知（见 parseIsRegistered）
 *
 * 这里保留旧字段名兜底（UserId / AvatarUrl / PhoneNumber），避免线上回滚到旧流程时登录直接失败。
 */
function normalizeLoginUser(d) {
  d = d || {}
  var id = d.Id || d.ID || d.UserId || d.userId || ''
  return {
    Id: id,
    // 下游（api/user.js、预约提交、取消预约）统一用 identity 作为 UserId 入参
    UserId: id,
    // 早期封装业务流程只回微信原生平铺结构（openid），保留兜底位以便兼容旧流程
    OpenId: d.OpenId || d.openid || '',
    NickName: d.NickName || d.nickName || d.nickname || '',
    Avatar: d.Avatar || d.AvatarUrl || d.avatar || '',
    Phone: String(d.Phone || d.PhoneNumber || d.Mobile || d.phone || '').replace(/\D/g, '').slice(0, 11),
    // 1 / 0 / null（null 表示服务端未返回有效值，调用方不得按「未注册」处理）
    IsRegistered: parseIsRegistered(d.IsRegistered),
    IsRegisteredRaw: d.IsRegistered === undefined ? null : d.IsRegistered
  }
}

/**
 * API-06 形式二 · js_code：wx.login 拿到的临时凭证，本接口不带 Token。
 * @param {string} jsCode wx.login 回调的 code（一次性，5 分钟有效）
 * @returns {Promise<{Id,UserId,NickName,Avatar,Phone,IsRegistered}>}
 */
function loginWithJsCode(jsCode, params) {
  var code = String(jsCode || '').trim()
  if (!code) return Promise.reject({ code: 'NO_JS_CODE', message: '微信登录凭证为空，请重试' })
  return callApi('wxLogin', Object.assign({}, params || {}, { JsCode: code, IsPhone: 0 }))
    .then(normalizeLoginUser)
}

/**
 * API-06 形式一 · 手机号授权：把 button open-type="getPhoneNumber" 回调里的
 * **一次性 code**（5 分钟有效）作为 JsCode 提交，换号与建档全在明道云侧完成。
 *
 * 注意：v1.9.3 起手机号登录并入 API-06（IsPhone=1），不再有独立的 API-11 手机号流程；
 * 传明文手机号的形式已在 v1.9.1 撤销，前端只发授权 code。
 *
 * @param {string} phoneCode e.detail.code
 * @returns {Promise<{Id,UserId,NickName,Avatar,Phone,IsRegistered}>}
 */
function loginWithPhoneCode(phoneCode) {
  var code = String(phoneCode || '').trim()
  if (!code) {
    return Promise.reject({ code: 'NO_PHONE_CODE', message: '未获取到手机号凭证，请重试' })
  }
  return callApi('wxLogin', { JsCode: code, IsPhone: 1 }).then(normalizeLoginUser)
}

/**
 * API-05 场馆预约提交（v1.9.14 契约）
 *
 * 入参：Code / Token / UserId / ReservateDateId / Visitors[]
 *   Visitors 元素：{ Name, **IdNumber**, Mobile, Type }，Type 枚举 成人 / 儿童；
 *   ⚠️ v1.9.8 把证件号键由 `IdCard` 破坏性更名为 `IdNumber`，传旧键会被工作流忽略，
 *      导致入场人员证件号丢失（服务端无元素级校验，不会报错）。
 *   到场人数由数组长度得出，不再单独传 Number。
 * 响应：data{ reservationId, reservationCode }（data 包裹，v1.9.5 破坏性变更）。
 *
 * ⚠️ 已知服务端缺口（ISS-005，前端须自行兜底）：
 *   - Visitors 为空数组仍会「预约成功」并写库 → 调用方必须拦住空名单；
 *   - 元素级校验缺失（缺 Name / IdNumber、Type 非法均成功）→ 前端必须校验完整；
 *   - 记录级幂等但随行人员不幂等（重复提交会累加）→ 提交前禁用按钮防连点；
 *   - 缺 Visitors 时返回纯文本「流程已终止」→ callApi 已转 BAD_RESPONSE。
 *
 * @param {{userId:string, reservateDateId:string,
 *          visitors:Array<{name:string,idNumber?:string,idCard?:string,mobile:string,type?:string}>,
 *          code?:string, scene?:string}} p
 * @returns {Promise<{reservationId:string,reservationCode:string,raw:Object}>}
 */
/**
 * Visitors 数组 → API-05 线上入参结构。
 * 单独抽成纯函数，便于离线单测锁死 v1.9.8 的破坏性更名（IdCard → IdNumber），
 * 避免日后有人「顺手改回去」导致入场人员证件号被工作流静默丢弃。
 */
function buildVisitors(list) {
  return (Array.isArray(list) ? list : []).map(function (v) {
    v = v || {}
    // 入参兼容项目内部长期使用的 idCard，但**对外只发 IdNumber**
    var idNo = v.idNumber || v.IdNumber || v.idCard || v.IdCard || ''
    return {
      Name: String(v.name || v.Name || '').trim(),
      IdNumber: String(idNo).trim().toUpperCase(),
      Mobile: String(v.mobile || v.Mobile || v.phone || '').trim(),
      Type: v.type === '儿童' || v.Type === '儿童' ? '儿童' : '成人'
    }
  })
}

function createReservation(p) {
  p = p || {}
  var body = {}
  if (p.userId) body.UserId = p.userId
  if (p.reservateDateId) body.ReservateDateId = p.reservateDateId
  var list = Array.isArray(p.visitors) ? p.visitors : []
  if (list.length) body.Visitors = buildVisitors(list)
  if (p.code !== undefined) body.code = p.code
  if (p.scene !== undefined) body.scene = p.scene
  if (body.UserId === undefined || body.ReservateDateId === undefined || !body.Visitors) {
    return Promise.reject({ code: 'PARAM', message: '预约信息不完整（需游客身份、预约日期与实名名单）' })
  }
  return callApi('reservation', body).then(function (d) {
    d = d || {}
    return {
      reservationId: d.reservationId || '',
      reservationCode: d.reservationCode || '',
      raw: d
    }
  })
}

/**
 * API-09 取消预约（v1.9.14：GET + query，状态「已就绪」）
 *
 * v1.9.8 起 ISS-006 已修复，不再是旧实测的「恒返 90025 未就绪」；
 * 2026-11-12 在线核验 GET / POST 均可达，按文档统一 GET。
 * 仅「待核销」/「已完成」状态允许取消，记录不存在或已取消返回 90025，
 * 调用方仍应对 90025 做降级提示，不要展示成「已取消」。
 * 契约只有 Code / Token / UserId / ReservationId 四项，无 CancelReason。
 */
function cancelReservation(p) {
  p = p || {}
  var body = {}
  if (p.userId !== undefined) body.UserId = p.userId
  if (p.reservationId !== undefined) body.ReservationId = p.reservationId
  if (p.code !== undefined) body.code = p.code
  if (p.scene !== undefined) body.scene = p.scene
  return callApi('cancelReservation', body)
}

/**
 * API-10 更新用户信息：query 传 Code / Token / UserId，body 传 NickName / Avatar。
 * Avatar 必须是**不带 data: 前缀的纯 base64**（小程序端先用 FileSystemManager.readFile encoding=base64 读出）。
 */
function updateUserInfo(p) {
  p = p || {}
  var body = {}
  if (p.userId !== undefined) body.UserId = p.userId
  if (p.nickName !== undefined) body.NickName = p.nickName
  if (p.avatar !== undefined) body.Avatar = p.avatar
  if (p.code !== undefined) body.code = p.code
  if (p.scene !== undefined) body.scene = p.scene
  return callApi('updateUser', body)
}

/**
 * v1.9.14 / CHG-024：`ReservationStatus` 由数字编码改为中文文本。
 * 这里同时兼容旧版数字返回（放进 statusCode），但**不做数字→中文映射**——
 * 文档从未定义数字枚举，凭猜测映射会给出错误状态，宁可留空由展示层兜底。
 * @returns {{text:string, code:number}}
 */
function normalizeReservationStatus(v) {
  if (v === null || v === undefined) return { text: '', code: 0 }
  if (typeof v === 'string') {
    var s = v.trim()
    if (s && !/^\d+(\.\d+)?$/.test(s)) return { text: s, code: 0 }
    var n = Number(s)
    return { text: '', code: isNaN(n) ? 0 : n }
  }
  var num = Number(v)
  return { text: '', code: isNaN(num) ? 0 : num }
}

/**
 * API-08 提交反馈（v1.9.11 发布、v1.9.12 收敛）
 *
 * 契约只接受 5 项：Code / Token / UserId / Title / Description，全必填；
 * 响应仅顶层 `code` / `msg`（成功 msg=「更新成功」），**不返回反馈记录 ID、不支持图片**。
 * 旧版 Content / Contact / images 一律不在本接口传参内，由调用方拼进 Description。
 *
 * @param {{userId:string,title:string,description:string,code?:string,scene?:string}} p
 * @returns {Promise<Object>} 顶层响应体（含 code / msg）
 */
function submitFeedback(p) {
  p = p || {}
  var body = {}
  if (p.userId !== undefined) body.UserId = p.userId
  if (p.title !== undefined) body.Title = p.title
  if (p.description !== undefined) body.Description = p.description
  if (p.code !== undefined) body.code = p.code
  if (p.scene !== undefined) body.scene = p.scene
  var title = String(body.Title || '').trim()
  var desc = String(body.Description || '').trim()
  if (!body.UserId || !title || !desc) {
    return Promise.reject({ code: 'PARAM', message: '反馈需要登录态、标题与描述，请补全后重试' })
  }
  return callApi('feedback', body)
}

/**
 * API-11 获取个人信息与预约记录列表（v1.9.14）
 *
 * 入参 Code / Token / UserId；响应 data{ UserId, NickName, ReservationList[] }。
 * ReservationList 元素：{ ID, ReservationCode, Total, ReservationStatus(中文文本) }
 *
 * ⚠️ 该列表**不含预约日期与场馆**（API-07 已于 v1.9.8 废弃，无后续接口可补），
 *    因此「我的预约」列表页仍读自有工作表；本接口只用于个人信息同步与数量统计。
 *    另：错误分支线上返回 HTTP 200 空 body，已由 ENDPOINTS.requireData 拦成 BAD_RESPONSE。
 *
 * @param {string} userId 游客档案 GUID（API-06 返回的 Id）
 * @returns {Promise<{userId,nickName,mobile,avatar,reservations:Array}>}
 */
function getProfileReservations(userId) {
  var uid = String(userId || '').trim()
  if (!uid) return Promise.reject({ code: 'NO_USER', message: config.ERROR_MSG.NO_USER })
  return callApi('profileReservations', { UserId: uid }).then(function (d) {
    d = d || {}
    var list = Array.isArray(d.ReservationList) ? d.ReservationList : []
    return {
      userId: d.UserId || uid,
      nickName: d.NickName || '',
      // v1.9.14 响应示例已不含 Mobile / Avatar（线上实测亦缺失），按可选字段处理
      mobile: String(d.Mobile || '').replace(/\D/g, ''),
      avatar: d.Avatar || '',
      reservations: list.map(function (r) {
        r = r || {}
        var st = normalizeReservationStatus(r.ReservationStatus)
        return {
          id: r.ID || '',
          code: r.ReservationCode || '',
          total: Number(r.Total) || 0,
          status: st.text,       // 中文文本：待核销 / 已完成 / 已取消
          statusCode: st.code    // 旧版数字编码兼容位，新版恒为 0
        }
      })
    }
  })
}

module.exports = {
  getVenue: getVenue,
  getAreaDetail: getAreaDetail,
  getExhibitDetail: getExhibitDetail,
  loginWithJsCode: loginWithJsCode,
  loginWithPhoneCode: loginWithPhoneCode,
  createReservation: createReservation,
  cancelReservation: cancelReservation,
  updateUserInfo: updateUserInfo,
  submitFeedback: submitFeedback,
  getProfileReservations: getProfileReservations,
  callApi: callApi,
  isReady: isReady,
  listEndpoints: listEndpoints,
  fetchToken: fetchToken,
  clearToken: clearToken,
  parseScene: parseScene,
  normalize: normalize,
  normalizeArea: normalizeArea,
  normalizeExhibit: normalizeExhibit,
  normalizeLoginUser: normalizeLoginUser,
  /** 解析 IsRegistered：1 已注册 / 0 未注册 / null 未知（空串与缺省都算未知） */
  parseIsRegistered: parseIsRegistered,
  getVenueCode: getVenueCode,
  setVenueCode: setVenueCode,
  isMock: isMock,
  // 供 tools/venue-api-test.js 做离线断言
  _internal: { buildUrl: buildUrl, isOk: isOk, errorText: errorText, networkErrorText: networkErrorText, runtimeInfo: runtimeInfo, htmlToText: htmlToText, toBool: toBool, listOf: listOf, normalizeDate: normalizeDate, normalizeLoginUser: normalizeLoginUser, parseIsRegistered: parseIsRegistered, normalizeReservationStatus: normalizeReservationStatus, buildVisitors: buildVisitors, hasBusinessFields: hasBusinessFields }
}
