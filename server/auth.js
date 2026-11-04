/**
 * 登录与登录态
 *
 * 链路：小程序 wx.login() 得 code → POST /api/auth/login { code }
 *       → 本服务调 jscode2session 换 openid（appsecret 只在服务端）
 *       → 查/建 users 工作表记录 → 签发自有 token（HMAC-SHA256）
 *       → 返回 { token, user }，小程序存 token，后续请求带 Authorization: Bearer
 *
 * 为什么不能在小程序里直接换 openid：
 *   jscode2session 必须带 appsecret，而 appsecret 一旦进入小程序包就等于公开。
 *   同理 session_key 也只在服务端使用（解密手机号等），永不返回前端。
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { config } = require('./config')
const hap = require('./hap')

/* ---------------- users 工作表 ---------------- */

let cachedWsId = ''

/**
 * users 表的 worksheetId
 * 优先取环境变量 HAP_USERS_WORKSHEET，其次读同仓库的 config/tables.js，
 * 避免维护两份映射。
 */
function usersWorksheetId() {
  if (cachedWsId) return cachedWsId
  if (process.env.HAP_USERS_WORKSHEET) {
    cachedWsId = process.env.HAP_USERS_WORKSHEET
    return cachedWsId
  }
  try {
    const p = path.join(__dirname, '..', 'config', 'tables.js')
    if (fs.existsSync(p)) {
      const tables = require(p)
      const id = (tables.TABLES && tables.TABLES.users) || ''
      if (id) {
        cachedWsId = id
        return cachedWsId
      }
    }
  } catch (e) {
    /* 忽略，走报错分支 */
  }
  throw { code: 'CONFIG', message: '未找到 users 工作表的 worksheetId：请填 config/tables.js 的 users，或设置 HAP_USERS_WORKSHEET' }
}

/* ---------------- 微信换 openid ---------------- */

async function jscode2session(code) {
  const qs =
    '?appid=' + encodeURIComponent(config.WX_APPID) +
    '&secret=' + encodeURIComponent(config.WX_SECRET) +
    '&js_code=' + encodeURIComponent(code) +
    '&grant_type=authorization_code'
  let res
  try {
    res = await fetch('https://api.weixin.qq.com/sns/jscode2session' + qs)
  } catch (e) {
    throw { code: 'WX_NETWORK', message: '微信接口连接失败：' + (e && e.message) }
  }
  const data = await res.json()
  if (!data.openid) {
    throw { code: 'WX_LOGIN_FAILED', message: '微信登录失败：' + (data.errmsg || '未知原因') }
  }
  // session_key 只留在服务端内存/短期缓存中，绝不外传
  return { openid: data.openid, unionid: data.unionid || '', sessionKey: data.session_key }
}

/* ---------------- token ---------------- */

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromB64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(s, 'base64')
}

/**
 * 签发 token：payload 为 base64url(JSON)，签名取 HMAC-SHA256(payload)
 * @param {object} payload 业务载荷（openid / uid）
 * @param {number} [ttlSeconds] 有效期秒数，默认取配置；传负数可构造过期 token 用于测试
 */
function signToken(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000)
  const ttl = typeof ttlSeconds === 'number' ? ttlSeconds : config.TOKEN_TTL
  const body = Object.assign({}, payload, { iat: now, exp: now + ttl })
  const data = b64url(JSON.stringify(body))
  const sig = b64url(crypto.createHmac('sha256', config.TOKEN_SECRET).update(data).digest())
  return data + '.' + sig
}

/** 校验 token，成功返回 payload，失败返回 null（过期、篡改、格式错误一律 null） */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const expect = crypto.createHmac('sha256', config.TOKEN_SECRET).update(parts[0]).digest()
  let actual
  try {
    actual = fromB64url(parts[1])
  } catch (e) {
    return null
  }
  if (actual.length !== expect.length) return null
  if (!crypto.timingSafeEqual(actual, expect)) return null
  let payload
  try {
    payload = JSON.parse(fromB64url(parts[0]).toString('utf8'))
  } catch (e) {
    return null
  }
  if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

