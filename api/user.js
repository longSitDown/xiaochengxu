/**
 * 用户服务：登录态管理
 *
 * 三种模式：
 *   mock    —— 首次进入生成本地演示用户（id 固定 demo_user，与种子数据关联）
 *   代理    —— wx.login 得 code → POST 后端 /api/auth/login → 拿 token + 用户档案
 *   直连    —— 无后端时本机生成 dev_ 前缀伪 openid 直接读写 users 表（仅联调，不可上线）
 *
 * 并发去重：多个页面同时触发登录（首页弹窗 + 我的页）时只发一次请求，
 * 其余调用复用同一个 Promise，避免重复换 openid / 重复建用户档。
 */
const config = require('../config/index')
const storage = require('../utils/storage')
const { request } = require('./request')
const { flattenRows, flattenRow, buildFields, filterGroup, filterCond } = require('./adapters')

const USER_KEY = 'user'
const OPENID_KEY = 'localOpenid'
const EXPIRE_KEY = 'authExpire'
const WS = 'users'

/** 进行中的登录 Promise（并发去重用） */
let pending = null

/** 当前用户（无登录态返回 null） */
function getUser() {
  return storage.getItem(USER_KEY, null)
}

function saveUser(user) {
  storage.setItem(USER_KEY, user)
  return user
}

/** token 是否还能用：没有过期时间视为可用（mock 模式不写过期时间） */
function isTokenAlive() {
  const token = storage.getItem(config.TOKEN_KEY, '')
  if (!token) return false
  const exp = Number(storage.getItem(EXPIRE_KEY, 0))
  if (!exp) return true
  // 预留 60 秒余量，避免请求发出途中恰好过期
  return exp * 1000 > Date.now() + 60 * 1000
}

/**
 * 登录
 * @param {{force?:boolean}} [opts] force=true 表示忽略本地登录态强制重登
 * @returns {Promise<{id, openid, nickname, avatar, phone}>}
 */
function login(opts) {
  const force = !!(opts && opts.force)
  if (force) pending = null

  // 已有可用登录态：直接返回，不打接口
  const cached = getUser()
  if (!force && cached && (config.USE_MOCK || isTokenAlive())) return Promise.resolve(cached)
  if (force && config.USE_MOCK) {
    // mock 模式下"重登"就是重新生成本地演示用户
    storage.removeItem(USER_KEY)
  }

  // 并发去重：登录进行中时复用同一个 Promise
  if (pending) return pending

  pending = (config.USE_MOCK ? mockLogin() : realLogin())
    .then((user) => {
      pending = null
      return saveUser(user)
    })
    .catch((e) => {
      pending = null
      throw e
    })
  return pending
}

/** 供 request.js 在收到 401 时调用：强制换新 token */
function refreshLogin() {
  return login({ force: true })
}

/** 确保已登录：写操作（预约/答题/反馈）前置校验，未登录直接抛错交给页面引导 */
function ensureLogin() {
  const user = getUser()
  if (user && (config.USE_MOCK || isTokenAlive())) return Promise.resolve(user)
  return login({ force: true })
}

function mockLogin() {
  return new Promise((resolve) => {
    let user = getUser()
    if (!user) {
      // 首次进入生成演示用户：id 固定 demo_user（关联虚拟人/种子数据），openid 随机生成
      user = saveUser({
        id: 'demo_user',
        openid: 'mock_openid_' + Math.random().toString(36).slice(2, 10),
        nickname: '红色传承者',
        avatar: '/images/placeholder.png',
        phone: '13800138000'
      })
    }
    resolve(user)
  })
}

/* ---------------- 真实登录 ---------------- */

function realLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (!res.code) {
          reject({ code: -1, message: '微信登录失败，请重试' })
          return
        }
        const task = config.USE_PROXY ? proxyLogin(res.code) : directLogin(res.code)
        task.then(resolve).catch(reject)
      },
      fail() {
        reject({ code: -1, message: '微信登录失败，请重试' })
      }
    })
  })
}

/**
 * 代理模式登录（生产路径）：appsecret 在后端，前端只拿 token 与档案
 * @param {string} code wx.login 返回的临时凭证
 */
function proxyLogin(code) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.API_BASE + '/api/auth/login',
      method: 'POST',
      data: { code },
      header: { 'Content-Type': 'application/json' },
      timeout: config.TIMEOUT,
      success(res) {
        const body = res.data || {}
        const data = body.data || {}
        if (res.statusCode !== 200 || body.success !== true || !data.token) {
          reject({ code: (body && body.error_code) || res.statusCode, message: body.error_msg || '登录失败' })
          return
        }
        storage.setItem(config.TOKEN_KEY, data.token)
        storage.setItem(EXPIRE_KEY, data.expireAt || 0)
        resolve(data.user)
      },
      fail() {
        reject({ code: -1, message: '登录服务连接失败，请检查网络' })
      }
    })
  })
}

