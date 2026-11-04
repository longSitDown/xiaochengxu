/**
 * 全局环境配置 —— mock / 明道云直连 / 自有后端代理 三种模式的总开关
 *
 * 三种用法：
 *   1) 本地演示         USE_MOCK: true
 *   2) 联调（无后端）    USE_MOCK: false, USE_PROXY: false
 *                       ⚠️ 直连需要把 AppKey/Sign 填进 MINGDAO，仅限本机调试，切勿提交
 *   3) 生产              USE_MOCK: false, USE_PROXY: true, API_BASE: 自有后端地址
 *                       密钥只在服务端，小程序只持 token
 *
 * 切换数据源时页面与服务层代码无需任何修改。
 *
 * 联调期可在真机上临时切换数据源（无需重新编译）：
 *   wx.setStorageSync('rh_forceMock', true)   // 强制 mock
 *   wx.setStorageSync('rh_forceMock', false)  // 强制真实接口
 *   清除该 Key 则回到本文件的 USE_MOCK 取值。
 */
const tables = require('./tables')
const optionKeys = require('./option-keys')

/** 是否走自有后端代理（生产模式，密钥不下发前端） */
const USE_PROXY = false

/** 自有后端地址（不含 /api/hap），仅在 USE_PROXY 时有意义 */
const API_BASE = 'https://api.example.com'

/** 明道云直连地址，仅非代理模式使用 */
const DIRECT_BASE = 'https://api.mingdao.com'

module.exports = {
  /** 是否使用本地 mock 数据（可被 storage 运行时覆盖，见上方说明） */
  USE_MOCK: true,

  /** 运行时覆盖 USE_MOCK 的 storage Key（不含 rh_ 前缀） */
  FORCE_MOCK_KEY: 'forceMock',

  /** 是否经自有后端代理转发（生产建议 true） */
  USE_PROXY,

  /** 后端业务接口基地址：登录 / 资料 / 上传都走这里 */
  API_BASE,

  /** 数据请求基地址：代理模式下指向后端的 /api/hap 透传入口 */
  BASE_URL: USE_PROXY ? API_BASE + '/api/hap' : DIRECT_BASE,

  /** 请求超时（ms） */
  TIMEOUT: 10000,

  /**
   * 明道云鉴权（AppKey + Sign）
   * ⚠️ 代表应用管理员权限，仅限本机直连调试时临时填写。
   *    生产必须用 USE_PROXY 模式，密钥只存在于后端 server/.env。
   */
  MINGDAO: {
    appKey: '',
    sign: ''
  },

  /**
   * 首页宫格隐藏名单：命中的入口不渲染（数据仍保留在 pages/index/index.js）
   * 恢复某个入口时，从该数组删掉对应名称即可，无需改页面代码。
   */
  HIDDEN_ENTRIES: ['VR展览', '展厅导览', 'AI讲解', '文物赏析', '祭扫烈士', '红色地图'],

  /**
   * 区块显示开关：false 时对应区块不渲染。
   * 数据、样式与业务逻辑全部保留，改回 true 即可恢复。
   */
  BLOCKS: {
    /** 首页「荣誉资质」横滑徽章 */
    honors: false,
    /**
     * 预约页「团体预约」入口卡片（当前已下线）。
     * 表单页不再提供类型切换，仅保留团体字段供历史团体订单改期使用。
     */
    groupReservation: false
  },

  /** 登录态在本地存储中的 Key（不含 rh_ 前缀） */
  TOKEN_KEY: 'authToken',

  /** 工作表别名 → 真实 worksheetId 映射表（转发给 request 层使用） */
  TABLES: tables,

  /** 选项 key 映射表 */
  OPTION_KEYS: optionKeys,

  /** 限流错误码（mingdao-api.md 4.6：通用表与 FAQ 存在 51/90000/90001 不一致，全部捕获） */
  RATE_LIMIT_CODES: [51, 90000, 90001],

  /**
   * 重试策略：指数退避；max=最大重试次数，baseDelay=初始等待基数(ms)，逐次翻倍(如 300/600)
   *
   * retryOnWrite 默认 false：POST /rows（新建）与 PATCH（更新）属非幂等写操作，
   * 请求超时后重试会造成重复预约、重复答题记录。只有查询类请求
   * （GET、POST .../rows/list、.../rows/pivot）才重试。
   */
  RETRY: { max: 2, baseDelay: 300, retryOnWrite: false },

  /** mock 延迟区间（ms），随机取值模拟真实网络波动 */
  MOCK_DELAY: [120, 320]
}
