/**
 * 后端配置：环境变量 + server/.env（零依赖，自行解析）
 *
 * 所有敏感项（微信 appsecret、明道云 AppKey/Sign 密钥）只存在于服务端，
 * 前端配置文件里只留代理地址。
 */
const fs = require('fs')
const path = require('path')

/** 极简 .env 解析：KEY=VALUE，支持行内注释与引号包裹；已存在的环境变量优先 */
function loadEnv() {
  const file = path.join(__dirname, '.env')
  if (!fs.existsSync(file)) return
  fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      if (/^\s*#/.test(line) || !line.trim()) return
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!m) return
      let v = m[2].trim()
      if (
        (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
        (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")
      ) {
        v = v.slice(1, -1)
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v
    })
}

loadEnv()

function str(name, def) {
  const v = process.env[name]
  return v === undefined || v === '' ? def : String(v)
}

function num(name, def) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : def
}

const config = {
  /** 监听端口 */
  PORT: num('PORT', 3000),

  /** 绑定地址：生产建议 127.0.0.1 由 Nginx 反代 */
  HOST: str('HOST', '0.0.0.0'),

  /** 明道云环境地址（私有部署填 https://<host>/api） */
  HAP_BASE: str('HAP_BASE', 'https://api.mingdao.com').replace(/\/+$/, ''),

  HAP_APPKEY: str('HAP_APPKEY', ''),
  HAP_SECRET: str('HAP_SECRET', ''),

  /**
   * 签名拼接变体 —— 明道云文档只给了 C# 参考实现，未明确拼接格式，
   * 因此这里做成可切换。用 tools/sign-probe.js 探测出正确值后写回本项。
   * 格式：<拼接方式>|<摘要编码>
   *   拼接方式：kv   → AppKey=xx&SecretKey=yy&Timestamp=zz
   *            kvnl → 同上，用换行分隔
   *            plain→ xx yy zz 直接相连
   *   摘要编码：b64hex → Base64(小写hex字符串)  ← C# 示例的做法
   *            b64raw → Base64(原始摘要字节)
   *            hex    → 直接用小写hex
   */
  HAP_SIGN_VARIANT: str('HAP_SIGN_VARIANT', 'kv|b64hex'),

  /** 小程序凭证（用于 jscode2session） */
  WX_APPID: str('WX_APPID', ''),
  WX_SECRET: str('WX_SECRET', ''),

  /** 登录态签名密钥，生产必须改成随机长串 */
  TOKEN_SECRET: str('TOKEN_SECRET', 'please-change-this-token-secret'),

  /** token 有效期（秒），默认 7 天 */
  TOKEN_TTL: num('TOKEN_TTL', 7 * 24 * 3600),

  /** 上传目录（头像等） */
  UPLOAD_DIR: path.resolve(__dirname, str('UPLOAD_DIR', './uploads')),

  /** 对外可访问的基地址，用于拼头像 URL */
  PUBLIC_BASE: str('PUBLIC_BASE', ''),

  /** 单文件上传上限（字节），默认 2MB */
  UPLOAD_MAX: num('UPLOAD_MAX', 2 * 1024 * 1024),

  /**
   * 跳过明道云、直接签发 token（仅用于前端联调登录链路）。
   * 生产必须为 0。
   */
  MOCK_LOGIN: str('MOCK_LOGIN', '0') === '1',

  /** 允许的跨域来源，逗号分隔；* 表示全部（小程序不需要 CORS，仅便于浏览器调试） */
  CORS_ORIGIN: str('CORS_ORIGIN', '*')
}

/** 启动前的配置体检，返回缺失项说明 */
function check() {
  const problems = []
  if (!config.HAP_APPKEY) problems.push('HAP_APPKEY 未配置（无法访问明道云）')
  if (!config.HAP_SECRET) problems.push('HAP_SECRET 未配置（无法生成签名）')
  if (!config.WX_APPID) problems.push('WX_APPID 未配置（无法换取 openid）')
  if (!config.WX_SECRET) problems.push('WX_SECRET 未配置（无法换取 openid）')
  if (config.TOKEN_SECRET === 'please-change-this-token-secret') {
    problems.push('TOKEN_SECRET 仍是默认值（任何人都能伪造登录态，上线前必须更换）')
  }
  return problems
}

module.exports = { config, check }
