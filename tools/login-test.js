/**
 * 登录链路自测（Node 直跑，stub wx）
 *
 * 覆盖代理模式（生产路径）的完整行为：
 *   1. 并发登录去重 —— 多个页面同时触发只换一次 openid
 *   2. token 落盘与过期判定
 *   3. ensureLogin 命中缓存 / 过期后强制重登
 *   4. 后端返回失败时 pending 被清空（允许重试，不会永久卡住）
 *   5. 401 静默重登并重放原请求
 *
 * 用法：node tools/login-test.js
 */
const store = {}
let loginCalls = 0
let requestLog = []
/** 由各用例设置：下一次 wx.request 的响应 */
let nextResponse = null

global.wx = {
  setStorageSync: (k, v) => {
    store[k] = v
  },
  getStorageSync: (k) => (k in store ? store[k] : ''),
  removeStorageSync: (k) => {
    delete store[k]
  },
  getStorageInfoSync: () => ({ keys: Object.keys(store) }),
  login(o) {
    loginCalls += 1
    o.success({ code: 'CODE_' + loginCalls })
  },
  request(o) {
    requestLog.push({ url: o.url, method: o.method, data: o.data })
    const r = nextResponse
    nextResponse = null
    if (r) {
      o.success(r)
      return
    }
    o.success({
      statusCode: 200,
      data: {
        success: true,
        error_code: 1,
        data: {
          token: 'TOKEN_' + loginCalls,
          expireAt: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'uid_1', openid: 'op_1', nickname: '红色传承者', avatar: '', phone: '' }
        }
      }
    })
  },
  getFileSystemManager() {
    return {
      readFile(o) {
        o.success({ data: Buffer.from('png-bytes').toString('base64') })
      }
    }
  },
  showToast() {},
  showLoading() {},
  hideLoading() {}
}

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('PASS:', msg)
}

async function main() {
  const config = require('../config/index')
  // 切到代理模式（生产路径）
  config.USE_MOCK = false
  config.USE_PROXY = true
  config.API_BASE = 'https://api.test.local'

  const userApi = require('../api/user')

  /* ---- 1. 并发登录去重 ---- */
  const results = await Promise.all([userApi.login(), userApi.login(), userApi.login(), userApi.login()])
  assert(loginCalls === 1, '并发 4 次登录只调用 1 次 wx.login')
  assert(results.every((u) => u && u.id === 'uid_1'), '并发调用拿到同一个用户')
  assert(store['rh_authToken'] === '"TOKEN_1"', 'token 已写入本地存储')
  assert(requestLog.length === 1 && requestLog[0].url === 'https://api.test.local/api/auth/login', '登录请求打到后端 /api/auth/login')
  assert(requestLog[0].data.code === 'CODE_1', '登录请求携带 wx.login 的 code')

  /* ---- 2. 命中缓存不再登录 ---- */
  const before = loginCalls
  const cached = await userApi.login()
  assert(loginCalls === before, '已有有效登录态时不再请求登录')
  assert(cached.id === 'uid_1', '返回本地缓存的用户')

  /* ---- 3. ensureLogin 命中缓存 ---- */
  const ensured = await userApi.ensureLogin()
  assert(ensured.id === 'uid_1' && loginCalls === before, 'ensureLogin 命中有效登录态时直接返回')

  /* ---- 4. token 过期后强制重登 ---- */
  store['rh_authExpire'] = JSON.stringify(Math.floor(Date.now() / 1000) - 10)
  assert(userApi.isTokenAlive() === false, '过期 token 被判定为不可用')
  const refreshed = await userApi.ensureLogin()
  assert(loginCalls === before + 1, 'token 过期后 ensureLogin 触发一次重登')
  assert(refreshed.id === 'uid_1', '重登后仍返回用户对象')

  /* ---- 5. 后端失败时 pending 清空，可重试 ---- */
  const prevLoginCalls = loginCalls
  nextResponse = {
    statusCode: 502,
    data: { success: false, error_code: 502, error_msg: '明道云连接失败' }
  }
  let failed = false
  try {
    await userApi.refreshLogin()
  } catch (e) {
    failed = e && e.message === '明道云连接失败'
  }
  assert(failed, '后端返回失败时抛出具象错误信息')
  // pending 已清空 → 下一次登录能正常发起（不会永久卡在失败 Promise 上）
  await userApi.refreshLogin()
  assert(loginCalls === prevLoginCalls + 2, '失败后重试能重新发起登录（pending 已释放）')

  /* ---- 6. 401 静默重登并重放 ---- */
  const { request } = require('../api/request')
  store['rh_authExpire'] = JSON.stringify(Math.floor(Date.now() / 1000) + 3600)
  const callsBefore401 = loginCalls
  let served401 = false
  // 第一次请求返回 401，后续返回正常数据
  nextResponse = { statusCode: 401, data: { success: false, error_code: 401, error_msg: '未登录' } }
  const data = await request({ url: '/v3/app/worksheets/users/rows/list', method: 'POST', data: { pageSize: 1 } })
  served401 = !!data
  assert(served401, '401 后自动重登并重放原请求，最终拿到数据')
  assert(loginCalls === callsBefore401 + 1, '401 只触发一次重登（不会循环）')

  /* ---- 7. mock 模式上传头像直接返回本地路径 ---- */
  config.USE_MOCK = true
  const localPath = await userApi.uploadAvatar('wxfile://tmp_avatar.png')
  assert(localPath === 'wxfile://tmp_avatar.png', 'mock 模式上传头像直接复用本地临时路径')

  console.log('\n===== 登录链路自测通过（并发去重 / 过期重登 / 401 自愈 / 失败可重试）=====')
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
