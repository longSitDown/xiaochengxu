/**
 * 用户服务：登录态管理
 *
 * LOGIN_MODE 三态（config/index.js）：
 *   'webhook' → wx.login / getPhoneNumber 拿微信凭证 → 调明道云 API-06 → 拿游客档案 Id 存本地（默认，不需要 server）
 *   'proxy'   → wx.login 得 code → POST 自有后端 /api/auth/login → 后端签发 token（需启动 server）
 *   'mock'    → 本地演示用户，不联网
 *
 * 两个 ID 的语义：
 *   id     —— 真实身份：webhook 为游客档案 Id（GUID）；proxy 为后端用户 ID；mock 为 demo_user
 *   bizId  —— 业务数据关联键：mock 种子数据 userId 固定 demo_user，
 *             所有「我的预约 / 答题 / 反馈」查询与写入都用 getBizId()，不要直接用 id
 *   source —— 登录态来源（'webhook' / 'proxy' / 'mock'），切换 LOGIN_MODE 时旧缓存自动失效
 *
 * 2026-11-11 契约 v1.9.6（重要）：
 *   API-06 入参改为 Code / JsCode / IsPhone，响应 **data 包裹**：
 *   data{ Id, NickName, Avatar(base64), Phone, IsRegistered }。
 *   - Id 取代旧 UserId，仍是「游客档案记录 ID」，可直接作为 API-05/07/09/11 的 UserId 入参；
 *   - Avatar 由附件 URL 改为 base64 字符串 → 本服务落盘成本地文件后只存路径，
 *     避免 base64 撑爆 storage，也避免旧实现里「临时签名 URL 一小时后裂图」；
 *   - Phone 为平台验证过的手机号（形式一写入，形式二档案已存则返回）。
 *   旧缓存的 webhook 用户没有 userId 字段，isTokenAlive() 会判失效并自动重新登录。
 *
 * 并发去重：多个页面同时触发登录时只发一次请求，其余复用同一个 Promise。
 */
const config = require('../config/index')
const storage = require('../utils/storage')

const USER_KEY = 'user'
const EXPIRE_KEY = 'authExpire'
const MOCK_BIZ_ID = 'demo_user'

/** 进行中的登录 Promise（并发去重用） */
let pending = null

/** 当前登录方式：显式 LOGIN_MODE 优先，否则按旧开关回退 */
function loginMode() {
  return config.LOGIN_MODE || (config.USE_REAL_LOGIN || !config.USE_MOCK ? 'proxy' : 'mock')
}

/** 是否走联网登录（mock 模式不联网） */
function isRealLogin() {
  return loginMode() !== 'mock'
}

/** 当前用户（无登录态返回 null） */
function getUser() {
  return storage.getItem(USER_KEY, null)
}

/**
 * 判断是否为「本机已持久化」的头像文件（而非微信给的临时路径）。
 *
 * 为什么不能只认 wxfile:// ——
 *   真机 USER_DATA_PATH 是 wxfile://usr，开发者工具是 http://usr。
 *   早期只写了 /^wxfile:\/\//，导致工具里持久化后的头像被判成"非本地"，
 *   重新登录时被 API-06 返回的附件 URL（带临时签名，约 1 小时）顶掉，
 *   签名过期后 <image> 就裂开，表现为"改完头像刷新就没了"。
 */
function isPersistedLocalFile(p) {
  const s = String(p || '')
  if (!s) return false
  if (s.indexOf('/images/') === 0) return false
  const base = (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) || ''
  if (base && s.indexOf(base) === 0) return true
  return /^(wxfile|http):\/\/usr\//.test(s)
}

/** 尽力删除一个本机头像文件（删不掉不影响主流程） */
function removeLocalAvatar(p) {
  const s = String(p || '')
  if (!isPersistedLocalFile(s)) return
  try {
    const fs = wx.getFileSystemManager()
    if (fs && fs.unlink) fs.unlink({ filePath: s, fail() {} })
  } catch (e) {
    /* 忽略 */
  }
}

