/**
 * 工作表别名 → 明道云真实 worksheetId 映射表
 *
 * 解决的问题：
 *   服务层与 mock 引擎统一用「别名」（如 reservations）作为路径参数，
 *   以便 adapters 通过 SCHEMES[别名] 取到字段定义。
 *   但明道云 V3 的路径参数是 {worksheet_id}，真实值是 24 位记录 ID。
 *   若直接把服务层的 WS 常量换成真实 ID，adapters 的 SCHEMES[ws] 就会查不到，
 *   字段格式化会整体退化为「原样透传」——页面拿到的数据是错的。
 *
 * 方案：服务层保持别名不动，由 request.js 在发请求前把 URL 中的别名段
 *   替换成这里的真实 ID。mock 模式不做替换，engine 继续用别名查 SCHEMES。
 *   → 服务层零改动、adapters 零改动、mock 回归测试不受影响。
 *
 * 填法：
 *   在明道云后台打开应用 → 进入工作表 → 浏览器地址栏或「API 开发文档」中
 *   可看到形如 `69a1c2b3d4e5f60718293a4b` 的 worksheetId，逐项填入。
 *
 * 留空时的行为：
 *   resolve() 回退为别名本身。这便于联调第一枪验证「路径参数是否接受别名」
 *   （mingdao-api.md 5.2.2 只承诺字段可用别名，未承诺工作表可用别名，属待验证项）。
 */
const TABLES = {
  users: '',
  banners: '',
  notices: '',
  news: '',
  honors: '',
  exhibitions: '',
  artifacts: '',
  quizActivities: '',
  questions: '',
  quizRecords: '',
  reservations: '',
  reservationQuota: '',
  visitors: '',
  guideItems: '',
  feedbacks: ''
}

/** 匹配 /v3/app/worksheets/{alias}/rest... 的路径 */
const PATH_RE = /^\/v3\/app\/worksheets\/([^/]+)([\s\S]*)$/

/** 别名 → 真实 ID（未配置时回退别名） */
function resolve(alias) {
  const id = String(TABLES[alias] || '').trim()
  return id || alias
}

/** 把请求 URL 中的工作表别名段替换为真实 ID；非工作表路径原样返回 */
function rewriteUrl(url) {
  const m = PATH_RE.exec(String(url || ''))
  if (!m) return url
  return '/v3/app/worksheets/' + resolve(m[1]) + (m[2] || '')
}

/** 尚未填写真实 ID 的别名列表（联调前置检查用） */
function missing() {
  return Object.keys(TABLES).filter((k) => !String(TABLES[k] || '').trim())
}

/** 是否全部表已映射完成 */
function isComplete() {
  return missing().length === 0
}

module.exports = { TABLES, resolve, rewriteUrl, missing, isComplete }
