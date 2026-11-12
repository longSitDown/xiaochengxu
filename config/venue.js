/**
 * 场馆 / 业务接口配置
 *
 * 契约 SSOT：`md/博物馆预约管理系统-数据接口文档 (1).md` **v1.9.14**（2026-11-12 收到）
 * ⚠️ 目录里不带 (1) 的同名文档停在 v1.9.6，云端资料库同名文档仍停在 1.6.0，
 *    均为历史快照；本文件与 api/venue.js 一律以 v1.9.14 为准。
 *
 * v1.9.6 → v1.9.14 关键变化（2026-11-12 已用 tools/verify-contract-v1914.js 在线核验）：
 *   1. **API-05 `Visitors[].IdCard` → `IdNumber`**（v1.9.8 破坏性更名）；响应仍为
 *      `data{reservationId,reservationCode}`。空 Visitors 返 `90022`、日期未开放返 `90017`。
 *   2. **API-08 提交反馈已发布**：`hooks2/NmFmNDU3ODk5NGIxODBlMjcyZjUyOWNl`，
 *      入参 `Code/Token/UserId/Title/Description`（5 项全必填，撤 Content/Contact），
 *      响应仅顶层 `code/msg`、成功 msg=「更新成功」，**无 data**。
 *   3. **API-09 取消预约**：协议明确为 **GET + query**（旧实现写成了 POST）；
 *      v1.9.8 起状态「已就绪」（ISS-006 已修复），仅「待核销 / 已完成」可取消。
 *      线上实测 GET 与 POST 均可达，按文档统一 GET。
 *   4. **API-07 已废弃**（v1.9.8）：列表能力并入 API-11，详情/凭证分支亦于 v1.9.9 撤销；
 *      本配置移除 `myReservation` 占位。「我的预约」列表暂仍读自有工作表。
 *   5. **API-11 `ReservationList[].ReservationStatus` 由数字编码改为中文文本**
 *      （v1.9.14 / CHG-024：待核销 / 已完成 / 已取消），`Total` 为整数。
 *   6. **API-02 去时段**（v1.9.13）：`ReservationDateList` 不再返回 `SessionId/SessionName`，
 *      按日期每天一条。2026-11-12 线上实测 7 条，字段仅
 *      `ID/Date/DailyQuota/DailyUsed/CanReserve`，与文档一致；前端保留聚合兼容层以防回滚。
 *   7. 附录 C 新增 `90017` 未开放预约 / `90022` 无预约人员 / `90029` 预约记录已经核销；
 *      撤下 `999` / `999999` 兜底码（前端保留 legacy 文案兼容旧返回）。
 *   8. 新增 **API-12 核销预约**（核销端 / 闸机专用，游客小程序不调用），仅登记地址与 `90029`。
 *   9. `MuseumInfo.NeedVerify` 线上仍未返回（文档标「待上线后返回」），前端缺省 false。
 *
 * 其它沿用口径：
 *   - 平台层必填校验返回 `{"status":2,"msg":"[字段] 参数缺少必填项"}`，无业务 code，须先判 status；
 *   - **API-05 缺 Visitors 返回 HTTP 200 纯文本「流程已终止」**（2026-11-12 实测复现），
 *     非 JSON 响应必须显式识别，否则会被 `isOk(undefined)` 误判为「预约成功」；
 *   - 微信原生 errcode 禁止透传，文档要求统一映射 `90006`（线上仍透传 `40029`，前端兜底）。
 *
 * 与 config/index.js 的 HAP API V3 通道相互独立：
 *   - 协议：HTTPS GET + query（API-05/06/08/10/11 为 POST + JSON body，API-09 为 GET）
 *   - 鉴权：API-01 签发的短期 token，密钥只在明道云工作流侧，前端零高权限密钥
 *   - 响应：{ code, msg, data }，没有 success / error_code 包装
 *
 * 运行环境要求（以微信官方最新规则为准）：
 *   1. 小程序后台「开发管理 → 服务器域名」把 api.mingdao.com 加入 request 合法域名；
 *   2. 场馆照片域名 p1.mingdaoyun.cn 需加入 downloadFile 合法域名（以官方文档核实）；
 *   3. 开发者工具可临时勾选「不校验合法域名」联调。
 */