function saveUser(user) {
  const prev = getUser()
  const prevAvatar = String((prev && prev.avatar) || '')
  const nextAvatar = String((user && user.avatar) || '')
  // 旧头像只有在新头像**确认落库之后**才清理。
  // 若在选图时就删（旧实现），用户"选了头像但没保存/保存失败"会让 storage 仍指向已删除文件，
  // 下次进来头像直接消失。
  if (prevAvatar && prevAvatar !== nextAvatar) removeLocalAvatar(prevAvatar)
  storage.setItem(USER_KEY, user)
  return user
}

/**
 * 业务数据关联键：mock 种子数据 userId 固定 demo_user。
 * 所有查询/写入用户相关数据的地方都应调用本方法，而不是直接取 user.id。
 */
function getBizId() {
  const u = getUser()
  if (!u) return ''
  if (u.bizId) return u.bizId
  return config.USE_MOCK ? MOCK_BIZ_ID : (u.id || '')
}

/**
 * 游客档案记录 ID（GUID）—— API-05 预约 / API-08 反馈 / API-09 取消 / API-10 资料 / API-11 个人信息的 UserId 入参。
 * （API-07「我的预约」已于契约 v1.9.8 废弃，不再有此下游。）
 * 与 getBizId() 的区别：bizId 是业务表关联键（mock 下为 demo_user），
 * userId 是明道云「游客档案」表的真实记录 ID，只由 API-06 下发（响应字段名 Id）。
 */
function getUserId() {
  const u = getUser()
  if (!u) return ''
  return u.userId || u.id || ''
}

/**
 * 登录态是否可用：
 *   webhook → 必须是 source='webhook' 的真实游客身份（旧 mock / proxy 缓存一律失效）
 *   proxy   → 校验后端 token 与过期时间（预留 60 秒余量）
 */
function isTokenAlive() {
  if (loginMode() === 'webhook') {
    const u = getUser()
    if (!u || u.source !== 'webhook') return false
    // v1.9.6 起身份是游客档案 Id，且它是 API-05 / 07 / 09 / 11 的必填入参
    if (u.userId) return !/^(mock_|dev_)/.test(u.userId)
    // 早期响应只回 openid（无 UserId）：允许登录态继续用，避免反复重登，
    // 但这类身份无法预约，页面在写操作前应引导重新登录。
    return !!u.identityFromOpenId
  }
  const token = storage.getItem(config.TOKEN_KEY, '')
  if (!token) return false
  const exp = Number(storage.getItem(EXPIRE_KEY, 0))
  if (!exp) return true
  return exp * 1000 > Date.now() + 60 * 1000
}

/**
 * 登录
 * @param {{force?:boolean}} [opts] force=true 表示忽略本地登录态强制重登
 * @returns {Promise<{id, openid, bizId, source, nickname, avatar, phone}>}
 */
function login(opts) {
  const force = !!(opts && opts.force)
  if (force) pending = null

  const real = isRealLogin()

  // 已有可用登录态：直接返回，不打接口。
  // 切换登录方式后旧缓存 source 不匹配，会在这里被判失效并重新联网登录。
  const cached = getUser()
  const cacheUsable = real ? !!(cached && isTokenAlive()) : !!cached
  if (!force && cacheUsable) return Promise.resolve(cached)
  if (force && !real) {
    // 本地演示模式下"重登"就是重新生成本地演示用户
    storage.removeItem(USER_KEY)
  }

  if (pending) return pending

  pending = (real ? realLogin() : mockLogin())
    .then((user) => finalizeUser(user))
    .then((user) => {
      pending = null
      console.log('[登录] 登录态已就绪：source=' + user.source + ' userId=' + (user.userId || '-') + ' id=' + user.id, user)
      return saveUser(user)
    })
    .catch((e) => {
      pending = null
      console.warn('[登录] 失败：', e)
      throw e
    })
  return pending
}

/** 供 request.js 在收到 401 时调用：强制重新登录 */
function refreshLogin() {
  return login({ force: true })
}

/** 确保已登录：写操作（预约/答题/反馈）前置校验，未登录直接抛错交给页面引导 */
function ensureLogin() {
  const user = getUser()
  const usable = user && (isRealLogin() ? isTokenAlive() : true)
  if (usable) return Promise.resolve(user)
  return login({ force: true })
}

