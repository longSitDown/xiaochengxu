/**
 * 我的答题历史：列表 + 最佳成绩摘要
 */
const quizApi = require('../../api/quiz')
const userApi = require('../../api/user')
const { formatDuration, formatDate } = require('../../utils/format')

Page({
  data: {
    records: [],
    best: null, // 最佳成绩
    loading: true
  },

  onLoad() {
    this.fetchList()
  },

  onPullDownRefresh() {
    this.fetchList(() => wx.stopPullDownRefresh())
  },

  fetchList(done) {
    const user = userApi.getUser()
    if (!user) {
      this.setData({ loading: false })
      return
    }
    quizApi
      .getMyRecords(user.id)
      .then((records) => {
        const list = records.map((r) => Object.assign({}, r, {
          timeText: formatDate(r.createTime, 'yyyy-MM-dd HH:mm'),
          durationText: formatDuration(r.durationUsed),
          accuracy: r.totalCount ? Math.round((r.correctCount / r.totalCount) * 100) : 0
        }))
        // 最佳成绩：得分最高 → 用时最短
        const best = list.slice().sort((a, b) => (b.score - a.score) || (a.durationUsed - b.durationUsed))[0] || null
        this.setData({ records: list, best, loading: false })
        done && done()
      })
      .catch((e) => {
        this.setData({ loading: false })
        done && done()
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  onRecordTap(e) {
    wx.navigateTo({ url: '/pages/quiz-result/quiz-result?id=' + e.currentTarget.dataset.id })
  },

  goQuiz() {
    wx.switchTab({ url: '/pages/quiz/quiz' })
  }
})
