/**
 * API-06 微信登录链路自测（Node 直跑，stub wx，不发真实网络请求）
 *
 * 覆盖：
 *   1. 登录请求打到明道云 Webhook，绝不请求 localhost:3000
 *   2. 入参 Code + JsCode + IsPhone、不带 Token（API-06 v1.9.3 契约）
 *   3. 游客档案 UserId 落盘为身份，不写后端 authToken
 *   4. 并发去重 / ensureLogin 缓存命中 / isTokenAlive 语义
 *   5. 40029 等失败码映射中文提示，且 pending 释放后可重试
 *   6. 资料与头像在 webhook 模式走本地，不打 server
 *
 * 2026-11-11 起以线上实测结构为准：{ code, msg, UserId, NickName, IsRegistered, Avatar }
 * （不再有 OpenId / AvatarUrl；OpenId 仅作旧契约兼容）
 *
 * 用法：node tools/login-webhook-test.js
 */
const assert = require('assert')
const VENUE = require('../config/venue')

const store = {}
let loginCalls = 0
let requestLog = []
let nextResponse = null
let downloadLog = []
let downloadFail = false

/** 线上契约成功态结构（v1.9.4 起 data 包裹，Avatar 为 base64 字符串） */
const LIVE_ID = '11111111-1111-4111-8111-111111111111'
// 长度 ≥128 且为 base64 字符集，满足 isBase64Avatar 判定
const AVATAR_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const LIVE_OK = {
  code: '',
  msg: '',
  data: {
    Id: LIVE_ID,
    NickName: '测试游客',
    Avatar: AVATAR_B64,
    Phone: '13800001111',
    IsRegistered: 1
  }
}

// 本地文件系统桩：验证 chooseAvatar 临时路径被落盘到 USER_DATA_PATH
const USER_DIR = 'wxfile://usr'
let fsLog = []
let copyFail = false
const fsStub = {
  copyFile(o) {
    fsLog.push({ op: 'copy', src: o.srcPath, dest: o.destPath })
    if (copyFail) { o.fail && o.fail({ errMsg: 'copyFile:fail' }); return }
    o.success && o.success({})
  },
  unlink(o) {
    fsLog.push({ op: 'unlink', path: o.filePath })
    o.success && o.success({})
  },
  readFile(o) { o.success && o.success({ data: 'BASE64' }) },
  writeFile(o) {
    fsLog.push({ op: 'write', path: o.filePath })
    if (copyFail) { o.fail && o.fail({ errMsg: 'writeFile:fail' }); return }
    o.success && o.success({})
  }
}

global.wx = {
  env: { USER_DATA_PATH: USER_DIR },
  getFileSystemManager: () => fsStub,
  setStorageSync: (k, v) => { store[k] = v },
  getStorageSync: (k) => (k in store ? store[k] : ''),
  removeStorageSync: (k) => { delete store[k] },
  getStorageInfoSync: () => ({ keys: Object.keys(store) }),
  login(o) {
    loginCalls += 1
    o.success({ code: 'WXCODE_' + loginCalls })
  },
  request(o) {
    requestLog.push({ url: o.url, method: o.method, data: o.data })
    if (nextResponse) {
      const r = nextResponse
      nextResponse = null
      o.success(r)
      return
    }
    // API-01 签令牌：顶层 { code, token, expired }
    if (o.url.indexOf(VENUE.HOOK_TOKEN) === 0) {
      o.success({ statusCode: 200, data: { code: '', msg: '', token: 'STUB_TOKEN', expired: 7200 } })
      return
    }
    // API-10 更新用户信息：顶层 { code, msg }
    if (o.url.indexOf(VENUE.ENDPOINTS.updateUser.url) === 0) {
      o.success({ statusCode: 200, data: { code: '', msg: '更新成功' } })
      return
    }
    // API-06 成功态（v1.6.0 实测）：顶层 UserId / NickName / IsRegistered / Avatar
    o.success({ statusCode: 200, data: Object.assign({}, LIVE_OK) })
  },
  downloadFile(o) {
    downloadLog.push(o.url)
    if (downloadFail) { o.fail && o.fail({ errMsg: 'downloadFile:fail' }); return }
    o.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_downloaded.png' })
  },
  showToast() {},
  showLoading() {},
  hideLoading() {}
}

let pass = 0
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log('[PASS] ' + name) })
    .catch((e) => { console.log('[FAIL] ' + name + ' → ' + (e && e.message ? e.message : e)); process.exitCode = 1 })
}

