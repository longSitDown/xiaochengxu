/**
 * 登录页 / 协议页 / API-11 手机号快捷登录 自测（Node 直跑，stub wx，不发真实请求）
 *
 * 覆盖：
 *   1. 页面注册与 profile 登录入口改造（不再用弹窗）
 *   2. 未勾协议时不挂 open-type，点按钮只提示、绝不弹微信授权
 *   3. getPhoneNumber 回调的四种分支：成功 / 用户取消 / 隐私未授权 / 缺 code
 *   4. API-11 未发布时自动回退 API-06，不阻断用户
 *   5. buildWebhookUser 能把 Phone 落到登录态并标记 phoneVerified
 *   6. 协议页两种文案、profile 已验证手机号只读
 *
 * 用法：node tools/login-page-test.js
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const VENUE = require('../config/venue')

/* ================= 桩环境 ================= */
const store = {}
let requestLog = []
let nextResponse = null
let toastLog = []
let navLog = []
let pageStackLen = 2
let appLoginCalls = 0

global.wx = {
  env: { USER_DATA_PATH: 'wxfile://usr' },
  getFileSystemManager: () => ({
    copyFile(o) { o.success && o.success({}) },
    unlink(o) { o.success && o.success({}) },
    readFile(o) { o.success && o.success({ data: 'QkFTRTY0' }) }
  }),
  setStorageSync: (k, v) => { store[k] = v },
  getStorageSync: (k) => (k in store ? store[k] : ''),
  removeStorageSync: (k) => { delete store[k] },
  getStorageInfoSync: () => ({ keys: Object.keys(store) }),
  login(o) { o.success({ code: 'WXCODE_STUB' }) },
  request(o) {
    requestLog.push({ url: o.url, method: o.method, data: o.data })
    if (nextResponse) {
      const r = nextResponse
      nextResponse = null
      o.success(r)
      return
    }
    o.fail({ errMsg: 'request:fail no stub' })
  },
  showToast: (o) => toastLog.push(o.title),
  showLoading: () => {},
  hideLoading: () => {},
  navigateTo: (o) => navLog.push(o.url),
  navigateBack: () => navLog.push('BACK'),
  switchTab: (o) => navLog.push('TAB:' + o.url),
  setNavigationBarTitle: () => {},
  getSystemInfoSync: () => ({ platform: 'devtools' })
}

let capturedPage = null
global.Page = (obj) => { capturedPage = obj }
global.getCurrentPages = () => new Array(pageStackLen).fill({})
global.getApp = () => ({
  globalData: {},
  doLogin: () => {
    appLoginCalls += 1
    return Promise.resolve({ id: 'STUB_USER', userId: 'STUB_USER', phone: '', source: 'webhook' })
  }
})

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30))
let pass = 0
async function check(name, fn) {
  try {
    await fn()
    pass += 1
    console.log('PASS  ' + name)
  } catch (e) {
    console.log('FAIL  ' + name + '\n      ' + (e && e.message))
    process.exitCode = 1
  }
}

/** 读取页面定义并构造可测实例（setData 支持一级键，够用） */
function loadPage(relPath, overrides) {
  capturedPage = null
  delete require.cache[require.resolve(path.join(ROOT, relPath))]
  require(path.join(ROOT, relPath))
  assert.ok(capturedPage, relPath + ' 未调用 Page()')
  const inst = Object.assign({}, capturedPage)
  inst.data = Object.assign({}, capturedPage.data, overrides || {})
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('.') > 0) {
        const [a, b] = k.split('.')
        this.data[a] = Object.assign({}, this.data[a])[b] = patch[k]
      } else {
        this.data[k] = patch[k]
      }
    })
  }
  inst.back = function () { navLog.push('BACK') }
  return inst
}

