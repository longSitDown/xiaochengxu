/**
 * 通用格式化工具
 */

/** 补零：个位数前补 0，返回字符串（用于 fmt 模板替换） */
function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

/**
 * 日期格式化
 * @param {Date|string|number} input
 * @param {string} fmt  yyyy-MM-dd HH:mm:ss
 */
function formatDate(input, fmt = 'yyyy-MM-dd') {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return ''
  const map = {
    yyyy: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds())
  }
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => map[k])
}

/**
 * 相对时间：刚刚 / n分钟前 / n小时前 / n天前 / 具体日期
 */
function fromNow(input) {
  if (!input) return ''
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime()
  if (isNaN(t)) return ''
  const diff = Date.now() - t
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '刚刚'
  if (diff < hour) return Math.floor(diff / min) + '分钟前'
  if (diff < day) return Math.floor(diff / hour) + '小时前'
  if (diff < 7 * day) return Math.floor(diff / day) + '天前'
  return formatDate(t, 'yyyy-MM-dd')
}

/**
 * 秒 → mm:ss 或 h:mm:ss（超过 1 小时带小时位，常用于音频/视频时长展示）
 */
function formatDuration(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return h + ':' + pad(m) + ':' + pad(s)
  return pad(m) + ':' + pad(s)
}

/** 数字千分位 */
function formatNumber(n) {
  const num = Number(n) || 0
  return num.toLocaleString('zh-CN')
}

/** 生成随机 ID：时间戳 36 进制 + 随机后缀，避免同毫秒内重复 */
function genId(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/**
 * 身份证号校验（18 位含校验码算法；兼容 15 位老证）
 * @param {string} no 身份证号
 * @returns {boolean}
 */
function validateIdCard(no) {
  const s = String(no || '').trim().toUpperCase()
  // 15 位老证：只校验纯数字格式，无校验码
  if (/^\d{15}$/.test(s)) return true
  if (!/^\d{17}[\dX]$/.test(s)) return false
  // 18 位校验码：前 17 位按固定权值加权求和，取 sum%11 映射到校验位表，与第 18 位比对
  // 权值与校验表均为国标固定常量（GB 11643-1999），推导后即得 X 校验位
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const codes = '10X98765432'
  const sum = s.slice(0, 17).split('').reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0)
  return codes.charAt(sum % 11) === s.charAt(17)
}

/**
 * 身份证号脱敏：保留前 6 位（地址码）与后 4 位
 * 110105194912310021 → 110105******0021
 */
function maskIdCard(no) {
  const s = String(no || '').trim()
  if (s.length < 11) return s ? '****' : ''
  return s.slice(0, 6) + '******' + s.slice(-4)
}

/** 解析 JSON 字符串，失败返回默认值 */
function safeParse(str, fallback) {
  try {
    const v = typeof str === 'string' ? JSON.parse(str) : str
    return v == null ? fallback : v
  } catch (e) {
    return fallback
  }
}

module.exports = {
  pad,
  formatDate,
  fromNow,
  formatDuration,
  formatNumber,
  genId,
  safeParse,
  validateIdCard,
  maskIdCard
}
