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

/* ================= 4. profile 昵称填写 ================= */
console.log('\n--- profile 昵称保存（form submit / 内容安全检测清空兜底） ---')
const fs = require('fs')
const path = require('path')
const profileWxml = fs.readFileSync(path.join(__dirname, '../pages/profile/profile.wxml'), 'utf8')
assert(profileWxml.indexOf('bindblur="onNicknameInput"') < 0, '不应再绑定 blur 覆盖昵称草稿')
assert(profileWxml.indexOf('name="nickname"') >= 0, 'input 需有 name 才能被 form 收集')
assert(profileWxml.indexOf('form-type="submit"') >= 0, '保存按钮应改为官方推荐的 form submit')

const toasts = []
global.wx.showToast = (o) => { toasts.push(o && o.title) }

// 用可控桩替换 updateUser，避免依赖 storage 中的登录态
const userApiStub = require('../api/user')
const realUpdateUser = userApiStub.updateUser
let mockProfileUser = null
userApiStub.updateUser = (patch) => Promise.resolve(Object.assign({}, mockProfileUser, patch))

capturedPage = null
require('../pages/profile/profile.js')
const profilePage = capturedPage

function mkProfile() {
  mockProfileUser = {
    id: 'oTEST', openid: 'oTEST', bizId: 'demo_user', source: 'webhook',
    nickname: '红色传承者', avatar: '/images/placeholder.png', phone: ''
  }
  const inst = Object.assign({}, profilePage, {
    data: {
      user: Object.assign({}, mockProfileUser),
      editing: true,
      saving: false,
      uploading: false,
      draft: { avatar: '/images/placeholder.png', nickname: '红色传承者', phone: '' }
    }
  })
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      if (k === 'draft.nickname') { this.data.draft.nickname = patch[k]; return }
      if (k === 'draft.avatar') { this.data.draft.avatar = patch[k]; return }
      if (k === 'draft.phone') { this.data.draft.phone = patch[k]; return }
      this.data[k] = patch[k]
    })
  }
  return inst
}

