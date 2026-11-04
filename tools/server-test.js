/**
 * 后端服务自测（进程内启动，跑完自动退出）
 *
 * 覆盖：登录签发 token、token 篡改与过期拒绝、写操作强制登录、
 *       匿名越权筛选拦截、userId 绑定改写、上传参数校验。
 *
 * 用法：node tools/server-test.js
 */
process.env.MOCK_LOGIN = '1'
process.env.PORT = '3199'
process.env.HOST = '127.0.0.1'
process.env.TOKEN_SECRET = 'test-secret-for-assertions-only'
process.env.PUBLIC_BASE = ''

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('PASS:', msg)
}

const BASE = 'http://127.0.0.1:3199'

async function req(path, opt) {
  const o = opt || {}
  const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers)
  const res = await fetch(BASE + path, {
    method: o.method || 'GET',
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body)
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    json = { raw: text }
  }
  return { status: res.status, body: json }
}

async function main() {
  const { bindUser, hasUserFilter, isWrite, server } = require('../server/index')
  const auth = require('../server/auth')

  // 等服务真正 listen 完成
  if (!server.listening) {
    await new Promise((r) => server.once('listening', r))
  }

  /* ---- 纯函数：越权防护 ---- */

  assert(
    isWrite('POST', '/v3/app/worksheets/r/rows') === true,
    'POST 新建行属写操作'
  )
  assert(
    isWrite('POST', '/v3/app/worksheets/r/rows/list') === false,
    'POST 列表查询不算写操作'
  )
  assert(isWrite('GET', '/v3/app/worksheets/r/rows/x') === false, 'GET 不算写操作')
  assert(isWrite('PATCH', '/v3/app/worksheets/r/rows/x') === true, 'PATCH 属写操作')

  const body1 = { fields: [{ id: 'userId', value: 'attacker' }, { id: 'score', value: '10' }] }
  bindUser(body1, 'real_uid')
  assert(body1.fields[0].value === 'real_uid', '写请求里伪造的 userId 被覆盖为当前登录用户')
  assert(body1.fields[1].value === '10', '其他字段不受影响')

  const body2 = {
    filters: {
      type: 'group',
      logic: 'AND',
      children: [
        { type: 'condition', field: 'userId', operator: 'eq', value: 'attacker' },
        { type: 'condition', field: 'status', operator: 'eq', value: '已通过' }
      ]
    }
  }
  bindUser(body2, 'real_uid')
  assert(body2.filters.children[0].value === 'real_uid', '读请求筛选里的 userId 被改写')
  assert(body2.filters.children[1].value === '已通过', '非 userId 条件保持不变')

  const nested = {
    filters: {
      type: 'group',
      logic: 'OR',
      children: [{ type: 'group', logic: 'AND', children: [{ type: 'condition', field: 'userId', operator: 'in', value: ['a'] }] }]
    }
  }
  bindUser(nested, 'real_uid')
  assert(
    Array.isArray(nested.filters.children[0].children[0].value) &&
      nested.filters.children[0].children[0].value[0] === 'real_uid',
    '嵌套筛选树里的 userId 也被改写（保持数组形态）'
  )

  assert(hasUserFilter(body2) === true, '能识别出请求体带 userId 条件')
  assert(hasUserFilter({ fields: [{ id: 'score', value: 1 }] }) === false, '无 userId 时判定为否')

  /* ---- token ---- */

  const token = auth.signToken({ openid: 'op_1', uid: 'uid_1' })
  assert(!!auth.verifyToken(token), '签发的 token 可校验通过')
  assert(auth.verifyToken(token.slice(0, -2) + 'xx') === null, '签名被篡改的 token 被拒绝')
  assert(auth.verifyToken('abc') === null, '格式错误的 token 被拒绝')
  assert(auth.verifyToken('') === null, '空 token 被拒绝')

  const expired = auth.signToken({ openid: 'op_1', uid: 'uid_1' }, -10)
  assert(auth.verifyToken(expired) === null, '过期 token 被拒绝')

  /* ---- HTTP 路由 ---- */

  const health = await req('/api/health')
  assert(health.status === 200 && health.body.data.mockLogin === true, 'GET /api/health 可用')

  const noCode = await req('/api/auth/login', { method: 'POST', body: {} })
  assert(noCode.status === 400, '登录缺 code 返回 400')

  const login = await req('/api/auth/login', { method: 'POST', body: { code: 'code_abc' } })
  assert(login.status === 200 && login.body.data.token, '登录返回 token')
  assert(login.body.data.user.openid === 'mock_code_abc', '登录返回 openid')

  const liveToken = login.body.data.token
  const profile = await req('/api/auth/profile', { headers: { Authorization: 'Bearer ' + liveToken } })
  assert(profile.status === 409, '联调账号无用户档案时读资料返回 409（提示先初始化）')

  const fakeProfile = await req('/api/auth/profile', { headers: { Authorization: 'Bearer a.b' } })
  assert(fakeProfile.status === 401, '伪造 token 读资料返回 401')

  const anonWrite = await req('/api/hap/v3/app/worksheets/w/rows', { method: 'POST', body: { fields: [] } })
  assert(anonWrite.status === 401, '匿名写操作返回 401（密钥不可被公开调用）')

  const anonFilter = await req('/api/hap/v3/app/worksheets/w/rows/list', {
    method: 'POST',
    body: {
      filters: {
        type: 'group',
        logic: 'AND',
        children: [{ type: 'condition', field: 'userId', operator: 'eq', value: 'someone' }]
      }
    }
  })
  assert(anonFilter.status === 403, '匿名按 userId 筛选被拦截（避免越权读他人记录）')

  const uploadNoAuth = await req('/api/upload', { method: 'POST', body: { ext: 'png', data: 'x' } })
  assert(uploadNoAuth.status === 401, '未登录上传被拒绝')

  const uploadBadExt = await req('/api/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + liveToken },
    body: { ext: 'exe', data: 'AAAA' }
  })
  assert(uploadBadExt.status === 400, '上传非法扩展名被拒绝')

  const uploadOk = await req('/api/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + liveToken },
    body: { ext: 'png', data: Buffer.from('fake-png-bytes').toString('base64') }
  })
  assert(uploadOk.status === 200 && /\/uploads\/[0-9a-f]+\.png$/.test(uploadOk.body.data.url), '登录后可上传并返回 URL')

  const notFound = await req('/api/nope')
  assert(notFound.status === 404, '未知路由返回 404')

  console.log('\n===== 后端自测通过（token / 越权防护 / 路由 / 上传）=====')
  server.close()
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
