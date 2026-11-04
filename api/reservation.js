/**
 * 参观预约服务：名额校验 / 预约创建 / 取消 / 改期 / 核销码
 *
 * 业务规则：
 *   - 名额余量 = totalQuota - usedQuota，创建预约前校验，不足则拒绝
 *   - 创建成功扣减名额；取消/驳回释放名额
 *   - 预约状态：待审核 → 已通过 / 已驳回；可取消；入馆核销后为已核销
 *   - 实名预约：visitors 为参观人（含身份证）数组，进馆凭身份证核验
 */
const { request } = require('./request')
const { flattenRows, flattenRow, buildFields, filterGroup, filterCond } = require('./adapters')
const { safeParse, toMysqlDatetime } = require('../utils/format')

const WS = {
  reservations: 'reservations',
  quota: 'reservationQuota'
}

/** visitors JSON 字符串 → 数组（读取侧统一装饰，页面直接消费） */
function decorate(resv) {
  if (!resv) return resv
  const list = safeParse(resv.visitors, [])
  resv.visitors = Array.isArray(list) ? list : []
  return resv
}

/* ---------------- 名额 ---------------- */
/*
 * 名额统一采用「读改写」模式：findQuota 读当前余量（available = total - used）
 * 做校验 → updateQuota 写回 usedQuota。流程是「先查后写」，
 * 多端同时操作同一行时原子性依赖后端（明道云脚本）对行的加锁/合并来保证。
 */

/** 查询某日期（可含时段）的名额，返回 [{id, visitDate, timeSlot, totalQuota, usedQuota, available}] */
function getQuotas(visitDate) {
  const conds = []
  if (visitDate) conds.push(filterCond('visitDate', 'eq', visitDate))
  return request({
    url: '/v3/app/worksheets/' + WS.quota + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 50,
      pageIndex: 1,
      sortId: 'visitDate',
      isAsc: true,
      filters: conds.length ? filterGroup('AND', conds) : undefined
    }
  }).then((data) =>
    flattenRows(data, WS.quota).map((q) =>
      Object.assign({}, q, { available: Math.max(0, q.totalQuota - q.usedQuota) })
    )
  )
}

function findQuotaId(visitDate, timeSlot) {
  return getQuotas(visitDate).then(
    (list) => list.find((q) => q.timeSlot === timeSlot) || null
  )
}

/** 名额增减统一在此写回（usedQuota 已是调整后的绝对值，非增量） */
function updateQuota(quotaId, total, used) {
  return request({
    url: '/v3/app/worksheets/' + WS.quota + '/rows/' + quotaId,
    method: 'PATCH',
    data: {
      fields: [
        { id: 'usedQuota', value: String(used) },
        { id: 'totalQuota', value: String(total) }
      ]
    }
  })
}

/* ---------------- 预约记录 ---------------- */

/** 我的预约列表（按创建时间倒序） */
function getMyReservations(userId) {
  return request({
    url: '/v3/app/worksheets/' + WS.reservations + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 50,
      pageIndex: 1,
      sortId: 'createTime',
      isAsc: false,
      filters: filterGroup('AND', [filterCond('userId', 'eq', userId)])
    }
  }).then((data) => flattenRows(data, WS.reservations).map(decorate))
}

/** 预约详情 */
function getReservationDetail(id) {
  return request({
    url: '/v3/app/worksheets/' + WS.reservations + '/rows/' + id,
    method: 'GET'
  }).then((data) => decorate(flattenRow(data, WS.reservations)))
}

/**
 * 创建预约
 * @param {{userId, type:'个人'|'团体', visitDate, timeSlot, visitorCount,
 *          organization?, contactName, contactPhone, contactIdCard?,
 *          visitors?:[{name, idCard, phone}]?, remark?}} data
 * @throws {code:'QUOTA_FULL'|'DATE_CLOSED', message} 名额不足 / 日期未开放
 */
