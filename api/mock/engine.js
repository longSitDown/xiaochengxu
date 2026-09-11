/**
 * Mock 引擎：模拟明道云 API V3 的响应结构与行为
 *
 * 模拟范围（对齐 mingdao-api.md）：
 *   - 统一响应包 { success, error_code, error_msg, data }（HTTP 恒 200，业务看 body）
 *   - 成功判定：success === true && error_code === 1
 *   - 行记录嵌套结构：{ id, fields: [{id, value, type, controlName}], _createdAt, ... }
 *   - 筛选器 filters 递归结构（group/condition、AND/OR、两层嵌套）
 *   - 分页 pageSize/pageIndex、排序 sortId/isAsc、关键词 keywords
 *   - 新建返回 { rowId }
 *
 * 支持的路由：
 *   GET    /v3/app                                  应用信息
 *   POST   /v3/app/worksheets/list                  工作表列表
 *   GET    /v3/app/worksheets/{ws}                  工作表结构
 *   POST   /v3/app/worksheets/{ws}/rows/list        行记录列表（筛选/分页）
 *   GET    /v3/app/worksheets/{ws}/rows/{rowId}     行记录详情
 *   POST   /v3/app/worksheets/{ws}/rows             新建行记录
 *   PATCH  /v3/app/worksheets/{ws}/rows/{rowId}     更新行记录
 *   DELETE /v3/app/worksheets/{ws}/rows/{rowId}     删除行记录
 */
const db = require('./db')
const { SCHEMES } = require('./schema')
const { genId } = require('../../utils/format')
const config = require('../../config/index')

/* ---------------- 响应包 ---------------- */

/**
 * 统一成功响应包：HTTP 恒为 200，业务成败看 response body。
 * 明道云约定：success===true 且 error_code===1 视为成功，因此在 mock 中保持一致。
 */
function ok(data) {
  return { success: true, error_code: 1, error_msg: '', data: data == null ? {} : data }
}

/** 统一失败响应包，error_code 传递业务错误码（如 10007 记录不存在、430022 工作表不存在） */
function fail(error_code, error_msg) {
  return { success: false, error_code, error_msg, data: {} }
}

/* ---------------- 值转换：扁平对象 ⇄ 明道云 fields[] ---------------- */
// 内部存储用「扁平对象」（{字段别名: 值}），而明道云出参/入参为 fields[]。
// 因此所有读写都要在两种形态间转换，转换规则完全依赖字段的 type。

const ATTACH = '14'
const SINGLE = '9'
const MULTI = '10'
const NUMBER = '6'

/**
 * 扁平值 → 明道云出参格式（按字段类型）。
 * 格式化成 README 停更文档里对外的字段值形态：
 *   Attachment → [{name,url}]；SingleSelect → [单个值]；MultipleSelect → [数组]；
 *   Number → 数字；其余文本类 → 字符串。
 */
function formatOut(value, f) {
  switch (f.type) {
    case ATTACH:
      if (!value) return []
      return [{ name: String(value).split('/').pop(), url: String(value) }]
    case SINGLE:
      return value == null || value === '' ? [] : [String(value)]
    case MULTI:
      if (Array.isArray(value)) return value.map(String)
      return value ? String(value).split(',').filter(Boolean) : []
    case NUMBER:
      return Number(value) || 0
    default:
      return value == null ? '' : String(value)
  }
}

/**
 * 明道云入参值 → 扁平存储格式（formatOut 的逆操作）。
 * 需兼容前端传入的多种形态（数组/JSON 字符串/裸值），
 * 例如 Attachment 可能直接给 URL 字符串或 object[]。
 */
function normIn(value, f) {
  if (value == null) return f.type === MULTI ? [] : ''
  switch (f.type) {
    case ATTACH: {
      let v = value
      if (typeof v === 'string') {
        try {
          v = JSON.parse(v)
        } catch (e) {
          return v // 直接是 URL 字符串
        }
      }
      if (Array.isArray(v) && v.length) {
        const a = v[0]
        return typeof a === 'string' ? a : a.url || ''
      }
      return ''
    }
    case SINGLE:
      if (Array.isArray(value)) return value.length ? String(value[0]) : ''
      return String(value)
    case MULTI:
      if (Array.isArray(value)) return value.map(String)
      return String(value).split(',').map((s) => s.trim()).filter(Boolean)
    case NUMBER: {
      const n = Number(value)
      return isNaN(n) ? 0 : n
    }
    default:
      return String(value)
  }
}

