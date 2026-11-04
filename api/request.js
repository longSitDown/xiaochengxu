/**
 * 统一请求层 —— 页面/服务层唯一的数据通道
 *
 * 三种模式：
 *   1. mock：路由到本地 mock 引擎（结构与明道云 API V3 完全一致）
 *   2. 直连：wx.request 打明道云，Header 带 HAP-Appkey / HAP-Sign（仅本机调试）
 *   3. 代理：wx.request 打自有后端 /api/hap/*，后端代签，前端只带 Authorization
 *
 * 四条关键处理：
 *   1. 工作表 ID 重写：服务层传别名（如 reservations），发请求前按 config/tables.js
 *      替换为真实 worksheetId。这样 adapters 仍能用别名查 SCHEMES 取字段定义，
 *      避免「换成真实 ID 后字段格式化整体失效」的连环问题。
 *   2. 登录态注入：从 storage 读 token 挂 Authorization。
 *   3. 登录态失效自愈：收到 401 时静默重登一次并重放原请求（401 无副作用，可安全重放）。
 *   4. 写操作不重试：非幂等请求（POST /rows、PATCH、DELETE）超时后重试会重复写库。
 *
 * 对上层暴露：request({ url, method, data }) → Promise<data>（已解包）
 */
const config = require('../config/index')
const storage = require('../utils/storage')
const mock = require('./mock/index')

/** 是否走 mock：storage 可运行时覆盖（真机联调免重编译） */
function isMock() {
  const forced = storage.getItem(config.FORCE_MOCK_KEY, null)
  if (forced === null || forced === undefined) return config.USE_MOCK
  return !!forced
}

/**
 * 是否为可安全重试的查询请求。
 * GET 与「列表/透视」查询幂等；POST /rows（新建）、PATCH、DELETE 均不可重试。
 */
function isRetryable(method, url) {
  if (config.RETRY.retryOnWrite) return true
  if (method === 'GET') return true
  return method === 'POST' && /\/(rows\/list|rows\/pivot)$/.test(String(url || ''))
}

function request(options) {
  const { url, method = 'GET', data = {}, header = {} } = options

  // 双通道路由：USE_MOCK 走本地 mock；否则走 wx.request 真实请求（同一 envelope 结构）
  if (isMock()) {
    return mock.dispatch({ url, method, data }).then((envelope) => checkEnvelope(envelope))
  }
  // 将重试次数放到闭包上下文里，递归重试时可保留 resolve/reject 及原始请求
  return new Promise((resolve, reject) => {
    realRequest({ url, method, data, header, retryLeft: config.RETRY.max, resolve, reject })
  })
}

/** 校验明道云响应包，成功解包 data，失败抛业务错误 */
function checkEnvelope(envelope) {
  const body = envelope || {}
  if (body.success === true && body.error_code === 1) {
    return body.data
  }
  throw {
    code: body.error_code,
    message: body.error_msg || '数据操作异常'
  }
}

/**
 * 组装请求头
 * 代理模式不发明道云鉴权头（密钥在后端），只发 Bearer token；直连模式才带 AppKey/Sign。
 */
function buildHeader(extra) {
  const header = { 'Content-Type': 'application/json' }
  if (!config.USE_PROXY) {
    header['HAP-Appkey'] = config.MINGDAO.appKey
    header['HAP-Sign'] = config.MINGDAO.sign
  }
  const token = storage.getItem(config.TOKEN_KEY, '')
  if (token) header.Authorization = 'Bearer ' + token
  return Object.assign(header, extra)
}

/** 登录态失效：静默重登（延迟 require 避免 request ⇄ user 循环依赖） */
function reLogin() {
  try {
    const userApi = require('./user')
    if (userApi && typeof userApi.refreshLogin === 'function') return userApi.refreshLogin()
  } catch (e) {
    /* 忽略，走下方 reject */
  }
  return Promise.reject({ code: 401, message: '登录态已失效' })
}

function realRequest(ctx) {
  const { url, method, data, header, retryLeft, resolve, reject } = ctx
  // 别名 → 真实 worksheetId（未配置时回退别名，便于先验证路径是否接受别名）
  const finalUrl = config.TABLES.rewriteUrl(url)
  wx.request({
    url: config.BASE_URL + finalUrl,
    method,
    data,
    timeout: config.TIMEOUT,
    header: buildHeader(header),
    success(res) {
      // 明道云约定：HTTP 恒 200，业务结果在 body；代理层 401 表示登录态失效
      const body = res.data || {}
      const unauthorized = res.statusCode === 401 || body.error_code === 401

      if (unauthorized && !ctx.reauthTried) {
        // 401 说明请求未被受理，重登后重放是安全的（不受「写操作不重试」限制）
        reLogin()
          .then(() => {
            realRequest(Object.assign({}, ctx, { reauthTried: true }))
          })
          .catch(() => {
            reject({ code: 401, message: '登录已失效，请重新登录' })
          })
        return
      }

      if (body.success === true && body.error_code === 1) {
        resolve(body.data)
        return
      }
      // 命中限流错误码且还有重试次数 → 指数退避后递归重试（仅查询类请求）
      if (
        config.RATE_LIMIT_CODES.indexOf(body.error_code) >= 0 &&
        retryLeft > 0 &&
        isRetryable(method, url)
      ) {
        const delay = config.RETRY.baseDelay * Math.pow(2, config.RETRY.max - retryLeft)
        setTimeout(() => {
          realRequest(Object.assign({}, ctx, { retryLeft: retryLeft - 1 }))
        }, delay)
        return
      }
      reject({ code: body.error_code, message: body.error_msg || '接口返回异常' })
    },
    fail(err) {
      // 写操作不重试：避免超时重发造成重复预约 / 重复答题记录
      if (retryLeft > 0 && isRetryable(method, url)) {
        setTimeout(() => {
          realRequest(Object.assign({}, ctx, { retryLeft: retryLeft - 1 }))
        }, config.RETRY.baseDelay)
        return
      }
      reject({ code: -1, message: (err && err.errMsg) || '网络异常，请稍后重试' })
    }
  })
}

module.exports = { request, isMock, isRetryable }
