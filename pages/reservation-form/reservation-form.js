/**
 * 预约表单：日期/时段（余量实时展示）+ 实名参观人 + 联系方式校验
 *
 * 类型说明：
 *   - 新建预约固定为「个人」，不提供类型切换，也不接受 ?type=团体 参数
 *   - 「团体」字段与校验逻辑保留，仅供改期历史团体订单使用（loadForReschedule 恢复 type）
 *   - 个人预约：多选实名参观人，人数 = 已选人数，上限 5
 *
 * 支持「改期模式」：URL 带 reschedule=<预约id> 时仅修改日期/时段/人数
 *
 * 实名规则：
 *   - 个人预约：参观人从「预约人」名单中选取（1-5 人，每人已登记身份证），
 *     联系人自动取第一位参观人
 *   - 团体预约：联系人（带队负责人）须填写身份证，可从预约人中一键选取
 *     （仅改期历史团体订单时生效，新建预约无此入口）
 */
const reservationApi = require('../../api/reservation')
const visitorApi = require('../../api/visitor')
const userApi = require('../../api/user')
const { formatDate, maskIdCard, validateIdCard } = require('../../utils/format')
const app = getApp()

// 个人预约单次最多选取的参观人数
const PERSON_MAX = 5

Page({
  data: {
    step: 1,           // 1=选日期时段 2=填预约信息（改期模式停留在 1）
    weeks: ['日', '一', '二', '三', '四', '五', '六'],
    calendar: [],      // 月历网格 [{blank|day,value,inRange,full,selected}]
    monthText: '',     // 当前显示年月
    hasLaterMonth: false, // 可约日期是否跨到下月（提供"切换年月"）
    isReschedule: false,
    resv: null,        // 改期时的原预约
    dates: [],         // [{value, label, weekday, slots: [{timeSlot, available, total}]}]
    visitDate: '',
    timeSlot: '',
    type: '个人',
    visitorCount: 1,
    organization: '',
    contactName: '',
    contactPhone: '',
    contactIdCard: '',
    remark: '',
    submitting: false,

    /* ---- 实名参观人 ---- */
    visitorList: [],     // 可选预约人全量
    selectedVisitors: [], // 已选参观人（个人预约）
    showPicker: false,   // 预约人选择弹层
    pickerMode: 'multi', // multi=个人多选参观人 / single=团体选联系人
    pickerItems: [],     // 弹层列表（含 checked）
    pickerCheckedCount: 0, // 弹层已选人数
    showEditor: false,   // 快捷新增预约人弹层
    userId: ''
  },

  onLoad(options) {
    const user = userApi.getUser()
    this.setData({ userId: user ? user.id : '' })
    // 新建预约固定为「个人」，不再接受 ?type=团体 预设（旧链接传入时静默忽略）；
    // 团体类型只在改期历史团体订单时由 loadForReschedule 恢复
    if (options.reschedule) {
      this.rescheduleId = options.reschedule
      this.setData({ isReschedule: true })
      wx.setNavigationBarTitle({ title: '预约改期' })
      this.loadForReschedule()
    } else {
      this.loadVisitors(user)
      this.loadQuotas()
    }
  },

  onUnload() {
    // 提交成功后有延时跳转：若用户在此期间返回上一页，需撤销跳转，
    // 否则会在已离开的页面上被强行 redirectTo
    if (this._jumpTimer) {
      clearTimeout(this._jumpTimer)
      this._jumpTimer = null
    }
  },

  /** 加载预约人名单：个人模式默认勾选「默认预约人」 */
  loadVisitors(user) {
    if (!user) return
    visitorApi
      .getVisitors(user.id)
      .then((list) => {
        const withMask = this.decorateVisitors(list)
        const selected = this.data.type === '个人' && !this.data.selectedVisitors.length
          ? withMask.filter((v) => v.isDefault === '1').slice(0, PERSON_MAX)
          : this.data.selectedVisitors
        this.syncVisitors(withMask, selected)
      })
      .catch(() => { /* 名单加载失败不阻塞预约，可在弹层中重试 */ })
  },

  /** 预约人装饰：身份证脱敏 + 姓名首字头像 */
  decorateVisitors(list) {
    return list.map((v) => Object.assign({}, v, {
      idCardMask: maskIdCard(v.idCard),
      avatar: (v.name || '').charAt(0)
    }))
  },

  /** 同步参观人选择状态（人数与联系人联动） */
  syncVisitors(list, selected) {
    const first = selected[0]
    this.setData({
      visitorList: list,
      selectedVisitors: selected,
      visitorCount: this.data.type === '个人' && !this.data.isReschedule ? selected.length : this.data.visitorCount,
      // 个人预约：联系人取第一位参观人
      contactName: this.data.type === '个人' && first ? first.name : this.data.contactName,
      contactPhone: this.data.type === '个人' && first ? first.phone : this.data.contactPhone,
      contactIdCard: this.data.type === '个人' && first ? first.idCard : this.data.contactIdCard
    })
  },

  /** 改期模式：拉取原预约与名额，回填表单 */
  loadForReschedule() {
    Promise.all([
      reservationApi.getReservationDetail(this.rescheduleId),
      reservationApi.getQuotas()
    ])
      .then(([resv, quotas]) => {
        this.applyQuotas(quotas, resv)
        this.setData({
          resv,
          type: resv.type,
          visitorCount: resv.visitorCount,
          visitDate: resv.visitDate,
          timeSlot: resv.timeSlot
        })
      })
      .catch((e) => {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  loadQuotas() {
    reservationApi
      .getQuotas()
      .then((quotas) => this.applyQuotas(quotas))
      .catch((e) => {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  /** 名额 → 日期分组结构（可选回填原预约） */
  applyQuotas(quotas, resv) {
    const byDate = {}
    quotas.forEach((q) => {
      if (!byDate[q.visitDate]) {
        const d = new Date(q.visitDate)
        byDate[q.visitDate] = {
          value: q.visitDate,
          label: formatDate(q.visitDate, 'MM月dd日'),
          // getDay() 周日=0，用字符表直接映射成中文星期
          weekday: '周' + '日一二三四五六'.charAt(d.getDay()),
          slots: []
        }
      }
      byDate[q.visitDate].slots.push({
        timeSlot: q.timeSlot,
        available: q.available,
        total: q.totalQuota,
        disabled: q.available <= 0
      })
    })
    // 日期键为 yyyy-mm-dd，字典序即时间先后，故可直接 sort() 实现日期升序
    const dates = Object.keys(byDate).sort().map((k) => byDate[k])
    const firstOpen = this.findFirstOpen(dates, resv)
    this.setData({
      dates,
      visitDate: firstOpen.visitDate,
      timeSlot: firstOpen.timeSlot
    })
    this.monthOffset = 0 // 日历从可约首日所在月开始
    this.buildCalendar()
  },

  /**
   * 由 dates（可约名额）生成月历网格：
   * 以第一个可约日期所在月为基准（monthOffset 可切下月），
   * 逐天标记 inRange（可约范围内）/ full（约满）/ selected（已选中）。
   */
  buildCalendar() {
    const dates = this.data.dates
    if (!dates.length) {
      this.setData({ calendar: [], monthText: '', hasLaterMonth: false })
      return
    }
    const first = new Date(dates[0].value + 'T00:00:00')
    const view = new Date(first.getFullYear(), first.getMonth() + this.monthOffset, 1)
    const vy = view.getFullYear()
    const vm = view.getMonth()
    const daysInMonth = new Date(vy, vm + 1, 0).getDate()
    const startBlank = view.getDay() // 周日=0，前面补空白格

    // value → 名额日期 的索引，便于逐天查状态
    const byDate = {}
    dates.forEach((d) => { byDate[d.value] = d })

    const cells = []
    for (let i = 0; i < startBlank; i++) cells.push({ blank: true })
    for (let day = 1; day <= daysInMonth; day++) {
      const value = formatDate(new Date(vy, vm, day), 'yyyy-MM-dd')
      const d = byDate[value]
      cells.push({
        day,
        value,
        inRange: !!d,
        full: d ? d.slots.every((s) => s.disabled) : false,
        selected: value === this.data.visitDate
      })
    }

    // 可约日期是否跨到显示月之后（决定是否显示「切换年月」）
    const last = new Date(dates[dates.length - 1].value + 'T00:00:00')
    const hasLater = last.getFullYear() * 12 + last.getMonth() > vy * 12 + vm

    this.setData({
      calendar: cells,
      monthText: vy + ' 年 ' + (vm + 1) + ' 月',
      hasLaterMonth: hasLater
    })
  },

  /** 切换到下一个月（仅当可约日期跨月时展示入口） */
  onNextMonth() {
    this.monthOffset += 1
    this.buildCalendar()
  },

  /** 优先回填原时段；否则取第一个有余量的时段 */
  findFirstOpen(dates, resv) {
    if (resv) {
      const d = dates.find((x) => x.value === resv.visitDate)
      if (d) {
        const s = d.slots.find((x) => x.timeSlot === resv.timeSlot)
        if (s && !s.disabled) return { visitDate: d.value, timeSlot: s.timeSlot }
      }
    }
    for (let i = 0; i < dates.length; i++) {
      const s = dates[i].slots.find((x) => !x.disabled)
      if (s) return { visitDate: dates[i].value, timeSlot: s.timeSlot }
    }
    return { visitDate: '', timeSlot: '' }
  },

  /* ---------------- 表单交互 ---------------- */

  /** 日历日期点击：仅可约日期可选（等价于原 onDateTap） */
  onCalTap(e) {
    const { value, ok } = e.currentTarget.dataset
    if (!value || ok === false || ok === 'false') {
      wx.showToast({ title: '该日期不可预约', icon: 'none' })
      return
    }
    this.selectDate(value)
  },

  onDateTap(e) {
    this.selectDate(e.currentTarget.dataset.value)
  },

  /** 选中某可约日期：自动选中第一个有余量的时段并刷新日历选中态 */
  selectDate(value) {
    const date = this.data.dates.find((d) => d.value === value)
    if (!date) return
    // 切换日期时自动选中第一个有余量的时段
    const slot = (date.slots || []).find((s) => !s.disabled)
    this.setData({
      visitDate: value,
      timeSlot: slot ? slot.timeSlot : ''
    })
    this.buildCalendar()
  },

  onSlotTap(e) {
    const { slot, disabled } = e.currentTarget.dataset
    if (disabled) {
      wx.showToast({ title: '该时段名额已满', icon: 'none' })
      return
    }
    this.setData({ timeSlot: slot })
  },

  onCountMinus() {
    const { visitorCount, type } = this.data
    const min = type === '团体' ? 10 : 1
    if (visitorCount > min) this.setData({ visitorCount: visitorCount - 1 })
  },

  onCountPlus() {
    const { visitorCount, type, dates, visitDate, timeSlot } = this.data
    const max = type === '团体' ? 100 : 5
    // 上限同时受当前时段余量约束
    let quotaMax = max
    const date = dates.find((d) => d.value === visitDate)
    const slot = date && date.slots.find((s) => s.timeSlot === timeSlot)
    if (slot) quotaMax = Math.min(max, slot.available)
    if (visitorCount < quotaMax) {
      this.setData({ visitorCount: visitorCount + 1 })
    } else if (slot && visitorCount >= slot.available) {
      wx.showToast({ title: '已达当前时段剩余名额（' + slot.available + ' 人）', icon: 'none' })
    }
  },

  onOrgInput(e) {
    this.setData({ organization: e.detail.value })
  },

  onNameInput(e) {
    this.setData({ contactName: e.detail.value })
  },

  onPhoneInput(e) {
    this.setData({ contactPhone: e.detail.value })
  },

  onIdCardInput(e) {
    this.setData({ contactIdCard: e.detail.value })
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  /* ---------------- 参观人选择 ---------------- */

  /** 打开选择弹层：个人多选参观人 / 团体单选联系人 */
  openPicker(e) {
    const mode = (e && e.currentTarget.dataset.mode) || 'multi'
    const selectedIds = this.data.selectedVisitors.map((v) => v.id)
    this.setData({
      pickerMode: mode,
      showPicker: true,
      pickerItems: this.data.visitorList.map((v) => Object.assign({}, v, {
        checked: mode === 'multi' ? selectedIds.indexOf(v.id) >= 0 : false
      })),
      pickerCheckedCount: mode === 'multi' ? selectedIds.length : 0
    })
  },

  /** 弹层勾选（个人多选，上限 5） */
  onPickerToggle(e) {
    if (this.data.pickerMode !== 'multi') return
    const id = e.currentTarget.dataset.id
    const items = this.data.pickerItems
    const idx = items.findIndex((v) => v.id === id)
    if (idx < 0) return
    const checkedCount = items.filter((v) => v.checked).length
    if (!items[idx].checked && checkedCount >= PERSON_MAX) {
      wx.showToast({ title: '个人预约每单最多 ' + PERSON_MAX + ' 人', icon: 'none' })
      return
    }
    this.setData({
      ['pickerItems[' + idx + '].checked']: !items[idx].checked,
      pickerCheckedCount: checkedCount + (items[idx].checked ? -1 : 1)
    })
  },

  /** 弹层点选（团体单选联系人：带出并关闭） */
  onPickerPick(e) {
    if (this.data.pickerMode !== 'single') return
    const id = e.currentTarget.dataset.id
    const item = this.data.pickerItems.find((v) => v.id === id)
    if (!item) return
    this.setData({
      showPicker: false,
      contactName: item.name,
      contactPhone: item.phone,
      contactIdCard: item.idCard
    })
  },

  /** 弹层确定：回填已选参观人 */
  onPickerConfirm() {
    const selected = this.data.pickerItems.filter((v) => v.checked)
    this.setData({ showPicker: false })
    this.syncVisitors(this.data.visitorList, selected)
  },

  closePicker() {
    this.setData({ showPicker: false })
  },

  /** 移除已选参观人（页面 chips） */
  onRemoveSelected(e) {
    const idx = e.currentTarget.dataset.idx
    const selected = this.data.selectedVisitors.filter((_, i) => i !== idx)
    this.syncVisitors(this.data.visitorList, selected)
  },

  /** 弹层内快捷新增预约人 */
  onQuickAdd() {
    this.setData({ showEditor: true })
  },

  /** 新增成功：刷新名单并自动勾选（个人模式） */
  onEditorSaved(e) {
    const visitor = e.detail.visitor
    const reload = visitorApi.getVisitors(this.data.userId).then((list) => {
      const withMask = this.decorateVisitors(list)
      // 个人模式：自动勾选新参观人；团体模式：新预约人带出为联系人
      if (this.data.pickerMode === 'multi') {
        const selectedIds = this.data.pickerItems
          .filter((v) => v.checked).map((v) => v.id)
        selectedIds.push(visitor.id)
        this.setData({
          visitorList: withMask,
          pickerItems: withMask.map((v) => Object.assign({}, v, {
            checked: selectedIds.indexOf(v.id) >= 0
          })),
          pickerCheckedCount: selectedIds.length
        })
      } else {
        this.setData({
          visitorList: withMask,
          contactName: visitor.name,
          contactPhone: visitor.phone,
          contactIdCard: visitor.idCard,
          showPicker: false
        })
      }
    })
    reload.catch(() => { /* 刷新失败不阻断，弹层可重试 */ })
  },

  onEditorClose() {
    this.setData({ showEditor: false })
  },

  /** 弹窗内容区点击占位（阻止冒泡关闭） */
  noop() {},

  /* ---------------- 分步导航 ---------------- */

  /** 底部按钮：Step1 下一步（改期直接提交）/ Step2 提交预约 */
  onBottomTap() {
    if (this.data.submitting) return
    if (this.data.step === 1) {
      if (!this.data.visitDate || !this.data.timeSlot) {
        wx.showToast({ title: '请选择参观日期与场次', icon: 'none' })
        return
      }
      // 改期模式没有第二步，日期时段确认后直接提交
      if (this.data.isReschedule) {
        this.onSubmit()
        return
      }
      this.setData({ step: 2 })
      wx.pageScrollTo({ scrollTop: 0, duration: 200 })
    } else {
      this.onSubmit()
    }
  },

  /** 返回第一步调整日期时段 */
  onPrevStep() {
    this.setData({ step: 1 })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  /* ---------------- 校验与提交 ---------------- */

  validate() {
    const { type, visitorCount, organization, contactName, contactPhone, contactIdCard,
      visitDate, timeSlot, isReschedule, selectedVisitors } = this.data
    if (!visitDate || !timeSlot) return '请选择参观日期与时段'
    if (isReschedule) {
      if (type === '个人' && (visitorCount < 1 || visitorCount > 5)) return '个人预约每单限 1-5 人'
      if (type === '团体' && (visitorCount < 10 || visitorCount > 100)) return '团体预约每单限 10-100 人'
      return ''
    }
    if (type === '个人') {
      if (!selectedVisitors.length) return '请选择参观人（进馆需核验身份证）'
      if (selectedVisitors.length > PERSON_MAX) return '个人预约每单最多 ' + PERSON_MAX + ' 人'
    } else {
      if (visitorCount < 10 || visitorCount > 100) return '团体预约每单限 10-100 人'
      if (!organization.trim()) return '请填写团体名称'
      if (!contactName.trim()) return '请填写联系人姓名'
      if (!/^1\d{10}$/.test(contactPhone.trim())) return '请填写正确的 11 位手机号'
      if (!validateIdCard(contactIdCard)) return '请填写联系人正确的 18 位身份证号'
    }
    return ''
  },

  onSubmit() {
    if (this.data.submitting) return
    const msg = this.validate()
    if (msg) {
      wx.showToast({ title: msg, icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    // 写操作前置：确保有登录身份（未登录会先走一次微信登录，失败则中止提交）
    app
      .ensureLogin()
      .then((user) => this.doSubmit(user))
      .catch((e) => {
        this.setData({ submitting: false })
        wx.showModal({
          title: '需要登录',
          content: (e && e.message) || '登录后才能提交预约',
          showCancel: false
        })
      })
  },

  /** 实际提交（调用前已确保登录态） */
  doSubmit(user) {
    const { visitDate, timeSlot, type, visitorCount, organization, contactName,
      contactPhone, contactIdCard, remark, selectedVisitors, isReschedule } = this.data

    let req
    if (isReschedule) {
      req = reservationApi.rescheduleReservation(this.rescheduleId, { visitDate, timeSlot, visitorCount })
    } else if (type === '个人') {
      // 个人：联系人=第一位参观人，参观人整单实名登记
      const first = selectedVisitors[0]
      req = reservationApi.createReservation({
        userId: user ? user.id : '匿名',
        type,
        visitDate,
        timeSlot,
        visitorCount: selectedVisitors.length,
        organization: '',
        contactName: first.name,
        contactPhone: first.phone,
        contactIdCard: first.idCard,
        visitors: selectedVisitors.map((v) => ({ name: v.name, idCard: v.idCard, phone: v.phone })),
        remark: remark.trim()
      })
    } else {
      // 团体：联系人（带队负责人）实名登记
      req = reservationApi.createReservation({
        userId: user ? user.id : '匿名',
        type,
        visitDate,
        timeSlot,
        visitorCount,
        organization: organization.trim(),
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        contactIdCard: contactIdCard.trim().toUpperCase(),
        visitors: [{ name: contactName.trim(), idCard: contactIdCard.trim().toUpperCase(), phone: contactPhone.trim() }],
        remark: remark.trim()
      })
    }

    return req
      .then((resv) => {
        wx.showToast({ title: isReschedule ? '改期成功' : '预约成功', icon: 'success' })
        // redirectTo：返回键直接回到预约列表（延时等 toast 展示完）
        this._jumpTimer = setTimeout(() => {
          this._jumpTimer = null
          wx.redirectTo({ url: '/pages/reservation-detail/reservation-detail?id=' + resv.id })
        }, 600)
      })
      .catch((e) => {
        this.setData({ submitting: false })
        // 服务层已给出明确 message（名额不足/日期未开放/状态不可变更等）
        wx.showModal({
          title: '提示',
          content: (e && e.message) || '提交失败，请稍后重试',
          showCancel: false
        })
      })
  }
})
