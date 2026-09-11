/**
 * 数字展馆服务：展区 / 展品（720°全景 + 语音讲解）
 * 字段契约对齐 mingdao-api.md 第 8 节：
 *   name / cover / audioUrl / script / views / exhibitionId / duration
 */
const { request } = require('./request')
const { flattenRows, flattenRow, filterGroup, filterCond } = require('./adapters')

const WS = {
  exhibitions: 'exhibitions',
  artifacts: 'artifacts'
}

/** 展区列表（按 order 升序，附加展品数量统计） */
function getExhibitions() {
  return request({
    url: '/v3/app/worksheets/' + WS.exhibitions + '/rows/list',
    method: 'POST',
    data: { pageSize: 50, pageIndex: 1, sortId: 'order', isAsc: true }
  }).then((data) => {
    const exhibitions = flattenRows(data, WS.exhibitions)
    // 并行拉取全部展品统计，按 exhibitionId 聚合出各展区数量，再挂到每个展区对象上
    return countArtifacts().then((counter) =>
      exhibitions.map((e) => Object.assign({}, e, { artifactCount: counter[e.id] || 0 }))
    )
  })
}

/** 展区详情 */
function getExhibitionDetail(id) {
  return request({
    url: '/v3/app/worksheets/' + WS.exhibitions + '/rows/' + id,
    method: 'GET'
  }).then((data) => flattenRow(data, WS.exhibitions))
}

/** 全部展品（用于统计各展区展品数） */
function countArtifacts() {
  return request({
    url: '/v3/app/worksheets/' + WS.artifacts + '/rows/list',
    method: 'POST',
    data: { pageSize: 1000, pageIndex: 1 }
  }).then((data) => {
    const counter = {}
    flattenRows(data, WS.artifacts).forEach((a) => {
      counter[a.exhibitionId] = (counter[a.exhibitionId] || 0) + 1
    })
    return counter
  })
}

/** 某展区的展品列表（重点展品优先，浏览量降序） */
function getArtifactsByExhibition(exhibitionId) {
  const filters = exhibitionId
    ? filterGroup('AND', [filterCond('exhibitionId', 'eq', exhibitionId)])
    : undefined
  return request({
    url: '/v3/app/worksheets/' + WS.artifacts + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 100,
      pageIndex: 1,
      sortId: 'views',
      isAsc: false,
      filters
    }
  }).then((data) => flattenRows(data, WS.artifacts))
}

/** 展品详情（浏览量 +1） */
function getArtifactDetail(id) {
  return request({
    url: '/v3/app/worksheets/' + WS.artifacts + '/rows/' + id,
    method: 'GET'
  }).then((data) => flattenRow(data, WS.artifacts))
}

function increaseArtifactViews(id, views) {
  return request({
    url: '/v3/app/worksheets/' + WS.artifacts + '/rows/' + id,
    method: 'PATCH',
    data: { fields: [{ id: 'views', value: String(views) }] }
  })
}

/** 全部展品（搜索/全部列表用） */
function getAllArtifacts() {
  return getArtifactsByExhibition('')
}

module.exports = {
  getExhibitions,
  getExhibitionDetail,
  getArtifactsByExhibition,
  getArtifactDetail,
  increaseArtifactViews,
  getAllArtifacts
}
