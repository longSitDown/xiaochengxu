/**
 * 头像持久化回归测试（Node 直跑，stub wx 文件系统，不发真实请求）
 *
 * 起因：真机上「改完头像、刷新后又变回默认图」。
 * 定位到两个缺陷，本脚本专门锁死它们：
 *
 *   1. isPersistedLocalFile 只认 wxfile:// ——
 *      开发者工具 USER_DATA_PATH 是 http://usr，被判成"非本机"，重新登录时
 *      被 API-06 返回的附件 URL（带 1 小时临时签名）顶掉，签名过期即裂图。
 *   2. 选图时立刻 unlink 旧头像 ——
 *      用户"选了图但没保存/保存失败"，storage 仍指向已删除文件，下次进来直接空白。
 *
 * 用法：node tools/avatar-test.js
 */
const assert = require('assert')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const store = {}
let fsLog = []
let copyFail = false
let unlinkFail = false
let nextResponse = null
let toastLog = []

const USER_DIR_PHONE = 'wxfile://usr' // 真机
const USER_DIR_TOOL = 'http://usr'    // 开发者工具

const fsStub = {
  copyFile(o) {
    fsLog.push({ op: 'copy', src: o.srcPath, dest: o.destPath })
    if (copyFail) { o.fail && o.fail({ errMsg: 'copyFile:fail' }); return }
    o.success && o.success({})
  },
  unlink(o) {
    fsLog.push({ op: 'unlink', path: o.filePath })
    if (unlinkFail) { o.fail && o.fail({ errMsg: 'unlink:fail' }); return }
    o.success && o.success({})
  },
  readFile(o) { o.success && o.success({ data: 'QkFTRTY0' }) },
  access(o) {
    fsLog.push({ op: 'access', path: o.path })
    o.fail && o.fail({ errMsg: 'access:fail no such file' })
  }
}

global.wx = {
  env: { USER_DATA_PATH: USER_DIR_PHONE },
  getFileSystemManager: () => fsStub,
  setStorageSync: (k, v) => { store[k] = v },
  getStorageSync: (k) => (k in store ? store[k] : ''),
  removeStorageSync: (k) => { delete store[k] },
  getStorageInfoSync: () => ({ keys: Object.keys(store) }),
  login(o) { o.success({ code: 'WXCODE_STUB' }) },
  request(o) {
    if (nextResponse) {
      const r = nextResponse
      nextResponse = null
      o.success(r)
      return
    }
    o.fail({ errMsg: 'request:fail no stub' })
  },
  showToast: (o) => toastLog.push(o.title),
  navigateTo: () => {},
  setNavigationBarTitle: () => {}
}

let capturedPage = null
global.Page = (obj) => { capturedPage = obj }
global.getApp = () => ({ globalData: {}, doLogin: () => Promise.resolve({}) })
global.getCurrentPages = () => [{}, {}]

const userApi = require('../api/user')

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

/** 写入一份登录态到 storage（storage 层会自动 JSON.stringify） */
function seedUser(patch) {
  const user = Object.assign({
    id: 'UID-1', userId: 'UID-1', source: 'webhook',
    nickname: '张三', avatar: '/images/placeholder.png', phone: ''
  }, patch || {})
  store['rh_user'] = JSON.stringify(user)
  return user
}

function apiLoginOk(avatar) {
  return {
    statusCode: 200,
    data: { code: '', msg: '', UserId: 'UID-1', NickName: '张三', IsRegistered: 1, Avatar: avatar || '' }
  }
}

