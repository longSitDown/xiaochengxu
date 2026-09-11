/**
 * 展区 / 展品种子数据
 *
 * 用途：为「展陈管理」下的展区列表与展品语音讲解提供演示数据。
 * 字段名对齐 mingdao-api.md 第 8 节展品表建议：
 *   name / cover / audioUrl / script / views / exhibitionId / duration
 * 关联关系：展品 exhibitionId 关联到展区(exhibitions) 的 id，
 * 演示多层结构的「展区 → 展品」浏览链路；isHighlight 标记重点展品。
 */
module.exports = {
  // 展区：order 控制展厅顺序，panoramaUrl 指向 720° 全景预览入口（带展区 id）
  exhibitions: [
    {
      id: 'exh_01',
      name: '第一展厅 · 星火燎原',
      cover: '/images/covers/cover-spark.png',
      description: '展现中国共产党创建初期艰苦卓绝的奋斗历程，从南湖红船到井冈星火，记录早期共产党人追寻真理、点燃革命火种的峥嵘岁月。',
      order: 1,
      panoramaUrl: '/pages/panorama/panorama?exhibitionId=exh_01'
    },
    {
      id: 'exh_02',
      name: '第二展厅 · 浴血奋战',
      cover: '/images/covers/cover-flame.png',
      description: '聚焦新民主主义革命时期的重大战役与英雄壮举，通过武器、文献、勋章等实物，再现革命先烈为民族独立和人民解放抛头颅、洒热血的壮烈场景。',
      order: 2,
      panoramaUrl: '/pages/panorama/panorama?exhibitionId=exh_02'
    },
    {
      id: 'exh_03',
      name: '第三展厅 · 峥嵘岁月',
      cover: '/images/covers/cover-mountain.png',
      description: '以抗日战争、解放战争为背景，讲述根据地建设、军民鱼水情与革命前辈在极端困难条件下坚持斗争的光辉事迹。',
      order: 3,
      panoramaUrl: '/pages/panorama/panorama?exhibitionId=exh_03'
    },
    {
      id: 'exh_04',
      name: '第四展厅 · 继往开来',
      cover: '/images/covers/cover-course.png',
      description: '回望新中国成立以来红色精神的传承与发展，展示新时代红色纪念馆在爱国主义教育、红色文化传播中的使命担当。',
      order: 4,
      panoramaUrl: '/pages/panorama/panorama?exhibitionId=exh_04'
    }
  ],

  // 展品语音讲解：script 为讲解词，audioUrl 为播放音频地址，duration 为音频时长（秒）
  // category 文物分类（文物鉴赏页筛选），period 历史时期（详情页展示）
  artifacts: [
    {
      id: 'art_001',
      name: '冲锋军号',
      cover: '/images/covers/cover-horn.png',
      category: '武器军械',
      period: '土地革命战争时期',
      audioUrl: '/audio/demo1.wav',
      script: '这是一把陪伴红军战士南征北战的冲锋号。铜质的号身已被岁月磨得发亮，号嘴处还留有战士们长期吹奏留下的痕迹。在一次次战斗最激烈的时刻，嘹亮的号声就是冲锋的命令，激励着战士们奋不顾身、勇往直前。它见证了中国革命从胜利走向胜利的光辉历程。',
      views: 1256,
      exhibitionId: 'exh_02',
      duration: 6,
      isHighlight: '1'
    },
    {
      id: 'art_002',
      name: '红军草鞋',
      cover: '/images/covers/cover-spirit.png',
      category: '实物器具',
      period: '土地革命战争时期',
      audioUrl: '/audio/demo2.wav',
      script: '这双草鞋由稻草和麻绳编制而成，鞋面早已磨损，鞋底沾满泥土。长征途中，战士们正是穿着这样简陋的草鞋，跨越雪山草地，跋涉二万五千里。它凝聚着红军战士不畏艰难、百折不挠的革命精神。',
      views: 980,
      exhibitionId: 'exh_02',
      duration: 6,
      isHighlight: '1'
    },
    {
      id: 'art_003',
      name: '抗战时期油灯',
      cover: '/images/covers/cover-letter.png',
      category: '实物器具',
      period: '抗日战争时期',
      audioUrl: '/audio/demo3.wav',
      script: '一盏锈迹斑斑的煤油灯，曾照亮根据地指挥部的夜晚。在那段艰苦卓绝的岁月里，无数重要决策在油灯下形成，无数战斗命令从油灯下发出。它微弱的火光，象征着革命者在黑暗中坚守信念、照亮前路的伟大力量。',
      views: 760,
      exhibitionId: 'exh_03',
      duration: 7,
      isHighlight: '0'
    },
    {
      id: 'art_004',
      name: '革命烈士家书',
      cover: '/images/covers/cover-letter.png',
      category: '文献文书',
      period: '解放战争时期',
      audioUrl: '/audio/demo1.wav',
      script: '这是一封写于解放战争前夕的家书，纸页已经泛黄，墨迹却依然清晰。信中既有对家人的深切思念，更有“为国尽忠，便是尽孝”的赤诚。字里行间流露出革命者舍小家为大家的崇高情怀。',
      views: 1450,
      exhibitionId: 'exh_03',
      duration: 6,
      isHighlight: '1'
    },
    {
      id: 'art_005',
      name: '党徽胸章',
      cover: '/images/covers/cover-medal.png',
      category: '实物器具',
      period: '大革命时期',
      audioUrl: '/audio/demo2.wav',
      script: '这枚铜质党徽胸章，由一位老党员珍藏多年。党徽正面锤头镰刀图案庄严肃穆，背面刻有编号。它见证了一名普通党员对党的无限忠诚，也象征着千千万万共产党员为共产主义事业奋斗终身的坚定信仰。',
      views: 630,
      exhibitionId: 'exh_01',
      duration: 6,
      isHighlight: '0'
    },
    {
      id: 'art_006',
      name: '红军斗笠',
      cover: '/images/covers/cover-mountain.png',
      category: '实物器具',
      period: '土地革命战争时期',
      audioUrl: '/audio/demo3.wav',
      script: '斗笠是南方红军战士常见的随身装备。它既能遮阳挡雨，又可当扇、当枕、当坐垫，陪伴战士们走过千山万水。斗笠上残留的弹痕，讲述着那段枪林弹雨中的峥嵘岁月。',
      views: 540,
      exhibitionId: 'exh_02',
      duration: 7,
      isHighlight: '0'
    },
    {
      id: 'art_007',
      name: '解放战争勋章',
      cover: '/images/covers/cover-medal.png',
      category: '实物器具',
      period: '解放战争时期',
      audioUrl: '/audio/demo1.wav',
      script: '这枚勋章授予在解放战争中建立功勋的革命军人。勋章正面刻有五角星与麦穗图案，象征着人民军队的荣耀。获得者用青春和热血，为中华人民共和国的诞生立下了不朽功勋。',
      views: 880,
      exhibitionId: 'exh_04',
      duration: 6,
      isHighlight: '1'
    },
    {
      id: 'art_008',
      name: '入党志愿书',
      cover: '/images/covers/cover-oath.png',
      category: '文献文书',
      period: '大革命时期',
      audioUrl: '/audio/demo2.wav',
      script: '这份入党志愿书写于上世纪四十年代，申请人用朴素的语言表达了对党的向往和为劳苦大众翻身解放而奋斗的决心。它记录了一名普通人在革命洪流中成长为坚定共产主义战士的心路历程。',
      views: 1120,
      exhibitionId: 'exh_01',
      duration: 6,
      isHighlight: '1'
    },
    {
      id: 'art_009',
      name: '老式步枪',
      cover: '/images/covers/cover-horn.png',
      category: '武器军械',
      period: '土地革命战争时期',
      audioUrl: '/audio/demo3.wav',
      script: '这支步枪曾跟随革命战士参加过无数次战斗。枪托上的划痕、枪管上的锈迹，都是硝烟与岁月的印记。它既是革命先辈英勇作战的武器，也是后人铭记历史、珍爱和平的生动教材。',
      views: 730,
      exhibitionId: 'exh_02',
      duration: 7,
      isHighlight: '0'
    },
    {
      id: 'art_010',
      name: '开国大典纪念章',
      cover: '/images/covers/cover-course.png',
      category: '实物器具',
      period: '社会主义革命和建设时期',
      audioUrl: '/audio/demo1.wav',
      script: '1949年10月1日，中华人民共和国成立。这枚珍贵的开国大典纪念章，曾佩戴在参加过天安门庆典的群众代表胸前。它凝结着中国人民从此站起来的骄傲与荣光，激励着一代又一代中华儿女接续奋斗。',
      views: 1590,
      exhibitionId: 'exh_04',
      duration: 6,
      isHighlight: '1'
    }
  ]
}
