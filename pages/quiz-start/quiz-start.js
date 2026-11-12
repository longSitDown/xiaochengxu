/**
 * 答题页：倒计时 + 单选/多选/判断 + 自动判分提交
 *
 * 判分约定（与种子题库格式对齐）：
 *   - 选项文本形如 "A. xxx"，答案 key 取选项前缀字母（"A"）；判断题选项为"正确/错误"，取全文
 *   - 单选/判断：所选 key == 答案 key；多选：所选 key 集合与答案 key 集合完全一致
 */
const quizApi = require('../../api/quiz')
const userApi = require('../../api/user')
const { formatDuration } = require('../../utils/format')
const app = getApp()

/** 提取选项 key：有 "A. " 前缀取字母，否则取全文（判断题） */
function optionKey(text) {
  const s = String(text).trim()
  const dot = s.indexOf('.')
  return dot > 0 ? s.slice(0, dot).trim() : s
}

Page({
  data: {
    activity: null,
    questions: [],   // [{id, type, title, options: [{text, key, selected}], score, answerKeys}]
    current: 0,      // 当前题下标
    answeredCount: 0, // 已作答题数
    remainText: '',  // 剩余时间 mm:ss
    submitting: false
  },

  onLoad(options) {
    this.activityId = options.id
    this.fetchData()
  },

  onUnload() {
    this.stopTimer()
  },

  fetchData() {
    Promise.all([
      quizApi.getActivityDetail(this.activityId),
      quizApi.getQuestions(this.activityId)
    ])
      .then(([activity, questions]) => {
        if (!questions.length) {
          wx.showToast({ title: '题库准备中', icon: 'none' })
          return
        }
        // 渲染结构：给每个选项附加 selected 标志
        const decorated = questions.map((q) => Object.assign({}, q, {
          options: (q.options || []).map((text) => ({
            text,
            key: optionKey(text),
            selected: false
          })),
          answerKeys: (q.answerKeys || []).map(optionKey).sort()
        }))
        this.setData({ activity, questions: decorated })
        wx.setNavigationBarTitle({ title: activity.title })
        this.startTimer(activity.duration * 60)
      })
      .catch((e) => {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  /* ---------------- 计时 ---------------- */

  /**
   * 用「截止时间戳」而非累加计数来倒计时：
   * 小程序切后台/锁屏时 setInterval 会被节流甚至暂停，按 tick 次数累减会导致
   * 倒计时偏慢（变相延长考试时间）。改为每次用真实时间差计算剩余秒数。
   */
  startTimer(totalSec) {
    this.totalSec = totalSec
    this.deadline = Date.now() + totalSec * 1000
    this.tickTimer()
    this.timer = setInterval(() => this.tickTimer(), 1000)
  },

  /** 每次 tick 按当前真实时间刷新剩余秒数，归零则自动交卷 */
  tickTimer() {
    const remain = Math.max(0, Math.round((this.deadline - Date.now()) / 1000))
    this.remainSec = remain
    this.setData({ remainText: formatDuration(remain) })
    if (remain <= 0) {
      this.stopTimer()
      wx.showToast({ title: '时间到，自动交卷', icon: 'none' })
      this.submit(true)
    }
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  /* ---------------- 答题交互 ---------------- */

  /** 选项点击：单选/判断替换选择；多选切换 */
  onOptionTap(e) {
    const { qi, oi } = e.currentTarget.dataset
    const q = this.data.questions[qi]
    const patch = {}
    if (q.type === '多选') {
      // toggle
      patch['questions[' + qi + '].options[' + oi + '].selected'] = !q.options[oi].selected
    } else {
      q.options.forEach((opt, idx) => {
        if (idx !== oi && opt.selected) {
          patch['questions[' + qi + '].options[' + idx + '].selected'] = false
        }
      })
      if (!q.options[oi].selected) {
        patch['questions[' + qi + '].options[' + oi + '].selected'] = true
      }
    }
    // 依据本次变更直接推算已答题数，与选项状态合并为一次 setData 下发
    // （避免先 setData 再读回 data 造成的第二次跨线程通信）
    const afterSelected = q.options.some((o, idx) => (
      idx === oi
        ? (q.type === '多选' ? !q.options[oi].selected : true) // 单选点击后必选中；多选取反
        : (q.type === '多选' ? o.selected : false)             // 单选其余清空；多选保持不变
    ))
    let answered = this.data.questions.filter(
      (qq, i) => i !== qi && qq.options.some((o) => o.selected)
    ).length
    if (afterSelected) answered++
    patch.answeredCount = answered
    this.setData(patch)
  },

  prevQuestion() {
    if (this.data.current > 0) this.setData({ current: this.data.current - 1 })
  },

  nextQuestion() {
    const { current, questions } = this.data
    if (current < questions.length - 1) {
      this.setData({ current: current + 1 })
    }
  },

  /**
   * 已作答题数。
   * 注意：data 里已有同名字段 answeredCount（供 wxml 渲染），
   * 此处是同名方法，二者通过 this.data.answeredCount / this.countAnswered() 区分。
   */
  countAnswered() {
    return this.data.questions.filter((q) => q.options.some((o) => o.selected)).length
  },

  /** 提交答卷（auto=true 为超时自动提交，跳过确认） */
  submit(auto) {
    if (this.data.submitting) return
    if (!auto) {
      const unanswered = this.data.questions.length - this.countAnswered()
      if (unanswered > 0) {
        wx.showModal({
          title: '确认交卷',
          content: '还有 ' + unanswered + ' 题未作答，确定提交吗？',
          success: (res) => {
            if (res.confirm) this.doSubmit()
          }
        })
        return
      }
    }
    this.doSubmit()
  },

  onSubmitTap() {
    this.submit(false)
  },

  doSubmit() {
    this.stopTimer()
    this.setData({ submitting: true })

    const { activity, questions } = this.data
    // 逐题判分
    const answers = []
    let score = 0
    let correctCount = 0
    questions.forEach((q) => {
      const selectedOpts = q.options.filter((o) => o.selected)
      const selectedKeys = selectedOpts.map((o) => o.key).sort()
      // 多选需集合一致：先各自 sort 再序列化比较，避免顺序不同误判
      const correct = JSON.stringify(selectedKeys) === JSON.stringify(q.answerKeys)
      if (correct) {
        score += q.score
        correctCount++
      }
      answers.push({
        questionId: q.id,
        selected: selectedOpts.map((o) => o.text),
        correct
      })
    })
    // 实际用时 = 总时长 - 剩余；clamp 到 [1, 总时长] 保证合法性
    const durationUsed = Math.max(1, this.totalSec - Math.max(0, this.remainSec))

    const user = userApi.getUser()
    // 交卷前确保登录：成绩已在内存里，登录失败只会提示重试，不会丢数据
    app
      .ensureLogin()
      .then(() =>
        quizApi.submitQuizRecord({
          userId: userApi.getBizId() || '匿名',
          activityId: activity.id,
          activityTitle: activity.title,
          score,
          correctCount,
          totalCount: questions.length,
          durationUsed,
          answers
        })
      )
      .then((record) => {
        // redirect：避免返回键再次进入答题页
        wx.redirectTo({ url: '/pages/quiz-result/quiz-result?id=' + record.id })
      })
      .catch((e) => {
        this.setData({ submitting: false })
        wx.showModal({
          title: '提交失败',
          content: (e && e.message) || '答题记录提交失败，请检查网络后重试',
          showCancel: false
        })
      })
  },

  /** 答题中退出确认 */
  onUnloadWithConfirm() {
    /* 微信无返回拦截，改为提示条提醒（略） */
  }
})
