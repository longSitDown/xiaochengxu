/**
 * 预约人服务：实名参观人（身份证）的增删改查
 *
 * 业务规则：
 *   - 身份证号格式校验（18 位校验码算法，兼容 15 位老证）
 *   - 同一用户下身份证号不可重复
 *   - 每个用户最多一个「默认预约人」（预约表单默认勾选）
 */
const { request } = require('./request')
const { flattenRow, flattenRows, buildFields, filterGroup, filterCond } = require('./adapters')
const { validateIdCard } = require('../utils/format')

const WS = 'visitors'
const MAX_COUNT = 20

/** 某用户的预约人列表（默认优先，其余按创建时间倒序） */
function getVisitors(userId) {
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 100,
      pageIndex: 1,
      sortId: 'createTime',
      isAsc: false,
      filters: filterGroup('AND', [filterCond('userId', 'eq', userId)])
    }
  }).then((data) =>
    flattenRows(data, WS)
      .sort((a, b) => (a.isDefault === '1' ? -1 : b.isDefault === '1' ? 1 : 0))
  )
}

/**
 * 新增 / 编辑预约人（id 为空即新增）
 * @param {{id?, userId, name, idCard, phone?, isDefault?}} data
 * @throws {code:'BAD_IDCARD'|'DUP_IDCARD'|'TOO_MANY', message}
 */
function saveVisitor(data) {
  // 三合一把关：① 姓名非空 → ② 身份证 18 位格式校验 → ③ 同用户身份证去重；
  // 任一不过则在写库前直接拒绝，返回对应错误码。
  const idCard = String(data.idCard || '').trim().toUpperCase()
  if (!data.name || !String(data.name).trim()) {
    return Promise.reject({ code: 'BAD_NAME', message: '请填写姓名' })
  }
  if (!validateIdCard(idCard)) {
    return Promise.reject({ code: 'BAD_IDCARD', message: '身份证号格式不正确' })
  }
  return getVisitors(data.userId)
    .then((list) => {
      // 同用户下身份证去重（编辑时排除自身，允许改自己的其他字段）
      if (list.some((v) => v.idCard.toUpperCase() === idCard && v.id !== data.id)) {
        throw { code: 'DUP_IDCARD', message: '该身份证已添加为预约人（' + list.find((v) => v.idCard.toUpperCase() === idCard).name + '）' }
      }
      // 上限：仅新增时校验，编辑不算新增
      if (!data.id && list.length >= MAX_COUNT) {
        throw { code: 'TOO_MANY', message: '预约人最多添加 ' + MAX_COUNT + ' 位' }
      }
      // 设为默认前，先取消其它默认 → 保证每个用户「默认唯一」
      const unset = data.isDefault === '1'
        ? list.filter((v) => v.isDefault === '1' && v.id !== data.id).map((v) => patchRow(v.id, { isDefault: '0' }))
        : []
      return Promise.all(unset)
    })
    .then(() => {
      const body = {
        userId: data.userId,
        name: String(data.name).trim(),
        idCard,
        phone: String(data.phone || '').trim(),
        isDefault: data.isDefault === '1' ? '1' : '0'
      }
      if (data.id) {
        return patchRow(data.id, body).then(() => getVisitor(data.id))
      }
      return request({
        url: '/v3/app/worksheets/' + WS + '/rows',
        method: 'POST',
        data: {
          fields: buildFields(Object.assign({}, body, { createTime: new Date().toISOString() }), WS),
          triggerWorkflow: false
        }
      }).then((res) => getVisitor(res.rowId))
    })
}

function getVisitor(id) {
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows/' + id,
    method: 'GET'
  }).then((row) => flattenRow(row, WS))
}

function removeVisitor(id) {
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows/' + id,
    method: 'DELETE'
  }).then(() => true)
}

/** PATCH 单行（内部工具） */
function patchRow(id, patch) {
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows/' + id,
    method: 'PATCH',
    data: { fields: buildFields(patch, WS) }
  })
}

module.exports = { getVisitors, saveVisitor, removeVisitor }
