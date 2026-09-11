/**
 * 用户服务：登录态管理
 *
 * mock 模式：首次进入生成本地演示用户（id 固定 demo_user，与种子预约/反馈数据关联），
 *            后续从本地存储读取，支持昵称、头像修改。
 * 真实模式：wx.login 获取 code，交由后端（明道云工作流或自有代理）换取 openid，
 *            再读取/创建 users 工作表记录。切换时仅需实现 realLogin 分支。
 */
const config = require('../config/index')
const storage = require('../utils/storage')

const USER_KEY = 'user'

/** 当前用户（无登录态返回 null） */
function getUser() {
  return storage.getItem(USER_KEY, null)
}

function saveUser(user) {
  storage.setItem(USER_KEY, user)
  return user
}

/**
 * 登录（mock 模式本地模拟；真实模式微信 code 换 openid）
 * @returns {Promise<{id, openid, nickname, avatar, phone}>}
 */
function login() {
  if (config.USE_MOCK) {
    return mockLogin()
  }
  return realLogin()
}

function mockLogin() {
  return new Promise((resolve) => {
    let user = getUser()
    if (!user) {
      // 首次进入生成演示用户：id 固定 demo_user（关联虚拟人/种子数据），openid 随机生成
      user = saveUser({
        id: 'demo_user',
        openid: 'mock_openid_' + Math.random().toString(36).slice(2, 10),
        nickname: '红色传承者',
        avatar: '/images/placeholder.png',
        phone: '13800138000'
      })
    }
    resolve(user)
  })
}

/** 真实登录：wx.login → 后端换 openid → 拉取/建档（对接明道云时实现） */
function realLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        console.log('wx.login success', res)
        if (!res.code) {
          reject({ code: -1, message: '微信登录失败' })
          return
        }
        // TODO: 对接明道云：
        // 1. POST 自有后端 /auth/login { code } → { openid, token }
        // 2. 读取 users 工作表（POST /v3/app/worksheets/users/rows/list，filters: openid eq）
        // 3. 不存在则新建用户行，返回完整用户对象
        reject({ code: -1, message: '真实登录通道待对接明道云后实现' })
      },
      fail() {
        reject({ code: -1, message: '微信登录失败' })
      }
    })
  })
}

/** 更新当前用户资料（昵称/头像/手机号） */
function updateUser(patch) {
  const user = getUser()
  if (!user) return null
  return saveUser(Object.assign({}, user, patch))
}

/** 退出登录 */
function logout() {
  storage.removeItem(USER_KEY)
}

/**
 * 重置演示数据：清空本地用户态与 mock 数据库增量（恢复初始种子）
 * 供演示后一键重置，重新生成初始演示用户和数据。
 */
function resetMockData() {
  storage.removeItem(USER_KEY)
  const db = require('./mock/db')
  db.resetDb()
}

module.exports = { login, getUser, updateUser, logout, resetMockData }