function mockLogin() {
  return new Promise((resolve) => {
    let user = getUser()
    if (!user) {
      user = saveUser({
        id: MOCK_BIZ_ID,
        openid: 'mock_openid_' + Math.random().toString(36).slice(2, 10),
        bizId: MOCK_BIZ_ID,
        source: 'mock',
        nickname: '红色传承者',
        avatar: '/images/placeholder.png',
        phone: '13800138000'
      })
    }
    resolve(user)
  })
}

/* ---------------- 联网登录 ---------------- */

function realLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        // 联调期打印临时凭证（5 分钟一次性），便于确认 wx.login 确实被调用
        console.log('[登录] wx.login code =', res.code)
        if (!res.code) {
          console.warn('[登录] wx.login 未返回 code')
          reject({ code: -1, message: '微信登录失败，请重试' })
          return
        }
        const task = loginMode() === 'webhook' ? webhookLogin(res.code) : proxyLogin(res.code)
        task.then(resolve).catch(reject)
      },
      fail(err) {
        console.warn('[登录] wx.login 调用失败：', err)
        reject({ code: -1, message: '微信登录失败，请重试' })
      }
    })
  })
}

/**
 * 头像是否是一段 base64 图片（API-06 v1.9.4 起 Avatar 为纯 base64，不带 data: 前缀）。
 * 判定尽量保守：排除 http(s) / 本机路径 / 项目静态图，其余长度足够且字符集像 base64 的才认。
 */
function isBase64Avatar(v) {
  const s = String(v || '')
  if (s.length < 128) return false
  if (/^(https?:|wxfile:|data:|\/)/i.test(s)) return false
  return /^[A-Za-z0-9+/=\s]+$/.test(s)
}

/** base64 头像指纹：长度 + 前 24 字符，用于判断「本次登录拿到的头像和上次一样」 */
function avatarSigOf(b64) {
  const s = String(b64 || '')
  return s ? s.length + ':' + s.slice(0, 24) : ''
}

/**
 * 把 base64 头像写成 USER_DATA_PATH 下的本地文件。
 *
 * 为什么不直接存 base64：
 *   一张头像 base64 常在几十 KB 到数百 KB，塞进 storage 会挤压 10MB 配额，
 *   且每次登录都会把整段字符串重新写一遍。落盘后 storage 里只有一个短路径。
 * 为什么不用 data: URI 兜底：
 *   兜底路径同样要写进 storage，体积问题依旧；写盘失败时退回上一次的头像更稳。
 *
 * @returns {Promise<string>} 本地文件路径；失败返回 ''（由调用方回退）
 */
function writeAvatarBase64(base64) {
  return new Promise((resolve) => {
    const base = (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) || ''
    if (!base) { resolve(''); return }
    let fs = null
    try {
      fs = wx.getFileSystemManager && wx.getFileSystemManager()
    } catch (e) {
      fs = null
    }
    if (!fs || typeof fs.writeFile !== 'function') { resolve(''); return }
    const dest = base + '/avatar_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.png'
    fs.writeFile({
      filePath: dest,
      data: String(base64 || ''),
      encoding: 'base64',
      success() { resolve(dest) },
      fail() {
        console.warn('[用户] base64 头像落盘失败，沿用上一次的头像')
        resolve('')
      }
    })
  })
}

/**
 * 登录返回值的收尾处理：把 base64 头像落盘、清掉不该落库的中间字段。
 * 头像没变时直接复用上一份本地文件，避免每次登录都产生新文件。
 * @returns {Promise<Object>} 可落盘的 user
 */
function finalizeUser(user) {
  if (!user) return Promise.resolve(user)
  const b64 = String(user.avatarBase64 || '')
  if (!b64) {
    delete user.avatarBase64
    return Promise.resolve(user)
  }
  const sig = avatarSigOf(b64)
  const prev = getUser() || {}
  const prevUsable = isPersistedLocalFile(prev.avatar) && prev.avatarSig === sig
  if (prevUsable) {
    user.avatar = prev.avatar
    delete user.avatarBase64
    return Promise.resolve(user)
  }
  return writeAvatarBase64(b64).then((path) => {
    // 写盘失败：不让 storage 存 base64，退回上一次头像或占位图
    user.avatar = path || (isPersistedLocalFile(prev.avatar) ? prev.avatar : '/images/placeholder.png')
    user.avatarSig = path ? sig : ''
    delete user.avatarBase64
    return user
  })
}

