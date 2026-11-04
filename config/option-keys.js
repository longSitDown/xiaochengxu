/**
 * 单选 / 多选字段的「业务值 ⇄ 明道云选项 key」映射表
 *
 * 背景：
 *   mock 里的选项 key 直接用中文标签（如 {key:'资讯', value:'资讯'}），便于阅读；
 *   真实明道云的选项 key 多为系统生成的数字串（如 '1'、'2'），与标签不同。
 *   若不做转换，写入时会报 10002 参数值错误，读回时页面拿数字当状态比较会全部失效。
 *
 * 设计要点：
 *   1. 映射表默认全空 → 恒等映射 → 当前 mock 行为完全不变，回归测试不受影响。
 *   2. 只在 adapters.js 的真实读写转换里生效，mock 引擎（engine.js）不感知。
 *   3. 反向查询（key → 业务值）查不到时回退原值，因此即使部分配置缺失也不会丢数据。
 *   4. 联调时按 GET /v3/app/worksheets/{id} 返回的 fields[].options 填充本表即可，
 *      无需改任何业务代码。
 *
 * 键格式：'工作表别名.字段别名'
 * 值格式：{ 业务值: 明道云选项 key }
 *
 * 注意两类字段的区别：
 *   - 标签型（页面判中文）：如 news.category → 页面比较 '英烈事迹'
 *   - 键值型（页面判 '1'/'0'）：如 visitor.isDefault → 页面比较 '1'
 *   键值型字段若明道云 key 恰好也是 '1'/'0'，留空即可；若不是，在此配
 *   { '1': '<显示选项的真实key>', '0': '<隐藏选项的真实key>' }。
 *
 * 示例：
 *   'news.category': { '资讯': '1', '英烈事迹': '2', '红色故事': '3' },
 *   'reservations.status': { '待审核': '1', '已通过': '2', '已驳回': '3', '已取消': '4', '已核销': '5' },
 *   'visitors.isDefault': { '1': '9f2c...', '0': '7a1b...' }
 */
const MAP = {
  // 内容
  // 'banners.linkType': { page: '', news: '', panorama: '' },
  // 'banners.isShow': { '1': '', '0': '' },
  // 'notices.type': { '公告': '', '紧急通知': '' },
  // 'notices.isPopup': { '1': '', '0': '' },
  // 'notices.status': { '上架': '', '下架': '' },
  // 'news.category': { '资讯': '', '英烈事迹': '', '红色故事': '' },
  // 'news.isTop': { '1': '', '0': '' },
  // 'news.status': { '上架': '', '下架': '' },
  // 展陈
  // 'artifacts.category': { '武器军械': '', '文献文书': '', '实物器具': '' },
  // 'artifacts.isHighlight': { '1': '', '0': '' },
  // 竞赛
  // 'questions.type': { '单选': '', '多选': '', '判断': '' },
  // 'quizActivities.status': { '进行中': '', '未开始': '', '已结束': '' },
  // 预约
  // 'reservations.type': { '个人': '', '团体': '' },
  // 'reservations.timeSlot': { '上午 9:00-12:00': '', '下午 12:00-17:00': '' },
  // 'reservations.status': { '待审核': '', '已通过': '', '已驳回': '', '已取消': '', '已核销': '' },
  // 'reservationQuota.timeSlot': { '上午 9:00-12:00': '', '下午 12:00-17:00': '' },
  // 'visitors.isDefault': { '1': '', '0': '' },
  // 服务
  // 'guideItems.category': { '开放时间': '', '地址交通': '', '参观须知': '', '配套服务': '', '讲解服务': '' },
  // 'feedbacks.status': { '待处理': '', '处理中': '', '已完结': '' }
}

/** 取某字段的映射表；空值项视为未配置（写入时跳过，避免把 key 写成空串） */
function pairOf(ws, field) {
  const raw = MAP[ws + '.' + field]
  if (!raw) return null
  const clean = {}
  let hit = false
  Object.keys(raw).forEach((biz) => {
    const key = raw[biz]
    if (key != null && String(key).trim() !== '') {
      clean[biz] = String(key)
      hit = true
    }
  })
  return hit ? clean : null
}

/** 业务值 → 明道云选项 key（未配置或未命中时原样返回） */
function toKey(ws, field, biz) {
  const map = pairOf(ws, field)
  if (!map) return biz
  const hit = map[String(biz)]
  return hit == null ? biz : hit
}

/** 明道云选项 key → 业务值（反向查找，未命中时原样返回） */
function toLabel(ws, field, key) {
  const map = pairOf(ws, field)
  if (!map) return key
  const target = String(key)
  const found = Object.keys(map).filter((biz) => map[biz] === target)[0]
  return found == null ? key : found
}

module.exports = { MAP, toKey, toLabel }