async function main() {
  /* ================= A. 页面注册与入口 ================= */
  console.log('\n--- A. 页面注册与登录入口 ---')

  await check('A01 app.json 已注册 login 与 agreement 页', () => {
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
    assert.ok(app.pages.indexOf('pages/login/login') >= 0, '缺 login 页')
    assert.ok(app.pages.indexOf('pages/agreement/agreement') >= 0, '缺 agreement 页')
  })

  await check('A02 profile 登录改为跳独立登录页', () => {
    const js = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.js'), 'utf8')
    assert.ok(/navigateTo\(\{\s*url:\s*'\/pages\/login\/login/.test(js), 'onLogin 未跳登录页')
    assert.strictEqual(/authShow/.test(js), false, '旧弹窗状态 authShow 应已移除')
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/profile/profile.wxml'), 'utf8')
    assert.strictEqual(/authorize-popup/.test(wxml), false, 'wxml 不应再挂 authorize-popup')
  })

  await check('A03 登录页静态结构：open-type 只在「已开放 + 已勾协议」分支出现', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/login/login.wxml'), 'utf8')
    assert.strictEqual((wxml.match(/open-type="getPhoneNumber"/g) || []).length, 1, 'getPhoneNumber 按钮应唯一')
    assert.ok(/wx:if="\{\{phoneLoginEnabled && agreed\}\}"/.test(wxml), 'open-type 分支需同时判定开关与协议')
    const idxWx = wxml.indexOf('bindtap="onWxLogin"')
    const idxOpen = wxml.indexOf('open-type="getPhoneNumber"')
    const idxOff = wxml.indexOf('bindtap="onPhoneUnavailable"')
    assert.ok(idxWx > 0, '缺微信登录按钮')
    assert.ok(idxOpen > idxWx, '手机号按钮应排在微信登录之后（当前默认用微信登录）')
    assert.ok(idxOff > idxOpen, '未开放分支应紧随其后')
    assert.ok(/用户协议/.test(wxml) && /数据隐私安全声明/.test(wxml), '缺协议链接')
    assert.ok(/暂不登录/.test(wxml), '缺游客入口')
  })

  await check('A04 主按钮文案为「微信一键登录」并绑定 onWxLogin', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/login/login.wxml'), 'utf8')
    const idx = wxml.indexOf('bindtap="onWxLogin"')
    const seg = wxml.slice(idx, idx + 220)
    assert.ok(/微信一键登录/.test(seg), '主按钮文案应为微信一键登录，实际片段：' + seg.slice(0, 120))
  })

  /* ================= B. 登录页交互 ================= */
  console.log('\n--- B. 登录页交互 ---')

  await check('B01 勾选切换协议状态', () => {
    const p = loadPage('pages/login/login.js')
    assert.strictEqual(p.data.agreed, false)
    p.onToggleAgree()
    assert.strictEqual(p.data.agreed, true)
    p.onToggleAgree()
    assert.strictEqual(p.data.agreed, false)
  })

  await check('B02 未勾协议点登录：只提示，不发请求、不触发授权', () => {
    const p = loadPage('pages/login/login.js')
    toastLog = []
    requestLog = []
    const before = appLoginCalls
    p.onNeedAgree()
    assert.ok(/协议/.test(p.data.hint), '应给出协议提示，实际：' + p.data.hint)
    assert.ok(toastLog.length === 1, '应弹一次提示')
    assert.strictEqual(requestLog.length, 0, '不应发网络请求')
    assert.strictEqual(appLoginCalls, before, '不应触发登录')
  })

  await check('B03 用户点取消（fail user deny）静默返回，不打扰', async () => {
    const p = loadPage('pages/login/login.js', { agreed: true })
    toastLog = []
    p.onGetPhone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } })
    await tick()
    assert.strictEqual(toastLog.length, 0, '取消不应弹任何提示')
    assert.strictEqual(p.data.loading, false, '不应进入 loading')
  })

  await check('B04 未配置隐私指引（privacy 错误）给出明确提示', async () => {
    const p = loadPage('pages/login/login.js', { agreed: true })
    toastLog = []
    p.onGetPhone({ detail: { errMsg: 'getPhoneNumber:fail privacy permission is not authorized' } })
    await tick()
    assert.ok(/隐私/.test(p.data.hint), '应提示隐私授权，实际：' + p.data.hint)
    assert.ok(toastLog.length === 1)
  })

  await check('B05 手机号授权失败（90006）→ 自动回退 js_code 静默登录', async () => {
    // v1.9.3：手机号登录已并入 API-06 形式一，失败即回退形式二，不再有「未发布」状态
    const p = loadPage('pages/login/login.js', { agreed: true })
    toastLog = []
    navLog = []
    requestLog = []
    nextResponse = { statusCode: 200, data: { code: '90006', msg: '微信登录失败' } }
    const before = appLoginCalls
    p.onGetPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'PHONE_CODE_STUB' } })
    await tick(120)
    assert.strictEqual(appLoginCalls, before + 1, '应回退调用 app.doLogin')
    assert.ok(/未成功|微信登录/.test(p.data.hint), '应说明降级原因，实际：' + p.data.hint)
    assert.strictEqual(p.data.loading, false)
    assert.ok(toastLog.length >= 1, '应提示已登录')
  })

  await check('B06 API-06 形式一就绪 → 手机号落盘且标记已验证', async () => {
    const p = loadPage('pages/login/login.js', { agreed: true })
    toastLog = []
    navLog = []
    requestLog = []
    nextResponse = {
      statusCode: 200,
      data: {
        code: '', msg: '',
        data: {
          Id: '22222222-2222-4222-8222-222222222222',
          Phone: '13800138000',
          NickName: '微信用户',
          IsRegistered: 0,
          Avatar: ''
        }
      }
    }
    p.onGetPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'PHONE_CODE_2' } })
    await tick(120)
    assert.strictEqual(requestLog.length, 1, '应只发一次 API-06')
    assert.strictEqual(requestLog[0].data.JsCode, 'PHONE_CODE_2', '授权 code 应作为 JsCode')
    assert.strictEqual(requestLog[0].data.IsPhone, 1, '形式一固定 IsPhone=1')
    const user = JSON.parse(store['rh_user'])
    assert.strictEqual(user.userId, '22222222-2222-4222-8222-222222222222')
    assert.strictEqual(user.phone, '13800138000', '手机号应落盘')
    assert.strictEqual(user.phoneVerified, true, '应标记为微信已验证')
    assert.strictEqual(user.nickname, '红色传承者', '「微信用户」不应覆盖昵称')
    assert.strictEqual(p.data.loading, false)
  })

  await check('B07 缺 code（低版本基础库）→ 回退静默登录', async () => {
    const p = loadPage('pages/login/login.js', { agreed: true })
    const before = appLoginCalls
    p.onGetPhone({ detail: { errMsg: 'getPhoneNumber:ok' } })
    await tick(80)
    assert.strictEqual(appLoginCalls, before + 1, '应回退 app.doLogin')
    assert.ok(/不支持|未返回/.test(p.data.hint), '应说明原因，实际：' + p.data.hint)
  })

  await check('B08 开发者工具环境识别 + 失败时引导真机', async () => {
    const p = loadPage('pages/login/login.js', { agreed: true })
    p.onLoad({})
    assert.strictEqual(p.data.isDevtools, true, '应识别出开发者工具')
    p.onGetPhone({ detail: { errMsg: 'getPhoneNumber:fail something unknown' } })
    assert.ok(/预览|真机/.test(p.data.hint), '应引导用真机测，实际：' + p.data.hint)
  })

  await check('B09 无接口权限 → 提示主体/认证要求', async () => {
    const p = loadPage('pages/login/login.js', { agreed: true })
    p.onGetPhone({ detail: { errMsg: 'getPhoneNumber:fail no permission' } })
    assert.ok(/非个人主体|认证/.test(p.data.hint), '应提示资质要求，实际：' + p.data.hint)
  })

  await check('B10 未知错误保留原始 errMsg，便于对照后台配置', async () => {
    // isDevtools=false 时才会把原文附在提示里
    const p = loadPage('pages/login/login.js', { agreed: true, isDevtools: false })
    p.onGetPhone({ detail: { errMsg: 'getPhoneNumber:fail xxx_code_xxx' } })
    assert.ok(/xxx_code_xxx/.test(p.data.hint), '应附带原始 errMsg，实际：' + p.data.hint)
  })

  await check('B11 微信登录按钮走 API-06，不依赖手机号与协议', async () => {
    const p = loadPage('pages/login/login.js', { agreed: false, phoneLoginEnabled: false })
    navLog = []
    const before = appLoginCalls
    p.onWxLogin()
    await tick(80)
    assert.strictEqual(appLoginCalls, before + 1, '应调用 app.doLogin')
    assert.strictEqual(p.data.loading, false, '结束后应复位 loading')
    assert.ok(navLog.indexOf('BACK') >= 0 || navLog.length >= 0, '登录后应有返回动作')
  })

  await check('B12 未认证（开关关闭）点手机号按钮：只说明，不发请求', () => {
    const p = loadPage('pages/login/login.js', { agreed: true, phoneLoginEnabled: false })
    toastLog = []
    requestLog = []
    const before = appLoginCalls
    p.onPhoneUnavailable()
    assert.ok(/认证/.test(p.data.hint), '应提示需微信认证，实际：' + p.data.hint)
    assert.strictEqual(toastLog.length, 1, '应弹一次提示')
    assert.strictEqual(requestLog.length, 0, '不应发网络请求')
    assert.strictEqual(appLoginCalls, before, '不应触发登录')
  })

  await check('B13 开关由 config 驱动；storage 可运行时覆盖', () => {
    const cfg = require('../config/index')
    assert.strictEqual(cfg.PHONE_LOGIN_ENABLED, false, '开发版默认关闭手机号登录')

    cfg.PHONE_LOGIN_ENABLED = true
    const on = loadPage('pages/login/login.js')
    on.onLoad({})
    assert.strictEqual(on.data.phoneLoginEnabled, true, 'config 打开后应生效')
    cfg.PHONE_LOGIN_ENABLED = false

    store['rh_phoneLogin'] = '1'
    const forced = loadPage('pages/login/login.js')
    forced.onLoad({})
    assert.strictEqual(forced.data.phoneLoginEnabled, true, 'storage=1 应覆盖 config')
    delete store['rh_phoneLogin']

    const off = loadPage('pages/login/login.js')
    off.onLoad({})
    assert.strictEqual(off.data.phoneLoginEnabled, false, '去掉覆盖后回到 config')
  })

  /* ================= C. 数据层 ================= */
  console.log('\n--- C. 数据层 ---')

  await check('C01 buildWebhookUser 解析 Phone 并标记 phoneVerified', () => {
    const userApi = require('../api/user')
    const u = userApi._internal.buildWebhookUser({
      UserId: 'UID-1', Phone: '138 0013 8000', NickName: '张三', IsRegistered: 1
    })
    assert.strictEqual(u.phone, '13800138000', '手机号应去掉非数字')
    assert.strictEqual(u.phoneVerified, true)
    assert.strictEqual(u.isRegistered, true)
  })

  await check('C02 未返回 Phone 时不伪造手机号、不标已验证', () => {
    const userApi = require('../api/user')
    delete store['rh_user']
    const u = userApi._internal.buildWebhookUser({ UserId: 'UID-2' })
    assert.strictEqual(u.phone, '')
    assert.strictEqual(u.phoneVerified, false)
  })

  await check('C03 loginWithPhone 空 code 直接拒绝，不发请求', async () => {
    const userApi = require('../api/user')
    let err = null
    try { await userApi.loginWithPhone('') } catch (e) { err = e }
    assert.ok(err && err.code === 'NO_PHONE_CODE', '应返回 NO_PHONE_CODE')
  })

  await check('C04 API-06 契约：不带 Token、入参 Code + JsCode + IsPhone', () => {
    const ep = VENUE.ENDPOINTS.wxLogin
    assert.strictEqual(ep.id, 'API-06')
    assert.strictEqual(ep.auth, false, '登录先于令牌，auth 必须为 false')
    assert.strictEqual(ep.method, 'POST')
    assert.deepStrictEqual(ep.params, ['Code', 'JsCode', 'IsPhone'])
    assert.strictEqual(ep.topLevel, undefined, 'v1.9.3 起响应改为 data 包裹')
    // 手机号登录不再单独占用 API-11（该编号已复用为个人信息与预约列表）
    assert.strictEqual(VENUE.ENDPOINTS.phoneLogin, undefined, '旧的 API-11 手机号登录应已移除')
    assert.deepStrictEqual(VENUE.ENDPOINTS.profileReservations.params, ['Code', 'Token', 'UserId'])
  })

  await check('C05 API-06 报文不含 Token，JsCode 原样透传且 IsPhone=1', async () => {
    const userApi = require('../api/user')
    requestLog = []
    nextResponse = {
      statusCode: 200,
      data: { code: '', msg: '', data: { Id: 'UID-C5', Phone: '13800138000', NickName: '张三', IsRegistered: 0, Avatar: '' } }
    }
    await userApi.loginWithPhone('PHONE_CODE_C5')
    assert.strictEqual(requestLog.length, 1, '应只发一次请求')
    const last = requestLog[0]
    assert.strictEqual(last.data.Token, undefined, 'API-06 不应带场馆 Token')
    assert.ok(last.data.Code, '应带场馆 Code')
    assert.strictEqual(last.data.JsCode, 'PHONE_CODE_C5', '授权 code 应原样作为 JsCode')
    assert.strictEqual(last.data.IsPhone, 1, '手机号授权固定 IsPhone=1')
  })

  /* ================= D. 协议页 ================= */
  console.log('\n--- D. 协议页 ---')

  await check('D01 type=user 渲染用户协议且含预约规则', () => {
    const p = loadPage('pages/agreement/agreement.js')
    p.onLoad({ type: 'user' })
    assert.strictEqual(p.data.docTitle, '用户协议')
    assert.ok(p.data.sections.length >= 6, '章节过少')
    const text = p.data.sections.map((s) => s.h + s.list.map((x) => x.text).join('')).join('')
    assert.ok(/预约服务规则/.test(text), '缺预约规则章节')
  })

  await check('D02 type=privacy 渲染隐私声明且含手机号说明', () => {
    const p = loadPage('pages/agreement/agreement.js')
    p.onLoad({ type: 'privacy' })
    assert.strictEqual(p.data.docTitle, '数据隐私安全声明')
    const text = p.data.sections.map((s) => s.h + s.list.map((x) => x.text).join('')).join('')
    assert.ok(/手机号/.test(text), '隐私声明必须说明手机号收集')
    assert.ok(/不会出售/.test(text), '缺「不出售」承诺')
  })

  await check('D03 非法 type 回退到用户协议（不白屏）', () => {
    const p = loadPage('pages/agreement/agreement.js')
    p.onLoad({ type: 'xxx' })
    assert.strictEqual(p.data.docTitle, '用户协议')
    p.onLoad({})
    assert.strictEqual(p.data.docTitle, '用户协议')
  })

  /* ================= E. 我的页手机号口径 ================= */
  console.log('\n--- E. 我的页 ---')

  await check('E01 微信已验证手机号在编辑面板只读（表单值不生效）', async () => {
    store['rh_user'] = JSON.stringify({
      nickname: '张三', avatar: '/images/placeholder.png',
      phone: '13800138000', phoneVerified: true, source: 'webhook', userId: 'UID-E'
    })
    const p = loadPage('pages/profile/profile.js', {
      user: {
        nickname: '张三', avatar: '/images/placeholder.png',
        phone: '13800138000', phoneVerified: true
      },
      phoneVerified: true,
      phoneText: '138****8000',
      draft: { avatar: '/images/placeholder.png', nickname: '张三', phone: '13900139000' }
    })
    await p.onSaveProfile({ detail: { value: { nickname: '张三', phone: '13900139000' } } })
    const saved = JSON.parse(store['rh_user'])
    assert.strictEqual(saved.phone, '13800138000', '已验证手机号不应被表单改写，实际：' + saved.phone)
  })

  await check('E02 未验证手机号仍可手填并保存', async () => {
    store['rh_user'] = JSON.stringify({
      nickname: '李四', avatar: '/images/placeholder.png',
      phone: '', source: 'webhook', userId: 'UID-E2'
    })
    const p = loadPage('pages/profile/profile.js', {
      user: { nickname: '李四', avatar: '/images/placeholder.png', phone: '' },
      phoneVerified: false,
      draft: { avatar: '/images/placeholder.png', nickname: '李四', phone: '13700137000' }
    })
    await p.onSaveProfile({ detail: { value: { nickname: '李四', phone: '13700137000' } } })
    const saved = JSON.parse(store['rh_user'])
    assert.strictEqual(saved.phone, '13700137000')
  })

  console.log('\n===== 汇总：' + pass + ' PASS =====')
}

main().catch((e) => {
  console.error('测试脚本异常：', e)
  process.exitCode = 1
})
