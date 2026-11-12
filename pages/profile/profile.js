/**
 * 我的（tabBar）：用户信息 + 业务统计 + 功能菜单
 *
 * 头像昵称采用官方「头像昵称填写能力」：
 *   - 头像：<button open-type="chooseAvatar"> 拿到临时路径 → uploadAvatar 落盘到 USER_DATA_PATH
 *           （webhook/mock 无上传接口；proxy 模式才走后端换 URL）
 *   - 昵称：<input type="nickname"> 键盘上方可出现微信昵称，一键填入
 * 昵称用 <form> + form-type="submit" 收集最终值（官方针对 2.24.4+ 内容安全检测
 * 「blur 异步清空输入」的推荐做法），不再绑定 bindblur 覆盖草稿。
 * 不再使用 wx.getUserProfile（该接口已收回，只会返回匿名数据）。
 *
 * 手机号：优先来自登录时 API-06 形式一（微信手机号授权）换回的平台验证手机号（不可手改，只读展示）；
 * 未走手机号授权（js_code 登录且档案无手机号）时，仍允许手动填写并满足 /^1\d{10}$/ 校验
 * （与 visitor-editor / reservation-form 同一口径），由 updateUser 存本地。
 * 展示一律脱敏为 138****8000，留空即解绑。
 */
const app = getApp()
const userApi = require('../../api/user')
const reservationApi = require('../../api/reservation')
const venueApi = require('../../api/venue')
const quizApi = require('../../api/quiz')
const feedbackApi = require('../../api/feedback')