module.exports = {
  /** API-01 签发前端访问令牌（开发环境 Webhook） */
  HOOK_TOKEN: 'https://api.mingdao.com/workflow/hooks2/NmFlZDc2NGNlOTVhYTgwMjYzNzE3ZGMz',

  /** API-02 按场馆编号查询场馆主页信息（开发环境 Webhook） */
  HOOK_VENUE: 'https://api.mingdao.com/workflow/hooks2/NmFlYzhlNGJjNjdlZGFjNTg2ZTE3NWNh',

  /** 正式环境地址：文档标注「待完善」，发布工作流后填入；为空时自动回退开发地址 */
  PROD_HOOK_TOKEN: '',
  PROD_HOOK_VENUE: '',
  USE_PROD: false,

  /** 默认场馆编号（联调馆 220261105083，扫码带入 Code 时会被覆盖） */
  DEFAULT_CODE: '220261105083',

  /**
   * 场馆接口是否走内置演示数据。
   * 与全局 config.USE_MOCK 解耦：默认 false = 直接打真实 Webhook，
   * 其它业务页面仍可继续用 mock，互不干扰。
   * 运行时可覆盖：wx.setStorageSync('rh_forceVenueMock', true/false)
   */
  USE_MOCK: false,
  FORCE_MOCK_KEY: 'forceVenueMock',

  /**
   * 联调日志：在控制台打印 API-01 是「签发」还是「命中缓存跳过」，以及各接口调用，
   * 避免把缓存命中误判成接口没调用。不打印 token 明文与完整 URL。
   * 上线前改为 false；运行时可用 wx.setStorageSync('rh_venueDebug', true/false) 覆盖。
   */
  DEBUG: true,
  DEBUG_KEY: 'venueDebug',

  /** 请求超时（ms）：真机移动网络含 DNS/TLS 握手，留足余量（实测接口约 1.2s） */
  TIMEOUT: 15000,

  /** 令牌提前过期秒数：避免临界点发出请求后被判 20004 */
  EXPIRE_SKEW: 60,

  /** storage Key（不含 rh_ 前缀，由 utils/storage 统一补） */
  TOKEN_KEY: 'venueToken',
  CODE_KEY: 'venueCode',

  /** 成功判据：code 为空 / 0 / 1（API-01 失败时为数值 90001.0，不在表内） */
  OK_CODES: ['', '0', '1', 0, 1],

  /** 令牌类错误：命中后清缓存、重签一次再重放查询 */
  AUTH_CODES: ['20001', '20002', '20003', '20004'],

  /**
   * 业务错误码 → 前端提示（v1.9.14 附录 C 全量）
   * 40029 是微信原生码：通则 §2 要求 API-06 映射为 90006，但线上实测仍透传 40029，
   * 这里做前端兜底映射，不要把原生码直接展示给游客（另见 WX_NATIVE_FALLBACK）。
   * 90012 定义为「同一证件已预约该日期」，但实测 UserId 不存在时工作流也返回 90012
   * （应为 90020），故文案保留「证件」口径，由写操作前的前置校验兜住游客档案缺失。
   *
   * ⚠️ 文档自相矛盾处：附录 C 的 90014 写「API-05 入参 AgreedPolicy 非 Y」，
   *    但 API-05 参数表（v1.9.14）并无 AgreedPolicy 字段，前端不传该键。
   */
  ERROR_MSG: {
    '90001': '场馆编号不存在，请确认扫码来源',
    '90002': '当前场馆已关闭',
    '90003': '展区不存在，请返回重试',
    '90004': '展品不存在，请返回重试',
    // 90005 / 90008 / 90009 / 90013 在 v1.9.14 附录 C 标「废止」或「暂停用」，保留兜底文案防旧线上返回
    '90005': '该日期不可预约，请重新选择',
    '90006': '微信登录失败，请重试',
    '90007': '反馈提交失败，请重试',
    '90008': '预约记录不存在',
    '90009': '该预约当前状态不可操作',
    '90010': '当日预约名额已满',
    '90011': '今日预约已达上限',
    '90012': '该证件已预约该日期',
    '90013': '改签时段不可用（该错误码已废止）',
    '90014': '请先阅读并同意隐私政策与实名须知',
    '90015': '预约提醒订阅失败，请重试',
    '90016': '当前无法预约，如有疑问请联系场馆',
    '90017': '当前日期未开放预约，请重新选择',
    '90020': '游客档案不存在，请重新登录后再试',
    '90021': '预约日期错误，请重新选择日期',
    '90022': '请添加预约人员后再提交',
    '90025': '预约记录不存在或已取消',
    '90029': '该预约记录不可核销',
    '20001': '访问凭证格式错误，正在重新获取',
    '20002': '访问凭证校验失败，正在重新获取',
    '20003': '访问凭证解析失败，正在重新获取',
    '20004': '访问凭证已过期，正在重新获取',
    '40029': '微信登录凭证已失效，请重新登录',
    // v1.9.10 已撤下 999 / 999999 兜底码，保留一条 legacy 文案兼容旧版工作流
    '999': '系统繁忙，请稍后重试',
    '999999': '系统繁忙，请稍后重试',
    NETWORK: '网络异常，请稍后重试',
    PARAM: '接口参数不完整',
    NOT_READY: '接口尚未发布',
    NO_USER: '登录态缺少游客档案 ID，请重新登录',
    /** 非 JSON / 空响应（线上「流程已终止」、HAP 引擎空 body）不得当成成功 */
    BAD_RESPONSE: '场馆系统暂时无法处理该请求，请稍后重试'
  },

  /** 微信原生 errcode 统一兜底：通则 §2 要求映射 90006，线上尚未修复 */
  WX_NATIVE_FALLBACK: '微信登录失败，请重试',

  /**
   * API-03~11 端点（v1.9.14 附录 A；2026-11-12 已逐端点在线核验必填键名）
   * url / prodUrl 留空 = 未就绪，callApi 会直接拒绝而不发请求。
   * v1.9.8 起 API-07 废弃、API-08 发布，本表由 9 项收敛为 **8 项且全部已发布**。
   *
   * auth:false   → 该接口不带 Token（API-06 微信登录先于预约发生）
   * params       → 契约留档，callApi 不校验必填，由调用方按文档传参
   * queryKeys    → 该接口要求的「query 传参」键名（未声明的走 JSON body）；
   *                 API-10 是唯一混合传参形态：query 鉴权 + body 业务字段
   * topLevel     → 响应无 data 包装，callApi 直接把整个 body 当结果返回
   *                 （API-08 / 09 / 10；API-05、06 自 v1.9.x 起已改为 data 包裹）
   * requireData  → 契约要求成功态必须带非空 data；空 body / HAP 引擎错误时
   *                 不得按「成功但数据为空」静默返回（防误判预约成功）
   *
   * 附：API-12 核销预约（核销端专用，游客小程序不调用，故不入表）
   *     hooks2/NmFmNDRiZjhmMmU2M2RlM2ZiMDA2ZmRm，入参 Code/Token/UserId/ReservationId，
   *     成功 msg=「核销成功」，不可核销返 90029。
   */
  ENDPOINTS: {
    areaDetail: {
      id: 'API-03', name: '按展区 ID 查展区详情与展品列表', method: 'GET',
      // 入参键 ExhbitAreaId 为线上流程实际拼写（少一个 i），传 AreaId 会报必填校验
      url: 'https://api.mingdao.com/workflow/hooks2/NmFmMTY2ODJhNWVhODMyNGI2MDE2MGNk', prodUrl: '',
      params: ['Code', 'Token', 'ExhbitAreaId']
    },
    exhibitDetail: {
      id: 'API-04', name: '按展品 ID 查展品详情', method: 'GET',
      url: 'https://api.mingdao.com/workflow/hooks2/NmFmMTVmZWU2ZDQ3YWI4MzE3NDcwZWJh', prodUrl: '',
      params: ['Code', 'Token', 'ExhibitId']
    },
    reservation: {
      id: 'API-05', name: '场馆预约提交', method: 'POST',
      // v1.9.8：Visitors 元素证件号键为 IdNumber（不是 IdCard）；响应 data{reservationId,reservationCode}
      url: 'https://api.mingdao.com/workflow/hooks2/NmFmMzBhOWRmMmU2M2RlM2ZiYTE1N2I4', prodUrl: '',
      params: ['Code', 'Token', 'UserId', 'ReservateDateId', 'Visitors'],
      requireData: true
    },
    wxLogin: {
      id: 'API-06', name: '微信登录（手机号授权 / js_code 两种形式）', method: 'POST',
      // v1.9.3 起换新工作流；地址在 hooks2/ 下，响应 data 包裹（不再是顶层平铺）
      url: 'https://api.mingdao.com/workflow/hooks2/NmFmM2ZkZDg4MmU2M2U2MDdiNDM1NzM3', prodUrl: '', auth: false,
      params: ['Code', 'JsCode', 'IsPhone']
    },
    // API-07「我的预约」已于 v1.9.8 废弃（列表并入 API-11、详情/凭证分支于 v1.9.9 撤销），
    // 原 myReservation 占位一并移除；「我的预约」页暂仍读自有工作表。
    feedback: {
      id: 'API-08', name: '提交反馈', method: 'POST',
      // v1.9.11/1.9.12 已发布；5 项全必填，响应仅顶层 code/msg（成功 msg=「更新成功」）
      // 2026-11-12 在线核验必填键：[Title, Description, UserId, Token] + Code，与文档一致
      url: 'https://api.mingdao.com/workflow/hooks2/NmFmNDU3ODk5NGIxODBlMjcyZjUyOWNl', prodUrl: '',
      params: ['Code', 'Token', 'UserId', 'Title', 'Description'],
      topLevel: true
    },
    cancelReservation: {
      id: 'API-09', name: '取消预约', method: 'GET',
      // v1.9.8 起状态「已就绪」（ISS-006 已修复）；v1.9.14 明确为 GET + query（旧实现误写 POST）。
      // 2026-11-12 实测 GET / POST 均可达且返回一致，按文档统一 GET。
      url: 'https://api.mingdao.com/workflow/hooks2/NmFmMzE0YzJmMmU2M2RlM2ZiYTQwNmY4', prodUrl: '',
      params: ['Code', 'Token', 'UserId', 'ReservationId'],
      topLevel: true
    },
    updateUser: {
      id: 'API-10', name: '更新用户信息', method: 'POST',
      // 混合传参：Code / Token / UserId 走 query，NickName / Avatar 走 body
      url: 'https://api.mingdao.com/workflow/hooks/NmFmMmFjNWY5NGIxODBlMjcyNTg4YzNm', prodUrl: '',
      params: ['Code', 'Token', 'UserId', 'NickName', 'Avatar'],
      queryKeys: ['Code', 'Token', 'UserId'],
      topLevel: true
    },
    profileReservations: {
      id: 'API-11', name: '获取个人信息与预约记录列表', method: 'POST',
      /**
       * v1.9.14：个人中心 / 我的预约的数据入口，按 UserId 一次返回
       * `data{ UserId, NickName, ReservationList[{ ID, ReservationCode, Total, ReservationStatus }] }`。
       *
       * **CHG-024（v1.9.14）破坏性变更**：`ReservationStatus` 由数字编码改为**中文文本**
       * 待核销 / 已完成 / 已取消，`Total` 为整数；旧实现用 Number() 会全部变成 0。
       *
       * 已知线上缺口（2026-11-12 实测）：
       *   - ReservationList 不含预约日期与场馆，列表页仍无法只靠本接口渲染；
       *   - 错误分支（Token 非法 / UserId 不存在）返回 **HTTP 200 空 body**，
       *     必须靠 requireData 拦住，不能当「成功但无预约」；
       *   - 文档 v1.9.6 曾列 Mobile / Avatar(base64)，v1.9.14 响应示例已不含，
       *     且线上实测缺失（工作流读 `AvataBase64` typo），前端按可选字段处理。
       */
      url: 'https://api.mingdao.com/workflow/hooks2/NmFmNDFiOTY4NDMxOGU4ZjA3MDY1YmNi', prodUrl: '',
      params: ['Code', 'Token', 'UserId'],
      requireData: true
    }
  }
}
