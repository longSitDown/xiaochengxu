/**
 * 全局唯一音频实例管理
 *
 * 整个小程序共享一个 InnerAudioContext（避免多实例并发播放），
 * 供语音讲解（数字展馆）使用。组件 / 页面通过订阅状态变更来刷新 UI。
 *
 * 播放源说明：
 *   - mock 数据 audioUrl 指向包内 /audio/*.wav（演示音），
 *   - 后续对接明道云后，audioUrl 为真实音频地址，本模块无需改动。
 */

let ctx = null
let current = null // { id, title, cover, src, duration }
const listeners = {} // eventName -> Set<cb>（用 Set 自动去重，同一回调不会重复订阅）

// 懒创建音频实例；每个事件仅 on 注册一次，回调统一转发给所有订阅者
function getCtx() {
  if (!ctx) {
    ctx = wx.createInnerAudioContext()
    ctx.obeyMuteSwitch = false
    const EVENTS = [
      'play', 'pause', 'stop', 'ended', 'error',
      'timeupdate', 'loadedmetadata', 'waiting', 'canplay'
    ]
    EVENTS.forEach((name) => {
      ctx.on(name, () => emit(name))
    })
  }
  return ctx
}

function emit(name) {
  const set = listeners[name]
  if (!set) return
  set.forEach((cb) => {
    try {
      cb(getState())
    } catch (e) {
      /* ignore */
    }
  })
}

function on(name, cb) {
  if (!listeners[name]) listeners[name] = new Set()
  listeners[name].add(cb)
  return () => {
    if (listeners[name]) listeners[name].delete(cb)
  }
}

function getState() {
  const c = getCtx()
  return {
    current,
    playing: !c.paused && c.src ? true : false,
    paused: c.paused,
    duration: current && current.duration ? current.duration : (c.duration || 0),
    currentTime: c.currentTime || 0
  }
}

/**
 * 播放（或切换）音频
 * @param {{id:string, title:string, cover?:string, src:string, duration?:number}} track
 */
function play(track) {
  if (!track || !track.src) return
  const c = getCtx()
  const isSame = current && current.id === track.id
  current = Object.assign({}, track)
  if (isSame && !c.paused) {
    // 同一音频且正在播放 → 点击即暂停（播放/暂停切换）
    c.pause()
    return
  }
  if (isSame) {
    // 同一音频且已暂停 → 续播
    c.play()
    return
  }
  // 切换到新音频：先 stop 清掉旧播放源，再换 src 播放，避免同实例冲突
  c.stop()
  c.src = track.src
  c.play()
}

/** 暂停 */
function pause() {
  if (ctx) ctx.pause()
}

/** 停止并清空：清空 src 并复位 current，关闭当前播放 */
function stop() {
  if (ctx) {
    ctx.stop()
    ctx.src = ''
  }
  current = null
}

/** 切换播放/暂停（用于播放条按钮） */
function toggle() {
  const c = getCtx()
  if (!current) return
  if (c.paused) c.play()
  else c.pause()
}

/** 跳转进度（秒）；范围钳制在 [0, 总时长] 内，防越界 */
function seek(sec) {
  if (ctx && ctx.duration > 0) {
    ctx.seek(Math.max(0, Math.min(sec, ctx.duration)))
  }
}

/** 当前是否有播放中的音频 */
function hasCurrent() {
  return !!current
}

module.exports = { play, pause, stop, toggle, seek, on, getState, hasCurrent }
