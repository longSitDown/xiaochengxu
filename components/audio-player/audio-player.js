/**
 * 语音讲解播放条
 * 读取 utils/audio 全局单例状态，订阅播放/暂停/进度/结束等事件刷新 UI。
 * 多个页面复用同一实例，切换页面时通过 detach 取消订阅，避免重复回调。
 */
const audio = require('../../utils/audio')
const { formatDuration } = require('../../utils/format')

Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  data: {
    playing: false,
    title: '',
    cover: '',
    currentTime: 0,
    duration: 0,
    curText: '00:00',
    durText: '00:00'
  },
  lifetimes: {
    attached() {
      this._off = []
      const events = ['play', 'pause', 'stop', 'ended', 'timeupdate', 'loadedmetadata', 'error']
      events.forEach((ev) => {
        this._off.push(audio.on(ev, () => this.refresh()))
      })
      this.refresh()
    },
    detached() {
      ;(this._off || []).forEach((fn) => fn && fn())
      this._off = []
    }
  },
  methods: {
    refresh() {
      const s = audio.getState()
      const duration = s.duration || (s.current && s.current.duration) || 0
      this.setData({
        playing: s.playing,
        title: s.current ? s.current.title : '',
        cover: s.current ? s.current.cover || '/images/placeholder.png' : '',
        currentTime: s.currentTime || 0,
        duration,
        curText: formatDuration(s.currentTime || 0),
        durText: formatDuration(duration)
      })
    },
    onToggle() {
      audio.toggle()
    },
    onClose() {
      audio.stop()
    },
    onSeek(e) {
      audio.seek(e.detail.value)
    }
  }
})
