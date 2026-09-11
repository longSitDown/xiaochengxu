/**
 * 静态体检脚本：路由合法性 / 组件声明 / 体积构成
 * 用法：node tools/audit.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
process.chdir(ROOT)

const app = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const tabPages = new Set(app.tabBar.list.map((t) => t.pagePath))

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

/* ---------- 1. 跳转合法性 ---------- */
console.log('=== 1. 跳转合法性（navigateTo/redirectTo 指向 tabBar 页会运行时失败）===')
let issue1 = 0
const allJs = []
;['pages', 'components'].forEach((d) => walk(d, allJs))
allJs
  .filter((f) => f.endsWith('.js'))
  .forEach((f) => {
    const c = fs.readFileSync(f, 'utf8')
    const re = /(navigateTo|redirectTo|reLaunch)\s*\(\s*\{[^}]*?url:\s*['"`]([^'"`]+)/g
    let m
    while ((m = re.exec(c))) {
      const page = m[2].split('?')[0].replace(/^\//, '')
      if (tabPages.has(page)) {
        console.log('  [X]', f, '->', m[1], m[2])
        issue1++
      }
    }
  })
console.log('  问题数:', issue1)

/* ---------- 2. 组件声明 ---------- */
console.log('\n=== 2. 自定义组件声明完整性 ===')
let issue2 = 0
app.pages.forEach((p) => {
  const wxml = p + '.wxml'
  const json = p + '.json'
  if (!fs.existsSync(wxml)) return
  const w = fs.readFileSync(wxml, 'utf8')
  const declared = fs.existsSync(json)
    ? Object.keys(JSON.parse(fs.readFileSync(json, 'utf8')).usingComponents || {})
    : []
  const globals = Object.keys(app.usingComponents || {})
  const used = new Set()
  const re = /<([a-z]+(?:-[a-z]+)+)[\s/>]/g
  let m
  while ((m = re.exec(w))) used.add(m[1])
  used.forEach((tag) => {
    if (!declared.includes(tag) && !globals.includes(tag)) {
      console.log('  [X]', p, '使用了 <' + tag + '> 但未声明')
      issue2++
    }
  })
})
console.log('  问题数:', issue2)

/* ---------- 3. 体积构成（按 project.config 的 ignore 规则模拟）---------- */
console.log('\n=== 3. 主包体积构成 ===')
const projCfg = JSON.parse(fs.readFileSync('project.config.json', 'utf8'))
const ignores = (projCfg.packOptions && projCfg.packOptions.ignore) || []
const ignoreSet = new Set(ignores.filter((i) => i.type === 'folder').map((i) => i.value))
const ignoreFiles = new Set(ignores.filter((i) => i.type === 'file').map((i) => i.value))

let total = 0
const byTop = {}
const big = []
walk('.', []).forEach((f) => {
  const rel = path.relative('.', f).replace(/\\/g, '/')
  if (rel.startsWith('.workbuddy/') || rel.startsWith('node_modules/')) return
  const top = rel.split('/')[0]
  if (ignoreSet.has(top) || ignoreFiles.has(top)) return
  const size = fs.statSync(f).size
  total += size
  byTop[top] = (byTop[top] || 0) + size
  big.push([rel, size])
})
const mb = (b) => (b / 1024 / 1024).toFixed(2) + ' MB'
console.log('  合计:', mb(total), '/ 限制 2.00 MB  ' + (total > 2 * 1024 * 1024 ? '!! 超限' : 'OK'))
Object.entries(byTop)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log('   ', k.padEnd(14), (v / 1024).toFixed(0).padStart(7) + ' KB'))
console.log('  最大的 10 个文件:')
big
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([f, s]) => console.log('   ', (s / 1024).toFixed(0).padStart(7) + ' KB  ' + f))

/* ---------- 4. 各类代码坏味道 ---------- */
console.log('\n=== 4. 代码坏味道扫描 ===')
const smells = { console: 0, todo: 0, hardcodedSecret: 0, syncStorage: 0, setDataInLoop: 0 }
const smellFiles = { console: [], todo: [], hardcodedSecret: [] }
walk('pages', [])
  .concat(walk('api', []), walk('utils', []), walk('components', []))
  .filter((f) => f.endsWith('.js') && !f.includes('qrcode'))
  .forEach((f) => {
    const c = fs.readFileSync(f, 'utf8')
    if (/console\.(log|warn|error|info)\(/.test(c)) {
      smells.console++
      smellFiles.console.push(f)
    }
    if (/TODO|FIXME|待对接|暂未实现/.test(c)) {
      smells.todo++
      smellFiles.todo.push(f)
    }
    if (/appKey\s*:\s*['"][^'"]+['"]|sign\s*:\s*['"][^'"]+['"]/.test(c)) {
      smells.hardcodedSecret++
      smellFiles.hardcodedSecret.push(f)
    }
    const sync = (c.match(/wx\.(get|set)StorageSync\(/g) || []).length
    smells.syncStorage += sync
  })
console.log('  含 console.* 的文件:', smells.console, smellFiles.console.join(', ') || '-')
console.log('  含 TODO/待对接的文件:', smells.todo, smellFiles.todo.join(', ') || '-')
console.log('  疑似硬编码密钥的文件:', smells.hardcodedSecret || 0, smellFiles.hardcodedSecret.join(', ') || '-')
console.log('  同步 Storage 调用次数:', smells.syncStorage)
