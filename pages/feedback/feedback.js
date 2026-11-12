/**
 * 意见反馈：提交反馈（文字 + 图片 + 联系方式）/ 我的反馈列表 双 Tab
 *
 * 双通道（契约 v1.9.14）：
 *   - 本地演示：写 feedbacks 工作表，图片为 wx.chooseMedia 临时文件；
 *   - 真实场馆：走 API-08，只接受 Title/Description，不返回记录 ID、不支持图片，
 *     因此提交成功后留在提交页（「我的反馈」读不到该记录）。
 */
const feedbackApi = require('../../api/feedback')
const userApi = require('../../api/user')
const { fromNow } = require('../../utils/format')
const app = getApp()

// 反馈状态 → 样式类
const STATUS_CLASS = {
  '待处理': 'fs-wait',
  '处理中': 'fs-doing',
  '已完结': 'fs-done'
}

Page({
  data: {
    tab: 'create', // create 提交反馈 / mine 我的反馈
    content: '',
    images: [],
    contact: '',
    submitting: false,
    myList: [],
    mineLoading: false,
    tipText: '提交后可在「我的反馈」中查看处理进度与官方回复'
  },

  onLoad(options) {
    if (options.tab === 'mine') {
      this.setData({ tab: 'mine' })
      this.fetchMine()
    }
    // 默认联系方式取当前用户手机号
    const user = userApi.getUser()
    if (user && user.phone) this.setData({ contact: user.phone })
  },

  onShow() {
    // 从反馈详情返回时刷新列表
    if (this._loaded && this.data.tab === 'mine') this.fetchMine()
    this._loaded = true
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({ tab })
    if (tab === 'mine' && !this.myLoaded) this.fetchMine()
  },

  /* ---------------- 提交反馈 ---------------- */

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value })
  },

  /** 选择图片（最多 3 张） */
  onChooseImage() {
    const left = 3 - this.data.images.length
    if (left <= 0) {
      wx.showToast({ title: '最多上传 3 张图片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        this.setData({ images: this.data.images.concat(paths).slice(0, 3) })
      }
    })
  },

  onPreviewImage(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.images })
  },

  onRemoveImage(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(idx, 1)
    this.setData({ images })
  },

  onSubmit() {
    const { content, contact, submitting } = this.data
    if (submitting) return
    if (content.trim().length < 5) {
      wx.showToast({ title: '反馈内容至少 5 个字', icon: 'none' })
      return
    }
    const user = userApi.getUser()
    this.setData({ submitting: true })
    // 写操作前置：确保有登录身份，提交内容已填好，登录失败不影响已输入内容
    app
      .ensureLogin()
      .then(() =>
        feedbackApi.createFeedback({
          userId: userApi.getBizId() || '匿名',
          // API-08 需要游客档案 GUID；与 mock 业务关联键 bizId 是两个 ID，不可混用
          venueUserId: userApi.getUserId(),
          content: content.trim(),
          images: this.data.images,
          contact: contact.trim()
        })
      )
      .then((res) => {
        const viaVenue = !!(res && res.viaVenue)
        wx.showToast({ title: viaVenue ? '已提交至场馆' : '提交成功', icon: 'success' })
        this.setData({
          content: '', images: [], submitting: false,
          tab: viaVenue ? 'create' : 'mine',
          tipText: viaVenue
            ? '反馈已提交至场馆系统；场馆侧暂不支持图片与在线进度查询，如有疑问请联系场馆'
            : '提交后可在「我的反馈」中查看处理进度与官方回复'
        })
        // 场馆系统（API-08）不返回反馈记录 ID，「我的反馈」读的是本地工作表，
        // 跳过去只会看到空列表；留在提交页由底下的提示说明进度查询方式。
        if (!viaVenue) {
          this.myLoaded = false
          this.fetchMine()
        }
      })
      .catch((e) => {
        this.setData({ submitting: false })
        wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' })
      })
  },

  /* ---------------- 我的反馈 ---------------- */

  fetchMine() {
    const user = userApi.getUser()
    if (!user) {
      this.setData({ myList: [], mineLoading: false })
      return
    }
    this.setData({ mineLoading: true })
    feedbackApi
      .getMyFeedbacks(userApi.getBizId())
      .then((list) => {
        this.myLoaded = true
        this.setData({
          myList: list.map((f) => Object.assign({}, f, {
            timeText: fromNow(f.createTime),
            statusClass: STATUS_CLASS[f.status] || 'fs-wait'
          })),
          mineLoading: false
        })
      })
      .catch((e) => {
        this.setData({ mineLoading: false })
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  onItemTap(e) {
    wx.navigateTo({ url: '/pages/feedback-detail/feedback-detail?id=' + e.currentTarget.dataset.id })
  }
})
