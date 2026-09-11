/**
 * 本地存储封装（统一 JSON 序列化，避免散落 try/catch）
 */

const PREFIX = 'rh_' // red-hall 前缀，防止与其它小程序数据冲突

function keyOf(k) {
  return PREFIX + k
}

// 读取：自动反序列化 JSON；非字符串(已存对象)或读不到时返回 fallback，读取失败也回退
function getItem(key, fallback) {
  try {
    const raw = wx.getStorageSync(keyOf(key))
    if (raw === '' || raw == null) return fallback
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (e) {
    return fallback
  }
}

// 写入：统一序列化为字符串，失败(如容量超限)返回 false 供调用方感知
function setItem(key, value) {
  try {
    wx.setStorageSync(keyOf(key), JSON.stringify(value))
    return true
  } catch (e) {
    return false
  }
}

function removeItem(key) {
  try {
    wx.removeStorageSync(keyOf(key))
  } catch (e) {
    /* ignore */
  }
}

/** 清空所有本应用前缀的存储（不误删其它小程序的 Key） */
function clearAll() {
  try {
    const info = wx.getStorageInfoSync()
    ;(info.keys || []).forEach((k) => {
      if (k.indexOf(PREFIX) === 0) wx.removeStorageSync(k)
    })
  } catch (e) {
    /* ignore */
  }
}

module.exports = { getItem, setItem, removeItem, clearAll }
