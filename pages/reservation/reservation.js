/**
 * 我的预约：状态筛选 + 预约卡片列表 + 新建入口
 */
const reservationApi = require('../../api/reservation')
const userApi = require('../../api/user')
const config = require('../../config/index')
const { formatDate } = require('../../utils/format')

const TABS = ['全部', '待审核', '已通过', '已驳回', '已取消', '已核销']

// 预约状态 → 样式类（app.wxss 已定义 .st-* 状态色）
const STATUS_CLASS = {
  '待审核': 'st-pending',
  '已通过': 'st-approved',
  '已驳回': 'st-rejected',
  '已取消': 'st-canceled',
  '已核销': 'st-used'
}

Page({
  data: {
    tabs: TABS,
    activeTab: '全部',
    list: [],
    loading: true,
    // 「团体预约」入口卡片开关（当前已下线）；表单页仅在改期历史团体订单时使用团体字段
    showGroup: config.BLOCKS.groupReservation
  },

  onLoad() {
    this.all = [] // 全量预约（筛选前）
    this.fetchList()
  },

  onShow() {
    // 从表单/详情页返回时刷新（首次 onLoad 已加载则跳过）
    if (this._loaded) this.fetchList()
    this._loaded = true
  },

  onPullDownRefresh() {
    this.fetchList(() => wx.stopPullDownRefresh())
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.applyFilter()
  },

  fetchList(done) {
    const user = userApi.getUser()
    if (!user) {
      this.all = []
      this.setData({ loading: false, list: [] })
      return
    }
    reservationApi
      .getMyReservations(user.id)
      .then((all) => {
        this.all = all.map((r) => Object.assign({}, r, {
          timeText: formatDate(r.createTime, 'yyyy-MM-dd HH:mm'),
          weekday: this.weekdayOf(r.visitDate),
          statusClass: STATUS_CLASS[r.status] || 'st-canceled',
          realCount: (r.visitors || []).length // 已实名登记的参观人数
        }))
        this.applyFilter()
        done && done()
      })
      .catch((e) => {
        this.setData({ loading: false })
        done && done()
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  weekdayOf(dateStr) {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    return '周' + '日一二三四五六'.charAt(d.getDay())
  },

  applyFilter() {
    const tab = this.data.activeTab
    const list = tab === '全部' ? this.all : this.all.filter((r) => r.status === tab)
    this.setData({ list, loading: false })
  },

  onItemTap(e) {
    wx.navigateTo({ url: '/pages/reservation-detail/reservation-detail?id=' + e.currentTarget.dataset.id })
  },

  goCreate() {
    // 团体预约已下线：统一进入个人预约表单，不再携带 type 参数
    wx.navigateTo({ url: '/pages/reservation-form/reservation-form' })
  }
})