async function main() {
  const isLocal = userApi.isLocalAvatar

  /* ================= A. 本机文件判定 ================= */
  console.log('\n--- A. 本机头像判定 ---')

  await check('A01 真机路径 wxfile://usr/** 判为本机文件', () => {
    assert.strictEqual(isLocal(USER_DIR_PHONE + '/avatar_1_ab.png'), true)
  })

  await check('A02 开发者工具路径 http://usr/** 也判为本机文件', () => {
    assert.strictEqual(isLocal(USER_DIR_TOOL + '/avatar_1_ab.png'), true)
  })

  await check('A03 临时路径 / 远程 URL / 静态占位图 不判为本机', () => {
    assert.strictEqual(isLocal('wxfile://tmp_abc.jpg'), false, 'tmp 不算持久化')
    assert.strictEqual(isLocal('http://tmp/abc.jpg'), false, '工具临时路径不算')
    assert.strictEqual(isLocal('https://p1.mingdaoyun.cn/a.png'), false, '远程不算')
    assert.strictEqual(isLocal('/images/placeholder.png'), false, '静态图不算')
    assert.strictEqual(isLocal(''), false)
  })

  /* ================= B. 选图与清理时机 ================= */
  console.log('\n--- B. 选图与文件清理 ---')

  await check('B04 选图：临时路径复制到用户目录，且不删除旧头像', async () => {
    seedUser({ avatar: USER_DIR_PHONE + '/avatar_old.png' })
    fsLog = []
    const dest = await userApi.uploadAvatar('wxfile://tmp_new.jpg')
    assert.ok(dest.indexOf(USER_DIR_PHONE + '/avatar_') === 0, '应复制到用户目录，实际：' + dest)
    assert.strictEqual(fsLog.filter((x) => x.op === 'copy').length, 1, '应复制一次')
    assert.strictEqual(fsLog.filter((x) => x.op === 'unlink').length, 0, '选图阶段不应删旧文件（未保存前不能动）')
  })

  await check('B05 复制失败降级为临时路径，不阻断选图', async () => {
    seedUser()
    copyFail = true
    const dest = await userApi.uploadAvatar('wxfile://tmp_fail.jpg')
    copyFail = false
    assert.strictEqual(dest, 'wxfile://tmp_fail.jpg', '应原样返回临时路径')
  })

  await check('B06 保存新头像后清理旧文件（只在落库后删）', async () => {
    seedUser({ avatar: USER_DIR_PHONE + '/avatar_old.png', source: 'mock' })
    fsLog = []
    await userApi.updateUser({ avatar: USER_DIR_PHONE + '/avatar_new.png' })
    const unlinked = fsLog.filter((x) => x.op === 'unlink')
    assert.strictEqual(unlinked.length, 1, '应清理一个旧文件，实际：' + unlinked.length)
    assert.strictEqual(unlinked[0].path, USER_DIR_PHONE + '/avatar_old.png')
    const saved = JSON.parse(store['rh_user'])
    assert.strictEqual(saved.avatar, USER_DIR_PHONE + '/avatar_new.png')
  })

  await check('B07 头像没变化时不删任何文件', async () => {
    seedUser({ avatar: USER_DIR_PHONE + '/avatar_same.png', source: 'mock' })
    fsLog = []
    await userApi.updateUser({ nickname: '张三' })
    assert.strictEqual(fsLog.filter((x) => x.op === 'unlink').length, 0)
  })

  await check('B08 旧头像不是本机文件（远程/静态）时不尝试删除', async () => {
    seedUser({ avatar: 'https://p1.mingdaoyun.cn/old.png', source: 'mock' })
    fsLog = []
    await userApi.updateUser({ avatar: USER_DIR_PHONE + '/avatar_new2.png' })
    assert.strictEqual(fsLog.filter((x) => x.op === 'unlink').length, 0, '远程地址不应走 unlink')
  })

  /* ================= C. 重新登录不覆盖本机头像 ================= */
  console.log('\n--- C. 重新登录后的头像来源 ---')

  await check('C09 真机：重登时保留本机头像，不被签名 URL 覆盖', async () => {
    wx.env.USER_DATA_PATH = USER_DIR_PHONE
    const local = USER_DIR_PHONE + '/avatar_keep.png'
    seedUser({ avatar: local })
    nextResponse = apiLoginOk('https://p1.mingdaoyun.cn/expiring.png?e=123&token=abc')
    const u = await userApi.refreshLogin()
    assert.strictEqual(u.avatar, local, '应保留本机头像，实际：' + u.avatar)
  })

  await check('C10 开发者工具：http://usr 头像同样被保留（原 bug 的核心场景）', async () => {
    wx.env.USER_DATA_PATH = USER_DIR_TOOL
    const local = USER_DIR_TOOL + '/avatar_keep.png'
    seedUser({ avatar: local })
    nextResponse = apiLoginOk('https://p1.mingdaoyun.cn/expiring.png?e=123&token=abc')
    const u = await userApi.refreshLogin()
    assert.strictEqual(u.avatar, local, '工具环境也应保留本机头像，实际：' + u.avatar)
    wx.env.USER_DATA_PATH = USER_DIR_PHONE
  })

  await check('C11 没有本机头像时，才使用 API-06 返回的 Avatar', async () => {
    seedUser({ avatar: '/images/placeholder.png' })
    const remote = 'https://p1.mingdaoyun.cn/from-api.png'
    nextResponse = apiLoginOk(remote)
    const u = await userApi.refreshLogin()
    assert.strictEqual(u.avatar, remote)
  })

  await check('C12 本机临时路径（tmp）不会被当成持久头像', async () => {
    seedUser({ avatar: 'wxfile://tmp_abc.jpg' })
    const remote = 'https://p1.mingdaoyun.cn/from-api2.png'
    nextResponse = apiLoginOk(remote)
    const u = await userApi.refreshLogin()
    assert.strictEqual(u.avatar, remote, '临时路径不算持久化，应用接口值')
  })

  /* ================= D. 我的页兜底 ================= */
  console.log('\n--- D. 我的页兜底 ---')

  await check('D13 头像文件丢失时退回占位图（不写 storage）', () => {
    capturedPage = null
    delete require.cache[require.resolve(path.join(ROOT, 'pages/profile/profile.js'))]
    require(path.join(ROOT, 'pages/profile/profile.js'))
    // profile 里 onShow 的 verifyAvatarFile 直接取来用，避免触发统计请求
    const built = capturedPage
    const inst = Object.assign({}, built)
    const user = { nickname: '张三', avatar: USER_DIR_PHONE + '/avatar_gone.png', phone: '' }
    inst.data = { user, phoneText: '未绑定手机号', phoneVerified: false }
    inst.setData = function (patch) { Object.assign(this.data, patch) }
    fsLog = []
    inst.verifyAvatarFile(user)
    assert.strictEqual(fsLog.filter((x) => x.op === 'access').length, 1, '应探测文件是否存在')
    assert.strictEqual(inst.data.user.avatar, '/images/placeholder.png', '应退回占位图')
    const saved = JSON.parse(store['rh_user'] || '{}')
    assert.notStrictEqual(saved.avatar, '/images/placeholder.png', '兜底只改内存展示，不应写回 storage')
  })

  await check('D14 非本机头像不做文件探测（远程/占位图直接跳过）', () => {
    const built = capturedPage
    const inst = Object.assign({}, built)
    inst.data = { user: null }
    inst.setData = function (patch) { Object.assign(this.data, patch) }
    fsLog = []
    inst.verifyAvatarFile({ avatar: 'https://p1.mingdaoyun.cn/a.png' })
    inst.verifyAvatarFile({ avatar: '/images/placeholder.png' })
    assert.strictEqual(fsLog.filter((x) => x.op === 'access').length, 0, '远程与占位图不应探测')
  })

  await check('D15 头像加载 error 时退回占位图，不写 storage', () => {
    const built = capturedPage
    const inst = Object.assign({}, built)
    const user = { nickname: '张三', avatar: USER_DIR_PHONE + '/avatar_err.png' }
    inst.data = { user }
    inst.setData = function (patch) { Object.assign(this.data, patch) }
    inst.onAvatarError()
    assert.strictEqual(inst.data.user.avatar, '/images/placeholder.png')
    // 已经是占位图时再触发不应反复 setData
    const before = inst.data.user
    inst.onAvatarError()
    assert.strictEqual(inst.data.user, before, '占位图状态下应直接返回')
  })

  console.log('\n===== 汇总：' + pass + ' PASS =====')
}

main().catch((e) => {
  console.error('测试脚本异常：', e)
  process.exitCode = 1
})
