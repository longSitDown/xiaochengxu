/**
 * 登录页：手机号快捷注册/登录
 *
 * 为什么不直接用 wx.login：
 *   wx.login 是静默接口，拿到的是 OpenID（只代表"这台设备的微信"），
 *   换手机就变成另一个人，无法作为预约实名与跨设备找回的依据。
 *   湖北省博物馆那套用的是「手机号快速验证」——手机号即账号，一码一账号。
 *
 * 契约 v1.9.6：两种形式都在 API-06 内，用 IsPhone 区分
 *   A. 手机号授权：getPhoneNumber 回调 e.detail.code → API-06（IsPhone=1，JsCode=该 code）
 *   B. 静默登录　：wx.login 的 code → API-06（IsPhone=0）
 *   两种形式返回一致（Id / NickName / Avatar / Phone / IsRegistered），前端只差提交哪个 code。
 *
 * 三条链路（按可用性自动降级）：
 *   A. 已勾协议 + 已开放 → 微信弹授权面板 → e.detail.code → API-06 形式一 → 手机号 + Id
 *   B. 未开放 / 用户拒绝 → 回退 API-06 形式二静默登录（不阻断）
 *   C. 用户点取消 → 静默留在本页，不报错打扰
 *
 * 手机号明文全程不经过前端：授权 code 交给明道云，由那边用 AppSecret 换。
 */
const app = getApp()
const userApi = require('../../api/user')
const config = require('../../config/index')

