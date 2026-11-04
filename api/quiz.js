/**
 * 红色知识竞赛服务：活动 / 题库 / 答题记录 / 排行榜
 */
const { request } = require('./request')
const { flattenRows, flattenRow, buildFields, filterGroup, filterCond } = require('./adapters')
const { safeParse, toMysqlDatetime } = require('../utils/format')

const WS = {
  activities: 'quizActivities',
  questions: 'questions',
  records: 'quizRecords'
}

/** 竞赛活动列表（进行中优先） */
function getActivities() {
  return request({
    url: '/v3/app/worksheets/' + WS.activities + '/rows/list',
    method: 'POST',
    data: { pageSize: 20, pageIndex: 1 }
  }).then((data) => flattenRows(data, WS.activities))
}

/** 活动详情 */
function getActivityDetail(id) {
  return request({
    url: '/v3/app/worksheets/' + WS.activities + '/rows/' + id,
    method: 'GET'
  }).then((data) => flattenRow(data, WS.activities))
}

/** 某活动的题目列表（options 为 JSON 字符串，解析为数组） */
function getQuestions(activityId) {
  // activityId 为关联记录(29)字段，传 ws 让适配器自动把值包成 rowId 数组
  const filters = activityId
    ? filterGroup('AND', [filterCond('activityId', 'eq', activityId, WS.questions)])
    : undefined
  return request({
    url: '/v3/app/worksheets/' + WS.questions + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 100,
      pageIndex: 1,
      sortId: 'sort',
      isAsc: true,
      filters
    }
  }).then((data) =>
    flattenRows(data, WS.questions).map((q) =>
      // answers 解析约定：
      //   options —— 明道云里存的是一段 JSON 字符串（[ {key, text|optionText}, ... ]），用 safeParse 兜底转数组
      //   answerKeys —— 答案选项 key 列表（明道云存逗号分隔的字符串），切分并去空格后得到合法的答题选项 key
      Object.assign({}, q, {
        options: safeParse(q.options, []),
        answerKeys: String(q.answer || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      })
    )
  )
}

/**
 * 提交答题记录
 * @param {{userId:string, activityId:string, activityTitle:string, score:number,
 *          correctCount:number, totalCount:number, durationUsed:number, answers:Array}} record
 * @returns 新建记录的完整对象
 */
function submitQuizRecord(record) {
  return request({
    url: '/v3/app/worksheets/' + WS.records + '/rows',
    method: 'POST',
    data: {
      fields: buildFields(
        Object.assign({}, record, {
          answers: JSON.stringify(record.answers || []),
          // 明道云 DateTime(16) 要求 'YYYY-MM-DD HH:mm:ss'，不可用 toISOString()
          createTime: toMysqlDatetime(new Date())
        }),
        WS.records
      ),
      triggerWorkflow: false
    }
  }).then((res) =>
    getQuizRecord(res.rowId).then((record) =>
      Object.assign({}, record, { answers: safeParse(record.answers, []) })
    )
  )
}

/** 单条答题记录 */
function getQuizRecord(id) {
  return request({
    url: '/v3/app/worksheets/' + WS.records + '/rows/' + id,
    method: 'GET'
  }).then((data) => flattenRow(data, WS.records))
}

/** 我的答题历史（按时间倒序） */
function getMyRecords(userId) {
  return request({
    url: '/v3/app/worksheets/' + WS.records + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 50,
      pageIndex: 1,
      sortId: 'createTime',
      isAsc: false,
      filters: filterGroup('AND', [filterCond('userId', 'eq', userId)])
    }
  }).then((data) =>
    flattenRows(data, WS.records).map((r) =>
      Object.assign({}, r, { answers: safeParse(r.answers, []) })
    )
  )
}

/**
 * 排行榜（按活动聚合：得分降序 → 用时升序 → 提交时间升序，取前 50）
 * 注：mock 阶段由前端基于答题记录计算；对接明道云后可改为后端统计或行记录透视接口
 */
function getRanking(activityId) {
  const conds = []
  // activityId 为关联记录(29)字段，传 ws 让适配器按 rowId 数组规范化
  if (activityId) conds.push(filterCond('activityId', 'eq', activityId, WS.records))
  return request({
    url: '/v3/app/worksheets/' + WS.records + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 1000,
      pageIndex: 1,
      filters: conds.length ? filterGroup('AND', conds) : undefined
    }
  }).then((data) => {
    const records = flattenRows(data, WS.records)
    // 每个用户取最好成绩
    const best = {}
    records.forEach((r) => {
      const key = r.userId || '匿名'
      const prev = best[key]
      if (
        !prev ||
        r.score > prev.score ||
        (r.score === prev.score && r.durationUsed < prev.durationUsed)
      ) {
        best[key] = r
      }
    })
    return Object.keys(best)
      .map((k) => best[k])
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (a.durationUsed !== b.durationUsed) return a.durationUsed - b.durationUsed
        return a.createTime < b.createTime ? -1 : 1
      })
      .slice(0, 50)
      .map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        userName: r.userName || (r.userId === 'demo_user' ? '红色传承者' : '游客' + String(r.userId).slice(-4)),
        score: r.score,
        correctCount: r.correctCount,
        totalCount: r.totalCount,
        durationUsed: r.durationUsed,
        createTime: r.createTime
      }))
  })
}

module.exports = {
  getActivities,
  getActivityDetail,
  getQuestions,
  submitQuizRecord,
  getQuizRecord,
  getMyRecords,
  getRanking
}