async function main() {
  const config = require('../config/index')
  config.LOGIN_MODE = 'webhook'
  config.USE_MOCK = true
  const userApi = require('../api/user')

  await check('L01 登录打到 API-06 Webhook，不请求 localhost:3000', async () => {
    const u = await userApi.login()
    const r = requestLog[0]
    assert.strictEqual(loginCalls, 1, '应调用一次 wx.login')
    assert.strictEqual(requestLog.length, 1, '应只发一次网络请求')
    assert.strictEqual(r.method, 'POST')
    assert.strictEqual(r.url, VENUE.ENDPOINTS.wxLogin.url, '应打到 API-06 端点')
    assert.ok(r.url.indexOf('localhost:3000') < 0, '不应请求自有后端')
    assert.ok(r.url.indexOf('/api/auth/login') < 0, '不应请求旧登录路由')
    assert.strictEqual(r.data.Code, VENUE.DEFAULT_CODE, '应注入场馆 Code')
    assert.strictEqual(r.data.JsCode, 'WXCODE_1', '应携带 wx.login 的 code')
    assert.strictEqual(r.data.IsPhone, 0, '形式二固定 IsPhone=0')
    assert.strictEqual(r.data.WxCode, undefined, 'WxCode 已随 1.9.3 移除')
    assert.strictEqual(r.data.Token, undefined, 'API-06 不应带场馆 Token')
    assert.strictEqual(u.userId, LIVE_ID, '应保存游客档案 Id')
    assert.strictEqual(u.nickname, '测试游客')
    // Avatar 是 base64：落盘成本地文件后只存路径，storage 里不留 base64
    assert.ok(u.avatar.indexOf(USER_DIR + '/avatar_') === 0, 'base64 头像应落盘为本地文件，实际：' + u.avatar)
    assert.ok(u.avatarSig, '应记录头像指纹用于重登去重')
    // 只允许存「长度+前缀」的指纹，整段 base64 不得进 storage
    assert.strictEqual(JSON.stringify(store).indexOf(AVATAR_B64.slice(-40)), -1, 'base64 不得写入 storage')
    assert.strictEqual(u.phone, '13800001111', '应保存平台手机号')
    assert.strictEqual(u.phoneVerified, true, 'API-06 返回手机号即视为已验证')
    assert.strictEqual(u.isRegistered, true, 'IsRegistered=1 应转为布尔')
    assert.strictEqual(u.id, LIVE_ID, 'id 应为游客档案 Id，不再是 demo_user')
    assert.strictEqual(userApi.getUserId(), LIVE_ID, 'getUserId 供 API-05/09/11 使用')
    assert.strictEqual(userApi.getBizId(), 'demo_user', '业务关联键仍为 demo_user，mock 数据不丢')
  })

  await check('L02 webhook 模式不写后端 token，isTokenAlive 基于 UserId', () => {
    assert.strictEqual(store['rh_authToken'], undefined, '不应写入 authToken')
    assert.strictEqual(store['rh_authExpire'], undefined, '不应写入 authExpire')
    assert.strictEqual(userApi.isTokenAlive(), true, '有 UserId 即视为有效')
  })

  await check('L03 ensureLogin 命中缓存，不再发起请求', async () => {
    const before = loginCalls
    const u = await userApi.ensureLogin()
    assert.strictEqual(u.userId, LIVE_ID)
    assert.strictEqual(loginCalls, before, '不应重复调用 wx.login')
    assert.strictEqual(requestLog.length, 1, '不应重复发请求')
  })

  await check('L04 并发登录去重（清缓存后 3 个并发只换一次 code）', async () => {
    userApi.logout()
    loginCalls = 0
    requestLog = []
    const list = await Promise.all([userApi.login(), userApi.login(), userApi.login()])
    assert.strictEqual(loginCalls, 1, '并发应合并为一次 wx.login')
    assert.strictEqual(requestLog.length, 1, '并发应合并为一次 API-06')
    assert.ok(list.every((u) => u.userId === LIVE_ID))
  })

  await check('L05 40029 透传时映射中文提示，且 pending 释放可重试', async () => {
    // 实测：失败分支仍会返回 UserId，但 code=40029 必须判失败，不能当成登录成功
    nextResponse = {
      statusCode: 200,
      data: { code: '40029', msg: 'invalid code', UserId: '22222222-2222-4222-8222-222222222222', NickName: '微信用户', IsRegistered: 0, Avatar: '' }
    }
    let err = null
    try { await userApi.refreshLogin() } catch (e) { err = e }
    assert.ok(err, '应抛出错误')
    assert.strictEqual(String(err.code), '40029')
    assert.ok(/重新登录|凭证/.test(err.message), '应给出中文提示，实际：' + err.message)
    const u = await userApi.refreshLogin()
    assert.strictEqual(u.userId, LIVE_ID, '失败后重试应成功')
  })

  await check('L06 只改手机号不发请求；头像落盘到本地用户目录', async () => {
    const before = requestLog.length
    const u = await userApi.updateUser({ phone: '13700000000' })
    assert.strictEqual(u.phone, '13700000000')
    assert.strictEqual(requestLog.length, before, '手机号无接口字段，不应产生请求')
    fsLog = []
    const p = await userApi.uploadAvatar('wxfile://tmp_avatar.png')
    assert.ok(p.indexOf(USER_DIR + '/avatar_') === 0, '临时头像应落盘到本地用户目录，实际：' + p)
    assert.strictEqual(fsLog.filter((x) => x.op === 'copy').length, 1, '应复制一份本地持久化文件')
    assert.strictEqual(requestLog.length, before, 'uploadAvatar 在 webhook 模式不应产生后端请求')
  })

  await check('L13 改昵称 → API-10：query 带 Code/Token/UserId，body 带 NickName + Avatar(base64)', async () => {
    const before = requestLog.length
    downloadLog = []
    const u = await userApi.updateUser({ nickname: '新昵称' })
    assert.strictEqual(u.nickname, '新昵称')
    const calls = requestLog.slice(before).filter((r) => r.url.indexOf(VENUE.ENDPOINTS.updateUser.url) === 0)
    assert.strictEqual(calls.length, 1, '应恰好调用一次 API-10')
    const r = calls[0]
    assert.strictEqual(r.method, 'POST')
    // 混合传参：鉴权走 query，业务字段走 body
    assert.ok(r.url.indexOf('UserId=' + encodeURIComponent(LIVE_ID)) >= 0, 'query 应带 UserId')
    assert.ok(r.url.indexOf('Token=STUB_TOKEN') >= 0, 'query 应带 Token')
    assert.ok(r.url.indexOf('Code=' + VENUE.DEFAULT_CODE) >= 0, 'query 应带 Code')
    assert.strictEqual(r.data.NickName, '新昵称')
    assert.strictEqual(typeof r.data.Avatar, 'string')
    assert.ok(r.data.Avatar.length > 0, 'Avatar 必填，不能为空')
    assert.ok(r.data.Avatar.indexOf('data:') !== 0, 'Avatar 不能带 data: 前缀')
    assert.strictEqual(r.data.UserId, undefined, 'UserId 不应重复出现在 body')
    assert.ok(r.url.indexOf('localhost:3000') < 0, '不应请求自有后端')
  })

  await check('L14 头像来源：内置占位图直出 base64；本地文件 readFile；远程 URL 先下载', async () => {
    const I = userApi._internal
    const inner = await I.avatarToBase64('/images/placeholder.png')
    assert.strictEqual(inner, I.PLACEHOLDER_AVATAR_BASE64, '内置占位图应复用同一张 base64')
    assert.strictEqual(I.PLACEHOLDER_AVATAR_BASE64.slice(0, 6), 'iVBORw', '应为 PNG base64')

    const local = await I.avatarToBase64(USER_DIR + '/avatar_1.png')
    assert.strictEqual(local, 'BASE64', '本地文件应走 readFile')

    downloadLog = []
    downloadFail = false
    const remote = await I.avatarToBase64('https://wx.qlogo.cn/a/132')
    assert.deepStrictEqual(downloadLog, ['https://wx.qlogo.cn/a/132'], '远程头像应先 downloadFile')
    assert.strictEqual(remote, 'BASE64', '下载后应读成 base64')

    // 下载失败 / 读文件失败都必须退回占位图，否则 API-10 的 Avatar 必填校验会拦
    downloadFail = true
    const fallback = await I.avatarToBase64('https://wx.qlogo.cn/b/132')
    assert.strictEqual(fallback, I.PLACEHOLDER_AVATAR_BASE64, '下载失败应退回占位图')
    downloadFail = false

    assert.strictEqual(I.stripDataPrefix('data:image/png;base64,AAA'), 'AAA', '应剥掉 data: 前缀')
    assert.strictEqual(I.stripDataPrefix('AAA'), 'AAA')
  })

  await check('L15 无 UserId 身份（旧 openid-only 缓存）保存资料 → 提示重新登录，且不落库', async () => {
    userApi.logout()
    store['rh_user'] = JSON.stringify({
      id: 'oOLD',
      openid: 'oOLD',
      source: 'webhook',
      identityFromOpenId: true,
      nickname: '旧身份',
      avatar: '/images/placeholder.png'
    })
    let err = null
    try { await userApi.updateUser({ nickname: '改不动' }) } catch (e) { err = e }
    assert.ok(err && err.code === 'NO_USER', '应返回 NO_USER')
    assert.ok(/重新登录/.test(err.message), '应提示重新登录，实际：' + err.message)
    assert.strictEqual(userApi.getUser().nickname, '旧身份', '同步失败不应写本地')
  })

  await check('L16 API-10 业务错误（90020）会抛出且不写本地', async () => {
    userApi.logout()
    const ok = await userApi.login()
    assert.strictEqual(ok.userId, LIVE_ID)
    nextResponse = { statusCode: 200, data: { code: '90020', msg: '用户不存在' } }
    let err = null
    try { await userApi.updateUser({ nickname: '不应保存' }) } catch (e) { err = e }
    assert.ok(err, '应抛出错误')
    assert.strictEqual(String(err.code), '90020')
    assert.ok(/游客|用户/.test(err.message), '应给出中文提示，实际：' + err.message)
    assert.strictEqual(userApi.getUser().nickname, '测试游客', '失败不应污染本地资料')
  })

  await check('L07 logout 清除登录态', () => {
    userApi.logout()
    assert.strictEqual(userApi.getUser(), null)
    assert.strictEqual(userApi.isTokenAlive(), false)
  })

  await check('L08 兼容早期平铺 OpenId 响应（session_key 不落盘）', async () => {
    userApi.logout()
    loginCalls = 0
    requestLog = []
    // 早期封装业务流程曾直接回微信原生平铺结构；线上已改为 UserId，这里只验兼容不炸
    nextResponse = {
      statusCode: 200,
      data: {
        openid: 'oFLAT_openid_002',
        session_key: 'SENSITIVE_SESSION_KEY',
        unionid: 'uSENSITIVE_UNIONID',
        nickname: '平铺游客'
      }
    }
    const u = await userApi.login()
    assert.strictEqual(u.openid, 'oFLAT_openid_002', '应从顶层 openid 兜底')
    assert.strictEqual(u.id, 'oFLAT_openid_002', '无 UserId 时退化为 openid 身份')
    const saved = JSON.stringify(store)
    assert.ok(saved.indexOf('SENSITIVE_SESSION_KEY') < 0, 'session_key 不得写入本地存储')
    assert.ok(saved.indexOf('uSENSITIVE_UNIONID') < 0, 'unionid 不得写入本地存储')
  })

  await check('L09 旧 mock 登录态失效：切到 webhook 后强制重新走 wx.login + API-06', async () => {
    userApi.logout()
    // 模拟上一版留下的旧缓存（id=demo_user / openid=mock_ 前缀 / 无 source）
    store['rh_user'] = JSON.stringify({
      id: 'demo_user',
      openid: 'mock_openid_old',
      nickname: '红色传承者',
      avatar: '/images/placeholder.png',
      phone: '13800138000'
    })
    loginCalls = 0
    requestLog = []
    const u = await userApi.login()
    assert.strictEqual(loginCalls, 1, '旧缓存应失效并触发 wx.login')
    assert.strictEqual(requestLog.length, 1, '应调用一次 API-06')
    assert.strictEqual(requestLog[0].data.JsCode, 'WXCODE_1', '应携带新的临时登录凭证')
    assert.strictEqual(requestLog[0].data.IsPhone, 0, '静默登录固定 IsPhone=0')
    assert.strictEqual(u.userId, LIVE_ID, '应返回游客档案 UserId')
    assert.strictEqual(u.source, 'webhook', '登录态来源应为 webhook')
    assert.strictEqual(u.id, LIVE_ID, 'id 应为真实身份')
    assert.strictEqual(userApi.getBizId(), 'demo_user', '业务关联键仍为 demo_user')
  })

  await check('L10 旧版 webhook 缓存（只有 openid、无 userId）自动失效并重登', async () => {
    userApi.logout()
    store['rh_user'] = JSON.stringify({
      id: 'oOLD_openid_cached',
      openid: 'oOLD_openid_cached',
      source: 'webhook',
      nickname: '老缓存用户'
    })
    assert.strictEqual(userApi.isTokenAlive(), false, '只有 openid 的旧缓存不可再用')
    loginCalls = 0
    requestLog = []
    const u = await userApi.login()
    assert.strictEqual(loginCalls, 1, '应触发 wx.login')
    assert.strictEqual(u.userId, LIVE_ID)
  })

  await check('L11 重新登录不覆盖用户在个人中心已填的昵称/头像/手机号', async () => {
    userApi.logout()
    loginCalls = 0
    requestLog = []
    const u1 = await userApi.login()
    const edited = await userApi.updateUser({
      nickname: '我自己起的昵称',
      avatar: '/images/my-avatar.png',
      phone: '13900000000'
    })
    assert.strictEqual(edited.nickname, '我自己起的昵称', '资料应已保存到本地')
    // 强制重新登录：线上档案里昵称仍是匿名占位「微信用户」、头像为空，不应覆盖本地资料
    nextResponse = {
      statusCode: 200,
      data: {
        code: '',
        msg: '',
        data: {
          Id: u1.userId,
          NickName: '微信用户',
          Avatar: '',
          Phone: '',
          IsRegistered: 1
        }
      }
    }
    const u2 = await userApi.refreshLogin()
    assert.strictEqual(u2.userId, u1.userId)
    assert.strictEqual(u2.nickname, '我自己起的昵称', '「微信用户」占位不应覆盖用户昵称')
    assert.strictEqual(u2.avatar, '/images/my-avatar.png', '头像不应被默认值覆盖')
    assert.strictEqual(u2.phone, '13900000000', '手机号应保留')
  })

  await check('L12 头像持久化边界：远程/静态/已落盘原样返回，失败降级；旧文件只在保存后清理', async () => {
    fsLog = []
    copyFail = false
    const remote = 'https://wx.qlogo.cn/avatar/132'
    assert.strictEqual(await userApi.uploadAvatar(remote), remote, '远程头像无需复制')
    assert.strictEqual(
      await userApi.uploadAvatar('/images/placeholder.png'),
      '/images/placeholder.png',
      '静态占位图无需复制'
    )
    const persisted = USER_DIR + '/avatar_old.png'
    assert.strictEqual(await userApi.uploadAvatar(persisted), persisted, '已落盘路径无需重复复制')
    assert.strictEqual(fsLog.filter((x) => x.op === 'copy').length, 0, '上述三类不应触发复制')

    // 当前头像指向旧文件
    store['rh_user'] = JSON.stringify({
      id: 'UID-L12', userId: 'UID-L12', source: 'mock',
      nickname: '张三', avatar: persisted, phone: ''
    })

    // 选图阶段**不能**删旧文件：用户可能选完就退出/保存失败，
    // 那时 storage 仍指向旧头像，删了就会「刷新后头像消失」
    const fresh = await userApi.uploadAvatar('wxfile://tmp_new.png')
    assert.ok(fresh.indexOf(USER_DIR + '/avatar_') === 0, '新头像应落盘')
    assert.notStrictEqual(fresh, persisted, '新旧头像路径不应相同')
    assert.strictEqual(fsLog.filter((x) => x.op === 'unlink').length, 0, '选图阶段不应删除旧头像')

    // 保存落库后才清理旧文件，避免本地目录堆积
    fsLog = []
    await userApi.updateUser({ avatar: fresh })
    assert.ok(
      fsLog.some((x) => x.op === 'unlink' && x.path === persisted),
      '保存新头像后应清理旧头像文件'
    )

    // 复制失败不阻断资料保存，降级为临时路径（本次会话仍可显示）
    copyFail = true
    const fallback = await userApi.uploadAvatar('wxfile://tmp_fail.png')
    assert.strictEqual(fallback, 'wxfile://tmp_fail.png', '失败应降级为临时路径')
    copyFail = false
  })

  await check('L17 js_code 返回 IsRegistered:"" → 未知（null），不得判为未注册', async () => {
    userApi.logout()
    requestLog = []
    nextResponse = {
      statusCode: 200,
      data: {
        code: '', msg: '',
        data: { Id: LIVE_ID, NickName: '测试游客', Avatar: '', Phone: '', IsRegistered: '' }
      }
    }
    const u = await userApi.login()
    assert.strictEqual(u.isRegistered, null, '空串应归一化为 null（未知），实际：' + JSON.stringify(u.isRegistered))
    assert.strictEqual(u.isRegisteredRaw, '', '应保留原始值便于排查服务端返回')
    const saved = JSON.parse(store['rh_user'])
    assert.strictEqual(saved.isRegistered, null, 'storage 里不得把空串落成 false')

    // 显式的 0 仍必须判为「未注册」，不能因为放宽而丢失语义
    userApi.logout()
    nextResponse = {
      statusCode: 200,
      data: { code: '', msg: '', data: { Id: LIVE_ID, NickName: '测试游客', Avatar: '', Phone: '', IsRegistered: 0 } }
    }
    const u2 = await userApi.login()
    assert.strictEqual(u2.isRegistered, false, 'IsRegistered=0 应判为未注册')
  })

  console.log('\n===== 汇总：' + pass + ' PASS =====')
}

main().catch((e) => {
  console.error('[FATAL]', e)
  process.exitCode = 1
})