/**
 * API-06 登录态组装（两种调用形式共用）。
 * @param {Object} d 登录响应 data：Id / NickName / Avatar(base64) / Phone / IsRegistered
 * @returns {Object} 可直接落盘的本地登录态（avatarBase64 由 finalizeUser 落盘后清除）
 */
function buildWebhookUser(d) {
  d = d || {}
  // v1.9.3 起身份字段名回到 Id；UserId / OpenId 为旧流程兜底
  const userId = d.Id || d.ID || d.UserId || d.userId || ''
  const openid = d.OpenId || d.openid || ''
  // Id 是 API-05 / 07 / 09 / 11 的 UserId 入参，缺了就没法预约；早期契约只回 OpenId，故两者取其一
  const identity = userId || openid
  if (!identity) {
    throw { code: -1, message: '登录接口未返回游客身份（Id）' }
  }
  // webhook 模式没有自有 token：清掉历史后端 token，避免 request.js 误带 Authorization
  storage.removeItem(config.TOKEN_KEY)
  storage.removeItem(EXPIRE_KEY)

  // 游客档案里的昵称头像为空时用本地已填资料兜底，避免每次重登都重置成默认值。
  // 「微信用户」是微信侧匿名占位昵称，不应覆盖用户自己填的名字。
  const prev = getUser() || {}
  const apiNick = d.NickName && d.NickName !== '微信用户' ? d.NickName : ''
  const apiAvatar = String(d.Avatar || '')
  const apiAvatarIsB64 = isBase64Avatar(apiAvatar)
  // 本机已落盘的头像优先：档案里的头像可能是 base64（需落盘）或历史附件 URL（带临时签名）
  const localAvatar = isPersistedLocalFile(prev.avatar) ? String(prev.avatar) : ''
  // API-06 形式一换到的是平台验证过的手机号，优先级高于本地手填
  const apiPhone = String(d.Phone || d.PhoneNumber || d.Mobile || d.phone || '')
    .replace(/\D/g, '')
    .slice(0, 11)

  // IsRegistered 三态：1 已注册 / 0 未注册 / null 未知。
  // 实测 js_code 形式（IsPhone=0）该字段返回空字符串 ""，工作流未赋值；
  // 空串必须当「未知」而不是「未注册」，否则老用户会被判成新用户、重复走注册引导。
  const regFlag = require('./venue').parseIsRegistered(d.IsRegistered)
  if (regFlag === null) {
    console.warn('[登录] API-06 未返回有效 IsRegistered（原始值：' + JSON.stringify(d.IsRegistered) + '），按「未知」处理，不触发注册引导')
  }

  return {
    id: identity,                                   // 真实身份（webhook = 游客档案 Id）
    userId: userId,                                 // API-05 / 07 / 09 / 11 的 UserId 入参
    openid: openid,                                 // 旧契约字段，保留兼容
    // 只拿到 openid 的旧响应：允许登录，但预约类接口用不了，标记出来供页面判断
    identityFromOpenId: !userId && !!openid,
    bizId: config.USE_MOCK ? MOCK_BIZ_ID : identity, // mock 业务数据仍按 demo_user 关联
    source: 'webhook',
    // true 已注册 / false 未注册 / null 服务端未给出有效值（不得当 false 用）
    isRegistered: regFlag === null ? null : regFlag === 1,
    // 原始值优先取 normalizeLoginUser 留下的 IsRegisteredRaw（空串也是有效排查线索）
    isRegisteredRaw: d.IsRegisteredRaw !== undefined
      ? d.IsRegisteredRaw
      : (d.IsRegistered === undefined ? null : d.IsRegistered),
    nickname: apiNick || prev.nickname || '红色传承者',
    avatar: localAvatar || (apiAvatarIsB64 ? '' : apiAvatar) || prev.avatar || '/images/placeholder.png',
    // base64 头像先挂在这里，由 finalizeUser 落盘后清掉，绝不进 storage
    avatarBase64: apiAvatarIsB64 ? apiAvatar : '',
    avatarSig: apiAvatarIsB64 ? avatarSigOf(apiAvatar) : (prev.avatarSig || ''),
    phone: apiPhone || prev.phone || '',
    // 手机号是否来自微信平台验证（决定「我的」页展示「已验证」标记）
    phoneVerified: !!apiPhone
  }
}

