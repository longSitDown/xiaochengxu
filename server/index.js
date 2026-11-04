/**
 * 红色纪念馆小程序 —— 后端服务（零依赖，Node 18+ 直接运行）
 *
 * 职责（三合一）：
 *   1. 登录：code → openid → 签发 token（微信 appsecret 只在这里）
 *   2. 明道云代理：代签 HAP-Appkey/HAP-Sign 转发，密钥不下发到小程序
 *   3. 越权防护：强制用 token 里的用户 ID 覆盖请求里的 userId
 *
 * 启动：node server/index.js
 * 配置：复制 server/.env.example 为 server/.env 并填写
 *
 * 路由：
 *   POST  /api/auth/login       { code }              → { token, user }
 *   GET   /api/auth/profile                            → { user }（需 token）
 *   PATCH /api/auth/profile     { nickname, avatar }   → { user }（需 token）
 *   POST  /api/upload           { ext, data(base64) }  → { url }（需 token）
 *   GET   /api/health                                  → 配置与连通性体检
 *   ANY   /api/hap/{...}                               → 转发明道云 /v3/...
 *   GET   /uploads/{file}                              → 头像静态资源
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const { config, check } = require('./config')
const hap = require('./hap')
const auth = require('./auth')

/* ---------------- 基础设施 ---------------- */

function log() {
  const args = Array.prototype.slice.call(arguments)
  console.log('[' + new Date().toISOString() + ']', ...args)
}

/** 统一失败响应：格式与明道云一致，前端 checkEnvelope 可直接消费 */
function fail(res, status, code, msg) {
  send(res, status, { success: false, error_code: code, error_msg: msg, data: {} })
}

function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': config.CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
  })
  res.end(body)
}

/** 读取请求体并解析 JSON（超限直接中断） */
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject({ code: 'TOO_LARGE', message: '请求体过大' })
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject({ code: 'BAD_JSON', message: '请求体不是合法 JSON' })
      }
    })
    req.on('error', reject)
  })
}

/** 从 Authorization: Bearer xxx 取 token 并校验 */
function currentUser(req) {
  const raw = req.headers.authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(raw)
  if (!m) return null
  return auth.verifyToken(m[1].trim())
}

/* ---------------- 越权防护 ---------------- */

const QUERY_POST = /\/(rows\/list|rows\/pivot)$/

/** 是否写操作：GET 与「列表/透视查询」之外的都算写 */
function isWrite(method, p) {
  if (method === 'GET' || method === 'HEAD') return false
  if (method === 'POST' && QUERY_POST.test(p)) return false
  return true
}

/** 递归遍历筛选器树，对 userId 条件执行回调 */
function walkUserId(node, fn) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'group' && Array.isArray(node.children)) {
    node.children.forEach((c) => walkUserId(c, fn))
    return
  }
  if (node.type === 'condition' && node.field === 'userId') fn(node)
}

/** 把请求体里所有 userId 条件与字段值改写为当前登录用户 */
function bindUser(body, uid) {
  if (!body || typeof body !== 'object') return body
  const filters = body.filters || body.filter
  if (filters) {
    walkUserId(filters, (cond) => {
      cond.value = Array.isArray(cond.value) ? [uid] : uid
    })
  }
  if (Array.isArray(body.fields)) {
    const hit = body.fields.filter((f) => f.id === 'userId')[0]
    if (hit) hit.value = uid
  }
  return body
}

/** 判断请求体里是否带了 userId 条件（用于匿名请求拒绝） */
function hasUserFilter(body) {
  let found = false
  const filters = body && (body.filters || body.filter)
  if (filters) walkUserId(filters, () => { found = true })
  if (body && Array.isArray(body.fields)) {
    if (body.fields.some((f) => f.id === 'userId')) found = true
  }
  return found
}

/* ---------------- 路由处理 ---------------- */

