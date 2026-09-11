/**
 * 红色纪念馆微信小程序 - 全局入口
 *
 * 架构分层：
 *   pages（视图层） → api/*（服务层） → api/request.js（统一请求层） → mock（本地模拟） | 明道云 API
 * 页面组件不感知数据来源，切换 USE_MOCK 即可整体切换数据源。
 */
const userApi = require('./api/user')

App({
  globalData: {
    appInfo: null,   // 应用信息（明道云 /v3/app）
    userInfo: null,  // 当前登录用户（未授权时保持 null，游客态）
    systemInfo: null // 设备信息
  },

  onLaunch() {
    // 1. 设备信息
    try {
      this.globalData.systemInfo = wx.getSystemInfoSync()
    } catch (e) {
      /* 忽略，个别环境不支持 */
    }

    // 2. 读取本地登录态：已登录过则恢复用户，未登录则保持 null（游客）。
    //    不再静默自动建号——是否登录由授权登录弹窗（authorize-popup）让用户决定。
    this.globalData.userInfo = userApi.getUser()
  },

  /**
   * 供各页面统一触发「微信授权登录」：
   *  mock 模式：本地模拟授权，生成/读取演示用户；
   *  真实模式：realLogin（wx.login 换 openid，待后端对接）。
   * 成功后写回 globalData.userInfo 并 resolve。
   */
  doLogin() {
    return userApi.login().then((user) => {
      this.globalData.userInfo = user
      return user
    })
  }
})
