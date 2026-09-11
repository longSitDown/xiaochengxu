/**
 * 首页服务：应用信息 / 轮播 / 公告 / 资讯 / 荣誉
 */
const { request } = require('./request')
const { flattenRows, flattenRow, filterGroup, filterCond } = require('./adapters')

const WS = {
  banners: 'banners',
  notices: 'notices',
  news: 'news',
  honors: 'honors'
}

/** 应用信息（对应 GET /v3/app） */
function getAppInfo() {
  return request({ url: '/v3/app', method: 'GET' })
}

/** 首页轮播（仅展示中的，按 sort 升序） */
function getBanners() {
  return request({
    url: '/v3/app/worksheets/' + WS.banners + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 10,
      pageIndex: 1,
      sortId: 'sort',
      isAsc: true,
      filters: filterGroup('AND', [filterCond('isShow', 'eq', '1')])
    }
  }).then((data) => flattenRows(data, WS.banners))
}

/** 公告通知（上架中的，按发布时间倒序） */
function getNotices(type) {
  const conds = [filterCond('status', 'eq', '上架')]
  if (type) conds.push(filterCond('type', 'eq', type))
  return request({
    url: '/v3/app/worksheets/' + WS.notices + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 20,
      pageIndex: 1,
      sortId: 'publishTime',
      isAsc: false,
      filters: filterGroup('AND', conds)
    }
  }).then((data) => flattenRows(data, WS.notices))
}

/**
 * 资讯列表
 * @param {{category?: string, page?: number, pageSize?: number, keywords?: string}} params
 */
function getNewsList(params = {}) {
  const conds = [filterCond('status', 'eq', '上架')]
  if (params.category) conds.push(filterCond('category', 'eq', params.category))
  return request({
    url: '/v3/app/worksheets/' + WS.news + '/rows/list',
    method: 'POST',
    data: {
      pageSize: params.pageSize || 10,
      pageIndex: params.page || 1,
      sortId: 'publishTime',
      isAsc: false,
      keywords: params.keywords || '',
      filters: filterGroup('AND', conds)
    }
  }).then((data) => ({
    list: flattenRows(data, WS.news),
    total: data.total,
    pageIndex: data.pageIndex,
    pageSize: data.pageSize,
    // 已加载条数小于总数即还有更多（用于分页加载）
    hasMore: data.pageIndex * data.pageSize < data.total
  }))
}

/** 资讯详情（浏览量 +1） */
function getNewsDetail(id) {
  return request({
    url: '/v3/app/worksheets/' + WS.news + '/rows/' + id,
    method: 'GET'
  }).then((data) => flattenRow(data, WS.news))
}

/**
 * 浏览量 +1：PATCH 直接改单行字段（fields 传入「裸」明道云格式，数值需转字符串）
 * 由调用方传入最新 views，避免「先查再加」的竞态
 */
function increaseNewsViews(id, views) {
  return request({
    url: '/v3/app/worksheets/' + WS.news + '/rows/' + id,
    method: 'PATCH',
    data: { fields: [{ id: 'views', value: String(views) }] }
  })
}

/** 荣誉资质 */
function getHonors() {
  return request({
    url: '/v3/app/worksheets/' + WS.honors + '/rows/list',
    method: 'POST',
    data: { pageSize: 20, pageIndex: 1, sortId: 'sort', isAsc: true }
  }).then((data) => flattenRows(data, WS.honors))
}

module.exports = {
  getAppInfo,
  getBanners,
  getNotices,
  getNewsList,
  getNewsDetail,
  increaseNewsViews,
  getHonors
}
