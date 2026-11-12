/**
 * 端到端链路自测（Node 环境 stub wx）：
 * 覆盖 21 个页面实际调用的全部服务层方法，验证 mock 引擎 + 适配器 + 业务规则
 * （含预约人实名链路：身份证校验/去重/默认唯一/参观人名单解析）
 */
// 本脚本只验证 mock 数据层：显式关掉真实登录，避免依赖后端服务与微信环境
require('../config/index').LOGIN_MODE = 'mock'

// stub wx 全局（内存版 storage）
const store = {}
global.wx = {
  setStorageSync: (k, v) => { store[k] = v },
  getStorageSync: (k) => (k in store ? store[k] : ''),
  removeStorageSync: (k) => { delete store[k] },
  getStorageInfoSync: () => ({ keys: Object.keys(store) })
}

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('PASS:', msg)
}

async function main() {
  const home = require('../api/home')
  const exhibition = require('../api/exhibition')
  const quiz = require('../api/quiz')
  const reservation = require('../api/reservation')
  const visitor = require('../api/visitor')
  const { validateIdCard, maskIdCard } = require('../utils/format')
  const guide = require('../api/guide')
  const feedback = require('../api/feedback')
  const user = require('../api/user')

  /* ---- 用户登录（app.js onLaunch / profile 页） ---- */
  const u = await user.login()
  assert(u && u.id === 'demo_user', 'user.login 生成本地演示用户')

  /* ---- 首页链路 ---- */
  const appInfo = await home.getAppInfo()
  assert(appInfo.name === '红色纪念馆数字化展示服务系统', 'home.getAppInfo 返回应用信息')
  const banners = await home.getBanners()
  assert(banners.length === 3 && banners[0].image, 'home.getBanners 轮播 3 张')
  const notices = await home.getNotices()
  assert(notices.length === 2 && notices[0].isPopup === '1', 'home.getNotices 含弹窗公告')
  const newsPage = await home.getNewsList({ page: 1, pageSize: 4 })
  assert(newsPage.list.length === 4 && newsPage.total === 6, 'home.getNewsList 分页正确')
  const newsDetail = await home.getNewsDetail(newsPage.list[0].id)
  assert(newsDetail.title && newsDetail.views > 0, 'home.getNewsDetail 资讯详情')
  await home.increaseNewsViews(newsDetail.id, newsDetail.views + 1)
  const newsAfter = await home.getNewsDetail(newsDetail.id)
  assert(newsAfter.views === newsDetail.views + 1, 'home.increaseNewsViews 浏览量 +1')
  const honors = await home.getHonors()
  assert(honors.length === 4, 'home.getHonors 荣誉 4 条')

  /* ---- 资讯列表（news 页：分类筛选 + 关键词） ---- */
  const catList = await home.getNewsList({ category: '英烈事迹' })
  assert(catList.list.length === 2 && catList.list.every((n) => n.category === '英烈事迹'), 'news 页分类筛选')
  const kwList = await home.getNewsList({ keywords: '刘胡兰' })
  assert(kwList.list.length === 1, 'news 页关键词搜索')

  /* ---- 数字展馆链路 ---- */
  const exhibitions = await exhibition.getExhibitions()
  assert(exhibitions.length === 4, 'exhibition.getExhibitions 展区 4 个')
  assert(exhibitions[0].artifactCount > 0, 'exhibition.getExhibitions 附带展品统计')
  const exhDetail = await exhibition.getExhibitionDetail('exh_01')
  assert(exhDetail.name === '第一展厅 · 星火燎原', 'exhibition.getExhibitionDetail 展区详情')
  const artifacts = await exhibition.getArtifactsByExhibition('exh_02')
  assert(artifacts.length > 0 && artifacts.every((a) => a.exhibitionId === 'exh_02'), 'hall-detail 页按展区取展品')
  const artDetail = await exhibition.getArtifactDetail('art_001')
  assert(artDetail.audioUrl && artDetail.script, 'artifact-detail 页展品详情含音频与讲解词')
  const allArtifacts = await exhibition.getAllArtifacts()
  assert(allArtifacts.length === 10, 'panorama 页热点取全部展品 10 件')

  /* ---- 知识竞赛链路 ---- */
  const activities = await quiz.getActivities()
  assert(activities.length === 1 && activities[0].status === '进行中', 'quiz 页活动列表')
  const questions = await quiz.getQuestions('act_001')
  assert(questions.length === 8 && Array.isArray(questions[0].options), 'quiz-start 页题库 8 题且 options 已解析')
  assert(questions[1].answerKeys.join(',') === 'A,B,C,D', '多选题 answerKeys 解析')

  // 模拟答题：全对（按答案 key 反选选项；服务层 options 为字符串数组，key 提取与 quiz-start 页一致）
  const optionKey = (s) => (s.indexOf('.') > 0 ? s.split('.')[0].trim() : s.trim())
  const answers = questions.map((q) => ({
    questionId: q.id,
    selected: q.options.filter((text) => q.answerKeys.indexOf(optionKey(text)) >= 0),
    correct: true
  }))
  const record = await quiz.submitQuizRecord({
    userId: 'demo_user',
    activityId: 'act_001',
    activityTitle: activities[0].title,
    score: 80,
    correctCount: 8,
    totalCount: 8,
    durationUsed: 300,
    answers
  })
  assert(record.id && record.score === 80 && Array.isArray(record.answers), 'quiz-start 页提交答题记录')

  const myRecords = await quiz.getMyRecords('demo_user')
  assert(myRecords.length >= 1, 'quiz-history 页我的战绩')
  const ranking = await quiz.getRanking('act_001')
  assert(ranking.length >= 1 && ranking[0].rank === 1, 'quiz-ranking 页排行榜')

  // quiz-result 页：错题还原
  const recordDetail = await quiz.getQuizRecord(record.id)
  assert(recordDetail.activityTitle === activities[0].title, 'quiz-result 页读取答题记录')

  /* ---- 预约人（实名参观人）链路 ---- */
  assert(validateIdCard('11010519491231002X') && !validateIdCard('11010519491231002A'), '身份证 18 位校验码算法')
  assert(maskIdCard('11010519491231002X') === '110105******002X', '身份证脱敏（前 6 后 4）')

  const visitors = await visitor.getVisitors('demo_user')
  assert(visitors.length === 3 && visitors[0].isDefault === '1', 'visitor-manage 页预约人列表（默认优先）')

  // 非法身份证拦截
  let badId = false
  try {
    await visitor.saveVisitor({ userId: 'demo_user', name: '测试', idCard: '11010519491231002A', phone: '13800138000' })
  } catch (e) {
    badId = e.code === 'BAD_IDCARD'
  }
  assert(badId, 'visitor-editor 身份证格式拦截')

  // 同用户身份证去重
  let dupId = false
  try {
    await visitor.saveVisitor({ userId: 'demo_user', name: '张建国分身', idCard: '11010519491231002X', phone: '13800138000' })
  } catch (e) {
    dupId = e.code === 'DUP_IDCARD'
  }
  assert(dupId, '预约人身份证去重拦截')

  // 新增（设为默认）→ 列表唯一默认且排序优先
  const added = await visitor.saveVisitor({
    userId: 'demo_user', name: '刘志强', idCard: '110105198808082416', phone: '13700137000', isDefault: '1'
  })
  assert(added.id && added.isDefault === '1', 'visitor-editor 新增预约人并设为默认')
  const afterAdd = await visitor.getVisitors('demo_user')
  assert(afterAdd.length === 4 && afterAdd.filter((v) => v.isDefault === '1').length === 1, '默认预约人唯一')
  assert(afterAdd[0].name === '刘志强', '默认预约人排序优先')

  // 编辑（改姓名）
  const edited = await visitor.saveVisitor({
    id: added.id, userId: 'demo_user', name: '刘志强（更新）', idCard: '110105198808082416', phone: '13700137000', isDefault: '1'
  })
  assert(edited.name === '刘志强（更新）', 'visitor-manage 编辑预约人')

  // 删除
  await visitor.removeVisitor(added.id)
  const afterRemove = await visitor.getVisitors('demo_user')
  assert(afterRemove.length === 3, 'visitor-manage 删除预约人')

  /* ---- 参观预约链路 ---- */
  const quotas = await reservation.getQuotas()
  assert(quotas.length === 14 && quotas[0].available >= 0, 'reservation-form 页名额列表（7 天 × 2 时段）')

  // 种子预约详情：参观人名单解析（reservation-detail 页）
  const seedDetail = await reservation.getReservationDetail('res_001')
  assert(Array.isArray(seedDetail.visitors) && seedDetail.visitors.length === 2 && seedDetail.visitors[0].idCard, 'reservation-detail 页参观人名单解析')
  assert(seedDetail.contactIdCard === '11010519491231002X', 'reservation-detail 页联系人身份证')

  // 创建预约 → 名额扣减（携带实名参观人，模拟表单页提交）
  const target = quotas.find((q) => q.available >= 3)
  const before = await reservation.getQuotas(target.visitDate)
  const beforeSlot = before.find((q) => q.timeSlot === target.timeSlot)
  const pickedVisitors = visitors.map((v) => ({ name: v.name, idCard: v.idCard, phone: v.phone }))
  const resv = await reservation.createReservation({
    userId: 'demo_user',
    type: '个人',
    visitDate: target.visitDate,
    timeSlot: target.timeSlot,
    visitorCount: 3,
    organization: '',
    contactName: pickedVisitors[0].name,
    contactPhone: pickedVisitors[0].phone,
    contactIdCard: pickedVisitors[0].idCard,
    visitors: pickedVisitors,
    remark: '自测'
  })
  assert(resv.status === '待审核' && resv.qrCode.indexOf('REDHALL-') === 0, 'reservation-form 页创建预约并回填二维码')
  assert(Array.isArray(resv.visitors) && resv.visitors.length === 3 && resv.visitors.every((v) => v.idCard), 'reservation-form 页预约携带实名参观人列表')
  const after = await reservation.getQuotas(target.visitDate)
  const afterSlot = after.find((q) => q.timeSlot === target.timeSlot)
  assert(afterSlot.usedQuota === beforeSlot.usedQuota + 3, '创建预约后名额扣减 3')

  // 名额不足拦截
  let quotaFull = false
  try {
    await reservation.createReservation({
      userId: 'demo_user',
      type: '个人',
      visitDate: target.visitDate,
      timeSlot: target.timeSlot,
      visitorCount: 999,
      contactName: 'x',
      contactPhone: '13800138000'
    })
  } catch (e) {
    quotaFull = e.code === 'QUOTA_FULL'
  }
  assert(quotaFull, '名额不足抛 QUOTA_FULL')

  // 我的预约列表 + 详情（reservation 页）
  const myResv = await reservation.getMyReservations('demo_user')
  assert(myResv.length >= 3, 'reservation 页我的预约列表')

  // 取消预约 → 名额释放
  const canceled = await reservation.cancelReservation(resv.id)
  assert(canceled.status === '已取消', 'reservation-detail 页取消预约')
  const released = await reservation.getQuotas(target.visitDate)
  const releasedSlot = released.find((q) => q.timeSlot === target.timeSlot)
  assert(releasedSlot.usedQuota === beforeSlot.usedQuota, '取消预约后名额释放')

  // 已取消状态再操作 → BAD_STATE
  let badState = false
  try {
    await reservation.cancelReservation(resv.id)
  } catch (e) {
    badState = e.code === 'BAD_STATE'
  }
  assert(badState, '已取消预约再取消抛 BAD_STATE')

  // 改期：种子 res_001（已通过，2 人）改到另一日期时段
  const seed = myResv.find((r) => r.id === 'res_001')
  const newDate = quotas.find((q) => q.visitDate !== seed.visitDate)
  const rescheduled = await reservation.rescheduleReservation(seed.id, {
    visitDate: newDate.visitDate,
    timeSlot: newDate.timeSlot
  })
  assert(rescheduled.visitDate === newDate.visitDate && rescheduled.status === '待审核', 'reservation-form 改期模式生效')

  /* ---- 场馆指南链路 ---- */
  const guideItems = await guide.getGuideItems({ category: '开放时间' })
  assert(guideItems.length === 2, 'guide 页按分类取指南')
  const grouped = await guide.getGuideGrouped()
  assert(grouped.length === 5 && grouped.every((g) => g.items.length), 'guide 页分组 5 类')

  /* ---- 意见反馈链路 ---- */
  const fb = await feedback.createFeedback({
    userId: 'demo_user',
    content: '自测反馈内容，超过五个字',
    images: ['/images/covers/cover-hall.png'],
    contact: '13800138000'
  })
  assert(fb.status === '待处理' && fb.images.length === 1, 'feedback 页提交反馈')
  const myFb = await feedback.getMyFeedbacks('demo_user')
  assert(myFb.length >= 3, 'feedback 页我的反馈列表')
  const fbDetail = await feedback.getFeedbackDetail('fb_001')
  assert(fbDetail.reply && fbDetail.status === '已完结', 'feedback-detail 页官方回复展示')

  console.log('\n===== 全部链路自测通过（8 个服务 / 50 项断言）=====')
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