/**
 * API-06 形式二 · js_code 登录（推荐，无自有后端）
 * 入参 Code + JsCode + IsPhone=0，不带 Token。
 * 响应 data{ Id, NickName, Avatar(base64), Phone, IsRegistered } —— 身份标识以 Id 为准。
 */
function webhookLogin(code) {
  const venueApi = require('./venue')
  console.log('[登录] 请求 API-06（形式二 js_code），登录方式 = webhook')
  return venueApi.loginWithJsCode(code).then(buildWebhookUser)
}

/**
 * API-06 形式一 · 手机号授权登录（微信「手机号快速验证」组件）
 *
 * v1.9.3 起手机号登录并入 API-06（IsPhone=1），不再有独立的 API-11 手机号流程：
 * 前端只把 e.detail.code（一次性、5 分钟）作为 JsCode 提交，
 * 换号（getuserphonenumber）与建档全在明道云侧完成，AppSecret 不下发前端。
 *
 * @param {string} phoneCode button open-type="getPhoneNumber" 回调的 e.detail.code
 */
function loginWithPhone(phoneCode) {
  if (loginMode() !== 'webhook') {
    // proxy / mock 模式没有 API-06，走各自的登录实现
    return login()
  }
  const code = String(phoneCode || '').trim()
  if (!code) return Promise.reject({ code: 'NO_PHONE_CODE', message: '未获取到手机号凭证，请重试' })

  const venueApi = require('./venue')
  console.log('[登录] 请求 API-06（形式一 手机号授权）')
  return venueApi
    .loginWithPhoneCode(code)
    .then(buildWebhookUser)
    .then((user) =>
      finalizeUser(user).then((u) => {
        console.log('[登录] 手机号登录成功：userId=' + u.userId + ' 手机号=' + (u.phone ? '已获取' : '未返回'))
        return saveUser(u)
      })
    )
}

/**
 * 代理模式登录（历史路径）：appsecret 在自有后端，前端拿 token 与用户档案。
 * 需先启动 node server/index.js；LOGIN_MODE='proxy' 时才会走这里。
 */
function proxyLogin(code) {
  const url = config.API_BASE + '/api/auth/login'
  console.log('[登录] 请求后端：POST ' + url)
  return new Promise((resolve, reject) => {
    wx.request({
      url: url,
      method: 'POST',
      data: { code },
      header: { 'Content-Type': 'application/json' },
      timeout: config.TIMEOUT,
      success(res) {
        console.log('[登录] 返回内容：', res.data)
        const body = res.data || {}
        const data = body.data || {}
        if (res.statusCode !== 200 || body.success !== true || !data.token) {
          const msg = body.error_msg || '登录失败'
          reject({ code: (body && body.error_code) || res.statusCode, message: msg })
          return
        }
        storage.setItem(config.TOKEN_KEY, data.token)
        storage.setItem(EXPIRE_KEY, data.expireAt || 0)

        const user = Object.assign({}, data.user || {})
        if (config.USE_MOCK && !user.id) user.id = MOCK_BIZ_ID
        user.source = 'proxy'
        user.bizId = config.USE_MOCK ? MOCK_BIZ_ID : (user.id || '')
        resolve(user)
      },
      fail(err) {
        console.error('[登录] 请求后端失败（网络/域名/服务未启动）：', err)
        reject({ code: -1, message: '登录服务连接失败，请检查网络' })
      }
    })
  })
}

/* ---------------- 资料与登出 ---------------- */

/**
 * 内置占位头像的 base64（= images/placeholder.png 的原始内容）。
 * 用途：API-10 的 `Avatar` 是**必填**，用户没设过头像时拿不出文件，
 * 用同一张占位图上传，保证「档案头像为空」与「上传占位图」在视觉上完全一致。
 */
