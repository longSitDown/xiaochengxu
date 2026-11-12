/**
 * 720°全景展馆（演示实现）：
 *   - 等距柱状投影全景图（images/panorama.png）+ 横向拖拽平移模拟环视
 *   - 热点位（展品）点击可跳转展品详情收听讲解
 *   - 生产环境可替换为 krpano / Pannellum 等专业全景引擎，交互骨架不变
 */
const exhibitionApi = require('../../api/exhibition')

// 全景热点：位置为全景图上的百分比坐标，关联展品 id（与 mock 种子展品对应）
const HOTSPOTS = [
  { id: 'art_001', x: 12, y: 62 },
  { id: 'art_002', x: 30, y: 55 },
  { id: 'art_004', x: 47, y: 66 },
  { id: 'art_007', x: 63, y: 58 },
  { id: 'art_010', x: 82, y: 63 }
]

// 全景图显示宽度 = 视口宽 × 该倍数（越大可视范围越广、拖拽行程越长）
const IMG_SCALE = 2.4

Page({
  data: {
    hotspots: [],
    offsetX: 0,        // 当前平移偏移（px）
    angle: 0,          // 当前视角（0-360°）
    viewportW: 375,
    imgW: 900,
    viewportH: 500,
    dragging: false,
    artifacts: [],      // 热点关联展品（取名称/展区）
    chapters: [],       // 底部章节菜单：场馆风貌 + 各展区
    activeChapter: '',  // 当前章节（'' = 场馆风貌，展示全部热点）
    sceneTitle: '',     // 场景标题浮层文字
    sceneShow: false,
    // 顶部信息
    creator: '超星·文博',
    popularity: '148万',
    // 右侧功能按钮状态
    musicPlaying: false,
    vrMode: false,
    // 场景缩略图
    sceneThumbs: [],
    // 状态栏高度（自定义导航栏适配）
    statusBarHeight: 20,
    menuReserve: 100 // 右侧为微信胶囊预留的宽度（px）
  },

  onLoad(options) {
    this.exhibitionId = options.exhibitionId || ''
    const info = wx.getSystemInfoSync()
    // 微信胶囊是系统浮层、不占文档流，顶栏右侧需按实际位置留白
    const navApp = getApp()
    const nav = (navApp && navApp.getNavMetrics && navApp.getNavMetrics()) || {}
    const viewportW = info.windowWidth
    const viewportH = Math.round(viewportW * 4 / 3) // 全景区高度按 4:3
    this.maxOffset = 0
    this.minOffset = viewportW - viewportW * IMG_SCALE // 负值
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      menuReserve: typeof nav.menuReserve === 'number' ? nav.menuReserve : 100,
      viewportW,
      viewportH,
      imgW: Math.round(viewportW * IMG_SCALE)
    })
    this.loadHotspotNames()
  },

  /** 返回上一页 */
  onBack() {
    wx.navigateBack({ delta: 1 })
  },

  /** 更多操作 */
  onMore() {
    wx.showActionSheet({
      itemList: ['分享给好友', '举报'],
      success: (res) => {
        if (res.tapIndex === 0) this.onToolTap({ currentTarget: { dataset: { tool: 'share' } } })
      }
    })
  },

  /** 右侧功能按钮：信息 / 音乐 / 分享 / VR */
  onToolTap(e) {
    const tool = e.currentTarget.dataset.tool
    if (tool === 'info') {
      wx.showModal({
        title: '全景导览',
        content: '720°全景数字展馆，左右拖动屏幕漫游展厅，点击光点查看展品并收听语音讲解。',
        showCancel: false
      })
    } else if (tool === 'music') {
      const playing = !this.data.musicPlaying
      this.setData({ musicPlaying: playing })
      wx.showToast({ title: playing ? '背景音乐已开启' : '背景音乐已关闭', icon: 'none' })
    } else if (tool === 'share') {
      wx.showToast({ title: '请点击右上角分享', icon: 'none' })
    } else if (tool === 'vr') {
      const vr = !this.data.vrMode
      this.setData({ vrMode: vr })
      wx.showToast({ title: vr ? 'VR 模式已开启' : 'VR 模式已关闭', icon: 'none' })
    }
  },

  /** 场景缩略图点击：切换章节（与底部章节菜单联动） */
  onSceneTap(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.activeChapter) return
    const chapter = this.data.chapters.find((c) => c.id === id) || {}
    this.setData({
      activeChapter: id,
      hotspots: this.filterHotspots(id),
      sceneTitle: chapter.name || '',
      sceneShow: true
    })
    clearTimeout(this._sceneTimer)
    this._sceneTimer = setTimeout(() => this.setData({ sceneShow: false }), 2500)
  },

  /** 拉取展品名称（热点标签）与展区列表（章节菜单） */
  loadHotspotNames() {
    Promise.all([
      exhibitionApi.getAllArtifacts().catch(() => []),
      exhibitionApi.getExhibitions().catch(() => [])
    ])
      .then(([artifacts, exhibitions]) => {
        this.allArtifacts = artifacts || []
        // 章节：场馆风貌（全部热点）+ 各展区（名称取「 · 」后的主标题）
        const chapters = [{ id: '', name: '场馆风貌' }].concat(
          (exhibitions || []).map((e) => {
            const parts = (e.name || '').split(' · ')
            return { id: e.id, name: parts[1] || e.name }
          })
        )
        // 场景缩略图：复用各展区封面，首项为全景航拍图
        const sceneThumbs = [{ id: '', name: '航拍', cover: '/images/panorama.png' }].concat(
          (exhibitions || []).map((e) => ({ id: e.id, name: chapters.find((c) => c.id === e.id).name, cover: e.cover }))
        )
        this.setData({
          artifacts: this.allArtifacts,
          chapters,
          sceneThumbs,
          // 从展区详情进入时（带 exhibitionId）默认定位到该展区章节
          activeChapter: this.exhibitionId,
          hotspots: this.filterHotspots(this.exhibitionId)
        })
      })
      .catch(() => {
        this.setData({ hotspots: HOTSPOTS })
      })
  },

  /** 按章节过滤热点：'' 展示全部，展区 id 只保留该展区的展品光点 */
  filterHotspots(chapterId) {
    return HOTSPOTS.map((h) => Object.assign({}, h, {
      name: (this.allArtifacts.find((a) => a.id === h.id) || {}).name || '展品',
      exhibitionId: (this.allArtifacts.find((a) => a.id === h.id) || {}).exhibitionId || ''
    })).filter((h) => !chapterId || h.exhibitionId === chapterId)
  },

  /** 切换章节：过滤热点 + 显示场景标题浮层（2.5s 后淡出） */
  onChapterTap(e) {
    const id = e.currentTarget.dataset.id
    if (id === this.data.activeChapter) return
    const chapter = this.data.chapters.find((c) => c.id === id) || {}
    this.setData({
      activeChapter: id,
      hotspots: this.filterHotspots(id),
      sceneTitle: chapter.name || '',
      sceneShow: true
    })
    clearTimeout(this._sceneTimer)
    this._sceneTimer = setTimeout(() => this.setData({ sceneShow: false }), 2500)
  },

  onUnload() {
    clearTimeout(this._sceneTimer)
  },

  onTouchStart(e) {
    // 记录本次拖拽的起点偏移，便于按增量计算新位置
    this.startX = e.touches[0].clientX
    this.startOffset = this.data.offsetX
    this.setData({ dragging: true })
  },

  onTouchMove(e) {
    const dx = e.touches[0].clientX - this.startX
    let offset = this.startOffset + dx
    // 边界回弹限制
    offset = Math.min(this.maxOffset, Math.max(this.minOffset, offset))
    this.applyOffset(offset)
  },

  onTouchEnd() {
    this.setData({ dragging: false })
  },

  /** 偏移 → 视角角度（0-360 环形映射，首尾无缝） */
  applyOffset(offset) {
    const range = this.maxOffset - this.minOffset
    // maxOffset(最右)对应 0°，minOffset(最左)对应 360°：向右拖看场景右部、向左拖看左部
    const ratio = range ? (this.maxOffset - offset) / range : 0
    this.setData({ offsetX: offset, angle: Math.round(ratio * 360) })
  },

  /** 热点点击 → 展品详情 */
  onHotspotTap(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: '/pages/artifact-detail/artifact-detail?id=' + id })
  },

  /** 微信分享（右上角菜单 / 分享按钮触发） */
  onShareAppMessage() {
    return {
      title: '津市革命纪念馆 · 720°全景数字展馆',
      path: '/pages/panorama/panorama'
    }
  }
})
