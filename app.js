/**
 * 红色纪念馆微信小程序 - 全局入口
 *
 * 架构分层：
 *   pages（视图层） → api/*（服务层） → api/request.js（统一请求层）
 *     → mock（本地模拟） | 自有后端代理（推荐） | 明道云直连（仅调试）
 * 页面组件不感知数据来源，切换 config 即可整体切换数据源。
 */
const userApi = require('./api/user')

App({
  globalData: {
    appInfo: null,   // 应用信息
    userInfo: null,  // 当前登录用户（未登录时保持 null，游客态）
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
    //    不再静默自动建号——是否登录由业务在需要时引导（见 ensureLogin）。
    this.globalData.userInfo = userApi.getUser()
  },

  /**
   * 触发登录（多处并发调用会复用同一个请求，不会重复换 openid）
   * @param {{force?:boolean}} [opts]
   */
  doLogin(opts) {
    return userApi.login(opts).then((user) => {
      this.globalData.userInfo = user
      console.log('[登录] globalData.userInfo =', user)
      return user
    })
  },

  /**
   * 确保已登录：供写操作（预约 / 答题 / 提交反馈）前置调用。
   * 未登录时自动走一遍登录，失败则把错误抛给页面做引导。
   */
  ensureLogin() {
    return userApi.ensureLogin().then((user) => {
      this.globalData.userInfo = user
      return user
    })
  },

  /** 退出登录（清本地登录态与 token） */
  doLogout() {
    userApi.logout()
    this.globalData.userInfo = null
  },

  /**
   * 自定义导航栏安全区（单位 px）
   *
   * 微信右上角胶囊是系统浮层、不占文档流；navigationStyle:custom 的页面必须
   * 按胶囊实际位置给右侧留白，否则搜索框 / 功能按钮会被胶囊遮住。
   * wx.getMenuButtonBoundingClientRect 基础库 ≥2.1.0（以官方文档为准），
   * 返回 { width, height, top, right, bottom, left }，坐标原点为屏幕左上角。
   *
   * @returns {{statusBarHeight:number, navTop:number, menuReserve:number}}
   *   statusBarHeight 状态栏高度；navTop 顶部内容起始位置；menuReserve 右侧需预留宽度
   */
  getNavMetrics() {
    let info = {}
    try {
      info = wx.getSystemInfoSync() || {}
    } catch (e) {
      /* 个别环境不支持，用默认值兜底 */
    }
    const winW = info.windowWidth || 375
    const statusBar = info.statusBarHeight || 20

    let menu = null
    try {
      if (wx.getMenuButtonBoundingClientRect) menu = wx.getMenuButtonBoundingClientRect()
    } catch (e) {
      /* 低版本基础库或异常，走兜底 */
    }
    const valid = !!(menu && menu.width > 0 && menu.left > 0 && menu.top > 0)

    // 页面左右 padding 为 32rpx，按当前屏宽换算成 px
    const sidePad = winW * 32 / 750
    // 让顶栏内容右边界落在「胶囊左边界 - 10px」处
    const reserve = valid
      ? Math.max(0, Math.round(winW - sidePad - menu.left + 10))
      : 100 // 兜底：胶囊宽约 87px + 右侧边距 + 间距
    return {
      statusBarHeight: statusBar,
      navTop: valid ? Math.max(statusBar, Math.round(menu.top)) : statusBar + 16,
      menuReserve: reserve
    }
  }
})