async function handleLogin(req, res) {
  const body = await readJson(req, 64 * 1024)
  if (!body.code) return fail(res, 400, 10001, '缺少 code')
  const result = await auth.login(body.code)
  log('login ok:', result.user.openid)
  send(res, 200, { success: true, error_code: 1, data: result })
}

async function handleGetProfile(req, res) {
  const me = currentUser(req)
  if (!me) return fail(res, 401, 401, '未登录或登录已过期')
  if (!me.uid) return fail(res, 409, 409, '登录态缺少用户档案，请先完成资料初始化')
  const r = await hap.forward({
    method: 'GET',
    path: '/v3/app/worksheets/' + auth.usersWorksheetId() + '/rows/' + me.uid
  })
  if (!r.body || r.body.success !== true) return fail(res, 502, 502, '读取用户资料失败')
  const fields = (r.body.data && r.body.data.fields) || []
  const get = (id) => {
    const hit = fields.filter((f) => f.id === id)[0]
    if (!hit) return ''
    const v = hit.value
    return Array.isArray(v) ? (v.length ? String(v[0]) : '') : v == null ? '' : String(v)
  }
  send(res, 200, {
    success: true,
    error_code: 1,
    data: {
      user: { id: me.uid, openid: me.openid, nickname: get('nickname'), avatar: get('avatar'), phone: get('phone') }
    }
  })
}

async function handlePatchProfile(req, res) {
  const me = currentUser(req)
  if (!me) return fail(res, 401, 401, '未登录或登录已过期')
  if (!me.uid) return fail(res, 409, 409, '登录态缺少用户档案')
  const body = await readJson(req, 64 * 1024)
  await auth.updateUser(me.uid, body)
  send(res, 200, { success: true, error_code: 1, data: { ok: true } })
}

const EXT_ALLOW = ['png', 'jpg', 'jpeg', 'webp']

async function handleUpload(req, res) {
  const me = currentUser(req)
  if (!me) return fail(res, 401, 401, '未登录或登录已过期')
  const body = await readJson(req, config.UPLOAD_MAX * 2)
  const ext = String(body.ext || 'png').toLowerCase().replace(/[^a-z]/g, '')
  if (EXT_ALLOW.indexOf(ext) < 0) return fail(res, 400, 702, '仅支持 png/jpg/webp')
  const raw = String(body.data || '')
  if (!raw) return fail(res, 400, 703, '缺少文件内容')
  const buf = Buffer.from(raw, 'base64')
  if (!buf.length) return fail(res, 400, 704, '文件内容为空')
  if (buf.length > config.UPLOAD_MAX) return fail(res, 413, 705, '图片超过 ' + Math.round(config.UPLOAD_MAX / 1024) + 'KB')

  const name = crypto.randomBytes(8).toString('hex') + '.' + ext
  if (!fs.existsSync(config.UPLOAD_DIR)) fs.mkdirSync(config.UPLOAD_DIR, { recursive: true })
  fs.writeFileSync(path.join(config.UPLOAD_DIR, name), buf)
  const base = config.PUBLIC_BASE || ('http://' + (req.headers.host || 'localhost:' + config.PORT))
  send(res, 200, { success: true, error_code: 1, data: { url: base + '/uploads/' + name } })
}

async function handleHealth(req, res) {
  const problems = check()
  const out = {
    ok: problems.length === 0,
    mockLogin: config.MOCK_LOGIN,
    hapBase: config.HAP_BASE,
    signVariant: config.HAP_SIGN_VARIANT,
    problems
  }
  // 顺带探一次明道云，验证密钥与签名是否可用（失败不影响健康检查结论）
  if (config.HAP_APPKEY && config.HAP_SECRET) {
    const r = await hap.forward({ method: 'GET', path: '/v3/app' })
    out.hap = {
      httpStatus: r.status,
      success: !!(r.body && r.body.success === true),
      errorCode: r.body && r.body.error_code,
      errorMsg: r.body && r.body.error_msg
    }
  }
  send(res, 200, { success: true, error_code: 1, data: out })
}

