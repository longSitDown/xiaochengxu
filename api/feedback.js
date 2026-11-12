/**
 * 意见反馈服务：提交 / 我的反馈 / 处理进度
 *
 * 双通道（v1.9.14 对齐）：
 *   - 本地演示（config.USE_MOCK=true）：写自有工作表 feedbacks，支持图片 / 联系方式 / 回复；
 *   - 真实场馆（USE_MOCK=false）：走明道云 **API-08 提交反馈**，契约只有
 *     Code/Token/UserId/Title/Description 五项，响应仅 code/msg，
 *     **不返回记录 ID、不支持图片**，故「我的反馈」列表读不到这条记录。
 */
const { request } = require('./request')
const { flattenRows, flattenRow, buildFields, filterGroup, filterCond } = require('./adapters')
const { safeParse, toMysqlDatetime } = require('../utils/format')
// 小程序运行时不会自动解析目录下的 index.js：必须显式写到文件，写 require('../config')
// 会被当成找 config.js 而报「module 'config.js' is not defined」并导致页面白屏。
const config = require('../config/index')
const storage = require('../utils/storage')
const venueApi = require('./venue')

const WS = 'feedbacks'

/** 与 request.js 一致：运行时 rh_forceMock 可免重编译覆盖 USE_MOCK */
function useMock() {
  const forced = storage.getItem(config.FORCE_MOCK_KEY, null)
  if (forced === null || forced === undefined) return config.USE_MOCK
  return !!forced
}

/**
 * 真实场馆通道：把本地表单（内容 / 图片 / 联系方式）映射到 API-08 的 Title / Description。
 * 契约没有标题独立字段，这里用内容前 20 字自动生成；图片与联系方式拼进描述文本，
 * 避免信息静默丢失（同时明确标注图片未上传）。
 */
function submitToVenue(data) {
  const uid = String(data.venueUserId || '').trim()
  if (!uid) {
    return Promise.reject({ code: 'NO_USER', message: '登录态缺少游客档案 ID，请重新登录后再提交' })
  }
  const content = String(data.content || '').trim()
  const title = String(data.title || '').trim() || content.slice(0, 20) || '游客反馈'
  let description = content
  if (data.images && data.images.length) {
    description += '\n（用户附了 ' + data.images.length + ' 张图片，场馆系统暂不支持图片上传）'
  }
  if (data.contact) description += '\n联系方式：' + String(data.contact).trim()
  return venueApi
    .submitFeedback({ userId: uid, title, description, code: data.code, scene: data.scene })
    .then(() => ({ rowId: '', viaVenue: true }))
}

/**
 * 提交反馈
 * @param {{userId, content, images?: string[], contact?, venueUserId?, title?, code?, scene?}} data
 *        userId 用于本地工作表（bizId）；venueUserId 为 API-08 所需游客档案 GUID，两者不可混用
 */
function createFeedback(data) {
  if (!useMock() && venueApi.isReady('feedback')) return submitToVenue(data)
  // 只取工作表字段，避免 venueUserId / title / code / scene 等 API-08 专用入参被写进 mock 表
  // images 为数组，入库统一转 JSON.stringify 字符串
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows',
    method: 'POST',
    data: {
      fields: buildFields(
        {
          userId: data.userId || '',
          content: data.content || '',
          images: JSON.stringify(data.images || []),
          contact: data.contact || '',
          status: data.status || '待处理',
          reply: data.reply || '',
          replyTime: data.replyTime || '',
          // 明道云 DateTime(16) 要求 'YYYY-MM-DD HH:mm:ss'，不可用 toISOString()
          createTime: data.createTime || toMysqlDatetime(new Date())
        },
        WS
      ),
      triggerWorkflow: false
    }
  }).then((res) => getFeedbackDetail(res.rowId))
}

/** 反馈详情（images JSON → 数组） */
function getFeedbackDetail(id) {
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows/' + id,
    method: 'GET'
  }).then((d) =>
    Object.assign(flattenRow(d, WS), { images: safeParse(flattenRow(d, WS).images, []) })
  )
}

/** 我的反馈列表（按提交时间倒序） */
function getMyFeedbacks(userId) {
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 50,
      pageIndex: 1,
      sortId: 'createTime',
      isAsc: false,
      filters: filterGroup('AND', [filterCond('userId', 'eq', userId)])
    }
  }).then((data) =>
    flattenRows(data, WS).map((f) => Object.assign({}, f, { images: safeParse(f.images, []) }))
  )
}

module.exports = { createFeedback, getFeedbackDetail, getMyFeedbacks }