const PLACEHOLDER_AVATAR_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAAD0klEQVR4nO3dTW4TURCFUYLYTWD/C4FeQCaWvAozjSz7xrHb7a6qc4bEEu/v69cJCN6Oh4/TD+Cin5d/GRAIfMENAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQ/Epf5LmWf39v/uz77z9PHQuXvR0PH6crX+OFQXxFMNsQSLEwzgnluQRSMIprxLI+36Q3ieOVv29nbpCmB9Rtsg43SMM49jieqgTS+DDudVyVCKT5Idz7+PZOIAMOX5Vx7pFAhhy6auPdC4EMOmxVx/1KAhl2yKqPf2sCGXi4usxjCwKBQCBDn7rd5vMsAhl8mLrOa00CgUAgEAhk+GtI9/k9SiAQCCSY8nSdMs97CAQCgUAgEAgEcsW09/Jp872VQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCuWLafx8wbb63EggEAoFAIBAIJJjyXj5lnvcQCAQCGf507T6/RwkEAoFAIJDBryFd57UmgQw9TN3m8ywCgUAgA5+6XeaxBYEMO1zVx781gQw6ZFXH/UoCGXLYqo13LwQy4NBVGeceCQSCt+Ph45Q+QJ9/7NlN8n0CaR7FNWK5jUCGhXFOKJlAhoZxTiiX+Sb9iklxTJzvrdwgZxwUt8lnbpBPxGEdzrlBhBG9D/9DxvE3iFsjW4Z/bzI6kOmbf6tl8DqNfMWavOGPeh/2yjXuBhGH9fuOUYGIwzp+15hAxGE97zEiEHFY13u1D0Qc1vcRrQMRh3V+VNtAxGG919A2EFhDy0DcHtZ9Le0CEYf1X1OrQMSxD0ujv8rTKhBYW5tAOj21Olia7EeLQLpsRjdLg31pEQg8S/lAOjylOluK70/pQKov/hRL4X0qHQg8W9lAKj+VJlqK7lfZQGALJQOp+jSabim4byUDga0IBDoFUvGapu7+lQsEtlQqkGpPH+rvY6lAYGsCgQ6BVLqW6bOfZQKBVxAIBAKB6oFUeV+l376WCAReRSAQCAQCgUAgEKgcSIWfdNB3f3cfCLySQCAQCAQCgUAgEAgEAoFA8HY8fJzSB2AyNwgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUDgx3X/AXcrIZAGoVuVAAAAAElFTkSuQmCC'

/** 去掉 data:image/xxx;base64, 前缀（API-10 要求纯 base64，虽实测带前缀也能过） */
function stripDataPrefix(b64) {
  return String(b64 || '').replace(/^data:[^;,]*;base64,/, '')
}

/** 读取本地文件为 base64；任何失败降级为空串，由调用方兜底 */
function readFileBase64(filePath) {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || !wx.getFileSystemManager) { resolve(''); return }
    const fs = wx.getFileSystemManager()
    if (!fs.readFile) { resolve(''); return }
    fs.readFile({
      filePath,
      encoding: 'base64',
      success(res) { resolve(stripDataPrefix(res && res.data)) },
      fail() { resolve('') }
    })
  })
}

/** 下载远程图片到临时文件（头像若已是 URL，需先落地才能转 base64） */
function downloadToTemp(url) {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || !wx.downloadFile) { resolve(''); return }
    wx.downloadFile({
      url,
      success(res) {
        // downloadFile 只要 statusCode 非 200 就拿不到可用文件
        if (res && res.statusCode === 200 && res.tempFilePath) resolve(res.tempFilePath)
        else resolve('')
      },
      fail() { resolve('') }
    })
  })
}

/**
 * 头像 → API-10 需要的 base64。
 * 三种来源分别处理，任何一步失败都退回内置占位图，保证 Avatar 永不为空（否则平台必填校验会拦）：
 *   1. 内置静态图（/images/...）→ 直接用同内容的占位 base64
 *   2. http(s) 远程地址（微信头像 / 明道云图片）→ downloadFile 落临时文件再读
 *   3. 本地文件（chooseAvatar 后落盘的 USER_DATA_PATH）→ readFile
 * @returns {Promise<string>} 纯 base64（无 data: 前缀）
 */
