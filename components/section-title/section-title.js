/**
 * 区块标题组件：页面各板块的统一标题栏
 * title=标题，more=右侧跳转链接，moreText=更多按钮文案（默认"更多"）
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    title: { type: String, value: '' },
    more: { type: String, value: '' },
    moreText: { type: String, value: '更多' }
  }
})
