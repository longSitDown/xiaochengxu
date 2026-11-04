/**
 * 答题结果：得分总览 + 错题汇总（题目 / 我的答案 / 正确答案 / 解析）
 */
const quizApi = require('../../api/quiz')
const { formatDuration, formatDate } = require('../../utils/format')

Page({
  data: {
    record: null,
    wrongList: [],  // 错题解析列表
    passed: false,
    durationText: '',
    timeText: '',
    scorePercent: 0
  },

  onLoad(options) {
    this.recordId = options.id
    this.fetchResult()
  },

  fetchResult() {
    quizApi
      .getQuizRecord(this.recordId)
      .then((record) => {
        const answers = record.answers || []
        return Promise.all([
          quizApi.getQuestions(record.activityId),
          quizApi.getActivityDetail(record.activityId)
        ]).then(([questions, activity]) => {
          const passScore = activity ? activity.passScore : 60
          // 组装错题：记录中标记 correct=false 的题，回查题库还原题目与正确答案
          const wrongList = answers
            .filter((a) => !a.correct)
            .map((a) => {
              const q = questions.find((x) => x.id === a.questionId) || {}
              return {
                title: q.title || '题目已下架',
                type: q.type || '',
                options: q.options || [],
                answer: q.answer || '',
                analysis: q.analysis || '',
                myAnswer: (a.selected || []).join('；') || '未作答'
              }
            })
          const totalScore = questions.reduce((s, q) => s + (q.score || 0), 0) || 100
          this.setData({
            record,
            wrongList,
            passed: record.score >= passScore,
            durationText: formatDuration(record.durationUsed),
            timeText: formatDate(record.createTime, 'yyyy-MM-dd HH:mm'),
            scorePercent: Math.min(100, Math.round((record.score / totalScore) * 100))
          })
        })
      })
      .catch((e) => {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  retry() {
    wx.redirectTo({ url: '/pages/quiz-start/quiz-start?id=' + this.data.record.activityId })
  },

  goRanking() {
    wx.navigateTo({ url: '/pages/quiz-ranking/quiz-ranking?activityId=' + this.data.record.activityId })
  },

  goHome() {
    // 「返回活动列表」：quiz 不在 tabBar 中，switchTab 会静默失败，改用 navigateTo
    wx.navigateTo({ url: '/pages/quiz/quiz' })
  }
})
