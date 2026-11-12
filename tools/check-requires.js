/**
 * 小程序端 require 静态解析体检
 *
 * 背景：Node 会自动解析目录下的 index.js，但**微信小程序运行时不会**。
 * 写 `require('../config')` 时，小程序按 `config.js` 去找，找不到就抛
 * `module 'config.js' is not defined`，表现为页面白屏（本次 profile 页事故）。
 * 这类错误在 Node 自测里完全跑不出来，只能靠静态扫描。
 *
 * 运行：node tools/check-requires.js
 * 报告写入 tools/require-scan.txt；发现问题时退出码 1。
 *
 * 扫描范围：app.js + api/ config/ utils/ pages/ components/ 下的 *.js
 * （server/ 与 tools/ 是 Node 环境，目录 index.js 解析合法，不扫）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SCAN_DIRS = ['api', 'config', 'utils', 'pages', 'components']
const SCAN_FILES = ['app.js']
const OUT = path.join(__dirname, 'require-scan.txt')
const lines = []
const problems = []
let fileCount = 0
let requireCount = 0

function w(s) { lines.push(String(s == null ? '' : s)) }

function collect(dir, out) {
  if (!fs.existsSync(dir)) return
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, out)
    else if (e.isFile() && /\.js$/.test(e.name)) out.push(p)
  })
}

const files = []
SCAN_FILES.forEach((f) => { const p = path.join(ROOT, f); if (fs.existsSync(p)) files.push(p) })
SCAN_DIRS.forEach((d) => collect(path.join(ROOT, d), files))

/**
 * 只在「代码」状态提取 require(...)，跳过注释与字符串字面量。
 * 否则注释里举例写的 require('../config') 会被当成真实引用而误报。
 */
function findRequires(src) {
  const found = []
  const n = src.length
  let i = 0
  let line = 1
  let state = 'code' // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '\n') {
      line++
      if (state === 'line') state = 'code'
      i++
      continue
    }
    if (state === 'line') { i++; continue }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; i += 2 } else i++
      continue
    }
    if (state === 'sq' || state === 'dq' || state === 'tpl') {
      if (c === '\\') { i += 2; continue }
      const q = state === 'sq' ? "'" : state === 'dq' ? '"' : '`'
      if (c === q) state = 'code'
      i++
      continue
    }
    if (c === '/' && d === '/') { state = 'line'; i += 2; continue }
    if (c === '/' && d === '*') { state = 'block'; i += 2; continue }
    if (c === "'") { state = 'sq'; i++; continue }
    if (c === '"') { state = 'dq'; i++; continue }
    if (c === '`') { state = 'tpl'; i++; continue }
    if (src.startsWith('require', i)) {
      const m = /^require\(\s*(['"])([^'"]+)\1\s*\)/.exec(src.slice(i))
      if (m) {
        found.push({ spec: m[2], line: line })
        i += m[0].length
        continue
      }
    }
    i++
  }
  return found
}

/** 按小程序运行时规则解析一个相对 require */
function resolveSpec(file, spec) {
  const base = path.resolve(path.dirname(file), spec)
  // 1) 显式 .js / 完整文件名
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return { ok: true, target: base }
  // 2) 省略后缀：base + '.js'
  if (fs.existsSync(base + '.js')) return { ok: true, target: base + '.js' }
  // 3) 目录 + index.js —— Node 可用，小程序运行时不可用
  const idx = path.join(base, 'index.js')
  if (fs.existsSync(idx)) return { ok: false, reason: '目录 require', target: idx }
  return { ok: false, reason: '模块不存在', target: base + '.js' }
}

w('小程序端 require 静态解析体检')
w('时间：' + new Date().toLocaleString('zh-CN'))
w('扫描目录：' + SCAN_DIRS.join(', ') + ' + ' + SCAN_FILES.join(', '))
w('规则：相对路径必须能解析到具体 .js 文件；指向「目录/index.js」一律判为错误。')
w('')

files.sort().forEach((file) => {
  fileCount++
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  const src = fs.readFileSync(file, 'utf8')
  findRequires(src).forEach((hit) => {
    const spec = hit.spec
    if (spec.charAt(0) !== '.') return // npm 包 / Node 内置模块，跳过
    requireCount++
    const r = resolveSpec(file, spec)
    if (r.ok) return
    const msg = rel + ':' + hit.line + '  require(' + "'" + spec + "'" + ') → ' + r.reason +
      '（需显式写到 ' + path.relative(ROOT, r.target).replace(/\\/g, '/') + '）'
    problems.push(msg)
  })
})

w('扫描文件：' + fileCount + ' 个，相对 require：' + requireCount + ' 处')
w('问题：' + problems.length + ' 处')
w('')
if (problems.length) {
  w('===== 需修复 =====')
  problems.forEach((p) => w('  [ERROR] ' + p))
} else {
  w('[PASS] 全部相对 require 均指向具体 .js 文件，无目录 index.js 依赖。')
}
/* ---------------- 运行时模拟：按小程序规则真实加载依赖链 ---------------- */
const vm = require('vm')

/** 故意禁用「目录 → index.js」解析，精确复刻小程序运行时的 require 行为 */
function strictLoad(entryRel) {
  const entry = path.join(ROOT, entryRel)
  const cache = {}
  const wxStub = new Proxy({ env: { USER_DATA_PATH: '/usr' } }, {
    get: (t, k) => (k in t ? t[k] : () => undefined)
  })
  function load(file) {
    if (cache[file]) return cache[file].exports
    const mod = { exports: {} }
    cache[file] = mod
    const strictRequire = (spec) => {
      if (spec.charAt(0) !== '.') return require(spec) // 内置 / npm 交给 Node
      const base = path.resolve(path.dirname(file), spec)
      let target = null
      if (fs.existsSync(base) && fs.statSync(base).isFile()) target = base
      else if (fs.existsSync(base + '.js')) target = base + '.js'
      else {
        throw new Error("module '" + path.basename(spec) + ".js' is not defined, require args is '" + spec + "'")
      }
      return load(target)
    }
    const sandbox = {
      module: mod,
      exports: mod.exports,
      require: strictRequire,
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
      wx: wxStub,
      getApp: () => ({ globalData: {}, getNavMetrics: () => ({}) }),
      Page: () => {},
      Component: () => {},
      App: () => {},
      Behavior: () => ({})
    }
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 3000 })
    return mod.exports
  }
  return load(entry)
}

w('')
w('===== 运行时模拟（禁用目录 index.js 解析） =====')
;['api/feedback.js', 'pages/profile/profile.js'].forEach((entry) => {
  try {
    strictLoad(entry)
    w('  [PASS] ' + entry + ' 依赖链加载成功')
  } catch (e) {
    const msg = entry + ' 运行时加载失败：' + (e && e.message ? e.message : e)
    problems.push(msg)
    w('  [ERROR] ' + msg)
  }
})

w('')
w('提示：新增 require 后请重跑本脚本；它是 Node 自测覆盖不到的白屏防线。')

fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log('require 体检：' + fileCount + ' 文件 / ' + requireCount + ' 处引用 / ' +
  problems.length + ' 处问题 → 报告 ' + path.relative(ROOT, OUT).replace(/\\/g, '/'))
if (problems.length) {
  problems.forEach((p) => console.error('  [ERROR] ' + p))
  process.exitCode = 1
}
