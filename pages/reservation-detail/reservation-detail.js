/**
 * 预约详情：状态进度 + 预约信息 + 核销二维码（canvas 绘制）+ 取消/改期操作
 */
const reservationApi = require('../../api/reservation')
const drawQrcode = require('../../utils/qrcode')
const { formatDate, maskIdCard } = require('../../utils/format')

// 状态 → 进度步骤（待审核 0 / 已通过 1 / 已核销 2；驳回与取消单独展示）
const STATUS_CLASS = {
  '待审核': 'st-pending',
  '已通过': 'st-approved',
  '已驳回': 'st-rejected',
  '已取消': 'st-canceled',
  '已核销': 'st-used'
}

Page({
  data: {
    resv: null,
    statusClass: '',
    timeText: '',
    showQr: false, // 是否展示核销码（已通过 / 已核销）
    steps: ['提交预约', '审核通过', '入馆核销'],
    currentStep: 0
  },

  onLoad(options) {
    this.id = options.id
  },

  onShow() {
    // 在 onLoad 用 onShow 而非 onLoad 加载：改期/取消操作后返回本页会重新触发 onShow 从而刷新状态
    this.fetchDetail()
  },

  fetchDetail() {
    reservationApi
      .getReservationDetail(this.id)
      .then((resv) => {
        const stepMap = { '待审核': 0, '已通过': 1, '已核销': 2 }
        // 参观人身份证脱敏（进馆核验凭证展示）
        resv.visitorList = (resv.visitors || []).map((v) => Object.assign({}, v, {
          idCardMask: maskIdCard(v.idCard)
        }))
        resv.contactIdCardMask = maskIdCard(resv.contactIdCard)
        this.setData({
          resv,
          statusClass: STATUS_CLASS[resv.status] || 'st-canceled',
          timeText: formatDate(resv.createTime, 'yyyy-MM-dd HH:mm'),
          showQr: resv.status === '已通过' || resv.status === '已核销',
          // 仅走流程的状态有进度；驳回/取消等异常态回退到第 0 步，进度条单独由 statusClass 变色
          currentStep: stepMap[resv.status] != null ? stepMap[resv.status] : 0
        })
        if (this.data.showQr) {
          // 等待 canvas 节点渲染完成后再绘制
          setTimeout(() => this.drawQr(resv.qrCode), 200)
        }
      })
      .catch((e) => {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  /** 绘制核销二维码（weapp-qrcode 旧版 canvas 接口） */
  drawQr(text) {
    if (!text) return
    try {
      drawQrcode({
        canvasId: 'qrCanvas',
        text,
        width: 180,
        height: 180,
        background: '#FFFFFF',
        foreground: '#2B2B2B',
        _this: this
      })
    } catch (e) {
      /* 二维码绘制失败不影响详情展示 */
    }
  },

  /** 取消预约（二次确认） */
  onCancel() {
    const resv = this.data.resv
    wx.showModal({
      title: '取消预约',
      content: '确定取消 ' + resv.visitDate + ' ' + resv.timeSlot + ' 的预约吗？名额将即时释放。',
      confirmColor: '#C8102E',
      success: (res) => {
        if (!res.confirm) return
        reservationApi
          .cancelReservation(this.id)
          .then(() => {
            wx.showToast({ title: '已取消', icon: 'success' })
            this.fetchDetail()
          })
          .catch((e) => {
            wx.showModal({ title: '提示', content: (e && e.message) || '取消失败', showCancel: false })
          })
      }
    })
  },

  /** 改期：跳转表单（改期模式） */
  onReschedule() {
    wx.navigateTo({ url: '/pages/reservation-form/reservation-form?reschedule=' + this.id })
  },

  goList() {
    wx.navigateBack()
  }
})