function createReservation(data) {
  return findQuotaId(data.visitDate, data.timeSlot)
    .then((quota) => {
      // 校验在扣名额之前：查不到名额 → DATE_CLOSED；余量不足 → QUOTA_FULL（均不写库）
      if (!quota) {
        throw { code: 'DATE_CLOSED', message: '该日期暂未开放预约，请选择其它日期' }
      }
      if (quota.available < data.visitorCount) {
        throw { code: 'QUOTA_FULL', message: '该时段剩余名额不足（当前余量 ' + quota.available + ' 人）' }
      }
      // 1. 先扣减名额
      return updateQuota(quota.id, quota.totalQuota, quota.usedQuota + data.visitorCount).then(
        () => quota
      )
    })
    .then(() =>
      // 2. 创建预约记录（visitors 数组序列化为 JSON 存储）
      request({
        url: '/v3/app/worksheets/' + WS.reservations + '/rows',
        method: 'POST',
        data: {
          fields: buildFields(
            Object.assign({}, data, {
              visitors: JSON.stringify(Array.isArray(data.visitors) ? data.visitors : []),
              contactIdCard: data.contactIdCard || '',
              status: '待审核',
              rejectReason: '',
              qrCode: '',
              // 明道云 DateTime(16) 要求 'YYYY-MM-DD HH:mm:ss'，不可用 toISOString()
              createTime: toMysqlDatetime(new Date())
            }),
            WS.reservations
          ),
          triggerWorkflow: false
        }
      })
    )
    .then((res) =>
      // 3. 回填核销二维码（REDHALL-预约ID）
      request({
        url: '/v3/app/worksheets/' + WS.reservations + '/rows/' + res.rowId,
        method: 'PATCH',
        data: { fields: [{ id: 'qrCode', value: 'REDHALL-' + res.rowId }] }
      }).then(() => getReservationDetail(res.rowId))
    )
}

/**
 * 取消预约（仅待审核/已通过状态可取消），并释放名额
 */
function cancelReservation(id) {
  return getReservationDetail(id).then((res) => {
    if (['已取消', '已核销', '已驳回'].indexOf(res.status) >= 0) {
      throw { code: 'BAD_STATE', message: '当前状态不可取消' }
    }
    return request({
      url: '/v3/app/worksheets/' + WS.reservations + '/rows/' + id,
      method: 'PATCH',
      data: { fields: [{ id: 'status', value: '已取消' }] }
    }).then(() => releaseQuota(res)).then(() => getReservationDetail(id))
  })
}

/**
 * 改期：释放原时段名额 → 校验新时段 → 扣减新时段名额 → 更新记录
 */
function rescheduleReservation(id, next) {
  return getReservationDetail(id).then((res) => {
    if (['已取消', '已核销', '已驳回'].indexOf(res.status) >= 0) {
      throw { code: 'BAD_STATE', message: '当前状态不可改期' }
    }
    const sameSlot = res.visitDate === next.visitDate && res.timeSlot === next.timeSlot
    const count = next.visitorCount || res.visitorCount
    if (sameSlot && count === res.visitorCount) {
      throw { code: 'NO_CHANGE', message: '未修改参观日期或时段' }
    }
    let p = Promise.resolve()
    // 1. 释放原名额
    if (!sameSlot) p = p.then(() => releaseQuota(res))
    // 2. 校验并扣减新名额
    return p
      .then(() => findQuotaId(next.visitDate, next.timeSlot))
      .then((quota) => {
        if (!quota) throw { code: 'DATE_CLOSED', message: '该日期暂未开放预约' }
        if (quota.available < count) {
          // 回滚：恢复原名额
          return restoreQuota(res).then(() => {
            throw { code: 'QUOTA_FULL', message: '新时段剩余名额不足（当前余量 ' + quota.available + ' 人）' }
          })
        }
        return updateQuota(quota.id, quota.totalQuota, quota.usedQuota + count)
      })
      .then(() =>
        request({
          url: '/v3/app/worksheets/' + WS.reservations + '/rows/' + id,
          method: 'PATCH',
          data: {
            fields: [
              { id: 'visitDate', value: next.visitDate },
              { id: 'timeSlot', value: next.timeSlot },
              { id: 'visitorCount', value: String(count) },
              { id: 'status', value: '待审核' }
            ]
          }
        })
      )
      .then(() => getReservationDetail(id))
  })
}

/* ---------------- 名额内部工具 ---------------- */

function releaseQuota(res) {
  return restoreQuota(res)
}

function restoreQuota(res) {
  return findQuotaId(res.visitDate, res.timeSlot).then((quota) => {
    if (!quota) return
    return updateQuota(quota.id, quota.totalQuota, Math.max(0, quota.usedQuota - res.visitorCount))
  })
}

module.exports = {
  getQuotas,
  getMyReservations,
  getReservationDetail,
  createReservation,
  cancelReservation,
  rescheduleReservation
}