Page({
  data: {
    agreed: false,            // 是否已勾选协议（只门控手机号登录）
    loading: false,           // 登录中（防重入）
    hint: '',                 // 状态提示（降级原因等）
    isDevtools: false,        // 开发者工具环境（不支持真实手机号授权，需真机验证）
    phoneLoginEnabled: false  // 手机号快捷登录是否开放（需非个人主体 + 已认证）
  },

  onLoad(options) {
    // from：来源页标识，仅用于日志排查
    this.from = (options && options.from) || ''
    // 开发者工具里 getPhoneNumber 拿不到真实 code，提前把话说清楚，省得误判成代码坏了
    try {
      const info = typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {}
      this.setData({
        isDevtools: !!(info && info.platform === 'devtools'),
        phoneLoginEnabled: this.resolvePhoneLoginEnabled()
      })
    } catch (e) {
      /* 取不到环境信息不影响登录 */
    }
  },

  /**
   * 手机号登录开关：storage 覆盖优先（认证前也能免重编译验链路），否则读 config。
   * 认证通过后把 config.PHONE_LOGIN_ENABLED 改 true 即正式开放。
   */
  resolvePhoneLoginEnabled() {
    try {
      const forced = wx.getStorageSync('rh_' + config.PHONE_LOGIN_KEY)
      if (forced === '1' || forced === 1 || forced === true) return true
      if (forced === '0' || forced === 0 || forced === false) return false
    } catch (e) {
      /* 读不到就按配置走 */
    }
    return !!config.PHONE_LOGIN_ENABLED
  },

  onShow() {
    // 已登录再进本页：直接退回，避免出现"已登录还能再登一次"的怪状态
    if (userApi.getUser() && userApi.isTokenAlive()) {
      this.back()
    }
  },

  /* ---------------- 协议 ---------------- */

  onToggleAgree() {
    this.setData({ agreed: !this.data.agreed, hint: '' })
  },

  onOpenAgreement(e) {
    const type = (e && e.currentTarget && e.currentTarget.dataset.type) || 'user'
    wx.navigateTo({ url: '/pages/agreement/agreement?type=' + type })
  },

  /** 未勾协议就想登录：只提示，不触发微信面板 */
  onNeedAgree() {
    this.setData({ hint: '请先勾选同意《用户协议》与《数据隐私安全声明》' })
    wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
  },

  /* ---------------- 方式一：微信登录（API-06，当前可用） ---------------- */

  /**
   * 微信静默登录：只换游客档案 UserId，不涉及手机号，
   * 因此不要求勾选协议（与改造前的行为保持一致）。
   */
  onWxLogin() {
    if (this.data.loading) return
    this.wxLogin('')
  },

  /** 真正的 API-06 登录实现；reason 仅用于日志区分来源 */
  wxLogin(hint, reason) {
    this.setData({ loading: true, hint: hint || '' })
    console.log('[登录页] 调用 API-06 微信登录' + (reason ? '（' + reason + '）' : ''))
    const task = app && typeof app.doLogin === 'function'
      ? app.doLogin()
      : userApi.login({ force: true })
    task
      .then((user) => this.afterLogin(user, false))
      .catch((err) => {
        this.setData({ loading: false })
        const msg = (err && err.message) || '登录失败，请重试'
        this.setData({ hint: msg })
        wx.showToast({ title: msg, icon: 'none' })
      })
  },

  /* ---------------- 方式二：手机号授权登录（API-06 形式一，需认证开放） ---------------- */

  /**
   * 手机号按钮在「开关关闭」或「未勾协议」时走这里：
   * 开关关闭说明小程序还没完成微信认证，直接讲清楚，别让用户以为是网络问题。
   */
  onPhoneUnavailable() {
    if (this.data.loading) return
    if (!this.data.phoneLoginEnabled) {
      const text = '手机号快捷登录需小程序完成微信认证后开放，当前请使用微信登录'
      this.setData({ hint: text })
      wx.showToast({ title: '尚未完成微信认证', icon: 'none' })
      return
    }
    this.onNeedAgree()
  },

  /**
   * getPhoneNumber 回调。
   *
   * errMsg 常见取值与含义（必须区分，否则排查时会误判）：
   *   getPhoneNumber:ok                       成功，detail.code 可用
   *   getPhoneNumber:fail user deny           用户点了「取消」
   *   ...fail privacy ...                     小程序后台没配《用户隐私保护指引》
   *   ...fail no permission / not support     主体资质或基础库不满足（需非个人主体 + 已认证 + ≥2.21.2）
   *   ...fail ...（开发者工具）                工具不返回真实 code，必须真机
   */
  onGetPhone(e) {
    if (this.data.loading) return
    const d = (e && e.detail) || {}
    const errMsg = String(d.errMsg || '')
    // 原始回调完整打出来：真机 vConsole 里一眼看出是资质、隐私还是环境问题
    console.log('[登录页] getPhoneNumber 回调：', JSON.stringify(d))

    if (errMsg.indexOf(':ok') < 0) {
      // 用户主动取消：静默返回，不弹任何错误（弹了反而像出故障）
      if (/deny|cancel/i.test(errMsg)) return
      const text = this.phoneErrorText(errMsg)
      this.setData({ hint: text })
      wx.showToast({ title: text, icon: 'none' })
      return
    }

    const code = d.code || ''
    if (!code) {
      // 低版本基础库仍走 encryptedData 老协议，前端无法解密，直接降级
      this.fallbackLogin('当前微信版本不支持手机号快捷登录，已为你使用微信登录')
      return
    }

    this.setData({ loading: true, hint: '' })
    userApi
      .loginWithPhone(code)
      .then((user) => this.afterLogin(user, true))
      .catch((err) => {
        this.setData({ loading: false })
        const c = String((err && err.code) || '')
        // 接口地址缺失 / 凭证为空 → 回退静默登录；其它错误如实提示
        if (c === 'NOT_READY' || c === 'NO_PHONE_CODE' || c === 'UNKNOWN_API' || c === '90006') {
          this.fallbackLogin('手机号授权未成功，已为你使用微信登录')
          return
        }
        this.setData({ hint: (err && err.message) || '登录失败，请重试' })
        wx.showToast({ title: (err && err.message) || '登录失败', icon: 'none' })
      })
  },

  /**
   * 把 getPhoneNumber 的 errMsg 翻译成能指导下一步的提示。
   * 原始 errMsg 会附在提示末尾，方便对着报错查后台配置。
   */
  phoneErrorText(errMsg) {
    const msg = String(errMsg || '')
    if (/privacy/i.test(msg)) return '需同意《用户隐私保护指引》后才能获取手机号'
    if (/no permission|not support|unsupported/i.test(msg)) {
      return '小程序暂无手机号快速验证权限（需非个人主体且已认证）'
    }
    if (this.data.isDevtools) {
      return '开发者工具不返回真实手机号，请点「预览」用真机测试'
    }
    return '微信未返回手机号授权，请重试' + (msg ? '（' + msg + '）' : '')
  },

  /** 回退到 API-06 微信静默登录（不弹任何窗口） */
  fallbackLogin(hint) {
    this.wxLogin(hint, 'API-06 形式一不可用')
  },

  afterLogin(user, withPhone) {
    this.setData({ loading: false })
    const hasPhone = !!(user && user.phone)
    wx.showToast({
      title: withPhone && hasPhone ? '登录成功' : '已登录',
      icon: 'success'
    })
    setTimeout(() => this.back(), 600)
  },

  /* ---------------- 导航 ---------------- */

  /** 有上一页就返回，否则（从分享/扫码直达）回到「我的」 */
  back() {
    const pages = getCurrentPages()
    if (pages && pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  onSkip() {
    this.back()
  }
})