async function handleProxy(req, res, urlObj) {
  // /api/hap/v3/app/... → /v3/app/...
  const p = urlObj.pathname.replace(/^\/api\/hap/, '')
  const method = req.method.toUpperCase()
  const write = isWrite(method, p)
  const me = currentUser(req)

  let body
  if (method !== 'GET' && method !== 'HEAD') {
    body = await readJson(req, 1024 * 1024)
  }

  // 写操作必须登录（否则等于把管理员写权限公开给互联网）
  if (write && !me) return fail(res, 401, 401, '请先登录')

  if (me && me.uid) {
    body = bindUser(body, me.uid)
  } else if (!write && hasUserFilter(body)) {
    // 匿名读却按 userId 筛选：存在越权读取他人记录的风险，直接拒绝
    return fail(res, 403, 403, '匿名请求不能按用户筛选，请先登录')
  }

  const r = await hap.forward({
    method,
    path: p,
    query: urlObj.search ? urlObj.search.slice(1) : '',
    body
  })
  // 原样透传明道云响应体（success/error_code/data 结构一致，前端无需特殊处理）
  send(res, r.status, r.body)
}

/** 头像静态资源（生产建议交给 Nginx 或对象存储） */
function serveUpload(req, res, urlObj) {
  const name = path.basename(urlObj.pathname.replace(/^\/uploads\//, ''))
  const file = path.join(config.UPLOAD_DIR, name)
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
    return
  }
  const ext = path.extname(file).toLowerCase().replace('.', '')
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  const stat = fs.statSync(file)
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' })
  fs.createReadStream(file).pipe(res)
}

/* ---------------- 服务入口 ---------------- */

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, 'http://' + (req.headers.host || 'localhost'))
  const p = urlObj.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': config.CORS_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400'
    })
    res.end()
    return
  }

  const route = req.method + ' ' + p
  const started = Date.now()

  Promise.resolve()
    .then(() => {
      if (route === 'GET /api/health') return handleHealth(req, res)
      if (route === 'POST /api/auth/login') return handleLogin(req, res)
      if (route === 'GET /api/auth/profile') return handleGetProfile(req, res)
      if (route === 'PATCH /api/auth/profile') return handlePatchProfile(req, res)
      if (route === 'POST /api/upload') return handleUpload(req, res)
      if (p.indexOf('/api/hap/') === 0) return handleProxy(req, res, urlObj)
      if (req.method === 'GET' && p.indexOf('/uploads/') === 0) return serveUpload(req, res, urlObj)
      return fail(res, 404, 404, '接口不存在：' + route)
    })
    .then(() => log(route, Date.now() - started + 'ms'))
    .catch((e) => {
      const code = (e && e.code) || 500
      const msg = (e && e.message) || '服务内部错误'
      log('ERROR', route, code, msg)
      if (!res.headersSent) {
        // 上游业务错误码（如 CONFIG / HAP_ERROR）透出为 502，便于前端区分
        const status = code === 'TOO_LARGE' ? 413 : code === 'BAD_JSON' || code === 'BAD_REQUEST' ? 400 : 502
        fail(res, status, typeof code === 'number' ? code : 502, msg)
      }
    })
})

server.listen(config.PORT, config.HOST, () => {
  log('server listening on http://' + config.HOST + ':' + config.PORT)
  const problems = check()
  if (problems.length) {
    log('⚠️ 配置待补全：')
    problems.forEach((x) => log('   - ' + x))
  } else {
    log('✅ 配置检查通过')
  }
  log('签名变体 HAP_SIGN_VARIANT =', config.HAP_SIGN_VARIANT)
})

// 导出内部函数，供 tools/server-test.js 做单元验证
module.exports = { server, bindUser, hasUserFilter, isWrite, currentUser }