Page({
  data: {
    user: null,
    phoneText: '未绑定手机号', // 脱敏展示文本，草稿里仍是完整号码
    phoneVerified: false,      // 手机号来自微信授权验证（API-06 形式一）时只读
    stats: { resv: 0, quiz: 0, feedback: 0 },
    editing: false,
    saving: false,
    uploading: false,
    draft: { avatar: '', nickname: '', phone: '' },
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
    this.setData({
      user,
      phoneText: this.formatPhone(user && user.phone),
      phoneVerified: !!(user && user.phoneVerified)
    })
    if (user) {
      this.verifyAvatarFile(user)
      this.fetchStats(userApi.getBizId())
    }
  },

  /**
   * 校验本机头像文件是否还在。
   * 系统清理缓存 / 历史版本遗留的已删路径都会让 <image> 变成空白，
   * 这里主动探一次，缺了就退回占位图并留日志（只改展示，不动 storage）。
   */
  verifyAvatarFile(user) {
    const p = String((user && user.avatar) || '')
    if (!p || !userApi.isLocalAvatar(p)) return
    let fs = null
    try {
      fs = wx.getFileSystemManager && wx.getFileSystemManager()
    } catch (e) {
      return
    }
    if (!fs || typeof fs.access !== 'function') return
    fs.access({
      path: p,
      fail: () => {
        console.warn('[我的] 头像文件已不存在，回退占位图：', p)
        this.setData({ user: Object.assign({}, user, { avatar: '/images/placeholder.png' }) })
      }
    })
  },

  /** 手机号脱敏：138****8000；纯数字（含未输完的输入）一律遮蔽，已是脱敏值原样展示 */
  formatPhone(phone) {
    const s = String(phone || '').trim()
    if (!s) return '未绑定手机号'
    if (/^1\d{10}$/.test(s)) return s.slice(0, 3) + '****' + s.slice(7)
    if (/^\d+$/.test(s)) return s.slice(0, 3) + '****' + s.slice(-4)
    return s // 已脱敏值或历史非数字资料
  },

  /** 并行拉取三项业务统计 */
  fetchStats(userId) {
    if (!userId) return
    const uid = userApi.getUserId()
    // 真实场馆模式下预约记录写在明道云「用户预约记录」表，HAP 工作表统计不到，
    // 优先用 API-11 的 ReservationList 计数；接口不可用时回退 HAP 统计（不影响其它两项）
    const countViaVenue = !venueApi.isMock() && !!uid
    const resvTask = countViaVenue
      ? venueApi
          .getProfileReservations(uid)
          .then((r) => r.reservations.length)
          .catch(() => reservationApi.getMyReservations(userId).then((l) => l.length))
      : reservationApi.getMyReservations(userId).then((l) => l.length)
    Promise.all([resvTask, quizApi.getMyRecords(userId), feedbackApi.getMyFeedbacks(userId)])
      .then(([resv, quiz, feedback]) => {
        this.setData({
          stats: { resv, quiz: quiz.length, feedback: feedback.length }
        })
      })
      .catch(() => {
        /* 统计失败不阻塞页面 */
      })
  },

  /** 点击登录入口：跳独立登录页（手机号快捷登录 + 协议勾选） */
  onLogin() {
    wx.navigateTo({ url: '/pages/login/login?from=profile' })
  },

  /**
   * 头像加载失败兜底。
   * 本机头像文件可能被系统清理，或历史缓存里存的是已被删除的路径；
   * 这种情况下不能让页面留一块空白，退回占位图并留日志便于排查。
   * 只改内存展示、不写 storage —— 单次加载失败不代表文件永久没了。
   */
  onAvatarError() {
    const user = this.data.user
    if (!user) return
    const cur = String(user.avatar || '')
    if (!cur || cur === '/images/placeholder.png') return
    console.warn('[我的] 头像加载失败，回退占位图：', cur)
    this.setData({ user: Object.assign({}, user, { avatar: '/images/placeholder.png' }) })
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
        nickname: this.data.user.nickname || '',
        phone: this.data.user.phone || ''
      }
    })
  },

  onCloseEditor() {
    if (this.data.saving || this.data.uploading) return
    this.setData({ editing: false })
  },

  /**
   * 昵称输入：只把非空值写入草稿。
   * 基础库 2.24.4+ 会在 input 失焦时异步做内容安全检测，未通过会清空输入框，
   * 此时可能回调空值；若用空值覆盖草稿，点保存就会变成「请填写昵称」。
   * 昵称本就不允许为空，空值不写草稿没有副作用。
   */
  onNicknameInput(e) {
    const d = (e && e.detail) || {}
    const raw = d.value != null ? d.value : (d.text != null ? d.text : '')
    const value = String(raw)
    if (!value.trim()) return
    // 值没变就不 setData：type="nickname" 受控回填在真机上容易把光标重置到末尾
    if (value === this.data.draft.nickname) return
    this.setData({ 'draft.nickname': value })
  },

  /** 手机号输入：只保留数字、最多 11 位；允许清空（解绑） */
  onPhoneInput(e) {
    const d = (e && e.detail) || {}
    const value = String(d.value == null ? '' : d.value).replace(/\D/g, '').slice(0, 11)
    if (value === this.data.draft.phone) return
    this.setData({ 'draft.phone': value })
  },

  /** 选头像：临时路径刷新即失效，交给 userApi.uploadAvatar 落盘（webhook 模式存本地用户目录） */
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

  /**
   * 保存资料：按微信官方建议从 form submit 的 e.detail.value 取最终昵称，
   * 表单值为空时回退到草稿（覆盖「安全检测清空输入框」等场景）。
   * 手机号以表单值为准（空 = 解绑，不能回退草稿，否则用户永远清不掉）。
   * 返回 Promise 便于自测 await；页面侧忽略返回值。
   */
  onSaveProfile(e) {
    if (this.data.saving || this.data.uploading) return Promise.resolve(false)
    const form = (e && e.detail && e.detail.value) || {}
    const formNick = String(form.nickname == null ? '' : form.nickname).trim()
    const draftNick = String(this.data.draft.nickname || '').trim()
    const nickname = formNick || draftNick

    const current = this.data.user || {}
    const currentPhone = String(current.phone || '').trim()

    // 表单提交了 phone 字段就以它为准；无 form 事件（兼容旧调用）时回退草稿。
    // 微信验证过的手机号是账号标识，一律不接受表单改写（换号须重新走登录授权）。
    const hasFormPhone = Object.prototype.hasOwnProperty.call(form, 'phone')
    const phone = this.data.phoneVerified
      ? currentPhone
      : String(hasFormPhone ? (form.phone == null ? '' : form.phone) : (this.data.draft.phone || ''))
        .replace(/\D/g, '')
        .slice(0, 11)
    console.log(
      '[资料] 保存：表单昵称=' + JSON.stringify(formNick) +
      ' 草稿昵称=' + JSON.stringify(draftNick) +
      ' 手机号=' + this.formatPhone(phone) +
      (this.data.phoneVerified ? '（微信已验证，只读）' : '')
    )

    if (!nickname) {
      wx.showToast({ title: '昵称未通过微信安全检测或为空，请重新填写', icon: 'none' })
      return Promise.resolve(false)
    }
    // 与预约人 / 预约表单保持同一校验口径
    if (phone && !/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写正确的 11 位手机号', icon: 'none' })
      return Promise.resolve(false)
    }
    if (
      nickname === current.nickname &&
      this.data.draft.avatar === current.avatar &&
      phone === currentPhone
    ) {
      this.setData({ editing: false })
      return Promise.resolve(false)
    }
    this.setData({ saving: true })
    return userApi
      .updateUser({ nickname, avatar: this.data.draft.avatar, phone })
      .then((user) => {
        this.setData({
          user,
          phoneText: this.formatPhone(user && user.phone),
          saving: false,
          editing: false
        })
        wx.showToast({ title: '已保存', icon: 'success' })
        return true
      })
      .catch((err) => {
        this.setData({ saving: false })
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
        return false
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
        this.setData({
          user: null,
          phoneText: '未绑定手机号',
          stats: { resv: 0, quiz: 0, feedback: 0 }
        })
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
          phoneText: '未绑定手机号',
          stats: { resv: 0, quiz: 0, feedback: 0 },
          editing: false,
          draft: { avatar: '', nickname: '', phone: '' }
        })
        wx.showToast({ title: '已退出登录', icon: 'success' })
      }
    })
  }
})
