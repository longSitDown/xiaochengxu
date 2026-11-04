/**
 * 首页：红色 Hero 横幅 + 功能宫格入口 + 新闻资讯（分类筛选）
 * 数据来自 api/home 服务层，页面不感知数据来源（mock / 明道云）。
 */
const homeApi = require('../../api/home')
const exhibitionApi = require('../../api/exhibition')
const config = require('../../config/index')
const { formatDate } = require('../../utils/format')
const storage = require('../../utils/storage')

/**
 * 功能入口全量清单（对应设计稿：参观须知/VR展览/展厅导览/AI讲解/文物赏析/祭扫烈士/红色地图/场馆活动）
 * 实际渲染项由 config.HIDDEN_ENTRIES 过滤：隐藏只是不展示，数据保留，恢复时改配置即可。
 */
const ALL_ENTRIES = [
  { name: '参观须知', icon: '/images/entry/entry-notice.png', url: '/pages/guide/guide' },
  { name: 'VR展览', icon: '/images/entry/entry-vr.png', url: '/pages/panorama/panorama' },
  { name: '展厅导览', icon: '/images/entry/entry-hall.png', url: '/pages/hall/hall' },
  { name: 'AI讲解', icon: '/images/entry/entry-ai.png', url: '', tip: '请在展厅内选择展品收听讲解' },
  { name: '文物赏析', icon: '/images/entry/entry-relic.png', url: '/pages/artifact/artifact' },
  { name: '祭扫烈士', icon: '/images/entry/entry-mourn.png', url: '', tip: '功能建设中，敬请期待' },
  { name: '红色地图', icon: '/images/entry/entry-map.png', url: '', tip: '功能建设中，敬请期待' },
  { name: '场馆活动', icon: '/images/entry/entry-event.png', url: '/pages/news/news' },
  // 知识竞赛：原入口在数字导览页（hall 已隐藏），移至首页保证答题功能可达
  { name: '知识竞赛', icon: '/images/entry/entry-quiz.png', url: '/pages/quiz/quiz' }
]

