/**
 * 关于我们：系统简介（/v3/app 应用信息）+ 服务模块 + 联系方式
 */
const homeApi = require('../../api/home')
const guideApi = require('../../api/guide')

Page({
  data: {
    appInfo: null,
    contacts: [] // 从场馆指南「地址交通 / 讲解服务」提取的联系方式
  },

  onLoad() {
    Promise.all([homeApi.getAppInfo(), guideApi.getGuideItems({ category: '地址交通' })])
      .then(([appInfo, guideItems]) => {
        this.setData({
          appInfo,
          contacts: (guideItems || []).map((g) => ({ title: g.title, content: g.content }))
        })
      })
      .catch(() => {
        /* 静默失败，页面仍可展示静态信息 */
      })
  },

  onCopy(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.text,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  }
})
