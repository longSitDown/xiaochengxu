/**
 * 登录引导弹窗
 *
 * 对外事件：
 *   cancel - 用户点击「暂不登录」，父级关闭弹窗并以游客身份继续
 *
 * 登录动作不再在本组件内完成：点击按钮直接跳 pages/login，
 * 那边负责协议勾选与微信「手机号快速验证」（open-type 只能挂在 button 上，
 * 且必须由用户手势触发，放在弹窗的 view 里无法生效）。
 * 父级点击 cancel 后应把 show 置回 false。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    /** 自定义说明文案（各场景利益点不同，如"登录后可保存本次预约"） */
    desc: { type: String, value: '' }
  },

  methods: {
    /** 手机号快捷登录：跳独立登录页 */
    onLogin() {
      wx.navigateTo({ url: '/pages/login/login?from=popup' })
    },

    /** 暂不登录（游客） */
    onCancel() {
      this.triggerEvent('cancel')
    },

    /** 阻止遮罩滚动穿透 */
    noop() {}
  }
})
