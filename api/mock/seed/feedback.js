/**
 * 意见反馈种子数据
 *
 * 用途：为「意见反馈」模块提供演示数据，覆盖不同处理状态（已完结 / 处理中）。
 * 字段与 schema.js 的 feedbacks 表对应：images 为 JSON 字符串形式的图片 URL 数组，
 * status 控制处理流程，reply/replyTime 记录官方回复内容与时间。
 */
module.exports = {
  feedbacks: [
    {
      id: 'fb_001',
      userId: 'demo_user',
      content: '建议在第三展厅增加休息座椅，老年人参观时间长了比较累。另外讲解词非常生动，给孩子上了一堂生动的红色课，点赞！',
      images: JSON.stringify(['/images/covers/cover-hall.png']),
      contact: '13800138000',
      status: '已完结',
      reply: '感谢您的宝贵建议！我们已在第三展厅增设两处休息区，欢迎再次前来参观体验。期待您继续关注和支持红色文化传播工作。',
      replyTime: '2026-08-21T16:00:00.000Z',
      createTime: '2026-08-19T09:20:00.000Z'
    },
    {
      id: 'fb_002',
      userId: 'demo_user',
      content: '线上预约流程很顺畅，但希望增加改期功能说明，之前找了半天没找到入口。',
      images: JSON.stringify([]),
      contact: 'wx_demo_user',
      status: '处理中',
      reply: '',
      replyTime: '',
      createTime: '2026-08-23T11:00:00.000Z'
    }
  ]
}
