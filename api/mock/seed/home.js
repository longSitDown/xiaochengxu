/**
 * 首页相关种子数据（首页四个内容板块的初始展示数据）
 *
 * 用途：为首页 Banner、公告、红色资讯、荣誉资质提供联调演示数据。
 * 深拷贝合并发生在 db.js getTable()：若演示中被新增/修改/删除，会以 delta 方式覆盖。
 * 字段名与 schema.js 中对应工作表的字段别名一一对应（如 banners 的 linkType/sort/isShow）。
 */
module.exports = {
  // 首页轮播 Banner：linkType 决定点击跳转行为（page 页面 / news 资讯 / panorama 全景展馆）
  banners: [
    { id: 'ban_001', title: '铭记历史 缅怀先烈', image: '/images/banners/banner-1.png', linkType: 'page', linkTarget: '/pages/about/about', sort: 1, isShow: '1' },
    { id: 'ban_002', title: '720°全景数字展馆', image: '/images/banners/banner-2.png', linkType: 'panorama', linkTarget: '/pages/panorama/panorama', sort: 2, isShow: '1' },
    { id: 'ban_003', title: '红色知识竞赛', image: '/images/banners/banner-3.png', linkType: 'page', linkTarget: '/pages/quiz/quiz', sort: 3, isShow: '1' }
  ],

  // 首页公告通知：type 区分「公告/紧急通知」，isPopup='1' 时首页做弹窗展示
  notices: [
    {
      id: 'not_001',
      title: '闭馆公告',
      content: '因场馆设备维护，本周一（8月25日）全天闭馆，周二恢复正常开放。请提前调整参观安排，给您带来不便敬请谅解。',
      type: '紧急通知',
      isPopup: '1',
      publishTime: '2026-08-20T09:00:00.000Z',
      status: '上架'
    },
    {
      id: 'not_002',
      title: '关于实行线上预约参观的通知',
      content: '为保障参观秩序，纪念馆实行实名制线上预约。个人游客可直接预约，团体需提前1-3个工作日提交申请。',
      type: '公告',
      isPopup: '0',
      publishTime: '2026-08-18T10:00:00.000Z',
      status: '上架'
    }
  ],

  // 红色资讯列表：category 分「资讯/英烈事迹/红色故事」，isTop 控制置顶，status 控制上下架
  news: [
    {
      id: 'news_001',
      title: '我馆开展“赓续红色血脉”主题党日活动',
      summary: '全体党员走进第一展厅，重温入党誓词，缅怀革命先烈，汲取奋进力量。',
      cover: '/images/covers/cover-spark.png',
      content: '为深入学习贯彻党的二十大精神，引导党员干部坚定理想信念，红色纪念馆党支部组织全体党员开展“赓续红色血脉 凝聚奋进力量”主题党日活动。大家在讲解员带领下参观第一展厅，仔细观看珍贵文物，聆听革命故事，并在党旗前重温入党誓词。',
      category: '资讯',
      source: '馆办公室',
      publishTime: '2026-08-22T08:00:00.000Z',
      views: 1280,
      isTop: '1',
      status: '上架'
    },
    {
      id: 'news_002',
      title: '革命烈士刘胡兰：生的伟大 死的光荣',
      summary: '回顾刘胡兰烈士短暂而光辉的一生，感悟共产党人坚贞不屈的革命气节。',
      cover: '/images/covers/cover-hero.png',
      content: '刘胡兰（1932—1947），山西省文水县云周西村人，著名的革命先烈。她10岁参加儿童团，14岁成为中共预备党员。1947年1月12日，国民党军和地主武装突然袭击云周西村，刘胡兰因叛徒出卖被捕。面对敌人威胁，她坚贞不屈，大义凛然，从容躺在铡刀下，年仅15岁。毛泽东主席亲笔题词：“生的伟大，死的光荣”。',
      category: '英烈事迹',
      source: '党史研究室',
      publishTime: '2026-08-15T10:30:00.000Z',
      views: 3420,
      isTop: '1',
      status: '上架'
    },
    {
      id: 'news_003',
      title: '一本日记背后的抗战记忆',
      summary: '泛黄纸页上的字字句句，记录着普通战士的家国情怀与必胜信念。',
      cover: '/images/covers/cover-letter.png',
      content: '在第二展厅“浴血奋战”展区，陈列着一本写于1943年的战士日记。日记主人是一名普通八路军战士，他在字里行间记录了敌后游击战的艰苦岁月，也写下了“国若破，家何存”的铮铮誓言。这本日记成为研究抗战史的重要民间史料。',
      category: '红色故事',
      source: '陈列保管部',
      publishTime: '2026-08-10T09:00:00.000Z',
      views: 890,
      isTop: '0',
      status: '上架'
    },
    {
      id: 'news_004',
      title: '我馆与中小学共建红色研学基地',
      summary: '通过馆校合作，让更多青少年走进纪念馆，接受爱国主义教育。',
      cover: '/images/covers/cover-hall.png',
      content: '近日，红色纪念馆与市第一中学、第二实验小学签署馆校合作协议，共建“红色研学实践基地”。未来双方将围绕展览讲解、知识竞赛、志愿服务等方面开展深度合作，推动红色文化进校园。',
      category: '资讯',
      source: '社教部',
      publishTime: '2026-08-05T14:00:00.000Z',
      views: 650,
      isTop: '0',
      status: '上架'
    },
    {
      id: 'news_005',
      title: '董存瑞：为了新中国，前进！',
      summary: '手托炸药包炸毁敌人碉堡，用年仅19岁的生命开辟了胜利道路。',
      cover: '/images/covers/cover-flame.png',
      content: '董存瑞（1929—1948），河北怀来人，中国人民解放军战斗英雄。1948年5月25日，在解放隆化战斗中，为扫除部队前进障碍，他毅然托起炸药包，炸毁敌人桥形暗堡，以自己的生命为部队开辟了前进道路，牺牲时年仅19岁。',
      category: '英烈事迹',
      source: '党史研究室',
      publishTime: '2026-07-28T08:00:00.000Z',
      views: 5100,
      isTop: '0',
      status: '上架'
    },
    {
      id: 'news_006',
      title: '一枚勋章见证峥嵘岁月',
      summary: '解放战争纪念章入藏我馆，承载那段波澜壮阔的革命历史。',
      cover: '/images/covers/cover-medal.png',
      content: '近日，市民王先生将其祖父珍藏多年的一枚“解放奖章”无偿捐赠给红色纪念馆。这枚勋章见证了老一辈革命者为民族独立和人民解放浴血奋战的光辉历程。馆方表示，将妥善保管并尽快在第三展厅展出。',
      category: '红色故事',
      source: '征集保管部',
      publishTime: '2026-07-20T10:00:00.000Z',
      views: 720,
      isTop: '0',
      status: '上架'
    }
  ],

  // 底部荣誉资质卡片，按 sort 排序显示
  honors: [
    { id: 'hon_001', title: '全国爱国主义教育示范基地', image: '/images/covers/cover-oath.png', sort: 1 },
    { id: 'hon_002', title: '省级国防教育基地', image: '/images/covers/cover-mountain.png', sort: 2 },
    { id: 'hon_003', title: '青少年红色研学基地', image: '/images/covers/cover-blood.png', sort: 3 },
    { id: 'hon_004', title: '文明单位', image: '/images/covers/cover-course.png', sort: 4 }
  ]
}
