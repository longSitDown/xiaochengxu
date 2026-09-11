/**
 * 空状态占位组件：列表/数据为空的统一提示
 * text=主文案，sub=副文案；样式由页面共享（styleIsolation: apply-shared）
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    text: { type: String, value: '暂无数据' },
    sub: { type: String, value: '' }
  }
})
