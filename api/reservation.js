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
const { safeParse, toMysqlDatetime, formatDate } = require('../utils/format')
const venueApi = require('./venue')

const WS = {
  reservations: 'reservations',
  quota: 'reservationQuota'
}

/** 'YYYY-MM-DD' → 周三（手动拆解，避开 iOS 对非 ISO 日期串的解析差异） */
function weekdayOf(value) {
  const p = String(value || '').split('-')
  if (p.length !== 3) return ''
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
  if (isNaN(d.getTime())) return ''
  return '周' + '日一二三四五六'.charAt(d.getDay())
}

/** 日期项在某模式下是否可选（真实模式看 reservable + 余量，本地模式看是否还有余量时段） */
function dateSelectable(item) {
  if (!item) return false
  if (item.slots && item.slots.length) return item.slots.some((s) => !s.disabled)
  // CanReserve 是权威标记，但线上出现过「CanReserve=1 而余量已归零」的不一致，
  // 这里叠加余量判断，宁可少放一天也不让用户约到满号日期。
  if (item.remaining !== undefined && item.remaining <= 0) return false
  return !!item.reservable
}

/** API-02 ReservationDateList 单项 → 页面日期项（真实模式，v1.9.13 起单条 = 单日） */
function venueDateItem(d) {
  const value = d.date
  return {
    value,
    label: formatDate(value, 'MM月dd日'),
    weekday: weekdayOf(value),
    dateId: d.id || '',
    quota: Number(d.quota) || 0,
    used: Number(d.used) || 0,
    remaining: Number(d.remaining) || 0,
    reservable: !!d.reservable,
    // 时段在 groupVenueDates 里按日期聚合后填充；单条全天记录保持空数组
    slots: []
  }
}

/**
 * API-02 可预约日期按日期聚合为日历项。
 *
 * v1.9.13 起线上**按日期每天一条**，不再返回 SessionId/SessionName
 * （2026-11-12 实测 7 条，字段仅 ID/Date/DailyQuota/DailyUsed/CanReserve），
 * 因此正常路径下天然一天一项、slots 恒为空数组。
 * 本函数保留时段聚合能力作为**兼容层**：若线上回滚到 v1.8.0 的「日期×时段」版本，
 * 同一天多条仍会被合并——未配置时段的条目作全天主记录，带 SessionId 的进 slots。
 * 页面结构因此无需随契约来回改动（mock 模式的本地名额表本就带时段）。
 * @param {Array} list normalize(normalizeDate) 后的日期项数组
 */
function groupVenueDates(list) {
  const byDate = {}
  const order = []
  ;(list || []).forEach((d) => {
    if (!d || !d.date) return
    if (!byDate[d.date]) {
      byDate[d.date] = []
      order.push(d.date)
    }
    byDate[d.date].push(d)
  })
  return order.sort().map((key) => {
    const entries = byDate[key]
    const dayEntry = entries.find((e) => !e.sessionId) || entries[0]
    const item = venueDateItem(dayEntry)
    const sessions = entries.filter((e) => e.sessionId)
    item.dateId = dayEntry.id || ''
    item.remaining = entries.reduce((sum, e) => sum + (Number(e.remaining) || 0), 0)
    item.reservable = entries.some((e) => e.reservable)
    item.slots = sessions.map((e) => ({
      timeSlot: e.sessionName || '时段',
      dateId: e.id || '',
      available: Number(e.remaining) || 0,
      total: Number(e.quota) || 0,
      disabled: !e.reservable
    }))
    return item
  })
}

/** 本地名额表 → 按日期分组的日期项（含时段，历史逻辑） */
function groupQuotas(quotas) {
  const byDate = {}
  quotas.forEach((q) => {
    if (!byDate[q.visitDate]) {
      byDate[q.visitDate] = {
        value: q.visitDate,
        label: formatDate(q.visitDate, 'MM月dd日'),
        weekday: weekdayOf(q.visitDate),
        dateId: '',
        quota: 0,
        used: 0,
        remaining: 0,
        reservable: false,
        slots: []
      }
    }
    const item = byDate[q.visitDate]
    item.slots.push({
      timeSlot: q.timeSlot,
      available: q.available,
      total: q.totalQuota,
      disabled: q.available <= 0
    })
    item.quota += Number(q.totalQuota) || 0
    item.used += Number(q.usedQuota) || 0
    item.remaining += Number(q.available) || 0
  })
  // 日期键为 yyyy-mm-dd，字典序即时间先后，直接 sort 即可升序
  return Object.keys(byDate).sort().map((k) => {
    const item = byDate[k]
    item.reservable = item.remaining > 0
    return item
  })
}

/** 本地名额表版本（改期、真实接口不可用时使用） */
function getQuotaDates() {
  return getQuotas().then((quotas) => ({
    source: 'mock',
    dates: groupQuotas(quotas),
    fallbackReason: ''
  }))
}

/**
 * 可预约日期（预约页唯一数据源）
 *   1. 场馆通道未被强制 mock → 用 API-02 的 data.ReservationDateList（真实放号）
 *   2. 接口不可用（网络/未发布/报错）→ 回退本地名额表，并在 fallbackReason 里说明
 * @returns {Promise<{source:'venue'|'mock', dates:Array, museumName?:string, fallbackReason?:string}>}
 */
function getAvailableDates() {
  if (venueApi.isMock()) return getQuotaDates()
  return venueApi
    .getVenue()
    .then((v) => ({
      source: 'venue',
      museumName: v.name || '',
      // 线上返回顺序是倒序（离今天最远在前）；先按日期聚合（兼容时段版），再按日期升序
      dates: groupVenueDates(v.dates || []),
      fallbackReason: ''
    }))
    .catch((err) => {
      console.warn('[预约] API-02 可预约日期不可用，回退本地名额表：' + ((err && err.message) || err))
      return getQuotaDates().then((res) => {
        res.fallbackReason = (err && err.message) || '场馆接口不可用'
        return res
      })
    })
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
  getQuotaDates,
  getAvailableDates,
  getMyReservations,
  getReservationDetail,
  createReservation,
  cancelReservation,
  rescheduleReservation,
  // 供 tools 离线断言
  _internal: { weekdayOf, dateSelectable, venueDateItem, groupVenueDates, groupQuotas }
}
