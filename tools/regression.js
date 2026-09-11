/**
 * 回归测试：验证本轮修复未破坏既有逻辑
 *   1. quiz-start 选项点击（单选/多选）与已答题数统计
 *   2. 倒计时基于时间戳（切后台后仍准确）
 *   3. artifact-detail / hall-detail 卸载时确实退订了音频监听
 * 用法：node tools/regression.js
 */
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('PASS:', msg)
}

// ---- 桩环境 ----
const store = {}
global.wx = {
  setStorageSync: (k, v) => { store[k] = v },
  getStorageSync: (k) => (k in store ? store[k] : ''),
  removeStorageSync: (k) => { delete store[k] },
  getStorageInfoSync: () => ({ keys: Object.keys(store) }),
  showToast: () => {},
  showModal: () => {},
  navigateTo: () => {},
  redirectTo: () => {},
  setNavigationBarTitle: () => {},
  createInnerAudioContext: () => ({
    paused: true, src: '', duration: 0, currentTime: 0,
    play() {}, pause() {}, stop() {}, seek() {}, on() {}
  })
}

let capturedPage = null
global.Page = (obj) => { capturedPage = obj }
global.getApp = () => ({ globalData: {}, doLogin: () => Promise.resolve({}) })

/* ================= 1. quiz-start 答题交互 ================= */
console.log('--- quiz-start 答题交互 ---')
require('../pages/quiz-start/quiz-start.js')
const quizPage = capturedPage

// 构造页面实例：3 题（单选 / 多选 / 单选）
const mk = () => {
  const inst = Object.assign({}, quizPage, {
    data: {
      questions: [
        { id: 'q1', type: '单选', score: 10, options: [{ text: 'A. x', key: 'A', selected: false }, { text: 'B. y', key: 'B', selected: false }], answerKeys: ['A'] },
        { id: 'q2', type: '多选', score: 10, options: [{ text: 'A. x', key: 'A', selected: false }, { text: 'B. y', key: 'B', selected: false }], answerKeys: ['A', 'B'] },
        { id: 'q3', type: '单选', score: 10, options: [{ text: 'A. x', key: 'A', selected: false }], answerKeys: ['A'] }
      ],
      answeredCount: 0,
      current: 0,
      submitting: false
    }
  })
  inst.setData = function (patch) { Object.keys(patch).forEach((k) => setPath(this.data, k, patch[k])) }
  inst.stopTimer = () => {}
  inst.submit = () => {}
  return inst
}
function setPath(obj, path, val) {
  const m = path.match(/^questions\[(\d+)\]\.options\[(\d+)\]\.selected$/)
  if (m) { obj.questions[+m[1]].options[+m[2]].selected = val; return }
  obj[path] = val
}

let p = mk()
// 单选第 1 题选 A
p.onOptionTap({ currentTarget: { dataset: { qi: 0, oi: 0 } } })
assert(p.data.questions[0].options[0].selected === true, '单选：选中 A')
assert(p.data.answeredCount === 1, '单选：已答题数 = 1')

// 单选改选 B：A 应清空
p.onOptionTap({ currentTarget: { dataset: { qi: 0, oi: 1 } } })
assert(p.data.questions[0].options[0].selected === false, '单选：改选后 A 清空')
assert(p.data.questions[0].options[1].selected === true, '单选：改选后 B 选中')
assert(p.data.answeredCount === 1, '单选：改选不增加已答数')

// 多选第 2 题勾 A、B
p.onOptionTap({ currentTarget: { dataset: { qi: 1, oi: 0 } } })
p.onOptionTap({ currentTarget: { dataset: { qi: 1, oi: 1 } } })
assert(p.data.questions[1].options[0].selected && p.data.questions[1].options[1].selected, '多选：A、B 均选中')
assert(p.data.answeredCount === 2, '多选：已答题数 = 2')

// 多选取消 A、B → 该题回到未作答
p.onOptionTap({ currentTarget: { dataset: { qi: 1, oi: 0 } } })
p.onOptionTap({ currentTarget: { dataset: { qi: 1, oi: 1 } } })
assert(p.data.answeredCount === 1, '多选：全部取消后该题不计入已答')

// 第 3 题选 A
p.onOptionTap({ currentTarget: { dataset: { qi: 2, oi: 0 } } })
assert(p.data.answeredCount === 2, '跨题统计正确')
assert(p.countAnswered() === 2, 'countAnswered() 与 data.answeredCount 一致')
assert(p.data.answeredCount === p.countAnswered(), 'data 字段与方法无冲突')

/* ================= 2. 倒计时基于真实时间戳 ================= */
console.log('\n--- 倒计时准确性 ---')
p = mk()
p.setData = function (patch) { Object.assign(this.data, patch) }
let autoSubmitted = false
p.submit = (auto) => { if (auto) autoSubmitted = true }
p.stopTimer = function () { if (this.timer) { clearInterval(this.timer); this.timer = null } }
p.startTimer(60)
assert(p.data.remainText === '01:00', '起始剩余时间 01:00')
assert(p.remainSec === 60, 'remainSec 初始为 60')

// 模拟"切后台 30 秒"：直接回拨 deadline 而不触发 tick
p.deadline -= 30 * 1000
p.tickTimer()
assert(p.remainSec === 30, '切后台 30s 后剩余时间自动校正为 30（不依赖 tick 次数）')
assert(p.data.remainText === '00:30', '剩余文案同步为 00:30')

// 超时自动交卷
p.deadline = Date.now() - 1000
p.tickTimer()
assert(autoSubmitted === true, '归零时自动交卷')
assert(p.timer === null, '自动交卷后定时器已停止')

/* ================= 3. 音频监听退订 ================= */
console.log('\n--- 音频监听退订 ---')
const audio = require('../utils/audio.js')
// 统计监听器集合大小
function listenerCount(name) {
  // 通过模块内部 listeners 不可直接访问，用行为验证：注册后触发，退订后不再触发
  return null
}

let unsubCalls = 0
capturedPage = null
require('../pages/artifact-detail/artifact-detail.js')
const artPage = capturedPage
const artInst = Object.assign({}, artPage, {
  id: 'art_001',
  data: { artifact: null, playing: false, loading: true },
  _off: [() => { unsubCalls++ }, () => { unsubCalls++ }, () => { unsubCalls++ }, () => { unsubCalls++ }]
})
artInst.setData = () => {}
artInst.onUnload()
assert(unsubCalls === 4, 'artifact-detail onUnload 退订全部 4 个音频监听')

unsubCalls = 0
capturedPage = null
require('../pages/hall-detail/hall-detail.js')
const hallInst = Object.assign({}, capturedPage, {
  data: {}, _offAudio: [() => { unsubCalls++ }, () => { unsubCalls++ }, () => { unsubCalls++ }, () => { unsubCalls++ }]
})
hallInst.setData = () => {}
hallInst.onUnload()
assert(unsubCalls === 4, 'hall-detail onUnload 退订全部 4 个音频监听')

console.log('\n===== 回归测试全部通过 =====')
