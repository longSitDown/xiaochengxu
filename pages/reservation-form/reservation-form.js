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
const venueApi = require('../../api/venue')
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
    dates: [],         // [{value,label,weekday,dateId,quota,used,remaining,reservable,slots}]
    hasSlots: true,    // 是否有时段维度：真实场馆配置了时段（SessionId）才为 true
    realMode: false,   // true = 日期来自 API-02、提交走 API-05（明道云实时预约）
    dateSource: 'mock',// 'venue' | 'mock'，便于排查与自测
    museumName: '',
    remainText: '',    // 选中日期的余量文案
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
    this.setData({ userId: user ? userApi.getBizId() : '' })
    // 新建预约固定为「个人」，不再接受 ?type=团体 预设（旧链接传入时静默忽略）；
    // 团体类型只在改期历史团体订单时由 loadForReschedule 恢复
    if (options.reschedule) {
      this.rescheduleId = options.reschedule
      this.setData({ isReschedule: true })
      wx.setNavigationBarTitle({ title: '预约改期' })
      this.loadForReschedule()
    } else {
      this.loadVisitors(user)
      this.loadDates()
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
      .getVisitors(userApi.getBizId())
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

  /** 改期模式：拉取原预约与本地名额，回填表单 */
  loadForReschedule() {
    Promise.all([
      reservationApi.getReservationDetail(this.rescheduleId),
      reservationApi.getQuotaDates()
    ])
      .then(([resv, res]) => {
        this.applyDates(res, resv)
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

  /**
   * 加载可预约日期：优先 API-02 的 ReservationDateList（真实放号、按日期不按时段），
   * 场馆接口不可用时自动回退本地名额表（带时段），两种结构在此统一。
   */
  loadDates() {
    return reservationApi
      .getAvailableDates()
      .then((res) => {
        if (res.fallbackReason) {
          console.warn('[预约] 已回退本地名额表：' + res.fallbackReason)
        }
        this.applyDates(res)
        if (!res.dates.length) {
          wx.showToast({ title: '当前暂无可预约日期', icon: 'none' })
        }
      })
      .catch((e) => {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  /**
   * 日期结果 → 页面结构（可选回填原预约）
   * @param {{source:string, dates:Array, museumName?:string}} res
   * @param {Object} [resv] 改期时的原预约
   */
  applyDates(res, resv) {
    const dates = (res.dates || []).slice()
    // 真实场馆只有配置了时段才有场次选择；本地模式仍按时段表展开
    const hasSlots = dates.some((d) => d.slots && d.slots.length)
    const firstOpen = this.findFirstOpen(dates, resv || null)
    const picked = dates.find((d) => d.value === firstOpen.visitDate)
    this.setData({
      dates,
      hasSlots,
      dateSource: res.source || 'mock',
      realMode: res.source === 'venue',
      museumName: res.museumName || '',
      visitDate: firstOpen.visitDate,
      timeSlot: firstOpen.timeSlot,
      // 注意：必须在 dates 落库的同一次 setData 里算好，否则读到的还是旧数组
      remainText: this.remainTextOfDate(picked)
    })
    this.monthOffset = 0 // 日历从可约首日所在月开始
    this.buildCalendar()
  },

  /** 选中日期的余量文案：真实模式「余 980 / 1000」，本地模式取各场次合计 */
  remainTextOf(value) {
    return this.remainTextOfDate(this.data.dates.find((x) => x.value === value))
  },

  remainTextOfDate(d) {
    if (!d) return ''
    if (!d.reservable && d.remaining <= 0) return '已约满'
    return '余 ' + d.remaining + (d.quota ? ' / ' + d.quota : '')
  },

  /**
   * 由 dates 生成月历网格：
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

    // value → 日期项 的索引，便于逐天查状态
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
        // 真实模式没有时段，约满与否直接看 Reservable + 余量
        full: d ? !reservationApi._internal.dateSelectable(d) : false,
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

  /** 优先回填原日期（及时段）；否则取第一个可预约日期 */
  findFirstOpen(dates, resv) {
    const selectable = reservationApi._internal.dateSelectable
    if (resv) {
      const d = dates.find((x) => x.value === resv.visitDate)
      if (d && selectable(d)) {
        const s = (d.slots || []).find((x) => x.timeSlot === resv.timeSlot)
        return { visitDate: d.value, timeSlot: s && !s.disabled ? s.timeSlot : '' }
      }
    }
    for (let i = 0; i < dates.length; i++) {
      if (!selectable(dates[i])) continue
      const s = (dates[i].slots || []).find((x) => !x.disabled)
      return { visitDate: dates[i].value, timeSlot: s ? s.timeSlot : '' }
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

  /** 选中某可约日期：有时段则自动选第一个有余量的场次，无时段（真实场馆）则只记日期 */
  selectDate(value) {
    const date = this.data.dates.find((d) => d.value === value)
    if (!date) return
    const slot = (date.slots || []).find((s) => !s.disabled)
    this.setData({
      visitDate: value,
      timeSlot: slot ? slot.timeSlot : '',
      remainText: this.remainTextOf(value)
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
      const missing = this.dateMissingText()
      if (missing) {
        wx.showToast({ title: missing, icon: 'none' })
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

  /** 日期（及本地模式的场次）是否选全，未选全时返回提示文案 */
  dateMissingText() {
    if (!this.data.visitDate) return '请选择参观日期'
    if (this.data.hasSlots && !this.data.timeSlot) return '请选择参观场次'
    return ''
  },

  /** 返回第一步调整日期时段 */
  onPrevStep() {
    this.setData({ step: 1 })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  /* ---------------- 校验与提交 ---------------- */

  validate() {
    const { type, visitorCount, organization, contactName, contactPhone, contactIdCard,
      visitDate, isReschedule, selectedVisitors, realMode } = this.data
    const missing = this.dateMissingText()
    if (missing) return missing
    if (!visitDate) return '请选择参观日期'
    if (isReschedule) {
      if (type === '个人' && (visitorCount < 1 || visitorCount > 5)) return '个人预约每单限 1-5 人'
      if (type === '团体' && (visitorCount < 10 || visitorCount > 100)) return '团体预约每单限 10-100 人'
      return ''
    }
    if (type === '个人') {
      if (!selectedVisitors.length) return '请选择参观人（进馆需核验身份证）'
      if (selectedVisitors.length > PERSON_MAX) return '个人预约每单最多 ' + PERSON_MAX + ' 人'
      // 真实模式每位入场者的姓名 / 身份证 / 手机号都会逐条上报给场馆，
      // 服务端不做元素级校验（ISS-005），只能前端卡住
      if (realMode) {
        const bad = selectedVisitors.find((v) => !v.name || !validateIdCard(v.idCard) || !/^1\d{10}$/.test(String(v.phone || '').trim()))
        if (bad) return '「' + (bad.name || '未命名') + '」的身份证或手机号不完整，请先在预约人中补全'
      }
    } else {
      if (visitorCount < 10 || visitorCount > 100) return '团体预约每单限 10-100 人'
      if (!organization.trim()) return '请填写团体名称'
      if (!contactName.trim()) return '请填写联系人姓名'
      if (!/^1\d{10}$/.test(contactPhone.trim())) return '请填写正确的 11 位手机号'
      if (!validateIdCard(contactIdCard)) return '请填写联系人正确的 18 位身份证号'
    }
    return ''
  },

  /**
   * 真实模式下本次提交对应的预约日历记录 ID（ReservateDateId）。
   * 一个日期配置了多个时段时，取当前选中时段那条记录的 ID；否则用全天记录的 ID。
   */
  selectedDateId() {
    const { dates, visitDate, timeSlot } = this.data
    const date = dates.find((d) => d.value === visitDate)
    if (!date) return ''
    const slot = (date.slots || []).find((s) => s.timeSlot === timeSlot)
    return (slot && slot.dateId) || date.dateId || ''
  },

  onSubmit() {
    if (this.data.submitting) return
    // 真实场馆的预约记录写在明道云「用户预约记录」表，改期需「先取消再重约」：
    // API-05 只能新建；虽然 API-09 自 v1.9.8 已修复为「已就绪」，
    // 但「取消 + 重新提交」跨两个异步写操作、失败难回滚，前端暂不开放改期入口
    if (this.data.realMode && this.data.isReschedule) {
      wx.showModal({
        title: '暂不支持在线改期',
        content: '该场馆的预约由场馆系统管理，需要变更日期时请先取消原预约后重新预约。',
        showCancel: false
      })
      return
    }
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
    // 真实场馆：走 API-05（Visitors 数组），与本地 HAP 工作表是两条独立链路
    if (this.data.realMode) return this.doSubmitVenue(user)
    const { visitDate, timeSlot, type, visitorCount, organization, contactName,
      contactPhone, contactIdCard, remark, selectedVisitors, isReschedule } = this.data

    let req
    if (isReschedule) {
      req = reservationApi.rescheduleReservation(this.rescheduleId, { visitDate, timeSlot, visitorCount })
    } else if (type === '个人') {
      // 个人：联系人=第一位参观人，参观人整单实名登记
      const first = selectedVisitors[0]
      req = reservationApi.createReservation({
        userId: user ? userApi.getBizId() : '匿名',
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
        userId: user ? userApi.getBizId() : '匿名',
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
  },

  /**
   * 真实场馆提交（API-05 v1.9.14 契约）
   *
   * 入参只有 Code / Token / UserId / ReservateDateId / Visitors 五项，
   * 没有团体名称、备注、人数；到场人数由 Visitors 长度决定。
   * Visitors 元素证件号对外键名为 **IdNumber**（v1.9.8 破坏性更名），
   * 页面内部沿用 idCard，由 api/venue.js 的 createReservation 统一映射。
   * 提交成功后记录落在明道云「用户预约记录」表，本地的「我的预约」列表读的是
   * 自有工作表，暂时看不到这条记录（API-07 已于 v1.9.8 废弃、API-11 列表不含日期），
   * 因此这里只回显预约编号。
   */
  doSubmitVenue(user) {
    const { selectedVisitors, isReschedule } = this.data
    if (isReschedule) {
      this.setData({ submitting: false })
      return
    }
    const userId = userApi.getUserId() || (user && user.userId) || ''
    if (!userId) {
      this.setData({ submitting: false })
      wx.showModal({
        title: '需要重新登录',
        content: '登录态缺少游客档案 ID，请退出后重新登录再预约。',
        showCancel: false
      })
      return
    }
    const reservateDateId = this.selectedDateId()
    if (!reservateDateId) {
      this.setData({ submitting: false })
      wx.showToast({ title: '该日期暂不可预约，请重新选择', icon: 'none' })
      return
    }
    const visitors = selectedVisitors.map((v) => ({
      name: String(v.name || '').trim(),
      idCard: String(v.idCard || '').trim().toUpperCase(),
      mobile: String(v.phone || '').trim(),
      type: '成人'
    }))

    return venueApi
      .createReservation({ userId, reservateDateId, visitors })
      .then((res) => {
        this.setData({ submitting: false })
        const codeText = res.reservationCode ? '预约编号：' + res.reservationCode + '\n' : ''
        wx.showModal({
          title: '预约成功',
          content: codeText + '请按预约日期携本人证件到馆核验。',
          showCancel: false,
          success: () => {
            // 我的预约列表当前读自有工作表，看不到场馆系统的记录，故回首页而非列表
            wx.redirectTo({ url: '/pages/index/index' })
          }
        })
      })
      .catch((e) => {
        this.setData({ submitting: false })
        wx.showModal({
          title: '预约失败',
          content: (e && e.message) || '提交失败，请稍后重试',
          showCancel: false
        })
      })
  }
})
