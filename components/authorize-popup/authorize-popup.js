/**
 * 授权登录弹窗
 * 对外事件：
 *   login  - 用户点击「微信授权登录」，父级应调用 userApi.login() 并依结果关闭弹窗
 *   cancel - 用户点击「暂不登录」，父级关闭弹窗并标记游客态
 * 仅负责展示与事件转发，不直接依赖登录逻辑，便于 mock/真实模式复用。
 */
Component({
  properties: {
    show: { type: Boolean, value: false }
  },

  methods: {
    /** 微信授权登录按钮 */
    onLogin() {
      this.triggerEvent('login')
    },

    /** 暂不登录（游客） */
    onCancel() {
      this.triggerEvent('cancel')
    },

    /** 阻止遮罩滚动穿透 */
    noop() {}
  }
})