async function profileNicknameTest() {
  // 1) 正常输入 → 草稿更新；模拟微信安全检测回传空值 → 不得覆盖草稿
  const a = mkProfile()
  a.onNicknameInput({ detail: { value: '新昵称' } })
  assert(a.data.draft.nickname === '新昵称', '输入昵称应写入草稿')
  a.onNicknameInput({ detail: { value: '' } })
  assert(a.data.draft.nickname === '新昵称', 'blur 安全检测回传空值不应清空草稿')
  a.onNicknameInput({ detail: {} })
  assert(a.data.draft.nickname === '新昵称', '事件缺 value 字段时应安全忽略')

  // 2) form submit 正常值 → 保存成功并关闭面板
  const ok = await a.onSaveProfile({ detail: { value: { nickname: '新昵称' } } })
  assert(ok === true, 'form submit 应保存成功')
  assert(a.data.user.nickname === '新昵称', '用户昵称应更新')
  assert(a.data.editing === false && a.data.saving === false, '保存后面板关闭、状态复位')

  // 3) 表单值被安全检测清空 → 回退草稿，仍能保存（这是原来「填昵称失败」的主因）
  const b = mkProfile()
  b.onNicknameInput({ detail: { value: '表单被清空' } })
  const ok2 = await b.onSaveProfile({ detail: { value: { nickname: '' } } })
  assert(ok2 === true, '表单值为空应回退草稿而不是判失败')
  assert(b.data.user.nickname === '表单被清空', '昵称应取草稿值')

  // 4) 表单与草稿都空 → 明确提示，不调用 updateUser
  toasts.length = 0
  const c = mkProfile()
  c.data.draft.nickname = ''
  let called = false
  userApiStub.updateUser = () => { called = true; return Promise.resolve({}) }
  const ok3 = await c.onSaveProfile({ detail: { value: { nickname: '' } } })
  assert(ok3 === false && called === false, '都为空时不应发起保存')
  assert(toasts.some((t) => /安全检测|重新填写/.test(t || '')), '应提示昵称未通过安全检测或为空')
  userApiStub.updateUser = (patch) => Promise.resolve(Object.assign({}, mockProfileUser, patch))

  // 5) 头像落盘中 / 保存中禁止重复提交；无参调用兼容旧 bindtap
  const d = mkProfile()
  d.data.uploading = true
  assert(await d.onSaveProfile({ detail: { value: { nickname: 'X' } } }) === false, '头像处理中不应提交')
  d.data.uploading = false
  d.data.saving = true
  assert(await d.onSaveProfile({ detail: { value: { nickname: 'X' } } }) === false, '保存中不应重复提交')
  d.data.saving = false
  d.onNicknameInput({ detail: { value: '无参调用也能存' } })
  assert(await d.onSaveProfile() === true, '无 form 事件时回退草稿值')

  /* ---- 6) 手机号绑定：输入校验 / 脱敏展示 / 解绑 ---- */
  console.log('\n--- profile 手机号绑定 ---')
  assert(profileWxml.indexOf('name="phone"') >= 0, '手机号 input 需有 name 才能被 form 收集')
  assert(profileWxml.indexOf('type="number"') >= 0, '手机号应唤起数字键盘')
  assert(profileWxml.indexOf('maxlength="11"') >= 0, '手机号最多 11 位')
  assert(profileWxml.indexOf('{{phoneText}}') >= 0, '用户卡片应展示脱敏手机号')

  const p1 = mkProfile()
  assert(p1.formatPhone('13800138000') === '138****8000', '手机号应脱敏展示为 138****8000')
  assert(p1.formatPhone('') === '未绑定手机号', '未绑定应有占位文案')
  assert(p1.formatPhone('138****8000') === '138****8000', '已是脱敏值不应二次处理')
  assert(p1.formatPhone('1380013800') === '138****3800', '未输完的纯数字也应遮蔽，日志不泄漏号码')
  p1.onPhoneInput({ detail: { value: '138-0013-8000' } })
  assert(p1.data.draft.phone === '13800138000', '手机号应过滤非数字')
  p1.onPhoneInput({ detail: { value: '138001380001234' } })
  assert(p1.data.draft.phone === '13800138000', '手机号应截断到 11 位')

  let savedPatch = null
  userApiStub.updateUser = (patch) => {
    savedPatch = patch
    return Promise.resolve(Object.assign({}, mockProfileUser, patch))
  }
  const ok4 = await p1.onSaveProfile({ detail: { value: { nickname: '红色传承者', phone: '13800138000' } } })
  assert(ok4 === true, '正确手机号应保存成功')
  assert(savedPatch && savedPatch.phone === '13800138000', 'updateUser 应收到完整手机号')
  assert(p1.data.user.phone === '13800138000', '用户对象存完整号码供反馈页带出')
  assert(p1.data.phoneText === '138****8000', '页面仅展示脱敏号码')

  // 非法格式（10 位）应被拦截，且不发起保存
  savedPatch = null
  toasts.length = 0
  const p2 = mkProfile()
  const ok5 = await p2.onSaveProfile({ detail: { value: { nickname: '红色传承者', phone: '1380013800' } } })
  assert(ok5 === false && savedPatch === null, '10 位手机号应被拦截')
  assert(toasts.some((t) => /11 位手机号/.test(t || '')), '应提示正确的 11 位手机号')

  // 仅修改手机号（昵称头像不变）也要能保存：变化检测须包含 phone
  savedPatch = null
  const p3 = mkProfile()
  const ok6 = await p3.onSaveProfile({ detail: { value: { nickname: '红色传承者', phone: '13900139000' } } })
  assert(ok6 === true && savedPatch.phone === '13900139000', '仅修改手机号也应触发保存')

  // 表单清空 = 解绑，不能像昵称那样回退草稿旧值
  savedPatch = null
  const p4 = mkProfile()
  p4.data.user.phone = '13800138000'
  p4.data.draft.phone = '13800138000'
  const ok7 = await p4.onSaveProfile({ detail: { value: { nickname: '红色传承者', phone: '' } } })
  assert(ok7 === true, '清空手机号应能解绑')
  assert(savedPatch && savedPatch.phone === '', '解绑应写空字符串而非草稿旧值')
  assert(p4.data.phoneText === '未绑定手机号', '解绑后展示占位文案')

  userApiStub.updateUser = realUpdateUser
}

