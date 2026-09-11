/**
 * 展区详情：展区介绍 + 全景入口 + 展品列表（支持直接播放语音讲解）
 */
const exhibitionApi = require('../../api/exhibition')
const audio = require('../../utils/audio')
const { formatNumber, formatDuration } = require('../../utils/format')

Page({
  data: {
    exhibition: null,
    artifacts: [],
    playingId: '', // 当前播放展品 id（用于列表播放态）
    loading: true
  },

  onLoad(options) {
    this.id = options.id
    this.fetchData()
  },

  onUnload() {
    // 先退订全局音频事件：否则本页已销毁，回调仍会被触发并对已卸载页面 setData
    if (this._offAudio) {
      this._offAudio.forEach((off) => off && off())
      this._offAudio = null
    }
    // 离开页面停止播放，避免后台残留
    audio.stop()
  },

  fetchData() {
    Promise.all([
      exhibitionApi.getExhibitionDetail(this.id),
      exhibitionApi.getArtifactsByExhibition(this.id)
    ])
      .then(([exhibition, artifacts]) => {
        this.setData({
          exhibition,
          artifacts: artifacts.map((a) => Object.assign({}, a, {
            viewsText: formatNumber(a.views),
            durationText: formatDuration(a.duration)
          })),
          loading: false
        })
        wx.setNavigationBarTitle({ title: exhibition.name })
      })
      .catch((e) => {
        this.setData({ loading: false })
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  goPanorama() {
    wx.navigateTo({ url: '/pages/panorama/panorama?exhibitionId=' + this.id })
  },

  /** 点击展品卡片 → 详情页 */
  goArtifact(e) {
    wx.navigateTo({ url: '/pages/artifact-detail/artifact-detail?id=' + e.currentTarget.dataset.id })
  },

  /** 播放按钮：调用全局音频单例（播放条组件自动浮现） */
  onPlayTap(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.artifacts.find((a) => a.id === id)
    if (!item) return
    // 同一展品：交给 audio 内部切换播放/暂停
    audio.play({
      id: item.id,
      title: item.name,
      cover: item.cover,
      src: item.audioUrl,
      duration: item.duration
    })
    const state = audio.getState()
    this.setData({ playingId: state.playing ? item.id : '' })
    // 只订阅一次：重复播放时避免反复注册监听导致状态错乱
    if (!this._offAudio) {
      this._offAudio = [
        audio.on('ended', () => this.setData({ playingId: '' })),
        audio.on('stop', () => this.setData({ playingId: '' })),
        audio.on('pause', () => {
          const s = audio.getState()
          if (!s.playing) this.setData({ playingId: '' })
        }),
        audio.on('play', () => {
          const s = audio.getState()
          if (s.current) this.setData({ playingId: s.current.id })
        })
      ]
    }
  }
})
