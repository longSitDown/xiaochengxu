/**
 * 预约与场馆指南种子数据
 *
 * 用途：为「便民服务」下预约流程（名额查询 → 选人 → 提交）、预约人管理与场馆指南提供数据。
 * 关键点：
 *  - reservationQuota 通过 buildQuota() 动态生成未来 7 天 × 上/下午两个时段的名额，
 *    保证每次演示都有"今天之后的可用名额"；totalQuota 固定 200，usedQuota 随机模拟已占用。
 *  - visitors 为演示用户预置的常用预约人，进馆凭身份证核验（对应 schema.js 的 visitors 表）。
 *  - adminQuota 指 reservationQuota 中各时段 totalQuota/usedQuota，用于展示余量并在核销时联动。
 */
const { formatDate } = require('../../../utils/format')

// 动态生成未来 7 天的预约名额种子（每天上/下午两个时段各一条）
function buildQuota() {
  const slots = ['上午 9:00-12:00', '下午 12:00-17:00']
  const rows = []
  for (let i = 1; i <= 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const date = formatDate(d, 'yyyy-MM-dd')
    slots.forEach((slot, idx) => {
      rows.push({
        id: 'quota_' + date + '_' + idx,
        visitDate: date,
        timeSlot: slot,
        totalQuota: 200, // 该时段总名额（adminQuota 上限）
        usedQuota: Math.floor(Math.random() * 80) // 已占用名额（随机模拟，余量=total-used）
      })
    })
  }
  return rows
}

module.exports = {
  // 预约人（提前添加的常用参观人，进馆凭身份证核验；isDefault 标记默认联系人）
  visitors: [
    {
      id: 'vis_001',
      userId: 'demo_user',
      name: '张建国',
      idCard: '11010519491231002X',
      phone: '13800138000',
      isDefault: '1',
      createTime: '2026-08-18T09:00:00.000Z'
    },
    {
      id: 'vis_002',
      userId: 'demo_user',
      name: '张小明',
      idCard: '110105201509082357',
      phone: '13800138000',
      isDefault: '0',
      createTime: '2026-08-18T09:02:00.000Z'
    },
    {
      id: 'vis_003',
      userId: 'demo_user',
      name: '王秀兰',
      idCard: '110105197203154822',
      phone: '13900139000',
      isDefault: '0',
      createTime: '2026-08-18T09:05:00.000Z'
    }
  ],

  // 预约记录：visitDate 为未来日期（相对当天偏移），status 覆盖审核/取消/通过等状态；
  // visitors 字段为 JSON 字符串（实际参观人明细），qrCode 用于核销
  reservations: [
    {
      id: 'res_001',
      userId: 'demo_user',
      type: '个人',
      visitDate: formatDate(new Date(Date.now() + 2 * 86400000), 'yyyy-MM-dd'),
      timeSlot: '上午 9:00-12:00',
      visitorCount: 2,
      organization: '',
      contactName: '张建国',
      contactPhone: '13800138000',
      contactIdCard: '11010519491231002X',
      visitors: JSON.stringify([
        { name: '张建国', idCard: '11010519491231002X', phone: '13800138000' },
        { name: '张小明', idCard: '110105201509082357', phone: '13800138000' }
      ]),
      remark: '带小朋友参观学习',
      status: '已通过',
      rejectReason: '',
      qrCode: 'RES:res_001',
      createTime: '2026-08-20T10:00:00.000Z'
    },
    {
      id: 'res_002',
      userId: 'demo_user',
      type: '团体',
      visitDate: formatDate(new Date(Date.now() + 5 * 86400000), 'yyyy-MM-dd'),
      timeSlot: '下午 12:00-17:00',
      visitorCount: 35,
      organization: '市第二实验小学',
      contactName: '李老师',
      contactPhone: '13900139000',
      contactIdCard: '110105198505062119',
      visitors: JSON.stringify([
        { name: '李老师', idCard: '110105198505062119', phone: '13900139000' }
      ]),
      remark: '五年级红色研学活动，需要讲解员一名',
      status: '待审核',
      rejectReason: '',
      qrCode: 'RES:res_002',
      createTime: '2026-08-22T15:30:00.000Z'
    }
  ],

  reservationQuota: buildQuota(), // 动态生成未来 7 天名额（见 buildQuota）

  guideItems: [
    // 场馆指南按 category 分组展示（开放时间/地址交通/参观须知/配套服务/讲解服务）
    // 开放时间
    { id: 'gd_001', category: '开放时间', title: '常规开放', content: '周二至周日 9:00-17:00（16:30 停止入馆），周一闭馆（法定节假日另行公告）。', sort: 1 },
    { id: 'gd_002', category: '开放时间', title: '闭馆提醒', content: '如遇重大活动、设备检修等情况临时闭馆，将通过公众号与小程序首页公告提前告知。', sort: 2 },

    // 地址交通
    { id: 'gd_003', category: '地址交通', title: '场馆地址', content: '红色纪念馆位于市中心城区红星路 88 号，毗邻人民广场。', sort: 1 },
    { id: 'gd_004', category: '地址交通', title: '公交路线', content: '乘坐 1 路、12 路、26 路、旅游专线至「纪念馆站」下车，步行约 200 米即到。', sort: 2 },
    { id: 'gd_005', category: '地址交通', title: '地铁路线', content: '地铁 2 号线「红星广场站」B 出口，沿红星路向东步行约 500 米。', sort: 3 },
    { id: 'gd_006', category: '地址交通', title: '自驾停车', content: '馆内设地下停车场（约 120 个车位），高峰期建议使用周边社会停车场。', sort: 4 },

    // 参观须知
    { id: 'gd_007', category: '参观须知', title: '入馆须知', content: '参观请携带本人身份证原件，凭预约核销码实名核验入馆；馆内请保持安静，勿大声喧哗；请勿触摸展品与展柜。', sort: 1 },
    { id: 'gd_008', category: '参观须知', title: '禁止事项', content: '馆内禁止吸烟、禁止使用闪光灯拍照、禁止携带宠物与易燃易爆物品入内。', sort: 2 },
    { id: 'gd_009', category: '参观须知', title: '礼仪规范', content: '请衣着得体，缅怀区域请脱帽肃立；团体参观请听从讲解员引导，有序参观。', sort: 3 },

    // 配套服务
    { id: 'gd_010', category: '配套服务', title: '便民服务', content: '馆内提供免费寄存、轮椅婴儿车借用、直饮水、应急药箱等便民服务，可至一层服务台咨询。', sort: 1 },
    { id: 'gd_011', category: '配套服务', title: '红色书屋', content: '一层东侧设有红色书屋，陈列党史读物与红色经典，可供现场阅览。', sort: 2 },
    { id: 'gd_012', category: '配套服务', title: '文创商店', content: '出口处设有文创商店，提供红色主题文创、纪念邮品等，欢迎选购留念。', sort: 3 },

    // 讲解服务
    { id: 'gd_013', category: '讲解服务', title: '人工讲解预约', content: '提供中文人工讲解服务，每场约 60 分钟。团体（20 人以上）可提前 1-3 个工作日致电 0715-8888888 或在预约时备注申请。', sort: 1 },
    { id: 'gd_014', category: '讲解服务', title: '语音导览', content: '个人游客可在小程序「数字展馆」中收听展品语音讲解，或至服务台租用语音导览设备（免费，需押金）。', sort: 2 }
  ]
}