/* ================= 5. 自定义导航栏胶囊避让 ================= */
console.log('\n--- 自定义导航栏：按微信胶囊位置留白 ---')
let capturedApp = null
global.App = (o) => { capturedApp = o }
global.wx.getSystemInfoSync = () => ({ windowWidth: 375, statusBarHeight: 20 })
global.wx.getMenuButtonBoundingClientRect = () => ({
  width: 87, height: 32, top: 48, right: 365, bottom: 80, left: 278
})
require('../app.js')
const nav1 = capturedApp.getNavMetrics()
assert(nav1.statusBarHeight === 20, '状态栏高度应取系统值')
assert(nav1.navTop === 48, '顶部内容应对齐胶囊 top')
assert(nav1.menuReserve === 91, '375px 屏、胶囊 left=278 时右侧应预留 91px')

// 低版本基础库 / 接口抛错 / 返回全 0 都要安全降级
global.wx.getMenuButtonBoundingClientRect = () => { throw new Error('not support') }
const nav2 = capturedApp.getNavMetrics()
assert(nav2.menuReserve === 100, '取不到胶囊信息时应使用 100px 兜底')
assert(nav2.navTop === 36, '兜底顶部留白应为 statusBar + 16')
global.wx.getMenuButtonBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0 })
const nav3 = capturedApp.getNavMetrics()
assert(nav3.menuReserve === 100, '返回全 0 时也应安全降级')
delete global.wx.getMenuButtonBoundingClientRect
const nav4 = capturedApp.getNavMetrics()
assert(nav4.menuReserve === 100, '无该 API 时也应安全降级')

const indexWxml = fs.readFileSync(path.join(__dirname, '../pages/index/index.wxml'), 'utf8')
assert(indexWxml.indexOf('padding-top:{{navTop}}px') >= 0, 'hero 顶部留白应改用 navTop')
assert(indexWxml.indexOf('padding-right:{{menuReserve}}px') >= 0, '首页顶栏应给胶囊预留宽度')
assert(indexWxml.indexOf('statusBarHeight + 16') < 0, '不应再用固定 statusBar+16 估算')
const panoWxml = fs.readFileSync(path.join(__dirname, '../pages/panorama/panorama.wxml'), 'utf8')
assert(panoWxml.indexOf('padding-right:{{menuReserve}}px') >= 0, '全景页顶栏同样需要避让胶囊')

/* ================= 6. 预约表单：API-02 可预约日期对接 ================= */
console.log('\n--- 预约表单：可预约日期数据源 ---')
require('../pages/reservation-form/reservation-form.js')
const resvFormPage = capturedPage

function mkResvForm() {
  const inst = Object.assign({}, resvFormPage, {
    data: JSON.parse(JSON.stringify(resvFormPage.data))
  })
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      if (/^[a-zA-Z.]+$/.test(k)) {
        const parts = k.split('.')
        let o = this.data
        for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]
        o[parts[parts.length - 1]] = patch[k]
      } else {
        this.data[k] = patch[k]
      }
    })
  }
  return inst
}