/**
 * 扁平对象 → 明道云行记录。
 * row.id 是行主键；row.fields 按 schema 字段顺序列出每个字段的 {id(别名),value,type,controlName}；
 * 系统字段（_createdAt/_updatedAt 与 _owner 等四类）有值才带出，模拟明道云出参结构。
 */
function toRow(flat, schema) {
  const fields = schema.fields.map((f) => ({
    id: f.id,
    value: formatOut(flat[f.id], f),
    type: f.type,
    controlName: f.controlName
  }))
  const row = { id: flat.id, fields }
  ;['_createdAt', '_updatedAt'].forEach((k) => {
    if (flat[k]) row[k] = flat[k]
  })
  ;['_owner', '_createdBy', '_updatedBy'].forEach((k) => {
    if (flat[k]) row[k] = flat[k]
  })
  return row
}

/**
 * 明道云 fields[] 入参 → 扁平补丁对象。
 * 只取 schema 中真实存在的字段别名（item.id），逐字段做 normIn 转换；
 * 别名不匹配的传入字段直接忽略，避免脏数据写入。
 */
function fieldsToPatch(fields, schema) {
  const patch = {}
  ;(fields || []).forEach((item) => {
    const f = schema.fields.find((x) => x.id === item.id)
    if (f) patch[f.id] = normIn(item.value, f)
  })
  return patch
}

/* ---------------- 筛选器 ---------------- */
// filters 支持递归结构：节点可type='group'（内含 children + logic: AND/OR），
// 也可type='condition'（对单字段做条件匹配）。matchFilter 递归遍历，
// matchCondition 处理单条条件的全部操作符。

/** 值比较：两值都能转数字则按数值比较，否则按中文字符串字典序比较 */
function cmp(a, b) {
  const na = Number(a)
  const nb = Number(b)
  if (!isNaN(na) && !isNaN(nb) && a !== '' && b !== '') return na - nb
  return String(a).localeCompare(String(b), 'zh-CN')
}

