/**
 * 文物详情：大图 + 分类/时期 + 描述 + 语音讲解 + 收藏/分享
 * 收藏为本地收藏（storage 记录展品 id 列表），分享走小程序原生转发。
 */
const exhibitionApi = require('../../api/exhibition')
const audio = require('../../utils/audio')
const storage = require('../../utils/storage')
const { formatNumber, formatDuration } = require('../../utils/format')

const FAV_KEY = 'fav_artifacts' // 本地收藏的展品 id 列表

Page({
  data: {
    artifact: null,
    viewsText: '',
    durationText: '',
    playing: false,
    faved: false,
    loading: true
  },

  onLoad(options) {
    this.id = options.id
    this.fetchDetail()
  },

  onUnload() {
    // 先退订全局音频事件：否则本页已销毁，回调仍会被触发并对已卸载页面 setData
    if (this._off) {
      this._off.forEach((off) => off && off())
      this._off = null
    }
    audio.stop()
  },

  /** 支持原生转发 */
  onShareAppMessage() {
    const a = this.data.artifact
    return {
      title: a ? '文物鉴赏 · ' + a.name : '红色纪念馆 · 文物鉴赏',
      path: '/pages/artifact-detail/artifact-detail?id=' + this.id
    }
  },

  fetchDetail() {
    exhibitionApi
      .getArtifactDetail(this.id)
      .then((artifact) => {
        this.setData({
          artifact,
          viewsText: formatNumber(artifact.views),
          durationText: formatDuration(artifact.duration),
          faved: (storage.getItem(FAV_KEY, []) || []).indexOf(artifact.id) >= 0,
          loading: false
        })
        wx.setNavigationBarTitle({ title: artifact.name })
        exhibitionApi.increaseArtifactViews(artifact.id, artifact.views + 1).catch(() => {})

        // 订阅全局播放状态，刷新本页播放按钮
        this._off = [
          audio.on('play', () => this.syncPlaying()),
          audio.on('pause', () => this.syncPlaying()),
          audio.on('stop', () => this.syncPlaying()),
          audio.on('ended', () => this.syncPlaying())
        ]
        this.syncPlaying()
      })
      .catch((e) => {
        this.setData({ loading: false })
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  syncPlaying() {
    const s = audio.getState()
    // audio 为全局单例：仅当"正在播放且当前播的正是本展品"才置为播放态，
    // 避免其它页面/展品播放时同步到本页造成误显示
    this.setData({ playing: !!(s.playing && s.current && s.current.id === this.id) })
  },

  /** 播放 / 暂停语音讲解 */
  onPlayTap() {
    const a = this.data.artifact
    audio.play({
      id: a.id,
      title: a.name,
      cover: a.cover,
      src: a.audioUrl,
      duration: a.duration
    })
    this.syncPlaying()
  },

  /** 收藏 / 取消收藏（本地记忆） */
  onFavTap() {
    const id = this.id
    const list = storage.getItem(FAV_KEY, []) || []
    const idx = list.indexOf(id)
    if (idx >= 0) {
      list.splice(idx, 1)
      this.setData({ faved: false })
      wx.showToast({ title: '已取消收藏', icon: 'none' })
    } else {
      list.push(id)
      this.setData({ faved: true })
      wx.showToast({ title: '已加入收藏', icon: 'success' })
    }
    storage.setItem(FAV_KEY, list)
  },

  /** 前往所在展区 */
  goExhibition() {
    const a = this.data.artifact
    if (a && a.exhibitionId) {
      wx.navigateTo({ url: '/pages/hall-detail/hall-detail?id=' + a.exhibitionId })
    }
  }
})
