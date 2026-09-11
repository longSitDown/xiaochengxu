/**
 * Mock 数据仓库
 *
 * 设计：两层数据合并 —— 静态/动态生成的种子数据(SEEDS) + 用户操作增量(delta)。
 * 增量持久化机制：只把「相对种子而言的变更」以 delta 形式写入 wx.storage，
 * 而不是整张表落盘。好处是种子可随代码版本自由更新，同时演示期间用户的
 * 新增/修改/删除操作结果仍能跨页面、跨会话保留。
 *
 * delta 结构：{ added: {<表名>: [新行]}, updated: {<表名>: {<行id>: 补丁}},
 *             removed: {<表名>: [已删行id]} }
 * 读取某表数据时 = 种子行(剔除 removed 的，叠加 updated 补丁) ∪ added 新增行。
 */
const storage = require('../../utils/storage')

const homeSeed = require('./seed/home')
const exhibitionSeed = require('./seed/exhibition')
const quizSeed = require('./seed/quiz')
const reservationSeed = require('./seed/reservation')
const feedbackSeed = require('./seed/feedback')

const SEEDS = {
  users: [],
  banners: homeSeed.banners,
  notices: homeSeed.notices,
  news: homeSeed.news,
  honors: homeSeed.honors,
  exhibitions: exhibitionSeed.exhibitions,
  artifacts: exhibitionSeed.artifacts,
  quizActivities: quizSeed.quizActivities,
  questions: quizSeed.questions,
  quizRecords: [],
  reservations: reservationSeed.reservations,
  reservationQuota: reservationSeed.reservationQuota,
  visitors: reservationSeed.visitors,
  guideItems: reservationSeed.guideItems,
  feedbacks: feedbackSeed.feedbacks
}

const DB_KEY = 'mock_db_delta'
let delta = null // 内存缓存，避免反复读 storage

function emptyDelta() {
  return { added: {}, updated: {}, removed: {} }
}

function loadDelta() {
  if (!delta) {
    delta = storage.getItem(DB_KEY, null)
    if (!delta || typeof delta !== 'object') delta = emptyDelta() // 首次运行/损坏时初始化为空增量
  }
  return delta
}

function saveDelta() {
  storage.setItem(DB_KEY, delta)
}

/**
 * 获取某工作表全量数据（种子 + 增量合并）。
 * 合并顺序：先遍历种子行，跳过被 removed 的记录，并对被 updated 的叠加补丁；
 * 再追加 added 的新增行（同样跳过 removed、叠加补丁，兼顾“新增后又被改/删”）。
 * 所有返回行均为深拷贝，避免调用方误改内部数据。
 */
function getTable(name) {
  const seed = SEEDS[name] || []
  const d = loadDelta()
  const removed = d.removed[name] || []
  const updated = d.updated[name] || {}
  const added = d.added[name] || []

  const rows = []
  seed.forEach((r) => {
    if (removed.indexOf(r.id) >= 0) return
    rows.push(updated[r.id] ? Object.assign({}, r, updated[r.id]) : Object.assign({}, r))
  })
  added.forEach((r) => {
    if (removed.indexOf(r.id) >= 0) return
    rows.push(Object.assign({}, updated[r.id] ? Object.assign({}, r, updated[r.id]) : r))
  })
  return rows
}

function findRow(name, id) {
  return getTable(name).find((r) => r.id === id) || null
}

function insertRow(name, row) {
  const d = loadDelta()
  if (!d.added[name]) d.added[name] = []
  d.added[name].push(Object.assign({}, row))
  saveDelta()
  return findRow(name, row.id)
}

/**
 * 更新一行。关键难点：需区分目标行属于「本次会话新增(added)」还是「种子(seed)」——
 * 新增行直接在 added 数组里就地替换；种子行则写入 updated 补丁（多次修改会不断累积补丁）。
 * 二者都不命中说明该行不存在，返回 null。
 */
function updateRow(name, id, patch) {
  const d = loadDelta()
  const seed = SEEDS[name] || []
  const inSeed = seed.some((r) => r.id === id)
  const inAdded = (d.added[name] || []).some((r) => r.id === id)
  if (inAdded) {
    d.added[name] = d.added[name].map((r) => (r.id === id ? Object.assign({}, r, patch) : r))
  } else if (inSeed) {
    if (!d.updated[name]) d.updated[name] = {}
    d.updated[name][id] = Object.assign({}, d.updated[name][id] || {}, patch)
  } else {
    return null
  }
  saveDelta()
  return findRow(name, id)
}

/**
 * 删除一行，同样按新增/种子双分支处理：
 * 新增行直接从 added 中移除（等价于消失）；种子行则记入 removed 列表（保留原始种子）。
 */
function removeRow(name, id) {
  const d = loadDelta()
  const seed = SEEDS[name] || []
  if ((d.added[name] || []).some((r) => r.id === id)) {
    d.added[name] = d.added[name].filter((r) => r.id !== id)
  } else if (seed.some((r) => r.id === id)) {
    if (!d.removed[name]) d.removed[name] = []
    if (d.removed[name].indexOf(id) < 0) d.removed[name].push(id)
  } else {
    return false
  }
  saveDelta()
  return true
}

/** 清空演示期间的写入（恢复初始种子状态） */
function resetDb() {
  delta = emptyDelta()
  saveDelta()
}

module.exports = { getTable, findRow, insertRow, updateRow, removeRow, resetDb, SEEDS }
