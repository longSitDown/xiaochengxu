/**
 * 数字导览（tabBar）：720°全景入口 + 展区横幅卡片 + 知识竞赛入口
 */
const exhibitionApi = require('../../api/exhibition')

Page({
  data: {
    exhibitions: [],
    loading: true
  },

  onLoad() {
    this.fetchList()
  },

  onPullDownRefresh() {
    this.fetchList(() => wx.stopPullDownRefresh())
  },

  fetchList(done) {
    exhibitionApi
      .getExhibitions()
      .then((exhibitions) => {
        // 名称形如「第一展厅 · 星火燎原」：拆出序号与主标题，用于横幅卡片排版
        const list = (exhibitions || []).map((e) => {
          const parts = (e.name || '').split(' · ')
          return Object.assign({}, e, {
            seq: parts[0] || '',
            main: parts[1] || e.name
          })
        })
        this.setData({ exhibitions: list, loading: false })
        done && done()
      })
      .catch((e) => {
        this.setData({ loading: false })
        done && done()
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  goPanorama() {
    wx.navigateTo({ url: '/pages/panorama/panorama' })
  },

  goHallDetail(e) {
    wx.navigateTo({ url: '/pages/hall-detail/hall-detail?id=' + e.currentTarget.dataset.id })
  },

  goQuiz() {
    wx.navigateTo({ url: '/pages/quiz/quiz' })
  }
})