/* ---------------- 用户档案 ---------------- */

function envelopeOk(r) {
  return r && r.body && r.body.success === true && r.body.error_code === 1
}

/** 按 openid 查用户；返回 { id, openid, nickname, avatar, phone } 或 null */
async function findUser(openid) {
  const r = await hap.forward({
    method: 'POST',
    path: '/v3/app/worksheets/' + usersWorksheetId() + '/rows/list',
    body: {
      pageSize: 1,
      pageIndex: 1,
      filters: {
        type: 'group',
        logic: 'AND',
        children: [{ type: 'condition', field: 'openid', operator: 'eq', value: openid }]
      }
    }
  })
  if (!envelopeOk(r)) {
    throw { code: 'HAP_ERROR', message: (r.body && r.body.error_msg) || '读取用户表失败' }
  }
  const rows = (r.body.data && r.body.data.rows) || []
  if (!rows.length) return null
  return toProfile(rows[0])
}

/** 行记录 → 用户对象 */
function toProfile(row) {
  const get = (id) => {
    const hit = (row.fields || []).filter((f) => f.id === id)[0]
    if (!hit) return ''
    const v = hit.value
    if (Array.isArray(v)) return v.length ? String(v[0]) : ''
    return v == null ? '' : String(v)
  }
  return {
    id: row.id,
    openid: get('openid'),
    nickname: get('nickname') || '红色传承者',
    avatar: get('avatar'),
    phone: get('phone')
  }
}

/** 建档：昵称给默认值，头像与手机号由用户后续在「我的」页完善 */
async function createUser(openid) {
  const r = await hap.forward({
    method: 'POST',
    path: '/v3/app/worksheets/' + usersWorksheetId() + '/rows',
    body: {
      fields: [
        { id: 'openid', value: openid },
        { id: 'nickname', value: '红色传承者' },
        { id: 'avatar', value: '' },
        { id: 'phone', value: '' }
      ],
      triggerWorkflow: false
    }
  })
  if (!envelopeOk(r)) {
    throw { code: 'HAP_ERROR', message: (r.body && r.body.error_msg) || '创建用户失败' }
  }
  return { id: r.body.data.rowId, openid, nickname: '红色传承者', avatar: '', phone: '' }
}

/** 更新用户资料（昵称/头像/手机号） */
async function updateUser(uid, patch) {
  const allow = ['nickname', 'avatar', 'phone']
  const fields = allow
    .filter((k) => patch[k] !== undefined)
    .map((k) => ({ id: k, value: String(patch[k] == null ? '' : patch[k]) }))
  if (!fields.length) throw { code: 'BAD_REQUEST', message: '没有可更新的字段' }
  const r = await hap.forward({
    method: 'PATCH',
    path: '/v3/app/worksheets/' + usersWorksheetId() + '/rows/' + uid,
    body: { fields }
  })
  if (!envelopeOk(r)) {
    throw { code: 'HAP_ERROR', message: (r.body && r.body.error_msg) || '更新用户资料失败' }
  }
  return true
}

/* ---------------- 登录入口 ---------------- */

async function login(code) {
  const expireAt = Math.floor(Date.now() / 1000) + config.TOKEN_TTL
  if (config.MOCK_LOGIN) {
    // 仅联调用：跳过微信与明道云，直接发 token，让前端先把登录流程跑通
    const openid = 'mock_' + String(code).slice(0, 12)
    return {
      token: signToken({ openid, uid: '' }),
      expireAt,
      user: { id: '', openid, nickname: '联调用户', avatar: '', phone: '' }
    }
  }
  const sess = await jscode2session(code)
  let user = await findUser(sess.openid)
  if (!user) user = await createUser(sess.openid)
  const token = signToken({ openid: sess.openid, uid: user.id })
  return { token, expireAt, user }
}

module.exports = {
  login,
  signToken,
  verifyToken,
  jscode2session,
  findUser,
  createUser,
  updateUser,
  usersWorksheetId
}
