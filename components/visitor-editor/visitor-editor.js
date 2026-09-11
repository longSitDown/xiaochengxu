/**
 * 预约人编辑弹层：新增 / 编辑常用参观人（姓名 + 身份证 + 手机号 + 默认开关）
 *
 * properties:
 *   show    Boolean  是否显示
 *   editing Object   编辑对象（null 或空为新增）
 *   userId  String   所属用户 id（保存时归属）
 * events:
 *   saved   {visitor, isEdit}  保存成功
 *   close   {}                 关闭弹层
 */
const visitorApi = require('../../api/visitor')

Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    show: { type: Boolean, value: false },
    editing: { type: Object, value: null },
    userId: { type: String, value: '' }
  },

  data: {
    name: '',
    idCard: '',
    phone: '',
    isDefault: false,
    saving: false
  },

  observers: {
    // 弹层每次打开时回填表单（编辑回显 / 新增清空）
    show(v) {
      if (!v) return
      const e = this.data.editing
      this.setData({
        name: e ? e.name : '',
        idCard: e ? e.idCard : '',
        phone: e ? e.phone : '',
        isDefault: e ? e.isDefault === '1' : false,
        saving: false
      })
    }
  },

  methods: {
    onNameInput(e) {
      this.setData({ name: e.detail.value })
    },
    onIdCardInput(e) {
      this.setData({ idCard: e.detail.value })
    },
    onPhoneInput(e) {
      this.setData({ phone: e.detail.value })
    },
    onDefaultTap() {
      this.setData({ isDefault: !this.data.isDefault })
    },

    /** 保存：本地校验 → 服务层校验（身份证格式/去重） */
    onSave() {
      if (this.data.saving) return
      const { name, idCard, phone, isDefault } = this.data
      if (!name.trim()) {
        wx.showToast({ title: '请填写姓名', icon: 'none' })
        return
      }
      if (!/^1\d{10}$/.test(phone.trim())) {
        wx.showToast({ title: '请填写正确的 11 位手机号', icon: 'none' })
        return
      }
      this.setData({ saving: true })
      const editing = this.data.editing
      visitorApi
        .saveVisitor({
          id: editing ? editing.id : '',
          userId: this.data.userId,
          name,
          idCard,
          phone,
          isDefault: isDefault ? '1' : '0'
        })
        .then((visitor) => {
          this.setData({ saving: false })
          this.triggerEvent('saved', { visitor, isEdit: !!editing })
          this.triggerEvent('close')
        })
        .catch((e) => {
          this.setData({ saving: false })
          wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
        })
    },

    onClose() {
      this.triggerEvent('close')
    },

    /** 弹窗内容区点击占位（阻止冒泡关闭） */
    noop() {}
  }
})
