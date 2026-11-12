/**
 * 竞赛排行榜：前三名领奖台 + 完整榜单（当前用户高亮）
 */
const quizApi = require('../../api/quiz')
const userApi = require('../../api/user')
const { formatDuration } = require('../../utils/format')

Page({
  data: {
    activity: null,
    top3: [],       // 前三名（展示顺序：2 1 3）
    others: [],     // 第 4 名起
    myUserId: '',
    loading: true
  },

  onLoad(options) {
    this.activityId = options.activityId || ''
    this.fetchData()
  },

  onPullDownRefresh() {
    this.fetchData(() => wx.stopPullDownRefresh())
  },

  fetchData(done) {
    const user = userApi.getUser()
    const tasks = [quizApi.getRanking(this.activityId)]
    if (this.activityId) {
      tasks.push(quizApi.getActivityDetail(this.activityId))
    }
    Promise.all(tasks)
      .then(([ranking, activity]) => {
        const list = ranking.map((r) => Object.assign({}, r, {
          durationText: formatDuration(r.durationUsed)
        }))
        // 领奖台展示顺序：亚军 / 冠军 / 季军
        const podium = [list[1], list[0], list[2]].filter(Boolean)
        podium.forEach((p) => {
          // 按位置标记：中间为冠军
          p.medal = p.rank === 1 ? 'gold' : (p.rank === 2 ? 'silver' : 'bronze')
        })
        this.setData({
          activity: activity || null,
          top3: podium,
          others: list.slice(3),
          myUserId: user ? userApi.getBizId() : '',
          loading: false
        })
        if (activity) wx.setNavigationBarTitle({ title: activity.title + ' · 排行榜' })
        done && done()
      })
      .catch((e) => {
        this.setData({ loading: false })
        done && done()
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  }
})