function isEmptyVal(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

/**
 * 匹配单条条件。难点在于操作符语义与多值处理：
 * eq/ne 在值是数组时退化为「包含/不包含判断」；in/notin 做集合匹配；
 * contains/notcontains 是任一关键词子串命中；concurrent 要求关键词全部命中。
 */
function matchCondition(flat, cond) {
  const v = flat[cond.field]
  const val = cond.value
  const asArr = Array.isArray(val) ? val.map(String) : null
  switch (cond.operator) {
    case 'eq':
      return asArr ? asArr.indexOf(String(v)) >= 0 : String(v) === String(val)
    case 'ne':
      return !(asArr ? asArr.indexOf(String(v)) >= 0 : String(v) === String(val))
    case 'gt':
      return cmp(v, val) > 0
    case 'ge':
      return cmp(v, val) >= 0
    case 'lt':
      return cmp(v, val) < 0
    case 'le':
      return cmp(v, val) <= 0
    case 'in':
      return (asArr || [String(val)]).indexOf(String(v)) >= 0
    case 'notin':
      return (asArr || [String(val)]).indexOf(String(v)) < 0
    case 'contains': {
      const kw = asArr ? asArr : [String(val)]
      return kw.some((k) => String(v).indexOf(k) >= 0)
    }
    case 'notcontains': {
      const kw = asArr ? asArr : [String(val)]
      return !kw.some((k) => String(v).indexOf(k) >= 0)
    }
    case 'concurrent': {
      const kw = asArr || [String(val)]
      return kw.every((k) => String(v).indexOf(k) >= 0)
    }
    case 'startswith':
      return String(v).indexOf(String(val)) === 0
    case 'endswith':
      return String(v).lastIndexOf(String(val)) === String(v).length - String(val).length
    case 'between':
      return Array.isArray(val) && val.length === 2 && cmp(v, val[0]) >= 0 && cmp(v, val[1]) <= 0
    case 'notbetween':
      return !(Array.isArray(val) && val.length === 2 && cmp(v, val[0]) >= 0 && cmp(v, val[1]) <= 0)
    case 'isempty':
      return isEmptyVal(v)
    case 'isnotempty':
      return !isEmptyVal(v)
    default:
      return true
  }
}

/**
 * 递归匹配筛选器节点（支持两层以上嵌套）。
 * group 节点：对每个子节点递归求布尔，再按 logic(AND/OR) 聚合为 some/every；
 * 叶子节点（condition）直接走 matchCondition。
 */
function matchFilter(flat, node) {
  if (!node) return true
  if (node.type === 'group') {
    const children = node.children || []
    if (!children.length) return true
    const results = children.map((c) => matchFilter(flat, c))
    return (node.logic || 'AND').toUpperCase() === 'OR'
      ? results.some(Boolean)
      : results.every(Boolean)
  }
  return matchCondition(flat, node)
}

/* ---------------- 应用信息 ---------------- */

function appInfo() {
  const sections = [
    { id: 'sec_content', name: '内容管理', items: pick(['banners', 'notices', 'news', 'honors']) },
    { id: 'sec_exhibit', name: '展陈管理', items: pick(['exhibitions', 'artifacts']) },
    { id: 'sec_quiz', name: '知识竞赛', items: pick(['quizActivities', 'questions', 'quizRecords']) },
    { id: 'sec_service', name: '便民服务', items: pick(['reservations', 'reservationQuota', 'visitors', 'guideItems', 'feedbacks', 'users']) }
  ]
  return {
    organizationId: 'org_red_memorial',
    appId: 'app_red_memorial_mp',
    name: '红色纪念馆数字化展示服务系统',
    iconUrl: '/images/logo.png',
    color: '#C8102E',
    desc: '面向社会游客提供线上参观预约、红色知识竞赛、720°全景数字展馆浏览、场馆信息查询、意见反馈等便民服务。',
    remark: '小程序用户端',
    sections
  }
}

function pick(names) {
  return names
    .filter((n) => SCHEMES[n])
    .map((n) => ({ id: SCHEMES[n].worksheetId, name: SCHEMES[n].name, alias: n }))
}

/* ---------------- 行记录操作 ---------------- */

/**
 * 行记录列表查询，处理链路：筛选 → 关键词 → 排序 → 分页。
 * 返回 { success, error_code:1, error_msg:'', data:{ rows, total, pageIndex, pageSize } }。
 */
function listRows(ws, body) {
  const schema = SCHEMES[ws]
  const data = body || {}
  let rows = db.getTable(ws)

  // 筛选（兼容 filters / filter 两种参数名，见 mingdao-api.md 待验证清单 #3）
  const filter = data.filters || data.filter
  if (filter) rows = rows.filter((r) => matchFilter(r, filter))

  // 关键词：匹配所有文本/富文本字段
  if (data.keywords) {
    const kw = String(data.keywords)
    const textFields = schema.fields.filter((f) => ['2', '41'].indexOf(f.type) >= 0).map((f) => f.id)
    rows = rows.filter((r) => textFields.some((k) => String(r[k] || '').indexOf(kw) >= 0))
  }

  // 排序：sortId 传字段别名，isAsc 默认 false（倒序）。
  // 未显式指定时，按表内是否存在 sort/order 字段自动挑选一个做默认排序维度。
  let sortId = data.sortId
  if (!sortId && schema.fields.some((f) => f.id === 'sort')) sortId = 'sort'
  if (!sortId && schema.fields.some((f) => f.id === 'order')) sortId = 'order'
  if (sortId && schema.fields.some((f) => f.id === sortId)) {
    const asc = data.isAsc === true
    rows = rows.slice().sort((a, b) => (asc ? cmp(a[sortId], b[sortId]) : cmp(b[sortId], a[sortId])))
  }

  // 分页：pageIndex/pageSize 做边界兜底（最小 1，pageSize 上限 1000），
  // total 为分页前总行数，保证前端翻页信息准确。
  const total = rows.length
  const pageIndex = Math.max(1, Number(data.pageIndex) || 1)
  const pageSize = Math.min(1000, Math.max(1, Number(data.pageSize) || 20))
  const start = (pageIndex - 1) * pageSize
  const pageRows = rows.slice(start, start + pageSize)

  return ok({
    rows: pageRows.map((r) => toRow(r, schema)),
    total,
    pageIndex,
    pageSize
  })
}

function getRow(ws, rowId) {
  const schema = SCHEMES[ws]
  const row = db.findRow(ws, rowId)
  if (!row) return fail(10007, '数据不存在或已经删除')
  return ok(toRow(row, schema))
}

/** 新建行：写入扁平补丁 + 自增行 id + 时间戳，返回明道云风格的 {rowId}（对齐 mingdao-api.md 5.5.1） */
function createRow(ws, body) {
  const schema = SCHEMES[ws]
  const data = body || {}
  const patch = fieldsToPatch(data.fields, schema)
  const now = new Date().toISOString()
  const row = Object.assign({}, patch, {
    id: genId(ws.slice(0, 3)),
    _createdAt: now,
    _updatedAt: now
  })
  db.insertRow(ws, row)
  // 与明道云一致：新建返回 rowId（mingdao-api.md 5.5.1）
  return ok({ rowId: row.id })
}

/** 更新行：仅合并传入字段的补丁并刷新 _updatedAt；行不存在返回 10007 */
function updateRow(ws, rowId, body) {
  const schema = SCHEMES[ws]
  const patch = fieldsToPatch((body || {}).fields, schema)
  patch._updatedAt = new Date().toISOString()
  const row = db.updateRow(ws, rowId, patch)
  if (!row) return fail(10007, '数据不存在或已经删除')
  return ok({ rowId })
}

/** 删除行：返回删除是否成功，失败（行不存在）返回 10007 */
function deleteRow(ws, rowId) {
  const success = db.removeRow(ws, rowId)
  if (!success) return fail(10007, '数据不存在或已经删除')
  return ok({})
}

function worksheetList() {
  return ok(
    Object.keys(SCHEMES).map((k) => ({
      id: SCHEMES[k].worksheetId,
      name: SCHEMES[k].name,
      alias: k,
      remark: ''
    }))
  )
}

function worksheetStructure(ws) {
  const schema = SCHEMES[ws]
  return ok({
    worksheetId: schema.worksheetId,
    name: schema.name,
    alias: ws,
    desc: '',
    remark: '',
    fields: schema.fields,
    views: [{ id: 'view_all', name: '全部数据', type: 1 }]
  })
}

/* ---------------- 路由 ---------------- */

/**
 * 核心路由跳板：把 URL 拆成路径段后按「段数 + RUC 关键字 + 方法」分派到对应处理函数。
 * 每种路由都可能先校验工作表是否存在于 SCHEMES，不存在一律返回 430022。
 * 匹配顺序从最短路径到最长路径依次判断。
 */
function handle(url, method, data) {
  const path = String(url || '').split('?')[0]
  const parts = path.split('/').filter(Boolean) // ['v3','app','worksheets',...]

  if (parts.join('/') === 'v3/app' && method === 'GET') {
    return ok(appInfo())
  }

  // /v3/app/worksheets/list
  if (parts.length === 4 && parts[3] === 'list' && parts[2] === 'worksheets') {
    return worksheetList()
  }

  // /v3/app/worksheets/{ws}
  if (parts.length === 4 && parts[2] === 'worksheets' && method === 'GET') {
    const ws = parts[3]
    if (!SCHEMES[ws]) return fail(430022, '工作表不存在')
    return worksheetStructure(ws)
  }

  // /v3/app/worksheets/{ws}/rows/list
  if (parts.length === 6 && parts[4] === 'rows' && parts[5] === 'list') {
    const ws = parts[3]
    if (!SCHEMES[ws]) return fail(430022, '工作表不存在')
    return listRows(ws, data)
  }

  // /v3/app/worksheets/{ws}/rows
  if (parts.length === 5 && parts[4] === 'rows') {
    const ws = parts[3]
    if (!SCHEMES[ws]) return fail(430022, '工作表不存在')
    if (method === 'POST') return createRow(ws, data)
    return fail(10001, '参数错误')
  }

  // /v3/app/worksheets/{ws}/rows/{rowId}
  if (parts.length === 6 && parts[4] === 'rows') {
    const ws = parts[3]
    if (!SCHEMES[ws]) return fail(430022, '工作表不存在')
    const rowId = parts[5]
    if (method === 'GET') return getRow(ws, rowId)
    if (method === 'PATCH') return updateRow(ws, rowId, data)
    if (method === 'DELETE') return deleteRow(ws, rowId)
    return fail(10001, '参数错误')
  }

  return fail(10001, '参数错误：未知的接口路径 ' + path)
}

/**
 * 统一入口：加随机延迟模拟真实网络（区间来自 config.MOCK_DELAY，默认 100~300ms）。
 * 用 Promise 包装，使 mock 与真实请求的使用方式完全一致；处理过程任意异常
 * 都会被捕获并转成 error_code=99999 的失败包，不会让 Promise reject 影响前端。
 * @returns {Promise} resolve 明道云响应包（含 success/error_code/data）
 */
function dispatch(options) {
  const { url, method = 'GET', data = {} } = options
  const delayRange = config.MOCK_DELAY || [100, 300]
  const delay = delayRange[0] + Math.random() * (delayRange[1] - delayRange[0])
  return new Promise((resolve) => {
    setTimeout(() => {
      let envelope
      try {
        envelope = handle(url, method, data)
      } catch (e) {
        envelope = fail(99999, '数据操作异常：' + (e && e.message))
      }
      resolve(envelope)
    }, delay)
  })
}

module.exports = { dispatch }
