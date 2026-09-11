/**
 * 明道云数据适配器
 *
 * 职责：在「明道云行记录结构」与「页面业务对象」之间做双向转换。
 * mock 与真实接口返回的都是 rows[].fields[] 嵌套结构，因此该适配器
 * 在两种模式下走同一份代码 —— 这是从 mock 无缝切换到明道云的关键。
 *
 *   flattenRow(row, ws)  明道云行记录 → 扁平业务对象（附件取首图 URL、单选取 key、数值转 Number）
 *   buildFields(obj, ws) 扁平业务对象 → 明道云 { fields: [{id, value}] } 写入格式
 */
const { SCHEMES } = require('./mock/schema')

// 明道云字段类型（type）数字编码
const ATTACH = '14'
const SINGLE = '9'
const MULTI = '10'
const NUMBER = '6'

/** 明道云字段值 → 业务字段值 */
function normalizeOut(value, f) {
  switch (f.type) {
    case ATTACH: // 附件 → 取第一个附件的 URL 字符串
      if (Array.isArray(value) && value.length) {
        const a = value[0]
        return typeof a === 'string' ? a : a.url || ''
      }
      return ''
    case SINGLE: // 单选 → key 字符串
      if (Array.isArray(value)) return value.length ? value[0] : ''
      return value == null ? '' : value
    case MULTI: // 多选 → key 数组
      if (Array.isArray(value)) return value
      return value ? String(value).split(',').filter(Boolean) : []
    case NUMBER:
      return Number(value) || 0
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
      const item = fields.find((x) => x.id === f.id)
      out[f.id] = normalizeOut(item ? item.value : '', f)
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
function formatIn(value, f) {
  switch (f.type) {
    case ATTACH: // 附件 → JSON 字符串 [{name, url}]
      if (!value) return ''
      return JSON.stringify([{ name: String(value).split('/').pop(), url: String(value) }])
    case SINGLE: // 单选 → 选项 key 数组
      return value == null || value === '' ? [] : [String(value)]
    case MULTI: // 多选 → 选项 key 数组
      return Array.isArray(value) ? value.map(String) : String(value || '').split(',').filter(Boolean)
    case NUMBER: // 数值 → 数字字符串
      return String(value == null ? 0 : value)
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
    .map((f) => ({ id: f.id, value: formatIn(obj[f.id], f) }))
}

/**
 * 筛选器为嵌套条件树：
 *   group: { type:'group', logic: 'AND'|'OR', children:[...] } —— 组合/逻辑
 *   condition: { type:'condition', field, operator, value? } —— 单个条件（eq/ne/gt…），
 *     value 省略表示只「存在」判断（如 isNull/notNull）
 */
function filterGroup(logic, children) {
  return { type: 'group', logic, children }
}

function filterCond(field, operator, value) {
  const cond = { type: 'condition', field, operator }
  if (value !== undefined) cond.value = value
  return cond
}

module.exports = { flattenRow, flattenRows, buildFields, filterGroup, filterCond }
