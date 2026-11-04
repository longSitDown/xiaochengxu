/**
 * 明道云数据适配器
 *
 * 职责：在「明道云行记录结构」与「页面业务对象」之间做双向转换。
 * mock 与真实接口返回的都是 rows[].fields[] 嵌套结构，因此该适配器
 * 在两种模式下走同一份代码 —— 这是从 mock 无缝切换到明道云的关键。
 *
 *   flattenRow(row, ws)  明道云行记录 → 扁平业务对象（附件取首图 URL、单选取 key、数值转 Number）
 *   buildFields(obj, ws) 扁平业务对象 → 明道云 { fields: [{id, value}] } 写入格式
 *
 * 对接明道云后的三处增强：
 *   1. 单选/多选 key 映射：真实环境的选项 key 多为数字串，而页面按中文标签判断。
 *      这里按 config/option-keys.js 做双向转换（未配置时为恒等映射，mock 行为不变）。
 *   2. 日期规范化：Date(15) 写 'YYYY-MM-DD'、DateTime(16) 写 'YYYY-MM-DD HH:mm:ss'，
 *      无论上游传 ISO 还是本地时间串都能落到正确格式。
 *   3. 筛选值规范化：关联记录(29) 的 eq 需传 rowId 数组，in/between 等运算符需数组值。
 */
const { SCHEMES } = require('./mock/schema')
const optionKeys = require('../config/option-keys')
const { toMysqlDate, toMysqlDatetime } = require('../utils/format')

// 明道云字段类型（type）数字编码
const ATTACH = '14'
const SINGLE = '9'
const MULTI = '10'
const NUMBER = '6'
const DATE = '15'
const DATETIME = '16'
const RELATION = '29'

/** 必须传数组值的运算符（mingdao-api.md 7.2 / 7.4 第 5 条） */
const ARRAY_OPERATORS = ['in', 'notin', 'between', 'notbetween', 'concurrent', 'belongsto', 'notbelongsto']

/** 按别名 + 字段别名查字段定义 */
function fieldOf(ws, field) {
  const schema = SCHEMES[ws]
  if (!schema) return null
  return schema.fields.filter((f) => f.id === field)[0] || null
}

/** 明道云字段值 → 业务字段值 */
function normalizeOut(value, f, ws) {
  switch (f.type) {
    case ATTACH: // 附件 → 取第一个附件的 URL 字符串
      if (Array.isArray(value) && value.length) {
        const a = value[0]
        return typeof a === 'string' ? a : a.url || ''
      }
      return ''
    case SINGLE: {
      // 单选 → 业务值（优先按映射表把选项 key 翻回中文标签）
      const raw = Array.isArray(value) ? (value.length ? value[0] : '') : value
      if (raw == null || raw === '') return ''
      return optionKeys.toLabel(ws, f.id, raw)
    }
    case MULTI: {
      // 多选 → 业务值数组
      const arr = Array.isArray(value) ? value : value ? String(value).split(',').filter(Boolean) : []
      return arr.map((v) => optionKeys.toLabel(ws, f.id, v))
    }
    case NUMBER:
      return Number(value) || 0
    case DATE:
      return value == null ? '' : toMysqlDate(value)
    case DATETIME:
      return value == null ? '' : toMysqlDatetime(value)
    default:
      return value == null ? '' : value
  }
}

/**
 * 明道云行记录 → 扁平业务对象
 * 核心映射：外层 row 是 { id, fields: [{id, value}, ...], _createdAt... }
 *   fields 里的每一项按 id 与 schema.fields 定义比对，再由 normalizeOut 按字段类型转换，
 *   最终摊平成 { [字段id]: 业务值 } 的扁平对象；时间/属主控制字段按原样补到顶层。
 */
function flattenRow(row, ws) {
  const schema = SCHEMES[ws]
  const out = { id: row.id }
  const fields = row.fields || []
  if (schema) {
    schema.fields.forEach((f) => {
      const item = fields.filter((x) => x.id === f.id)[0]
      out[f.id] = normalizeOut(item ? item.value : '', f, ws)
    })
  } else {
    // 无表结构定义时原样透传
    fields.forEach((x) => {
      out[x.id] = x.value
    })
  }
  // 明道云内置的系统字段补到扁平对象顶层（时间戳 / 属主 / 创建人）
  ;['_createdAt', '_updatedAt'].forEach((k) => {
    if (row[k]) out[k] = row[k]
  })
  ;['_owner', '_createdBy', '_updatedBy'].forEach((k) => {
    if (row[k]) out[k] = row[k]
  })
  return out
}

