/**
 * 我的（tabBar）：用户信息 + 业务统计（预约/答题/反馈）+ 功能菜单
 */
const userApi = require('../../api/user')
const reservationApi = require('../../api/reservation')
const quizApi = require('../../api/quiz')
const feedbackApi = require('../../api/feedback')

Page({
  data: {
    user: null,
    stats: { resv: 0, quiz: 0, feedback: 0 },
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
      .catch(() => { /* 统计失败不阻塞页面 */ })
  },

  onLogin() {
    userApi
      .login()
      .then((user) => {
        this.setData({ user })
        this.fetchStats(user.id)
        wx.showToast({ title: '登录成功', icon: 'success' })
      })
      .catch((e) => {
        wx.showToast({ title: (e && e.message) || '登录失败', icon: 'none' })
      })
  },

  /** 编辑昵称（mock 用户资料更新） */
  onEditNickname() {
    const user = this.data.user
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: user ? user.nickname : '',
      success: (res) => {
        if (res.confirm && res.content && res.content.trim()) {
          const updated = userApi.updateUser({ nickname: res.content.trim() })
          this.setData({ user: updated })
          wx.showToast({ title: '已更新', icon: 'success' })
        }
      }
    })
  },

  onMenuTap(e) {
    const url = e.currentTarget.dataset.url
    // tab 页（如"我的预约"）须用 switchTab 跳转
    const tabPages = ['/pages/index/index', '/pages/hall/hall', '/pages/reservation/reservation', '/pages/profile/profile']
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
        wx.showToast({ title: '已重置', icon: 'success' })
        // 重置后重新初始化演示用户
        setTimeout(() => this.onLogin(), 500)
      }
    })
  }
})
