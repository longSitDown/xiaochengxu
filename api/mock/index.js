/**
 * Mock 层入口
 *
 * 说明：仅当 api/request.js 中的 USE_MOCK 开启时，页面的 API 请求才会改走本模块。
 * 对外只暴露一个 dispatch，完全对齐真实网络请求的入参（{url,method,data}）与
 * Promise 返回，因此上层页面无需感知是否处于 mock 状态，切换真实环境时零改动。
 */
const engine = require('./engine') // 真正的请求处理逻辑（路由解析、数据操作）都在 engine.js

module.exports = {
  /** 统一派发请求，返回 Promise，resolve 的即为明道云式响应包 */
  dispatch: engine.dispatch
}