function avatarToBase64(avatar) {
  const p = String(avatar || '')
  if (!p) return Promise.resolve(PLACEHOLDER_AVATAR_BASE64)
  if (p.indexOf('/images/') === 0) return Promise.resolve(PLACEHOLDER_AVATAR_BASE64)
  if (/^https?:\/\//.test(p)) {
    return downloadToTemp(p).then((tmp) => (tmp ? readFileBase64(tmp) : '')).then((b) => b || PLACEHOLDER_AVATAR_BASE64)
  }
  return readFileBase64(p).then((b) => b || PLACEHOLDER_AVATAR_BASE64)
}

/**
 * 把昵称 / 头像同步到「游客档案」（API-10）。
 * 两个字段都是必填，所以一次一定同时带 NickName + Avatar（实测缺任一都是 status:2）。
 * 手机号没有对应接口字段，仍只存本地。
 */
function syncProfileToAccount(user, patch) {
  const venueApi = require('./venue')
  const userId = user.userId || ''
  if (!userId) {
    // 早期身份只有 openid（或登录缓存来自旧版本），拿不到 API-10 必填的 UserId
    return Promise.reject({ code: 'NO_USER', message: '登录态缺少游客档案 ID，请退出后重新登录' })
  }
  const nickname = String(patch.nickname != null ? patch.nickname : user.nickname || '').trim()
  if (!nickname) {
    return Promise.reject({ code: 'PARAM', message: '昵称不能为空' })
  }
  const avatar = patch.avatar != null ? patch.avatar : user.avatar
  return avatarToBase64(avatar).then((base64) =>
    venueApi.updateUserInfo({ userId, nickName: nickname, avatar: base64 })
  )
}

/** 这次修改是否触及需要同步到档案的字段（昵称 / 头像） */
function touchesAccount(user, patch) {
  if (!patch) return false
  if (patch.nickname != null && String(patch.nickname).trim() !== String(user.nickname || '').trim()) return true
  if (patch.avatar != null && String(patch.avatar) !== String(user.avatar || '')) return true
  return false
}

/**
 * 更新当前用户资料（昵称/头像/手机号）
 *   proxy   → 写自有后端 /api/auth/profile
 *   webhook → 昵称头像走 API-10（游客档案），手机号只存本地
 *   mock    → 全部本地
 * 返回保存后的 user 对象。
 */
function updateUser(patch) {
  const user = getUser()
  if (!user) return Promise.resolve(null)
  patch = patch || {}

  if (loginMode() === 'proxy') {
    const token = storage.getItem(config.TOKEN_KEY, '')
    return new Promise((resolve, reject) => {
      wx.request({
        url: config.API_BASE + '/api/auth/profile',
        method: 'PATCH',
        data: patch,
        header: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { Authorization: 'Bearer ' + token } : {}
        ),
        timeout: config.TIMEOUT,
        success(res) {
          const body = res.data || {}
          if (res.statusCode === 200 && body.success === true) {
            resolve(saveUser(Object.assign({}, user, patch)))
            return
          }
          reject({ code: body.error_code || res.statusCode, message: body.error_msg || '保存失败' })
        },
        fail() {
          reject({ code: -1, message: '网络异常，请稍后重试' })
        }
      })
    })
  }

  const merged = Object.assign({}, user, patch)
  const needSync = loginMode() === 'webhook' && user.source !== 'mock' && touchesAccount(user, patch)
  if (!needSync) {
    // 只改了手机号（或 mock 模式）：没有服务端字段可写，纯本地保存
    return Promise.resolve(saveUser(merged))
  }
  return syncProfileToAccount(user, patch).then(() => saveUser(merged))
}

/**
 * 上传头像：
 *   proxy（且非 mock）→ 打自有后端 /api/upload 换永久 URL
 *   webhook / mock    → 没有上传接口，落盘到 wx.env.USER_DATA_PATH
 *
 * 为什么不能直接用 chooseAvatar 的返回值：它给的是**临时路径**，
 * 小程序重启 / 清缓存后即失效，用户下次进来头像会裂图。
 * 持久化到本地用户目录是纯前端可行的方案，不需要 server。
 */
