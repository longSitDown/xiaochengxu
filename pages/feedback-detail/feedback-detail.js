/**
 * 反馈详情：内容 + 图片预览 + 处理进度时间线（提交 → 处理中 → 官方回复）
 */
const feedbackApi = require('../../api/feedback')
const { formatDate } = require('../../utils/format')

const STATUS_CLASS = {
  '待处理': 'fs-wait',
  '处理中': 'fs-doing',
  '已完结': 'fs-done'
}

Page({
  data: {
    fb: null,
    statusClass: '',
    createTimeText: '',
    replyTimeText: ''
  },

  onLoad(options) {
    feedbackApi
      .getFeedbackDetail(options.id)
      .then((fb) => {
        this.setData({
          fb,
          statusClass: STATUS_CLASS[fb.status] || 'fs-wait',
          createTimeText: formatDate(fb.createTime, 'yyyy-MM-dd HH:mm'),
          replyTimeText: fb.replyTime ? formatDate(fb.replyTime, 'yyyy-MM-dd HH:mm') : ''
        })
      })
      .catch((e) => {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  onPreviewImage(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.fb.images })
  }
})