Page({
  data: {
    statusBarHeight: 20, // 自定义导航栏：状态栏高度（hero 顶部留白）
    notices: [],        // 滚动公告条
    popupNotice: null,  // 弹窗公告
    entries: [],        // 功能宫格入口（已按 HIDDEN_ENTRIES 过滤）
    intro: '',          // 纪念馆简介
    honors: [],         // 荣誉资质列表（是否展示由 config.BLOCKS.honors 控制）
    showHonors: config.BLOCKS.honors, // 荣誉资质区块开关
    newsTabs: ['全部'], // 资讯分类 tabs（数据聚合后填充）
    newsTab: '全部',    // 当前选中分类
    newsList: [],       // 全量资讯（已装饰）
    showNews: [],       // 当前分类下展示的资讯
    loading: true
  },

  onLoad() {
    // 自定义导航栏需要自己撑起状态栏高度
    const info = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })

    // 宫格入口：按 config.HIDDEN_ENTRIES 过滤（当前隐藏 VR展览/展厅导览/AI讲解/文物赏析/祭扫烈士/红色地图）
    this.setData({ entries: this.visibleEntries() })

    // 纪念馆简介 + 荣誉资质（静态展示，后续可接入接口）
    this.setData({
      intro: '津市市革命纪念馆是为纪念在中国革命斗争中英勇献身的津市籍革命先烈而兴建的专题纪念馆。馆内收藏革命文物、文献资料数百件，通过实物、图片、场景复原等形式，生动再现了津市人民在大革命、土地革命、抗日战争和解放战争时期的光辉革命历程，是开展爱国主义教育和革命传统教育的重要阵地。',
      honors: ['全国爱国主义教育示范基地', '湖南省文物保护单位', '国家AAA级旅游景区', '湖南省红色旅游经典景区', '湖南省学雷锋活动示范点']
    })

    // 首页不弹登录：资讯、展馆、指南等公开内容游客可直接浏览，
    // 统一改为在写操作（预约/答题/反馈）时由 app.ensureLogin() 引导登录
    this.fetchAll()
  },

  onPullDownRefresh() {
    this.fetchAll(() => wx.stopPullDownRefresh())
  },

  /** 按 config.HIDDEN_ENTRIES 过滤出实际渲染的宫格入口 */
  visibleEntries() {
    const hidden = config.HIDDEN_ENTRIES || []
    return ALL_ENTRIES.filter((e) => hidden.indexOf(e.name) < 0)
  },

  /** 并行拉取首页数据：公告 + 资讯 + 展区（AI 讲解入口用） */
  fetchAll(done) {
    Promise.all([
      homeApi.getNotices(),
      homeApi.getNewsList({ page: 1, pageSize: 20 }),
      exhibitionApi.getExhibitions().catch(() => [])
    ])
      .then(([notices, news, exhibitions]) => {
        const newsList = this.decorateNews((news && news.list) || [])
        // 从资讯数据聚合出分类 tabs（去重保序）
        const cats = ['全部']
        newsList.forEach((n) => {
          if (n.category && cats.indexOf(n.category) < 0) cats.push(n.category)
        })
        this.setData({
          notices,
          newsList,
          newsTabs: cats,
          showNews: this.filterNews(newsList, this.data.newsTab),
          loading: false
        })
        // AI 讲解入口：进入第一个展区的展品讲解列表
        // 该入口可能被 config.HIDDEN_ENTRIES 隐藏，findIndex 返回 -1 时跳过，避免写入无效的 entries[-1]
        if (exhibitions && exhibitions.length) {
          const idx = this.data.entries.findIndex((e) => e.name === 'AI讲解')
          if (idx >= 0) {
            this.setData({
              ['entries[' + idx + '].url']: '/pages/hall-detail/hall-detail?id=' + exhibitions[0].id
            })
          }
        }
        this.checkPopupNotice(notices)
        done && done()
      })
      .catch((e) => {
        this.setData({ loading: false })
        done && done()
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  /** 资讯列表附加展示字段（设计稿展示完整日期） */
  decorateNews(list) {
    return (list || []).map((n) => Object.assign({}, n, {
      dateText: formatDate(n.publishTime, 'yyyy-MM-dd')
    }))
  },

  /** 按分类过滤，最多展示 4 条 */
  filterNews(list, tab) {
    const filtered = tab === '全部' ? list : list.filter((n) => n.category === tab)
    return filtered.slice(0, 4)
  },

  /** 切换资讯分类 tab */
  onNewsTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.newsTab) return
    this.setData({ newsTab: tab, showNews: this.filterNews(this.data.newsList, tab) })
  },

  /** 弹窗公告：isPopup=1 且未阅读过（按公告 id 记忆，避免每次进入都弹） */
  checkPopupNotice(notices) {
    const seenIds = storage.getItem('popup_notice_seen', [])
    const target = (notices || []).find((n) => n.isPopup === '1' && seenIds.indexOf(n.id) < 0)
    if (target) this.setData({ popupNotice: target })
  },

  /** 关闭弹窗并记录已读 */
  closePopup() {
    const n = this.data.popupNotice
    if (n) {
      const seenIds = storage.getItem('popup_notice_seen', [])
      seenIds.push(n.id)
      storage.setItem('popup_notice_seen', seenIds)
    }
    this.setData({ popupNotice: null })
  },

  /** 宫格点击：tab 页 switchTab，普通页 navigateTo，未开通功能提示 */
  onEntryTap(e) {
    const entry = this.data.entries[e.currentTarget.dataset.index]
    if (!entry) return
    if (!entry.url) {
      wx.showToast({ title: entry.tip || '功能建设中', icon: 'none' })
      return
    }
    // 仅这些页面在 tabBar 中，需 switchTab；其余一律 navigateTo
    // 注意：hall 已从 tabBar 移除，故不在本数组内（否则 switchTab 会失败）
    const tabPages = ['/pages/index/index', '/pages/reservation/reservation', '/pages/profile/profile']
    if (tabPages.indexOf(entry.url) >= 0) {
      wx.switchTab({ url: entry.url })
    } else {
      wx.navigateTo({ url: entry.url })
    }
  },

  onNewsTap(e) {
    wx.navigateTo({ url: '/pages/news-detail/news-detail?id=' + e.currentTarget.dataset.id })
  },

  /** 点击搜索框 → 跳转资讯列表页（自带搜索） */
  goSearch() {
    wx.navigateTo({ url: '/pages/news/news' })
  },

  /** 右上角菜单：常用快捷入口 */
  onMenuTap() {
    wx.showActionSheet({
      itemList: ['关于我们', '场馆指南', '意见反馈', '我的预约'],
      success: (res) => {
        const urls = [
          '/pages/about/about',
          '/pages/guide/guide',
          '/pages/feedback/feedback',
          '/pages/reservation/reservation'
        ]
        const url = urls[res.tapIndex]
        if (!url) return
        // 预约页是 tabBar，需 switchTab
        if (url === '/pages/reservation/reservation') {
          wx.switchTab({ url })
        } else {
          wx.navigateTo({ url })
        }
      }
    })
  },

  goNews() {
    wx.navigateTo({ url: '/pages/news/news' })
  },

  /** 弹窗内容区点击占位（阻止冒泡关闭） */
  noop() {}
})
