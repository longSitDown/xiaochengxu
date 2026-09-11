/**
 * 资讯详情：标题 + 元信息 + 封面 + 正文（富文本），浏览量自增
 */
const homeApi = require('../../api/home')
const { formatDate, formatNumber } = require('../../utils/format')

Page({
  data: {
    news: null,
    loading: true
  },

  onLoad(options) {
    this.id = options.id
    this.fetchDetail()
  },

  fetchDetail() {
    homeApi
      .getNewsDetail(this.id)
      .then((news) => {
        const decorated = Object.assign({}, news, {
          timeText: formatDate(news.publishTime, 'yyyy-MM-dd HH:mm'),
          viewsText: formatNumber(news.views)
        })
        this.setData({ news: decorated, loading: false })
        // 浏览量 +1（后台统计口径）
        homeApi.increaseNewsViews(news.id, news.views + 1).catch(() => {})
      })
      .catch((e) => {
        this.setData({ loading: false })
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  onShareAppMessage() {
    const n = this.data.news || {}
    return { title: n.title || '红色纪念馆资讯', path: '/pages/news-detail/news-detail?id=' + this.id }
  }
})
