/**
 * 知识竞赛种子数据
 *
 * 用途：为「知识竞赛」模块的活动、题库提供演示数据。
 * quizActivities 定义一场活动（含时间、限时、及格分、状态与规则）；
 * questions 为题库，answer 存正确答案（多选逗号分隔），options 为 JSON 字符串，
 * 与 schema.js 中 questions 表字段的存储约定一致。答题记录(quizRecords)由运行时写入，无种子。
 */
module.exports = {
  // 竞赛活动：status 由前端按 startTime/endTime 综合判断，这里预置「进行中」便于演示
  quizActivities: [
    {
      id: 'act_001',
      title: '红色记忆 · 2026 知识竞答',
      description: '以赛促学、以学促行，通过线上知识竞答重温党的光辉历程，传承红色基因。',
      startTime: '2026-08-01T00:00:00.000Z',
      endTime: '2026-12-31T23:59:59.000Z',
      duration: 10,
      passScore: 80,
      questionCount: 8,
      status: '进行中',
      rule: '1. 共 8 道题，包含单选、多选、判断三种题型；\n2. 每题答题时间为 2 分钟，超时自动进入下一题；\n3. 答对得分，答错不扣分；\n4. 活动结束后根据总分与用时生成排行榜。'
    }
  ],

  // 题库：type 为三种题型，activityId 关联到活动，sort 控制出题顺序
  questions: [
    {
      id: 'q_001',
      activityId: 'act_001',
      type: '单选',
      title: '1927年8月1日，中国共产党领导发动的武装起义是？',
      options: JSON.stringify(['A. 秋收起义', 'B. 南昌起义', 'C. 广州起义', 'D. 百色起义']),
      answer: 'B. 南昌起义',
      analysis: '南昌起义打响了武装反抗国民党反动派的第一枪，标志着中国共产党独立领导革命战争、创建人民军队和武装夺取政权的开始。',
      score: 10,
      sort: 1
    },
    {
      id: 'q_002',
      activityId: 'act_001',
      type: '多选',
      title: '下列属于长征精神主要内涵的有？',
      options: JSON.stringify(['A. 把全国人民和中华民族的根本利益看得高于一切', 'B. 为了救国救民，不怕任何艰难险阻', 'C. 坚持独立自主、实事求是', 'D. 紧紧依靠人民群众']),
      answer: 'A,B,C,D',
      analysis: '长征精神包括：把全国人民和中华民族的根本利益看得高于一切，坚定革命的理想和信念；为了救国救民，不怕任何艰难险阻；坚持独立自主、实事求是；顾全大局、严守纪律、紧密团结；紧紧依靠人民群众。',
      score: 10,
      sort: 2
    },
    {
      id: 'q_003',
      activityId: 'act_001',
      type: '判断',
      title: '五四运动爆发于1919年5月4日。',
      options: JSON.stringify(['正确', '错误']),
      answer: '正确',
      analysis: '五四运动是1919年5月4日发生在北京的一场以青年学生为主的爱国运动，是中国新民主主义革命的开端。',
      score: 10,
      sort: 3
    },
    {
      id: 'q_004',
      activityId: 'act_001',
      type: '单选',
      title: '中国共产党第一次全国代表大会于1921年在哪里召开？',
      options: JSON.stringify(['A. 北京', 'B. 上海', 'C. 广州', 'D. 武汉']),
      answer: 'B. 上海',
      analysis: '中共一大于1921年7月23日在上海法租界望志路106号开幕，后因受到法租界巡捕的干扰，最后一天的会议转移到浙江嘉兴南湖的一艘游船上举行。',
      score: 10,
      sort: 4
    },
    {
      id: 'q_005',
      activityId: 'act_001',
      type: '多选',
      title: '毛泽东同志提出的新民主主义革命“三大法宝”是？',
      options: JSON.stringify(['A. 统一战线', 'B. 武装斗争', 'C. 党的建设', 'D. 群众路线']),
      answer: 'A,B,C',
      analysis: '1939年，毛泽东在《〈共产党人〉发刊词》中，把统一战线、武装斗争、党的建设概括为中国共产党在中国革命中战胜敌人的三大法宝。',
      score: 10,
      sort: 5
    },
    {
      id: 'q_006',
      activityId: 'act_001',
      type: '判断',
      title: '中国人民抗日战争胜利纪念日是1945年8月15日。',
      options: JSON.stringify(['正确', '错误']),
      answer: '错误',
      analysis: '1945年8月15日，日本宣布无条件投降；9月2日，日本正式签署投降书。2014年起，每年9月3日被确定为中国人民抗日战争胜利纪念日。',
      score: 10,
      sort: 6
    },
    {
      id: 'q_007',
      activityId: 'act_001',
      type: '单选',
      title: '第一个农村革命根据地是？',
      options: JSON.stringify(['A. 井冈山革命根据地', 'B. 中央革命根据地', 'C. 湘鄂西革命根据地', 'D. 左右江革命根据地']),
      answer: 'A. 井冈山革命根据地',
      analysis: '1927年10月，毛泽东率领秋收起义部队到达井冈山，创建了中国第一个农村革命根据地——井冈山革命根据地。',
      score: 10,
      sort: 7
    },
    {
      id: 'q_008',
      activityId: 'act_001',
      type: '单选',
      title: '中华人民共和国开国大典举行于哪一年？',
      options: JSON.stringify(['A. 1948年', 'B. 1949年', 'C. 1950年', 'D. 1951年']),
      answer: 'B. 1949年',
      analysis: '1949年10月1日，毛泽东主席在天安门城楼上庄严宣告中华人民共和国中央人民政府成立。',
      score: 10,
      sort: 8
    }
  ]
}
