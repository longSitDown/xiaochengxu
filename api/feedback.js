/**
 * 意见反馈服务：提交 / 我的反馈 / 处理进度
 */
const { request } = require('./request')
const { flattenRows, flattenRow, buildFields, filterGroup, filterCond } = require('./adapters')
const { safeParse } = require('../utils/format')

const WS = 'feedbacks'

/**
 * 提交反馈
 * @param {{userId, content, images?: string[], contact?}} data
 */
function createFeedback(data) {
  // 先用默认字段兜底，再覆盖业务传入；images 为数组，入库统一转 JSON.stringify 字符串
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows',
    method: 'POST',
    data: {
      fields: buildFields(
        Object.assign(
          {
            userId: '',
            content: '',
            images: '[]',
            contact: '',
            status: '待处理',
            reply: '',
            replyTime: '',
            createTime: new Date().toISOString()
          },
          data,
          { images: JSON.stringify(data.images || []) }
        ),
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
