/**
 * 资讯列表：分类筛选 + 关键词搜索 + 上拉分页
 */
const homeApi = require('../../api/home')
const { fromNow, formatNumber } = require('../../utils/format')

const PAGE_SIZE = 10

Page({
  data: {
    categories: ['全部', '资讯', '英烈事迹', '红色故事'],
    activeCat: '全部',
    keywords: '',
    list: [],
    page: 1,
    hasMore: false,
    loading: false,
    finished: false // 首屏加载完成
  },

  onLoad(options) {
    if (options.category) this.setData({ activeCat: options.category })
    this.reload()
  },

  onPullDownRefresh() {
    this.reload(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return
    this.loadMore()
  },

  /** 分类切换 */
  onCatTap(e) {
    const cat = e.currentTarget.dataset.cat
    if (cat === this.data.activeCat) return
    this.setData({ activeCat: cat })
    this.reload()
  },

  onSearchInput(e) {
    this.setData({ keywords: e.detail.value })
  },

  onSearchConfirm() {
    this.reload()
  },

  /** 重新加载第一页 */
  reload(done) {
    this.setData({ page: 1, list: [], hasMore: false })
    this.fetchPage(true).then(() => done && done())
  },

  loadMore() {
    this.fetchPage(false)
  },

  /** 拉取一页数据（append 控制追加或替换） */
  fetchPage(reset) {
    const { activeCat, keywords, page } = this.data
    this.setData({ loading: true })
    return homeApi
      .getNewsList({
        category: activeCat === '全部' ? '' : activeCat,
        keywords,
        page,
        pageSize: PAGE_SIZE
      })
      .then((res) => {
        const rows = res.list.map((n) => Object.assign({}, n, {
          timeText: fromNow(n.publishTime),
          viewsText: formatNumber(n.views)
        }))
        this.setData({
          list: reset ? rows : this.data.list.concat(rows),
          hasMore: res.hasMore,
          page: res.hasMore ? page + 1 : page,
          loading: false,
          finished: true
        })
      })
      .catch((e) => {
        this.setData({ loading: false, finished: true })
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  onNewsTap(e) {
    wx.navigateTo({ url: '/pages/news-detail/news-detail?id=' + e.currentTarget.dataset.id })
  }
})
