/**
 * 全局环境配置 —— 业务数据源 + 登录方式
 *
 * 当前组合（2026-11-10 起）：
 *   USE_MOCK = true        → 业务数据仍走本地 mock
 *   LOGIN_MODE = 'webhook' → 登录直接调明道云 API-06，不需要启动 server/
 *   VENUE 通道             → 场馆/展区/展品直连真实 Webhook
 * 即：完全不依赖自有后端，`http://localhost:3000` 不会被请求。
 *
 * 登录三态（LOGIN_MODE）：
 *   'webhook' → wx.login 得 code → POST API-06 → 拿 OpenId 存本地（推荐，无 server）
 *   'proxy'   → wx.login 得 code → POST {API_BASE}/api/auth/login → 后端签 token（需启动 server）
 *   'mock'    → 纯本地演示用户，不联网、不调用任何登录接口
 *
 * 业务数据源三态（USE_MOCK / USE_PROXY）：
 *   1) 本地演示         USE_MOCK: true
 *   2) 联调（无后端）    USE_MOCK: false, USE_PROXY: false（直连需填 AppKey/Sign，仅本机调试）
 *   3) 生产              USE_MOCK: false, USE_PROXY: true, API_BASE: 自有后端地址
 * ⚠️ 只有在 LOGIN_MODE='proxy' 或 USE_MOCK=false 且 USE_PROXY=true 时才需要 server/。
 *
 * 联调期可在真机上临时切换数据源（无需重新编译）：
 *   wx.setStorageSync('rh_forceMock', true)   // 强制 mock
 *   wx.setStorageSync('rh_forceMock', false)  // 强制真实接口
 *   清除该 Key 则回到本文件的 USE_MOCK 取值。
 */
const tables = require('./tables')
const optionKeys = require('./option-keys')
const venue = require('./venue')

/** 是否经自有后端代理转发（仅 USE_MOCK=false 时生效；webhook 登录不依赖它） */
const USE_PROXY = true

/** 自有后端地址（不含 /api/hap），仅 LOGIN_MODE='proxy' 或代理数据通道时使用 */
const API_BASE = 'http://localhost:3000'

/**
 * 登录方式总开关（与业务数据源解耦）
 *   'webhook' → 明道云 API-06（默认，AppSecret 只在明道云侧，无自有后端）
 *   'proxy'   → 自有后端 /api/auth/login（需启动 node server/index.js）
 *   'mock'    → 本地演示用户
 * 切换后页面代码零修改；测试脚本可运行时赋值覆盖。
 */
const LOGIN_MODE = 'webhook'

/**
 * 手机号授权登录开关（getPhoneNumber + API-06 形式一）
 *
 * 为什么单独立一个开关而不是看接口就绪与否：
 *   「手机号快速验证」要求小程序为**非个人主体且已完成微信认证**。
 *   开发版目前未认证，调用只会返回 fail，此时按钮应显性说明「待认证」，
 *   而不是让用户点了没反应或看到一串微信原始报错。
 *
 * 认证通过后只需把这里改成 true（或运行时 wx.setStorageSync('rh_phoneLogin','1')
 * 免重编译验证），登录页的手机号按钮即刻可用；授权失败时会自动回退
 * API-06 形式二（js_code）静默登录。
 */
const PHONE_LOGIN_ENABLED = false

/** 运行时覆盖手机号登录开关的 storage Key（不含 rh_ 前缀） */
const PHONE_LOGIN_KEY = 'phoneLogin'

/**
 * 兼容旧开关：USE_REAL_LOGIN=true 曾用于强制走后端登录。
 * 现在由 LOGIN_MODE 接管，仅当未显式指定 LOGIN_MODE 时作为回退依据。
 */
const USE_REAL_LOGIN = false

/** 明道云直连地址，仅非代理模式使用 */
const DIRECT_BASE = 'https://api.mingdao.com'

module.exports = {
  /** 是否使用本地 mock 数据（可被 storage 运行时覆盖，见上方说明） */
  USE_MOCK: true,

  /** 运行时覆盖 USE_MOCK 的 storage Key（不含 rh_ 前缀） */
  FORCE_MOCK_KEY: 'forceMock',

  /** 登录方式：'webhook' | 'proxy' | 'mock'（详见文件头） */
  LOGIN_MODE: LOGIN_MODE,

  /** 手机号快捷登录（getPhoneNumber）是否开放：需非个人主体 + 已微信认证 */
  PHONE_LOGIN_ENABLED: PHONE_LOGIN_ENABLED,

  /** 运行时覆盖 PHONE_LOGIN_ENABLED 的 storage Key（不含 rh_ 前缀） */
  PHONE_LOGIN_KEY: PHONE_LOGIN_KEY,

  /** 是否经自有后端代理转发（webhook 登录 + mock 数据组合下不会用到） */
  USE_PROXY,

  /** 兼容旧开关，已由 LOGIN_MODE 接管 */
  USE_REAL_LOGIN,

  /** 后端业务接口基地址：仅 proxy 登录 / 代理数据通道时才会请求 */
  API_BASE,

  /** 数据请求基地址：代理模式下指向后端的 /api/hap 透传入口 */
  BASE_URL: USE_PROXY ? API_BASE + '/api/hap' : DIRECT_BASE,

  /** 请求超时（ms） */
  TIMEOUT: 10000,

  /**
   * 明道云鉴权（AppKey + Sign）
   * ⚠️ 代表应用管理员权限，仅限本机直连调试时临时填写。
   *    webhook 通道不使用这两个密钥，密钥只存明道云工作流侧。
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

  /** 登录态在本地存储中的 Key（不含 rh_ 前缀）；webhook 模式不写此 Key */
  TOKEN_KEY: 'authToken',

  /** 工作表别名 → 真实 worksheetId 映射表（转发给 request 层使用） */
  TABLES: tables,

  /** 场馆 / 业务接口配置（API-01~04 / 06 Webhook，独立于 HAP V3 通道，详见 config/venue.js） */
  VENUE: venue,

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
