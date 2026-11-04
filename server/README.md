# 后端服务（登录 + 明道云代理）

零依赖 Node 服务（Node 18+，无需 `npm install`），解决三件事：

| 问题 | 做法 |
|---|---|
| 小程序拿不到 openid | 用 `code` 换 openid，`appsecret` 只留在服务端 |
| 明道云密钥不能进前端 | 代签 `HAP-Appkey`/`HAP-Sign` 转发请求 |
| 前端可随意伪造 userId 越权 | 用 token 里的用户 ID 强制覆盖请求里的 `userId` |

---

## 一、快速启动

```bash
cp server/.env.example server/.env
# 编辑 server/.env，填入 HAP_APPKEY / HAP_SECRET / WX_APPID / WX_SECRET / TOKEN_SECRET

node server/index.js
```

看到 `server listening on http://0.0.0.0:3000` 即启动成功。
`GET /api/health` 会列出还缺哪几项配置。

**先跑通登录再配明道云**：把 `MOCK_LOGIN=1` 打开，服务会跳过微信与明道云直接发 token，
小程序端可以立刻验证整条登录链路（此时 `/api/auth/profile` 会返回 409，属预期）。

---

## 二、签名变体必须先探测

明道云官方 API 文档**没有给出 `HAP-Sign` 算法**，只在组织 API 文档里有一个 C# 参考实现。
参数怎么拼接、时间戳用秒还是毫秒都没写清，猜不出来。

拿到 AppKey/Secret 后先跑：

```bash
node tools/sign-probe.js
```

脚本会把 24 种组合全试一遍（4 种拼接 × 3 种摘要编码 × 2 种时间戳单位），
用 `GET /v3/app` 判断哪种能通过，输出类似：

```
✅ 1. kv|b64hex|ms         通过（HTTP 200）
...
✅ 可用变体：
   HAP_SIGN_VARIANT=kv|b64hex    (时间戳单位：毫秒)
```

把这一行写进 `.env` 重启即可。若 24 种全失败，脚本会打印排查顺序。

---

## 三、接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{ code }` → `{ token, user }` |
| GET | `/api/auth/profile` | 需 `Authorization: Bearer <token>` |
| PATCH | `/api/auth/profile` | `{ nickname, avatar, phone }`，需登录 |
| POST | `/api/upload` | `{ ext, data }`（base64）→ `{ url }`，需登录 |
| GET | `/api/health` | 配置体检 + 明道云连通性 |
| ANY | `/api/hap/v3/...` | 透传明道云，`/api/hap` 前缀会被剥掉 |

### 鉴权规则（重要）

- **写操作必须登录**：POST 新建、PATCH、DELETE 一律要求有效 token。
  否则等于把「应用管理员写权限」开放给整个互联网。
- **读操作允许匿名**：GET 与 POST `.../rows/list|pivot` 可匿名访问（游客要能浏览资讯）。
- **匿名 + `userId` 筛选 = 403**：防止有人构造 `filterCond('userId','eq','别人')` 读他人预约。
- **写请求的 `userId` 会被强制改写**为当前登录用户，前端传什么都不作数。

---

## 四、部署

### 1. 反代（Nginx）

```nginx
server {
    listen 443 ssl http2;
    server_name api.你的域名.com;

    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 4m;
    }
}
```

### 2. 常驻进程（systemd）

```ini
[Unit]
Description=redhall-api
After=network.target

[Service]
WorkingDirectory=/opt/redhall
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=HOST=127.0.0.1
EnvironmentFile=/opt/redhall/server/.env

[Install]
WantedBy=multi-user.target
```

### 3. 小程序端

改 `config/index.js` 两处：

```js
USE_MOCK: false,
BASE_URL: 'https://api.你的域名.com/api/hap',   // 注意要带 /api/hap
```

再把 `https://api.你的域名.com` 加进微信公众平台
「开发管理 → 开发设置 → 服务器域名 → request 合法域名」，
以及 `downloadFile 合法域名`（头像 URL 走同一个域名）。

---

## 五、安全清单（上线前逐条对）

- [ ] `TOKEN_SECRET` 已换成 32 位以上随机串
- [ ] `MOCK_LOGIN=0`
- [ ] `server/.env` 已加入 `.gitignore`，未提交
- [ ] `HOST=127.0.0.1` + Nginx 反代，不直接暴露 3000
- [ ] 已开 HTTPS（小程序强制要求）
- [ ] `server/uploads/` 有定期清理或转对象存储的策略
- [ ] 反代层加了限流（防刷 `/api/auth/login`）

---

## 六、已知限制

- **上传落本地磁盘**：多实例部署或容器重启会丢文件，生产建议换对象存储（OSS/COS），
  改动点只在 `server/index.js` 的 `handleUpload`。
- **无内置限流**：需要靠 Nginx `limit_req` 或云厂商 WAF 兜。
- **无 refresh token**：token 到期（默认 7 天）后前端会静默重新登录一次，
  不会打断用户操作，但每次重登都会打一次微信接口。
