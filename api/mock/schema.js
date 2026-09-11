/**
 * 各工作表字段定义
 *
 * 核心设计：字段 id 使用「别名」而非明道云原生字段 ID（如 fld_xxx），
 * 这是因为明道云 API V3 支持以「别名」作为字段 id 传参。页面代码只需
 * 用别名访问字段值，后续切换真实工作表时，只需保证明道云后台的字段别名
 * 与本文件一一对应，所有页面逻辑零改动。
 *
 * 字段类型码（type）参考 mingdao-api.md 第 6 节：
 *   2: Text, 6: Number, 9: SingleSelect, 10: MultipleSelect, 14: Attachment,
 *  15: Date, 16: DateTime, 21: DynamicLink, 29: Relation, 41: RichText
 *
 * field() 函数是字段定义的核心别名机制，接收 (id, type, opts)，
 * 返回统一结构的字段对象，使 SCHEMES 中各工作表字段定义简洁一致。
 */
const T = {
  TEXT: '2',
  NUMBER: '6',
  SINGLE: '9',
  MULTI: '10',
  ATTACH: '14',
  DATE: '15',
  DATETIME: '16',
  LINK: '21',
  RELATION: '29',
  RICHTEXT: '41'
}

/** 字段类型 → 中文显示名，用于构造明道云出参中的 controlName */
const controlNames = {
  [T.TEXT]: '文本字段',
  [T.NUMBER]: '数值字段',
  [T.SINGLE]: '单选字段',
  [T.MULTI]: '多选字段',
  [T.ATTACH]: '附件字段',
  [T.DATE]: '日期字段',
  [T.DATETIME]: '时间字段',
  [T.LINK]: '自由链接',
  [T.RELATION]: '关联记录',
  [T.RICHTEXT]: '富文本字段'
}

/**
 * 字段定义工厂函数 —— 统一字段对象的构造方式，也是别名机制的核心。
 * 最终每个字段对象含有 { id(别名), type(类型码), controlName(中文名) }，
 * 以及按 opts 按需附带的 isTitle/required/options/dataSource/subType/remark。
 * 这样 SCHEMES 里每个工作表只需一行 field() 即可定义完整字段，避免重复拼写。
 */
function field(id, type, opts = {}) {
  const obj = { id, type, controlName: controlNames[type] || '' }
  if (opts.isTitle) obj.isTitle = true
  if (opts.required) obj.required = true
  if (opts.options) obj.options = opts.options
  if (opts.dataSource) obj.dataSource = opts.dataSource
  if (opts.subType) obj.subType = opts.subType
  if (opts.remark) obj.remark = opts.remark
  return obj
}

