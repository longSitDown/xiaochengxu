/**
 * 登录引导弹窗
 *
 * 对外事件：
 *   login  - 用户点击「微信一键登录」，父级应调用 app.doLogin() 并依结果关闭弹窗
 *   cancel - 用户点击「暂不登录」，父级关闭弹窗并以游客身份继续
 *
 * 仅负责展示与事件转发，不直接依赖登录逻辑，便于 mock / 代理 / 直连三种模式复用。
 * 弹窗时机由父页面决定：组件不在页面加载时自动弹出，只用在需要身份的操作被触发时。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    /** 自定义说明文案（各场景利益点不同，如"登录后可保存本次预约"） */
    desc: { type: String, value: '' }
  },

  methods: {
    /** 微信一键登录按钮 */
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
