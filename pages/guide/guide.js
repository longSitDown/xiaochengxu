/**
 * 场馆指南：开放时间 / 地址交通 / 参观须知 / 配套服务 / 讲解服务（分组手风琴）
 */
const guideApi = require('../../api/guide')

// 分类 → 展示图标（CSS 绘制徽标用标识）
const CATEGORY_ICON = {
  '开放时间': 'clock',
  '地址交通': 'location',
  '参观须知': 'notice',
  '配套服务': 'service',
  '讲解服务': 'guide'
}

Page({
  data: {
    groups: [],     // [{category, icon, items}]
    openIndex: 0,   // 当前展开分组
    loading: true
  },

  onLoad() {
    guideApi
      .getGuideGrouped()
      .then((groups) => {
        this.setData({
          groups: groups.map((g) => Object.assign({}, g, { icon: CATEGORY_ICON[g.category] || 'notice' })),
          loading: false
        })
      })
      .catch((e) => {
        this.setData({ loading: false })
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  onGroupTap(e) {
    const idx = Number(e.currentTarget.dataset.index)
    this.setData({ openIndex: this.data.openIndex === idx ? -1 : idx })
  },

  /** 复制地址/电话等内容 */
  onItemTap(e) {
    const content = e.currentTarget.dataset.content || ''
    if (!content) return
    wx.setClipboardData({
      data: content,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  }
})
