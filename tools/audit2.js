/**
 * 深度体检：生命周期清理 / 分享覆盖 / setData 用法 / 页面入口连通性
 * 用法：node tools/audit2.js
 */
const fs = require('fs')
const path = require('path')
process.chdir(path.resolve(__dirname, '..'))
const app = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const PAGES = app.pages

function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}

/* ---------- A. 生命周期清理 ---------- */
console.log('=== A. 生命周期与资源清理 ===')
PAGES.forEach((p) => {
  const js = read(p + '.js')
  if (!js) return
  const issues = []
  if (/setInterval\(|setTimeout\(/.test(js) && !/onUnload/.test(js)) {
    issues.push('用了定时器但没有 onUnload')
  }
  if (/setInterval\(/.test(js) && !/clearInterval/.test(js)) {
    issues.push('setInterval 没有对应 clearInterval')
  }
  if (/audio\.on\(/.test(js)) {
    const hasOff = /_off/.test(js) && /onUnload/.test(js)
    if (!hasOff) issues.push('订阅了 audio 事件，onUnload 未退订（监听器泄漏）')
  }
  if (/createInnerAudioContext|wx\.onLocationChange|wx\.onNetworkStatusChange/.test(js) && !/onUnload/.test(js)) {
    issues.push('持有全局实例但无 onUnload 清理')
  }
  if (issues.length) console.log('  [!]', p, '->', issues.join('; '))
})

/* ---------- B. 分享 / 下拉刷新覆盖 ---------- */
console.log('\n=== B. 分享与下拉刷新覆盖 ===')
const noShare = []
const pullNoStop = []
PAGES.forEach((p) => {
  const js = read(p + '.js')
  const json = p + '.json'
  const cfg = fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, 'utf8')) : {}
  if (!/onShareAppMessage/.test(js)) noShare.push(p)
  if (cfg.enablePullDownRefresh && !/stopPullDownRefresh/.test(js)) pullNoStop.push(p)
})
console.log('  未配置 onShareAppMessage 的页面 (' + noShare.length + '/' + PAGES.length + '):')
noShare.forEach((p) => console.log('     ', p))
console.log('  开启下拉刷新但没调 stopPullDownRefresh 的页面:', pullNoStop.length ? pullNoStop.join(', ') : '无')

/* ---------- C. setData 用法 ---------- */
console.log('\n=== C. setData 用法检查 ===')
let loopSet = 0
let bigSet = []
PAGES.concat(
  fs.readdirSync('components').map((d) => 'components/' + d + '/' + d)
).forEach((p) => {
  const js = read(p + '.js')
  if (!js) return
  // forEach/map 内部直接 setData（应合并为一次）
  const re = /\.forEach\((?:[^)]*)=>\s*\{?[\s\S]{0,200}?setData\(/g
  if (re.test(js)) {
    console.log('  [!]', p, '循环内可能频繁 setData')
    loopSet++
  }
  // 统计 setData 次数
  const cnt = (js.match(/setData\(/g) || []).length
  if (cnt > 12) bigSet.push([p, cnt])
})
console.log('  循环内 setData 嫌疑:', loopSet)
console.log('  setData 调用次数偏多的文件:')
bigSet.sort((a, b) => b[1] - a[1]).forEach(([p, c]) => console.log('     ', String(c).padStart(3), p))

/* ---------- D. 页面连通性（是否有孤岛页面） ---------- */
console.log('\n=== D. 页面连通性 ===')
const allCode = PAGES.map((p) => read(p + '.js')).join('\n') +
  fs.readdirSync('components').map((d) => read('components/' + d + '/' + d + '.js')).join('\n') +
  read('app.js') + read('app.json')
const tabSet = new Set(app.tabBar.list.map((t) => t.pagePath))
const orphan = PAGES.filter((p) => {
  if (tabSet.has(p)) return false
  const re = new RegExp(p + "(\\?|'|\\\"|`)")
  return !re.test(allCode)
})
console.log('  没有任何入口跳转到的页面:', orphan.length ? orphan.join(', ') : '无')

/* ---------- E. 错误处理覆盖 ---------- */
console.log('\n=== E. Promise 错误处理 ===')
let noCatch = []
PAGES.forEach((p) => {
  const js = read(p + '.js')
  if (!js) return
  // 找出 .then( 后面既没有 .catch( 也没有第二个参数的情况（粗略）
  const lines = js.split('\n')
  let depth = 0
  lines.forEach((l, i) => {
    if (/\.then\(/.test(l)) depth++
    if (/\.catch\(/.test(l) || /,\s*\(?e\)?\s*=>/.test(l)) depth = 0
  })
  const thenCount = (js.match(/\.then\(/g) || []).length
  const catchCount = (js.match(/\.catch\(/g) || []).length
  if (thenCount - catchCount > 1) noCatch.push([p, thenCount, catchCount])
})
console.log('  then 明显多于 catch 的页面:')
noCatch.forEach(([p, t, c]) => console.log('     ', p, 'then=' + t, 'catch=' + c))
if (!noCatch.length) console.log('     无')

/* ---------- F. 隐私/权限相关 ---------- */
console.log('\n=== F. 权限与合规 ===')
const permRe = /(wx\.getLocation|wx\.chooseImage|wx\.chooseMedia|wx\.getUserInfo|wx\.chooseAddress|wx\.saveImageToPhotosAlbum|wx\.authorize)/g
const perms = new Set()
PAGES.concat(fs.readdirSync('components').map((d) => 'components/' + d + '/' + d)).forEach((p) => {
  const js = read(p + '.js')
  let m
  while ((m = permRe.exec(js))) perms.add(m[1] + '  (' + p + ')')
})
if (perms.size) [...perms].forEach((x) => console.log('  用到的敏感 API:', x))
else console.log('  未使用需要授权的敏感 API')
const appJsonStr = fs.readFileSync('app.json', 'utf8')
console.log('  app.json 是否声明 permission:', /permission/.test(appJsonStr) ? '是' : '否')
console.log('  app.json 是否声明 requiredPrivateInfos:', /requiredPrivateInfos/.test(appJsonStr) ? '是' : '否')
