/**
 * 场馆指南服务
 */
const { request } = require('./request')
const { flattenRows, filterGroup, filterCond } = require('./adapters')

const WS = 'guideItems'

/**
 * 按分类获取指南条目（全部分类时不传 category）
 * @param {{category?: string}} params
 */
function getGuideItems(params = {}) {
  const conds = []
  if (params.category) conds.push(filterCond('category', 'eq', params.category))
  return request({
    url: '/v3/app/worksheets/' + WS + '/rows/list',
    method: 'POST',
    data: {
      pageSize: 50,
      pageIndex: 1,
      sortId: 'sort',
      isAsc: true,
      filters: conds.length ? filterGroup('AND', conds) : undefined
    }
  }).then((data) => flattenRows(data, WS))
}

/** 全部指南（按分类分组返回） */
function getGuideGrouped() {
  return getGuideItems().then((items) => {
    const groups = [
      { category: '开放时间', icon: 'clock', items: [] },
      { category: '地址交通', icon: 'location', items: [] },
      { category: '参观须知', icon: 'notice', items: [] },
      { category: '配套服务', icon: 'service', items: [] },
      { category: '讲解服务', icon: 'guide', items: [] }
    ]
    // 按固定分类顺序归组（仅保留有数据的分组，保证前端展示顺序稳定）
    items.forEach((item) => {
      const g = groups.find((x) => x.category === item.category)
      if (g) g.items.push(item)
    })
    return groups.filter((g) => g.items.length)
  })
}

module.exports = { getGuideItems, getGuideGrouped }
