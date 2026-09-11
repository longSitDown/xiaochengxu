/**
 * 文物鉴赏：馆藏列表 + 分类筛选（武器军械 / 文献文书 / 实物器具）
 * 数据来自展品服务层，category 字段为文物分类。
 */
const exhibitionApi = require('../../api/exhibition')

const TABS = ['全部', '武器军械', '文献文书', '实物器具']

Page({
  data: {
    tabs: TABS,
    activeTab: '全部',
    list: [],      // 当前分类下展示的藏品
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
      .getAllArtifacts()
      .then((all) => {
        this.all = all || [] // 全量藏品（筛选前）
        this.applyFilter()
        done && done()
      })
      .catch((e) => {
        this.setData({ loading: false })
        done && done()
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  /** 切换分类 tab */
  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.applyFilter()
  },

  applyFilter() {
    const tab = this.data.activeTab
    const list = tab === '全部' ? this.all : this.all.filter((a) => a.category === tab)
    this.setData({ list, loading: false })
  },

  /** 进入文物详情 */
  onItemTap(e) {
    wx.navigateTo({ url: '/pages/artifact-detail/artifact-detail?id=' + e.currentTarget.dataset.id })
  }
})
