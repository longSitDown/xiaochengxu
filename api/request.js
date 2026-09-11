/**
 * 统一请求层 —— 页面/服务层唯一的数据通道
 *
 * mock 模式：路由到本地 mock 引擎（结构与明道云 API V3 完全一致）
 * 真实模式：wx.request 直连明道云（或自有后端代理），按 mingdao-api.md 约定：
 *   - Header 携带 HAP-Appkey / HAP-Sign
 *   - HTTP 状态码恒为 200，业务结果看 body（success === true && error_code === 1）
 *   - 限流错误码（51/90000/90001）指数退避重试
 *
 * 对上层暴露：request({ url, method, data }) → Promise<data>（已解包）
 */
const config = require('../config/index')
const mock = require('./mock/index')

function request(options) {
  const { url, method = 'GET', data = {}, header = {} } = options

  // 双通道路由：USE_MOCK 走本地 mock；否则走 wx.request 真实请求（同一 envelope 结构）
  if (config.USE_MOCK) {
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

function realRequest(ctx) {
  const { url, method, data, header, retryLeft, resolve, reject } = ctx
  wx.request({
    // 拼装完整地址：统一前缀 BASE_URL + 各服务传入的相对路径（如 /v3/app/worksheets/xx/rows/list）
    url: config.BASE_URL + url,
    method,
    data,
    timeout: config.TIMEOUT,
    header: Object.assign(
      {
        'Content-Type': 'application/json',
        'HAP-Appkey': config.MINGDAO.appKey,
        'HAP-Sign': config.MINGDAO.sign
      },
      header
    ),
    success(res) {
      // 明道云约定：HTTP 恒 200，业务结果在 body
      const body = res.data || {}
      if (body.success === true && body.error_code === 1) {
        resolve(body.data)
        return
      }
      // 命中限流错误码且还有重试次数 → 指数退避后递归重试（剩余次数越少，延迟越长）
      if (config.RATE_LIMIT_CODES.indexOf(body.error_code) >= 0 && retryLeft > 0) {
        const delay = config.RETRY.baseDelay * Math.pow(2, config.RETRY.max - retryLeft)
        setTimeout(() => {
          realRequest(Object.assign({}, ctx, { retryLeft: retryLeft - 1 }))
        }, delay)
        return
      }
      reject({ code: body.error_code, message: body.error_msg || '接口返回异常' })
    },
    fail(err) {
      if (retryLeft > 0) {
        setTimeout(() => {
          realRequest(Object.assign({}, ctx, { retryLeft: retryLeft - 1 }))
        }, config.RETRY.baseDelay)
        return
      }
      reject({ code: -1, message: (err && err.errMsg) || '网络异常，请稍后重试' })
    }
  })
}

module.exports = { request }