function uploadAvatar(filePath) {
  if (loginMode() === 'proxy' && !config.USE_MOCK) {
    return uploadAvatarToServer(filePath)
  }
  return persistLocalAvatar(filePath)
}

/** 把临时头像复制到本地用户目录，并清掉上一份，避免文件堆积 */
function persistLocalAvatar(tempPath) {
  const p = String(tempPath || '')
  const base = (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) || ''
  const isRemote = /^https?:\/\//.test(p) && !isPersistedLocalFile(p)
  const isStatic = p.indexOf('/images/') === 0
  const isPersisted = isPersistedLocalFile(p)
  // 远程 URL（API-06 返回的微信头像）/ 项目静态占位图 / 已持久化路径 → 原样使用
  if (!p || !base || isPersisted || isRemote || isStatic) return Promise.resolve(p)
  if (typeof wx === 'undefined' || !wx.getFileSystemManager) return Promise.resolve(p)

  const fs = wx.getFileSystemManager()
  if (!fs.copyFile) return Promise.resolve(p)
  // 文件名带时间戳 + 随机后缀，保证同毫秒内连选两次也不会互相覆盖，
  // 且 setData 后 <image> 会刷新，不命中旧路径缓存
  const dest = base + '/avatar_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.png'
  return new Promise((resolve) => {
    fs.copyFile({
      srcPath: p,
      destPath: dest,
      // 复制成功后**不删旧文件**：此刻只是"选了图"，还没保存。
      // 旧文件的清理统一放到 saveUser()，避免"选了没保存"把当前头像弄丢。
      success() {
        resolve(dest)
      },
      // 复制失败降级为临时路径：本次会话仍可显示，不阻断资料保存
      fail() {
        console.warn('[用户] 头像持久化失败，本次使用临时路径', p)
        resolve(p)
      }
    })
  })
}

/** proxy 模式：base64 上传自有后端（需 node server/index.js） */
function uploadAvatarToServer(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success(res) {
        const ext = (String(filePath).split('.').pop() || 'png').toLowerCase()
        const token = storage.getItem(config.TOKEN_KEY, '')
        wx.request({
          url: config.API_BASE + '/api/upload',
          method: 'POST',
          data: { ext: ext === 'jpeg' ? 'jpg' : ext, data: res.data },
          header: Object.assign(
            { 'Content-Type': 'application/json' },
            token ? { Authorization: 'Bearer ' + token } : {}
          ),
          timeout: config.TIMEOUT,
          success(r) {
            const body = r.data || {}
            if (r.statusCode === 200 && body.success === true && body.data && body.data.url) {
              resolve(body.data.url)
              return
            }
            reject({ code: body.error_code || r.statusCode, message: body.error_msg || '上传失败' })
          },
          fail() {
            reject({ code: -1, message: '上传失败，请检查网络' })
          }
        })
      },
      fail() {
        reject({ code: -1, message: '读取图片失败' })
      }
    })
  })
}

/** 退出登录（清本地用户态与历史后端 token） */
function logout() {
  storage.removeItem(USER_KEY)
  storage.removeItem(config.TOKEN_KEY)
  storage.removeItem(EXPIRE_KEY)
  pending = null
}

/** 重置演示数据：清空本地用户态与 mock 数据库增量 */
function resetMockData() {
  logout()
  const db = require('./mock/db')
  db.resetDb()
}

module.exports = {
  login,
  loginWithPhone,
  refreshLogin,
  ensureLogin,
  getUser,
  getBizId,
  getUserId,
  updateUser,
  uploadAvatar,
  logout,
  resetMockData,
  isTokenAlive,
  /** 路径是否为「本机已持久化头像文件」（真机 wxfile://usr / 工具 http://usr） */
  isLocalAvatar: isPersistedLocalFile,
  // 供 tools/login-webhook-test.js 做离线断言
  _internal: { avatarToBase64, stripDataPrefix, touchesAccount, buildWebhookUser, isPersistedLocalFile, isBase64Avatar, avatarSigOf, finalizeUser, PLACEHOLDER_AVATAR_BASE64 }
}