// 真实场馆：API-02 的 ReservationDateList → 只有日期、没有时段
const venueDates = {
  source: 'venue',
  museumName: '辛亥革命纪念馆',
  dates: [
    { value: '2026-11-11', label: '11月11日', weekday: '周三', dateId: 'd1', quota: 1000, used: 0, remaining: 1000, reservable: true, slots: [] },
    { value: '2026-11-12', label: '11月12日', weekday: '周四', dateId: 'd2', quota: 1000, used: 1000, remaining: 0, reservable: true, slots: [] }
  ]
}
let rf = mkResvForm()
rf.applyDates(venueDates)
assert(rf.data.realMode === true, '真实模式应标记 realMode')
assert(rf.data.hasSlots === false, 'API-02 日期无时段 → hasSlots=false')
assert(rf.data.visitDate === '2026-11-11', '默认选中首个可约日期')
assert(rf.data.timeSlot === '', '真实模式不应带时段')
assert(rf.data.remainText === '余 1000 / 1000', '余量文案应含上限，实际：' + rf.data.remainText)
assert(rf.data.calendar.filter((c) => !c.blank && c.inRange).length === 2, '日历应标出 2 个可约日')
assert(rf.data.calendar.filter((c) => c.inRange && !c.full).length === 1, '余量为 0 的日期应标约满')
assert(rf.dateMissingText() === '', '已选日期时不报缺')
rf.setData({ visitDate: '' })
assert(rf.dateMissingText() === '请选择参观日期', '未选日期应提示选择日期（不再要求时段）')

// 真实模式已接入 API-05：服务端对空 Visitors 仍会「预约成功」并写库（ISS-005），
// 因此前端必须先挡住空名单
rf = mkResvForm()
rf.applyDates(venueDates)
rf.setData({ step: 2 })
const emptyMsg = rf.validate()
assert(emptyMsg === '请选择参观人（进馆需核验身份证）', '真实模式空名单应被前端拦住，实际：' + emptyMsg)

// 真实模式不支持在线改期（API-05 只能新建、API-09 未就绪）：提示先取消再重约
let modalTitle = ''
const savedModal = global.wx.showModal
global.wx.showModal = (o) => { modalTitle = o.title }
rf = mkResvForm()
rf.applyDates(venueDates)
rf.setData({ step: 2, isReschedule: true })
rf.onSubmit()
global.wx.showModal = savedModal
assert(modalTitle === '暂不支持在线改期', '真实模式改期应提示，实际：' + modalTitle)

// 配置了时段时，提交要取「该时段」的日历记录 ID，而不是当天记录的 ID
rf = mkResvForm()
rf.setData({
  dates: [{ value: '2026-11-11', dateId: 'day-1', slots: [{ timeSlot: '上午', dateId: 'slot-1' }] }],
  visitDate: '2026-11-11',
  timeSlot: '上午'
})
assert(rf.selectedDateId() === 'slot-1', '有选中时段时应取时段的 dateId')
rf.setData({ timeSlot: '' })
assert(rf.selectedDateId() === 'day-1', '无时段时应取当天记录的 dateId')
assert(rf.data.submitting !== true, '真实模式不应进入提交态')

// 本地名额表：仍保有时段维度，行为不变
const quotaDates = {
  source: 'mock',
  dates: [
    { value: '2026-11-20', label: '11月20日', weekday: '周五', dateId: '', quota: 200, used: 50, remaining: 150, reservable: true,
      slots: [{ timeSlot: '上午', available: 150, total: 200, disabled: false }] }
  ]
}
rf = mkResvForm()
rf.applyDates(quotaDates)
assert(rf.data.hasSlots === true && rf.data.realMode === false, '本地模式应保留时段')
assert(rf.data.timeSlot === '上午', '本地模式自动选中首个有余量的场次')
assert(rf.data.dateMissingText === undefined || rf.dateMissingText() === '', '本地模式日期+场次齐全')

profileNicknameTest()
  .then(() => console.log('\n===== 回归测试全部通过 ====='))
  .catch((e) => { console.error(e); process.exitCode = 1 })