/**
 * 直连模式登录（仅联调）：没有后端就换不到真 openid，用本机持久化伪 openid 顶替。
 * 该 openid 不与微信身份绑定，换设备即变成新用户，绝不可用于生产。
 */
function directLogin(code) {
  return exchangeOpenid(code).then(ensureUser)
}

/** code → openid（直连模式下退化为本机伪 openid） */
function exchangeOpenid(code) {
  const loginUrl = String(config.MINGDAO.loginUrl || '').trim()
  if (!loginUrl) return Promise.resolve(localOpenid())
  return new Promise((resolve, reject) => {
    wx.request({
      url: loginUrl,
      method: 'POST',
      data: { code },
      header: { 'Content-Type': 'application/json' },
      timeout: config.TIMEOUT,
      success(res) {
        const body = (res.data || {}).data || res.data || {}
        if (!body.openid) {
          reject({ code: -1, message: '登录服务未返回 openid' })
          return
        }
        // 后端签发的登录态，后续请求由 request.js 注入 Authorization
        if (body.token) storage.setItem(config.TOKEN_KEY, body.token)
        resolve(body.openid)
      },
      fail() {
        reject({ code: -1, message: '登录服务连接失败' })
      }
    })
  })
}

/** 联调降级用的本机 openid：持久化，保证同一设备重复进入身份稳定 */
function localOpenid() {
  let v = storage.getItem(OPENID_KEY, '')
  if (!v) {
    v = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    storage.setItem(OPENID_KEY, v)
  }
  return v
}

/** 按 openid 读取用户，不存在则建档 */
function ensureUser(openid) {
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 1,
      pageIndex: 1,
      filters: filterGroup('AND', [filterCond('openid', 'eq', openid, WS)])
    }
  })
    .then((data) => {
      const rows = flattenRows(data, WS)
      if (rows.length) return toProfile(rows[0])
      // 首次进入：建用户档（昵称/头像后续可由用户授权后覆盖）
      return request({
        url: '/v3/app/worksheets/' + WS + '/rows',
        method: 'POST',
        data: {
          fields: buildFields(
            { openid, nickname: '红色传承者', avatar: '/images/placeholder.png', phone: '' },
            WS
          ),
          triggerWorkflow: false
        }
      })
        .then((res) =>
          request({
            url: '/v3/app/worksheets/' + WS + '/rows/' + res.rowId,
            method: 'GET'
          })
        )
        .then((data) => toProfile(flattenRow(data, WS)))
    })
    .then((profile) => Object.assign({}, profile, { openid }))
}

/** 工作表行 → 页面消费的用户对象 */
function toProfile(row) {
  return {
    id: row.id,
    openid: row.openid || '',
    nickname: row.nickname || '红色传承者',
    avatar: row.avatar || '/images/placeholder.png',
    phone: row.phone || ''
  }
}

/* ---------------- 资料与登出 ---------------- */

/**
 * 更新当前用户资料（昵称/头像/手机号）
 * 代理模式写后端（服务端用 token 里的用户 ID 定位，前端无法改别人的资料）；
 * 其余模式本地存储直写。
 * @returns {Promise<object|null>}
 */
function updateUser(patch) {
  const user = getUser()
  if (!user) return Promise.resolve(null)

  if (config.USE_PROXY && !config.USE_MOCK) {
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

  return Promise.resolve(saveUser(Object.assign({}, user, patch)))
}

/** 上传头像：小程序本地临时路径 → 后端换永久 URL */
function uploadAvatar(filePath) {
  // mock 演示直接用临时路径（无后端可传），页面同样能正常显示
  if (config.USE_MOCK) return Promise.resolve(filePath)
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

/** 退出登录 */
function logout() {
  storage.removeItem(USER_KEY)
  storage.removeItem(config.TOKEN_KEY)
  storage.removeItem(EXPIRE_KEY)
  pending = null
}

/**
 * 重置演示数据：清空本地用户态与 mock 数据库增量（恢复初始种子）
 * 供演示后一键重置，重新生成初始演示用户和数据。
 */
function resetMockData() {
  logout()
  storage.removeItem(OPENID_KEY)
  const db = require('./mock/db')
  db.resetDb()
}

module.exports = {
  login,
  refreshLogin,
  ensureLogin,
  getUser,
  updateUser,
  uploadAvatar,
  logout,
  resetMockData,
  isTokenAlive
}