const SCHEMES = {
  users: {
    worksheetId: 'ws_users',
    name: '小程序用户',
    fields: [
      field('openid', T.TEXT, { isTitle: true }),
      field('nickname', T.TEXT),
      field('avatar', T.TEXT, { remark: '头像 URL，也可改为 Attachment 字段' }),
      field('phone', T.TEXT)
    ]
  },
  banners: {
    worksheetId: 'ws_banners',
    name: '首页轮播 Banner',
    fields: [
      field('title', T.TEXT, { isTitle: true }),
      field('image', T.ATTACH),
      field('linkType', T.SINGLE, { options: [{ key: 'page', value: '页面' }, { key: 'news', value: '资讯' }, { key: 'panorama', value: '全景展馆' }] }),
      field('linkTarget', T.TEXT, { remark: '跳转目标 ID 或路径' }),
      field('sort', T.NUMBER),
      field('isShow', T.SINGLE, { options: [{ key: '1', value: '显示' }, { key: '0', value: '隐藏' }] })
    ]
  },
  notices: {
    worksheetId: 'ws_notices',
    name: '公告通知',
    fields: [
      field('title', T.TEXT, { isTitle: true }),
      field('content', T.RICHTEXT),
      field('type', T.SINGLE, { options: [{ key: '公告', value: '公告' }, { key: '紧急通知', value: '紧急通知' }] }),
      field('isPopup', T.SINGLE, { options: [{ key: '1', value: '弹窗' }, { key: '0', value: '不弹窗' }] }),
      field('publishTime', T.DATETIME),
      field('status', T.SINGLE, { options: [{ key: '上架', value: '上架' }, { key: '下架', value: '下架' }] })
    ]
  },
  news: {
    worksheetId: 'ws_news',
    name: '红色资讯',
    fields: [
      field('title', T.TEXT, { isTitle: true }),
      field('summary', T.TEXT),
      field('cover', T.ATTACH),
      field('content', T.RICHTEXT),
      field('category', T.SINGLE, { options: [{ key: '资讯', value: '资讯' }, { key: '英烈事迹', value: '英烈事迹' }, { key: '红色故事', value: '红色故事' }] }),
      field('source', T.TEXT),
      field('publishTime', T.DATETIME),
      field('views', T.NUMBER),
      field('isTop', T.SINGLE, { options: [{ key: '1', value: '置顶' }, { key: '0', value: '普通' }] }),
      field('status', T.SINGLE, { options: [{ key: '上架', value: '上架' }, { key: '下架', value: '下架' }] })
    ]
  },
  honors: {
    worksheetId: 'ws_honors',
    name: '荣誉资质',
    fields: [
      field('title', T.TEXT, { isTitle: true }),
      field('image', T.ATTACH),
      field('sort', T.NUMBER)
    ]
  },
  exhibitions: {
    worksheetId: 'ws_exhibitions',
    name: '展区',
    fields: [
      field('name', T.TEXT, { isTitle: true }),
      field('cover', T.ATTACH),
      field('description', T.RICHTEXT),
      field('order', T.NUMBER),
      field('panoramaUrl', T.TEXT, { remark: '720 全景入口链接' })
    ]
  },
  artifacts: {
    worksheetId: 'ws_artifacts',
    name: '展品',
    fields: [
      field('name', T.TEXT, { isTitle: true }),
      field('cover', T.ATTACH),
      field('category', T.SINGLE, { options: [
        { key: '武器军械', value: '武器军械' },
        { key: '文献文书', value: '文献文书' },
        { key: '实物器具', value: '实物器具' }
      ] }),
      field('period', T.TEXT, { remark: '历史时期（如：土地革命战争时期）' }),
      field('audioUrl', T.TEXT),
      field('script', T.RICHTEXT),
      field('views', T.NUMBER),
      field('exhibitionId', T.RELATION, { dataSource: 'ws_exhibitions', subType: 1, remark: '单条关联到「展区」表' }),
      field('duration', T.NUMBER, { remark: '音频时长（秒）' }),
      field('isHighlight', T.SINGLE, { options: [{ key: '1', value: '重点展品' }, { key: '0', value: '普通展品' }] })
    ]
  },
  quizActivities: {
    worksheetId: 'ws_quiz_activities',
    name: '知识竞赛活动',
    fields: [
      field('title', T.TEXT, { isTitle: true }),
      field('description', T.RICHTEXT),
      field('startTime', T.DATETIME),
      field('endTime', T.DATETIME),
      field('duration', T.NUMBER, { remark: '答题限时（分钟）' }),
      field('passScore', T.NUMBER),
      field('questionCount', T.NUMBER),
      field('status', T.SINGLE, { options: [{ key: '进行中', value: '进行中' }, { key: '未开始', value: '未开始' }, { key: '已结束', value: '已结束' }] }),
      field('rule', T.RICHTEXT)
    ]
  },
  questions: {
    worksheetId: 'ws_questions',
    name: '题库',
    fields: [
      field('title', T.TEXT, { isTitle: true }),
      field('activityId', T.RELATION, { dataSource: 'ws_quiz_activities', subType: 1 }),
      field('type', T.SINGLE, { options: [{ key: '单选', value: '单选' }, { key: '多选', value: '多选' }, { key: '判断', value: '判断' }] }),
      field('options', T.RICHTEXT, { remark: '选项 JSON 数组，示例：["A. 南昌起义","B. 秋收起义"]（真实环境可用子表拆出）' }),
      field('answer', T.TEXT, { remark: '正确答案文本；单选/判断为一个选项，多选为逗号分隔' }),
      field('analysis', T.RICHTEXT),
      field('score', T.NUMBER),
      field('sort', T.NUMBER)
    ]
  },
  quizRecords: {
    worksheetId: 'ws_quiz_records',
    name: '答题记录',
    fields: [
      field('userId', T.TEXT),
      field('activityId', T.RELATION, { dataSource: 'ws_quiz_activities', subType: 1 }),
      field('activityTitle', T.TEXT),
      field('score', T.NUMBER),
      field('correctCount', T.NUMBER),
      field('totalCount', T.NUMBER),
      field('durationUsed', T.NUMBER, { remark: '答题耗时（秒）' }),
      field('answers', T.RICHTEXT, { remark: 'JSON 字符串：[{questionId, selected, correct}]' }),
      field('createTime', T.DATETIME)
    ]
  },
  reservations: {
    worksheetId: 'ws_reservations',
    name: '参观预约',
    fields: [
      field('userId', T.TEXT),
      field('type', T.SINGLE, { options: [{ key: '个人', value: '个人' }, { key: '团体', value: '团体' }] }),
      field('visitDate', T.DATE),
      field('timeSlot', T.SINGLE, { options: [{ key: '上午 9:00-12:00', value: '上午 9:00-12:00' }, { key: '下午 12:00-17:00', value: '下午 12:00-17:00' }] }),
      field('visitorCount', T.NUMBER),
      field('organization', T.TEXT, { remark: '团体名称，个人可为空' }),
      field('contactName', T.TEXT),
      field('contactPhone', T.TEXT),
      field('contactIdCard', T.TEXT, { remark: '联系人身份证号（联系人/负责人入馆凭证）' }),
      field('visitors', T.RICHTEXT, { remark: '参观人 JSON 数组：[{name, idCard, phone}]，进馆凭身份证核验（真实环境可拆子表）' }),
      field('remark', T.TEXT),
      field('status', T.SINGLE, { options: [{ key: '待审核', value: '待审核' }, { key: '已通过', value: '已通过' }, { key: '已驳回', value: '已驳回' }, { key: '已取消', value: '已取消' }, { key: '已核销', value: '已核销' }] }),
      field('rejectReason', T.TEXT),
      field('qrCode', T.TEXT, { remark: '核销二维码文本' }),
      field('createTime', T.DATETIME)
    ]
  },
  reservationQuota: {
    worksheetId: 'ws_reservation_quota',
    name: '预约名额',
    fields: [
      field('visitDate', T.DATE),
      field('timeSlot', T.SINGLE, { options: [{ key: '上午 9:00-12:00', value: '上午 9:00-12:00' }, { key: '下午 12:00-17:00', value: '下午 12:00-17:00' }] }),
      field('totalQuota', T.NUMBER),
      field('usedQuota', T.NUMBER)
    ]
  },
  visitors: {
    worksheetId: 'ws_visitors',
    name: '预约人',
    fields: [
      field('userId', T.TEXT, { remark: '所属用户 id' }),
      field('name', T.TEXT, { isTitle: true }),
      field('idCard', T.TEXT, { remark: '身份证号，入馆核验凭证' }),
      field('phone', T.TEXT),
      field('isDefault', T.SINGLE, { options: [{ key: '1', value: '默认' }, { key: '0', value: '普通' }] }),
      field('createTime', T.DATETIME)
    ]
  },
  guideItems: {
    worksheetId: 'ws_guide_items',
    name: '场馆指南',
    fields: [
      field('category', T.SINGLE, { options: [{ key: '开放时间', value: '开放时间' }, { key: '地址交通', value: '地址交通' }, { key: '参观须知', value: '参观须知' }, { key: '配套服务', value: '配套服务' }, { key: '讲解服务', value: '讲解服务' }] }),
      field('title', T.TEXT, { isTitle: true }),
      field('content', T.RICHTEXT),
      field('sort', T.NUMBER)
    ]
  },
  feedbacks: {
    worksheetId: 'ws_feedbacks',
    name: '意见反馈',
    fields: [
      field('userId', T.TEXT),
      field('content', T.RICHTEXT, { isTitle: true }),
      field('images', T.RICHTEXT, { remark: 'JSON 数组图片 URL（真实环境可用 Attachment 字段或附件表）' }),
      field('contact', T.TEXT),
      field('status', T.SINGLE, { options: [{ key: '待处理', value: '待处理' }, { key: '处理中', value: '处理中' }, { key: '已完结', value: '已完结' }] }),
      field('reply', T.RICHTEXT),
      field('replyTime', T.DATETIME),
      field('createTime', T.DATETIME)
    ]
  }
}

module.exports = { SCHEMES, FIELD_TYPES: T }
