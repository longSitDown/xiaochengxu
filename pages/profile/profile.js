/**
 * 我的（tabBar）：用户信息 + 业务统计 + 功能菜单
 *
 * 头像昵称采用官方「头像昵称填写能力」：
 *   - 头像：<button open-type="chooseAvatar"> 拿到临时路径 → 上传后端换永久 URL
 *   - 昵称：<input type="nickname"> 键盘上方可出现微信昵称，一键填入
 * 不再使用 wx.getUserProfile（该接口已收回，只会返回匿名数据）。
 */
const app = getApp()
const userApi = require('../../api/user')
const reservationApi = require('../../api/reservation')
const quizApi = require('../../api/quiz')
const feedbackApi = require('../../api/feedback')

Page({
  data: {
    user: null,
    stats: { resv: 0, quiz: 0, feedback: 0 },
    editing: false,
    saving: false,
    uploading: false,
    draft: { avatar: '', nickname: '' },
    menus: [
      { icon: 'resv', name: '我的预约', url: '/pages/reservation/reservation' },
      { icon: 'visitor', name: '预约人管理', url: '/pages/visitor-manage/visitor-manage' },
      { icon: 'quiz', name: '答题战绩', url: '/pages/quiz-history/quiz-history' },
      { icon: 'feedback', name: '我的反馈', url: '/pages/feedback/feedback?tab=mine' },
      { icon: 'guide', name: '场馆指南', url: '/pages/guide/guide' },
      { icon: 'about', name: '关于我们', url: '/pages/about/about' }
    ]
  },

  onShow() {
    const user = userApi.getUser()
    this.setData({ user })
    if (user) this.fetchStats(user.id)
  },

  /** 并行拉取三项业务统计 */
  fetchStats(userId) {
    if (!userId) return
    Promise.all([
      reservationApi.getMyReservations(userId),
      quizApi.getMyRecords(userId),
      feedbackApi.getMyFeedbacks(userId)
    ])
      .then(([resv, quiz, feedback]) => {
        this.setData({
          stats: { resv: resv.length, quiz: quiz.length, feedback: feedback.length }
        })
      })
      .catch(() => {
        /* 统计失败不阻塞页面 */
      })
  },

  onLogin() {
    wx.showLoading({ title: '登录中', mask: true })
    app
      .doLogin()
      .then((user) => {
        wx.hideLoading()
        this.setData({ user })
        this.fetchStats(user.id)
        wx.showToast({ title: '登录成功', icon: 'success' })
      })
      .catch((e) => {
        wx.hideLoading()
        wx.showToast({ title: (e && e.message) || '登录失败', icon: 'none' })
      })
  },

  /* ---------------- 资料编辑 ---------------- */

  onOpenEditor() {
    if (!this.data.user) {
      this.onLogin()
      return
    }
    this.setData({
      editing: true,
      draft: {
        avatar: this.data.user.avatar || '',
        nickname: this.data.user.nickname || ''
      }
    })
  },

  onCloseEditor() {
    if (this.data.saving || this.data.uploading) return
    this.setData({ editing: false })
  },

  onNicknameInput(e) {
    this.setData({ 'draft.nickname': e.detail.value })
  },

  /** 选头像：拿到临时路径后立刻上传换永久 URL（临时路径刷新即失效） */
  onChooseAvatar(e) {
    const path = e.detail.avatarUrl
    if (!path) return
    this.setData({ uploading: true })
    userApi
      .uploadAvatar(path)
      .then((url) => {
        this.setData({ 'draft.avatar': url, uploading: false })
      })
      .catch((err) => {
        this.setData({ uploading: false })
        wx.showToast({ title: (err && err.message) || '头像上传失败', icon: 'none' })
      })
  },

  onSaveProfile() {
    const nickname = String(this.data.draft.nickname || '').trim()
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    if (nickname === this.data.user.nickname && this.data.draft.avatar === this.data.user.avatar) {
      this.setData({ editing: false })
      return
    }
    this.setData({ saving: true })
    userApi
      .updateUser({ nickname, avatar: this.data.draft.avatar })
      .then((user) => {
        this.setData({ user, saving: false, editing: false })
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch((err) => {
        this.setData({ saving: false })
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
      })
  },

  /** 阻止遮罩滚动穿透 / 面板点击冒泡到遮罩 */
  noop() {},

  onMenuTap(e) {
    const url = e.currentTarget.dataset.url
    // 未登录时先引导登录：这些页面都依赖 userId
    if (!this.data.user) {
      this.onLogin()
      return
    }
    // tab 页（如"我的预约"）须用 switchTab 跳转
    const tabPages = ['/pages/index/index', '/pages/reservation/reservation', '/pages/profile/profile']
    if (tabPages.indexOf(url) >= 0) {
      wx.switchTab({ url })
    } else {
      wx.navigateTo({ url })
    }
  },

  /** 重置演示数据（清空本地用户态与 mock 增量，恢复种子） */
  onResetData() {
    wx.showModal({
      title: '重置演示数据',
      content: '将清空本地预约/答题/反馈等演示数据并恢复初始状态，确定继续吗？',
      confirmColor: '#C8102E',
      success: (res) => {
        if (!res.confirm) return
        userApi.resetMockData()
        this.setData({ user: null, stats: { resv: 0, quiz: 0, feedback: 0 } })
        wx.showToast({ title: '已重置', icon: 'success' })
      }
    })
  },

  /**
   * 退出登录：二次确认 → 清本地用户态与 token → 本页回到游客态。
   * 只清登录态，不清业务数据；重新登录后历史记录仍在。
   */
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需重新登录才能预约、答题和查看历史记录，确定退出吗？',
      confirmText: '退出',
      confirmColor: '#D43D3D',
      success: (res) => {
        if (!res.confirm) return
        // app.doLogout 内部调 userApi.logout()，并同步 globalData.userInfo = null
        app.doLogout()
        this.setData({
          user: null,
          stats: { resv: 0, quiz: 0, feedback: 0 },
          editing: false,
          draft: { avatar: '', nickname: '' }
        })
        wx.showToast({ title: '已退出登录', icon: 'success' })
      }
    })
  }
})
