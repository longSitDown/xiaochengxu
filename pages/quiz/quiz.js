/**
 * 知识竞赛（tabBar）：活动列表 + 规则弹窗 + 排行榜/战绩入口
 */
const quizApi = require('../../api/quiz')
const { formatDate } = require('../../utils/format')

Page({
  data: {
    activities: [],
    loading: true,
    ruleActivity: null // 规则弹窗中的活动
  },

  onLoad() {
    this.fetchList()
  },

  onPullDownRefresh() {
    this.fetchList(() => wx.stopPullDownRefresh())
  },

  fetchList(done) {
    quizApi
      .getActivities()
      .then((activities) => {
        this.setData({
          activities: activities.map((a) => Object.assign({}, a, {
            timeRange: formatDate(a.startTime, 'MM月dd日') + ' - ' + formatDate(a.endTime, 'MM月dd日')
          })),
          loading: false
        })
        done && done()
      })
      .catch((e) => {
        this.setData({ loading: false })
        done && done()
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  /** 点击活动卡片：进行中 → 弹规则；其他状态直接进排行榜 */
  onActivityTap(e) {
    const { id, status } = e.currentTarget.dataset
    const activity = this.data.activities.find((a) => a.id === id)
    if (!activity) return
    if (status === '进行中') {
      this.setData({ ruleActivity: activity })
    } else {
      wx.navigateTo({ url: '/pages/quiz-ranking/quiz-ranking?activityId=' + id })
    }
  },

  closeRule() {
    this.setData({ ruleActivity: null })
  },

  /** 开始答题 */
  startQuiz() {
    const a = this.data.ruleActivity
    if (!a) return
    this.setData({ ruleActivity: null })
    wx.navigateTo({ url: '/pages/quiz-start/quiz-start?id=' + a.id })
  },

  goRanking() {
    const first = this.data.activities[0]
    const query = first ? '?activityId=' + first.id : ''
    wx.navigateTo({ url: '/pages/quiz-ranking/quiz-ranking' + query })
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/quiz-history/quiz-history' })
  },

  /** 弹窗内容区点击占位（阻止冒泡关闭） */
  noop() {}
})
