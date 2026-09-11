/**
 * 全局环境配置 —— mock 与真实接口的总开关
 *
 * 切换到明道云真实接口时：
 *   1. 将 USE_MOCK 置为 false；
 *   2. BASE_URL 填明道云地址（SaaS：https://api.mingdao.com；私有部署：https://<host>/api），
 *      或填自有后端代理地址（推荐，密钥必须保留在服务端，见 mingdao-api.md 2.2 安全约束）；
 *   3. 页面与服务层代码无需任何修改。
 */
module.exports = {
  /** 是否使用本地 mock 数据 */
  USE_MOCK: true,

  /** 明道云环境地址（或后端代理地址） */
  BASE_URL: 'https://api.mingdao.com',

  /** 请求超时（ms） */
  TIMEOUT: 10000,

  /**
   * 明道云鉴权（AppKey + Sign）
   * ⚠️ 纯前端小程序无法安全保存密钥，生产环境必须经自有后端代理签名转发，
   *    此处仅做联调占位。
   */
  MINGDAO: {
    appKey: '',
    sign: ''
  },

  /** 限流错误码（mingdao-api.md 4.6：通用表与 FAQ 存在 51/90000/90001 不一致，全部捕获） */
  RATE_LIMIT_CODES: [51, 90000, 90001],

  /** 限流重试策略：指数退避；max=最大重试次数，baseDelay=初始等待基数(ms)，逐次翻倍(如 300/600) */
  RETRY: { max: 2, baseDelay: 300 },

  /** mock 延迟区间（ms），随机取值模拟真实网络波动 */
  MOCK_DELAY: [120, 320]
}
