/**
 * 预约人管理：常用实名参观人（身份证）的增删改
 * 支持两种入口：
 *   - profile 菜单（完整管理）
 *   - 预约表单选择弹层「去管理」（便于预约前维护名单）
 */
const visitorApi = require('../../api/visitor')
const userApi = require('../../api/user')
const { maskIdCard } = require('../../utils/format')

Page({
  data: {
    list: [],        // [{id, name, idCardMask, phone, isDefault}]
    editing: null,   // visitor-editor 弹层的编辑对象（null = 新增）
    showEditor: false,
    loading: true,
    hasUser: false,
    userId: ''
  },

  onShow() {
    const user = userApi.getUser()
    this.setData({ hasUser: !!user, userId: user ? userApi.getBizId() : '' })
    if (user) {
      this.fetchList()
    } else {
      this.setData({ list: [], loading: false })
    }
  },

  fetchList() {
    visitorApi
      .getVisitors(this.data.userId)
      .then((list) => {
        this.setData({
          list: list.map((v) => Object.assign({}, v, { idCardMask: maskIdCard(v.idCard) })),
          loading: false
        })
      })
      .catch((e) => {
        this.setData({ loading: false })
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      })
  },

  /** 打开新增弹层 */
  onAdd() {
    if (!this.checkUser()) return
    this.setData({ editing: null, showEditor: true })
  },

  /** 打开编辑弹层 */
  onEdit(e) {
    if (!this.checkUser()) return
    const id = e.currentTarget.dataset.id
    const visitor = this.data.list.find((v) => v.id === id)
    this.setData({ editing: visitor, showEditor: true })
  },

  /** 删除预约人（二次确认） */
  onRemove(e) {
    const id = e.currentTarget.dataset.id
    const visitor = this.data.list.find((v) => v.id === id)
    wx.showModal({
      title: '删除预约人',
      content: '确定删除「' + visitor.name + '」吗？删除后预约时不可再选取。',
      confirmColor: '#C8102E',
      success: (res) => {
        if (!res.confirm) return
        visitorApi
          .removeVisitor(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            this.fetchList()
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      }
    })
  },

  /** 弹层保存成功后刷新列表 */
  onEditorSaved() {
    this.fetchList()
  },

  onEditorClose() {
    this.setData({ showEditor: false })
  },

  /** 未登录统一提示（预约人需归属登录用户） */
  checkUser() {
    if (this.data.hasUser) return true
    wx.showToast({ title: '请先在「我的」页面登录', icon: 'none' })
    return false
  }
})
