/**
 * 明道云对接改造专项验证（Node 直跑，无需 DevTools）
 *
 * 覆盖 5 项在 mock 模式下「静默生效、跑不到」的逻辑：
 *   1. 工作表别名 → 真实 worksheetId 的 URL 重写
 *   2. 单选/多选 业务值 ⇄ 选项 key 双向映射
 *   3. Date(15) / DateTime(16) 写入格式规范化
 *   4. 关联记录(29) 筛选值自动包成 rowId 数组
 *   5. 写操作不重试（幂等保护）
 *
 * 用法：node tools/mingdao-test.js
 */
const store = {}
global.wx = {
  setStorageSync: (k, v) => { store[k] = v },
  getStorageSync: (k) => (k in store ? store[k] : ''),
  removeStorageSync: (k) => { delete store[k] },
  getStorageInfoSync: () => ({ keys: Object.keys(store) })
}

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('PASS:', msg)
}

const tables = require('../config/tables')
const optionKeys = require('../config/option-keys')
const config = require('../config/index')
const { buildFields, flattenRow, filterCond } = require('../api/adapters')
const { isRetryable } = require('../api/request')
const { toMysqlDate, toMysqlDatetime } = require('../utils/format')

/* ---------- 1. URL 重写 ---------- */
const listUrl = '/v3/app/worksheets/reservations/rows/list'
assert(tables.rewriteUrl(listUrl) === listUrl, '未配置 worksheetId 时回退为别名')
assert(tables.missing().length === 15, '15 张表待填 worksheetId')
assert(tables.missing().indexOf('reservations') >= 0, '待填清单包含 reservations')

const backup = tables.TABLES.reservations
tables.TABLES.reservations = '69a1c2b3d4e5f60718293a4b'
assert(
  tables.rewriteUrl(listUrl) === '/v3/app/worksheets/69a1c2b3d4e5f60718293a4b/rows/list',
  '列表路径中的别名被替换为真实 worksheetId'
)
assert(
  tables.rewriteUrl('/v3/app/worksheets/reservations/rows/res_001') ===
    '/v3/app/worksheets/69a1c2b3d4e5f60718293a4b/rows/res_001',
  '详情路径中的别名被替换（含 rowId 段保留）'
)
assert(tables.rewriteUrl('/v3/app') === '/v3/app', '非工作表路径不被改写')
assert(tables.missing().length === 14, '填入后待填数量递减')
tables.TABLES.reservations = backup

/* ---------- 2. 选项 key 映射 ---------- */
// 未配置时恒等映射（保证 mock 行为不变）
assert(optionKeys.toKey('news', 'category', '英烈事迹') === '英烈事迹', '未配置映射时写入保持原值')
assert(optionKeys.toLabel('news', 'category', '英烈事迹') === '英烈事迹', '未配置映射时读取保持原值')

// 配置后双向转换
optionKeys.MAP['news.category'] = { 资讯: '1', 英烈事迹: '2', 红色故事: '3' }
optionKeys.MAP['visitors.isDefault'] = { '1': 'opt_show', '0': 'opt_hide' }
assert(optionKeys.toKey('news', 'category', '英烈事迹') === '2', '写入：中文标签 → 选项 key')
assert(optionKeys.toLabel('news', 'category', '2') === '英烈事迹', '读取：选项 key → 中文标签')
assert(optionKeys.toLabel('news', 'category', '99') === '99', '未知 key 原样返回（不丢数据）')
assert(optionKeys.toKey('news', 'category', '不存在') === '不存在', '未知业务值原样返回')
assert(optionKeys.toKey('visitors', 'isDefault', '1') === 'opt_show', '键值型字段（页面判 1/0）同样可映射')

/* ---------- 3. 日期格式规范化 ---------- */
assert(toMysqlDate('2026-10-28T08:34:58.000Z').length === 10, 'DateTime 输入转 Date 字段取 YYYY-MM-DD')
assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(toMysqlDatetime(new Date())), 'DateTime 写入为 YYYY-MM-DD HH:mm:ss')
assert(toMysqlDatetime('2026-10-28T08:34:58.000Z').indexOf('T') < 0, '不再出现 ISO 的 T 分隔符')
assert(toMysqlDatetime('') === '', '空值返回空串')

const resvFields = buildFields(
  { visitDate: '2026-11-01T00:00:00.000Z', createTime: new Date('2026-10-28T08:34:58.000Z'), status: '待审核' },
  'reservations'
)
const byId = (id) => resvFields.filter((f) => f.id === id)[0]
assert(byId('visitDate').value === '2026-11-01', 'buildFields：Date 字段落为 YYYY-MM-DD')
assert(byId('createTime').value === '2026-10-28 16:34:58', 'buildFields：DateTime 字段按本地时区落为 YYYY-MM-DD HH:mm:ss')
assert(Array.isArray(byId('status').value) && byId('status').value.length === 1, 'buildFields：单选落为 key 数组')

/* ---------- 4. 关联字段筛选值 ---------- */
optionKeys.MAP['reservations.status'] = { 待审核: '1', 已通过: '2', 已取消: '4' }
assert(
  buildFields({ status: '已通过' }, 'reservations').filter((f) => f.id === 'status')[0].value[0] === '2',
  'buildFields：单选经映射表转真实 key'
)

const relCond = filterCond('exhibitionId', 'eq', 'exh_02', 'artifacts')
assert(Array.isArray(relCond.value) && relCond.value[0] === 'exh_02', '关联记录(29) eq 值被包成 rowId 数组')

const plainCond = filterCond('userId', 'eq', 'demo_user', 'reservations')
assert(!Array.isArray(plainCond.value), '普通文本字段 eq 保持裸值')

const inCond = filterCond('status', 'in', '待审核', 'reservations')
assert(Array.isArray(inCond.value), 'in 运算符的值被包成数组')

const noWsCond = filterCond('exhibitionId', 'eq', 'exh_02')
assert(!Array.isArray(noWsCond.value), '不传 ws 时保持向后兼容（不做类型判断）')

/* ---------- 5. 写操作不重试 ---------- */
assert(isRetryable('GET', '/v3/app/worksheets/reservations/rows/res_001') === true, 'GET 详情可重试')
assert(isRetryable('POST', '/v3/app/worksheets/reservations/rows/list') === true, 'POST 列表查询可重试')
assert(isRetryable('POST', '/v3/app/worksheets/reservations/rows') === false, 'POST 新建不可重试（防重复写入）')
assert(isRetryable('PATCH', '/v3/app/worksheets/reservations/rows/res_001') === false, 'PATCH 更新不可重试')
assert(isRetryable('DELETE', '/v3/app/worksheets/reservations/rows/res_001') === false, 'DELETE 不可重试')

/* ---------- 6. 读取侧映射回中文 ---------- */
const row = {
  id: 'row_1',
  fields: [
    { id: 'category', value: ['2'] },
    { id: 'isTop', value: ['1'] },
    { id: 'publishTime', value: '2026-10-28T08:34:58.000Z' }
  ]
}
const flat = flattenRow(row, 'news')
assert(flat.category === '英烈事迹', 'flattenRow：选项 key 翻回中文标签')
assert(flat.isTop === '1', 'flattenRow：未配置映射的键值型字段保持原值')
assert(flat.publishTime === '2026-10-28 16:34:58', 'flattenRow：DateTime 读回统一格式')
assert(flat.id === 'row_1', 'flattenRow：行 ID 保留在顶层')

console.log('\n===== 明道云对接改造专项验证通过（6 组 / 35 项断言）=====')