/** 列表响应 data → 业务对象数组 */
function flattenRows(listData, ws) {
  const rows = (listData && listData.rows) || []
  return rows.map((r) => flattenRow(r, ws))
}

/** 业务字段值 → 明道云写入格式（mingdao-api.md 6.3） */
function formatIn(value, f, ws) {
  switch (f.type) {
    case ATTACH: // 附件 → JSON 字符串 [{name, url}]
      if (!value) return ''
      return JSON.stringify([{ name: String(value).split('/').pop(), url: String(value) }])
    case SINGLE: {
      // 单选 → 选项 key 数组（业务值先按映射表转 key）
      const raw = Array.isArray(value) ? (value.length ? value[0] : '') : value
      if (raw == null || raw === '') return []
      return [String(optionKeys.toKey(ws, f.id, raw))]
    }
    case MULTI: {
      // 多选 → 选项 key 数组
      const arr = Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean)
      return arr.map((v) => String(optionKeys.toKey(ws, f.id, v)))
    }
    case NUMBER: // 数值 → 数字字符串
      return String(value == null ? 0 : value)
    case DATE: // 日期 → YYYY-MM-DD
      return value ? toMysqlDate(value) : ''
    case DATETIME: // 时间 → YYYY-MM-DD HH:mm:ss
      return value ? toMysqlDatetime(value) : ''
    default:
      return value == null ? '' : String(value)
  }
}

/**
 * 扁平业务对象 → 明道云 { fields: [{id, value}] }
 * 有表结构时按 schema.fields 顺序取值，经 formatIn 按字段类型格式化（附件序列化、
 * 选项转 key 数组、数值转字符串），并跳过 undefined 字段；无表结构时透传其余字段。
 */
function buildFields(obj, ws) {
  const schema = SCHEMES[ws]
  if (!schema) {
    return Object.keys(obj)
      .filter((k) => k !== 'id' && k.indexOf('_') !== 0)
      .map((k) => ({ id: k, value: obj[k] }))
  }
  return schema.fields
    .filter((f) => obj[f.id] !== undefined)
    .map((f) => ({ id: f.id, value: formatIn(obj[f.id], f, ws) }))
}

/**
 * 筛选器为嵌套条件树：
 *   group: { type:'group', logic: 'AND'|'OR', children:[...] } —— 组合/逻辑
 *   condition: { type:'condition', field, operator, value? } —— 单个条件（eq/ne/gt…），
 *     value 省略表示只「存在」判断（如 isNull/notNull）
 */

/**
 * 规范化条件值：
 *   - 关联记录(29) 的 eq/ne 需传 rowId 数组（文档 7.2 示例 ["<targetid>"]）
 *   - in/notin/between/concurrent 等运算符的值必须是数组
 * 传入 ws 才能做字段类型判断；不传时仅做运算符层面的规范化，保持向后兼容。
 */
function conditionValue(value, operator, field, ws) {
  if (value === undefined) return undefined
  const isEmpty = value === '' || value == null
  const f = ws && field ? fieldOf(ws, field) : null
  if (f && f.type === RELATION && ['eq', 'ne'].indexOf(operator) >= 0) {
    if (Array.isArray(value)) return value
    return isEmpty ? [] : [String(value)]
  }
  if (ARRAY_OPERATORS.indexOf(operator) >= 0 && !Array.isArray(value)) {
    return isEmpty ? [] : [value]
  }
  return value
}

function filterGroup(logic, children) {
  return { type: 'group', logic, children }
}

/**
 * @param {string} field 字段别名
 * @param {string} operator 运算符
 * @param {*} value 条件值
 * @param {string} [ws] 工作表别名 —— 传入后会按字段类型规范化取值
 */
function filterCond(field, operator, value, ws) {
  const cond = { type: 'condition', field, operator }
  const v = conditionValue(value, operator, field, ws)
  if (v !== undefined) cond.value = v
  return cond
}

module.exports = { flattenRow, flattenRows, buildFields, filterGroup, filterCond, fieldOf }
