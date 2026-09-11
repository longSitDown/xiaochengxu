# 明道云 HAP 应用开放接口（API V3）资料库

> **用途**：本文档为「咸宁市博物馆音频导览」项目对接明道云数据源时准备的接口参考库。当前项目（`src/api/mock.ts`）使用本地 mock 数据，后续如需改为读取/写入明道云工作表，可依据本文档实现 `exhibition.ts` 中的真实接口。
>
> **资料来源**（截至 2026-08-20）：
>
> 1. 用户指定文档：`https://apidoc.mingdao.com/application_v3`（应用授权 / AppKey+Sign 版，含字段类型表、筛选器指南、错误码）
> 2. 规范总览：`https://help.mingdao.com/api/v3`（V3 统一约定、环境地址、接口清单、系统字段、错误码）
> 3. 配额与限流：`https://help.mingdao.com/faq/numbers`（QPS、请求体上限、记录行数上限）
>
> **状态说明**：文档中存在不一致 / 未明确项，已在正文与文末「待验证清单」中标注 `⚠️`。凡标注 `⚠️` 的字段、参数或算法，需以实际接口联调或官方 MCP「应用 API 文档」为准。

***

## 目录

1. [对接背景与本项目映射](#1-对接背景与本项目映射)
2. [鉴权方式](#2-鉴权方式)
3. [环境地址与基础路径](#3-环境地址与基础路径)
4. [通用约定](#4-通用约定)
5. [核心接口清单（按模块）](#5-核心接口清单按模块)
6. [字段类型与取值格式](#6-字段类型与取值格式)
7. [筛选条件（filters）规则](#7-筛选条件filters规则)
8. [本项目对接建议](#8-本项目对接建议)
9. [待验证 / 不明确清单](#9-待验证--不明确清单)

***

## 1. 对接背景与本项目映射

本项目当前三级数据模型：

| 本项目概念                  | 明道云对应               | 备注                                |
| ---------------------- | ------------------- | --------------------------------- |
| `ExhibitionItem`（展区）   | 一个工作表（如「展区」表）的一行    | 或作为「展品」表的分类字段                     |
| `ArtifactItem`（展品，可播放） | 一个工作表（如「展品」表）的一行    | 含 `audioUrl`、`script`、`views` 等字段 |
| 音频 / 讲解词               | 普通字段（文本 / 附件 / URL） | 真实音频地址写入 `audioUrl` 字段            |

> 实际对接时，建议把「展品」建为一张工作表，字段对应 `name`(标题)、`cover`(附件/URL)、`audioUrl`(URL)、`script`(文本)、`views`(数值)、`exhibitionId`(关联记录 或 单选)。详见 [第 8 节](#8-本项目对接建议)。

***

## 2. 鉴权方式

V3 支持**三种**鉴权方式，凭证统一放在 **Header** 中，每个请求都必须携带。

### 2.1 三种鉴权对比

| 方式                      | Header 参数                                            | 操作身份           | 有效期     | 适用场景                        |
| ----------------------- | ---------------------------------------------------- | -------------- | ------- | --------------------------- |
| **AppKey + Sign**（应用密钥） | `HAP-Appkey`、`HAP-Sign`                              | 应用管理员（不代表具体用户） | 长期      | **服务端集成、定时同步、后台自动化**（本项目推荐） |
| **PAT**（个人访问凭证）         | `Authorization: Bearer {access_token}`、`HAP-Appid`\* | 个人             | 可设定     | 个人脚本 / 工具                   |
| **OAuth 2.0**           | `Authorization: Bearer {access_token}`、`HAP-Appid`\* | 被授权用户          | 短期，自动刷新 | 第三方应用集成                     |

> `*`：PAT / OAuth 的 `HAP-Appid` 仅「部分接口」必填（应用级接口通常需要）。本项目用 AppKey+Sign 时**无需** `HAP-Appid`。

### 2.2 AppKey + Sign 详解（重点）

- **创建者**：由应用管理员在【授权管理】>【新建授权密钥】创建。
- **组成**：每个密钥包含 `AppKey`、`Sign`（签名密钥）和**接口权限范围**，可用于不同系统 / 业务场景。
- **Header 必须携带**：

| Header       | 必填 | 类型     | 说明                      |
| ------------ | -- | ------ | ----------------------- |
| `HAP-Appkey` | 是  | string | 应用密钥 ID，示例 `{{appkey}}` |
| `HAP-Sign`   | 是  | string | 请求签名，示例 `{{sign}}`      |

- **安全约束**：密钥代表应用管理员权限，可访问范围取决于密钥所属应用及管理员权限。**只在可信服务端使用，禁止暴露到浏览器 / 客户端 / 公开仓库。**
  - ⚠️ 本项目是**纯前端 SPA**，若直接在前端放 `HAP-Appkey/HAP-Sign` 会泄露密钥。建议加一层**自有后端代理**（服务端持有密钥并签名），前端只调自有后端。

### 2.3 PAT / OAuth（补充，本项目暂不涉及）

- PAT：用户在个人中心自行创建，以个人身份操作，可设定有效期与权限范围。
- OAuth 2.0：需完成授权流程，返回 `access_token`，短期有效并支持刷新；相关错误码见 [4.5](#45-错误码表)（600xxx 段）。

### 2.4 签名（Sign）计算 ⚠️

> **文档未给出** **`HAP-Sign`** **的具体算法**（apidoc 与 help 文档均未提供签名公式、是否含 timestamp / nonce / 请求体哈希等）。
> 实际签名规则请以应用内「API 开发文档」页面、官方 MCP 文档或管理员后台的签名说明为准。**这是联调前必须澄清的第一项。**

***

## 3. 环境地址与基础路径

| 环境            | Host（基础地址）                                               |
| ------------- | -------------------------------------------------------- |
| HAP SaaS（公有云） | `https://api.mingdao.com`                                |
| 私有部署          | `{私有部署 host}/api`（示例：`https://p-demo.mingdaoyun.cn/api`） |

完整请求地址 = **Host + URL 路径**：

```text
https://api.mingdao.com   +   /v3/app/worksheets/{worksheet_id}/rows
        ↑ Host（环境）              ↑ URL（资源路径）
```

> 本项目 `vite.config.ts` 已预留 `/japi`、`/file` 代理位（当前为空）。对接时可在 dev 代理里把 `/mingdao` 转发到 `https://api.mingdao.com`，避免浏览器跨域（生产仍需后端代理以隐藏密钥）。

***

## 4. 通用约定

### 4.1 请求方法语义

| 方法       | 含义             | 案例                                             |
| -------- | -------------- | ---------------------------------------------- |
| `GET`    | 查询（不修改资源）      | 获取应用信息、记录详情、日志                                 |
| `POST`   | 新建；复杂查询也用 POST | 新建工作表、新建记录、**获取记录列表（含筛选器，走** **`/rows/list`）** |
| `PUT`    | 整体更新（未传字段会被清空） | 更新自定义页面                                        |
| `PATCH`  | 局部更新（仅更新传入字段）  | 更新 / 批量更新行记录                                   |
| `DELETE` | 删除             | 删除工作表、删除 / 批量删除行记录                             |

### 4.2 参数位置规范

| 位置                  | 命名风格         | 示例                                              |
| ------------------- | ------------ | ----------------------------------------------- |
| Header 鉴权           | `HAP-` 前缀    | `HAP-Appkey`、`HAP-Sign`、`HAP-Appid`             |
| Path 参数（资源 ID）      | 下划线 + 花括号    | `{worksheet_id}`、`{row_id}`、`{app_id}`          |
| Query 参数（GET）       | 小驼峰          | `pageSize`、`pageIndex`、`responseFormat`         |
| Body 参数（POST/PATCH） | 小驼峰          | `triggerWorkflow`、`rowIds`、`fields`             |
| 响应字段                | 小驼峰          | `total`、`pageIndex`、`pageSize`                  |
| 系统字段                | `_` 前缀 + 小驼峰 | `_createdBy`、`_owner`、`_createdAt`、`_updatedAt` |

- `POST/PUT/PATCH/DELETE` 的请求体必须为 **JSON**，`Content-Type: application/json`。
- `GET` 参数拼在 URL `?` 之后。

### 4.3 通用响应结构

所有接口统一返回 JSON，**HTTP 状态码恒为 200**，业务结果在 body 内判断：

```json
{
  "success": true,        // 是否成功（布尔）
  "error_code": 1,        // 错误码，1=成功（见 4.5）
  "error_msg": "string",  // 错误信息
  "data": {}              // 业务数据，类型 object 或 Array[object]
}
```

> ⚠️ **文档示例存在不一致**：部分示例写成 `"success": true, "error_code": 0`（如「获取工作表列表」示例），但错误码表定义 `1=成功 / 0=失败`。**判断成功请以** **`success === true`** **且** **`error_code === 1`** **为准**，联调时留意该字段实际取值。

### 4.4 系统字段

系统字段由平台自动维护，统一 `_` 前缀，**不占用自定义字段命名空间**（V3 对 V2 字段名做了语义化升级）：

| 含义     | V3 字段名       | 类型 / 说明                             |
| ------ | ------------ | ----------------------------------- |
| 记录 ID  | `id`（行记录顶层）  | 行记录唯一标识，增删改查路径用                     |
| 拥有者    | `_owner`     | `{ accountId, fullname }`           |
| 创建人    | `_createdBy` | `{ accountId, fullname }`           |
| 创建时间   | `_createdAt` | ISO 时间，如 `2024-03-25T15:52:58.000Z` |
| 最近修改时间 | `_updatedAt` | ISO 时间                              |
| 最近修改人  | `_updatedBy` | `{ accountId, fullname }`           |

> 工作流相关系统字段（V3）：`_processName`、`_nodeAssignees`、`_initiatedBy`、`_initiatedAt`、`_nodeStartedAt`、`_approvalCompletedAt`、`_dueAt`、`_remainingTime`、`_processStatus` 等。

### 4.5 错误码表

| 错误码    | 说明          |
| ------ | ----------- |
| 0      | 失败          |
| 1      | 成功          |
| 51     | 请求限流        |
| 10000  | 拒绝访问，IP 受限  |
| 10001  | 参数错误        |
| 10002  | 参数值错误       |
| 10005  | 数据操作无权限     |
| 10006  | 数据已存在       |
| 10007  | 数据不存在或已经删除  |
| 10101  | 令牌不存在       |
| 10102  | 签名不合法       |
| 10105  | 用户访问令牌失效    |
| 10106  | 用户访问组织令牌受限  |
| 100005 | 字段值重复       |
| 100006 | 选项数量已达上限    |
| 100007 | 附件数量已达上限    |
| 430013 | 应用未找到工作表    |
| 430014 | 工作表字段权限不足   |
| 430017 | 应用附件上传量不足   |
| 430018 | 草稿箱记录数量已达上限 |
| 430019 | 必填字段值为空     |
| 430020 | 子表数据错误      |
| 430021 | 数据不满足业务规则   |
| 430022 | 工作表不存在      |
| 90000  | 请求次数超出限制    |
| 99999  | 数据操作异常      |

**OAuth 相关错误码（600xxx 段，PAT/OAuth 才出现）**：`600100` access token 无效或已过期；`600101` 授权已失效；`600102` refresh token 失效；`600103` refresh token 不可换 token；`600104` 授权不存在；`600300/600302` 应用停用/不可用；`600311/600312` scope 非法/权限变更；`600320` 当前用户无权限；`600000~600004` 授权流程参数错误；`600112/600113` client 凭证错误 / IP 白名单。

### 4.6 限流与配额

API 网关对**同一个来源 IP**做调用频率限制（不针对某个应用或用户）：

| 接口（V2 名）                       | QPS 上限 | 请求体大小上限 |
| ------------------------------ | ------ | ------- |
| 新建行记录 `addRow`                 | 20     | 16 MB   |
| 批量新增 `addRows`                 | 20     | 16 MB   |
| 编辑行记录 `editRow`                | 20     | 16 MB   |
| 批量编辑 `editRows`                | 20     | 16 MB   |
| 删除行记录 `deleteRow`              | 20     | 16 MB   |
| 获取记录数量 `getFilterRowsTotalNum` | 50     | —       |
| 获取记录列表 `getFilterRows`         | 50     | —       |
| 其他接口                           | 不限制    | —       |
| **私有部署**                       | 不限制    | 25 MB   |

**记录行数上限**：

- 通过 API 获取记录列表：最多 **1000 行**。
- 通过 API 批量新增 / 更新 / 删除：最多 **1000 行**。
- API 写入 Base64 附件：最大 **7 MB**（SaaS）/ **14 MB**（私有部署）。

**超限表现**（需做容错）：

- 超过调用频率：HTTP 仍返回 200，body 为 `{"error_code":90001,"success":false,"error_msg":"调用接口超出限制"}`。
  > ⚠️ **错误码不一致**：通用错误码表写的是 `51 请求限流` 和 `90000 请求次数超出限制`，而限流 FAQ 示例给出 `90001`。**实际限流返回码需联调确认**；客户端重试逻辑建议同时捕获 51 / 90000 / 90001。
- 超过请求体大小：网关直接返回 HTTP **413 Request Entity Too Large**。

**建议**：循环调用时加间隔（如 `sleep(200ms)`），并对限流错误码加重试（指数退避）。

***

## 5. 核心接口清单（按模块）

> 统一说明：
>
> - 所有接口 Header 必带 `HAP-Appkey`、`HAP-Sign`（AppKey+Sign 方式）。
> - 路径中的 `{worksheet_id}`、`{row_id}` 为必填 Path 参数。

### 5.1 应用信息

#### 5.1.1 获取应用信息

| 项       | 内容                                |
| ------- | --------------------------------- |
| 用途      | 获取当前授权应用的基本信息（名称、图标、分组下的工作表/页面清单） |
| 方法 + 路径 | `GET /v3/app`                     |
| 请求参数    | 无（仅 Header）                       |

**返回** **`data`** **结构**：

| 字段               | 类型     | 说明                                                   |
| ---------------- | ------ | ---------------------------------------------------- |
| `organizationId` | string | 组织 ID                                                |
| `appId`          | string | 应用 ID                                                |
| `name`           | string | 应用名称                                                 |
| `iconUrl`        | string | 图标                                                   |
| `color`          | string | 主题色                                                  |
| `desc`           | string | 描述                                                   |
| `remark`         | string | 备注                                                   |
| `sections`       | array  | 分组列表，每项含 `id`、`name`、`items`（工作表/页面）、`childSections` |

> 注：`/v3/app` 同时也可用于「编辑应用」（POST）与「删除应用」（DELETE），本项目通常只需 GET。

***

### 5.2 工作表结构

#### 5.2.1 获取工作表列表

| 项       | 内容                             |
| ------- | ------------------------------ |
| 用途      | 获取应用下全部（或指定）工作表 ID 与名称         |
| 方法 + 路径 | `POST /v3/app/worksheets/list` |
| 请求体     | 见下表                            |

| 参数               | 位置   | 类型        | 必填 | 说明                          |
| ---------------- | ---- | --------- | -- | --------------------------- |
| `responseFormat` | body | string    | 否  | `json`(默认) / `md`（更省 token） |
| `worksheets`     | body | string\[] | 否  | 指定返回的工作表 ID，填后只返回这些         |

**返回** **`data`**：`[{ id, name, remark }]`。

#### 5.2.2 获取工作表结构信息 ⭐（写入前必调）

| 项       | 内容                                                  |
| ------- | --------------------------------------------------- |
| 用途      | 获取字段 `id`/别名、选项 `key`、关联字段类型——**新增/更新记录前必须先调本接口确认** |
| 方法 + 路径 | `GET /v3/app/worksheets/{worksheet_id}`             |

| 参数               | 位置    | 类型     | 必填 | 说明                |
| ---------------- | ----- | ------ | -- | ----------------- |
| `worksheet_id`   | path  | string | 是  | 工作表 ID            |
| `responseFormat` | query | string | 否  | `json`(默认) / `md` |

**返回** **`data`** **关键字段**：

| 字段                                                   | 类型    | 说明                        |
| ---------------------------------------------------- | ----- | ------------------------- |
| `worksheetId` / `name` / `alias` / `desc` / `remark` | —     | 工作表元信息                    |
| `fields`                                             | array | 字段数组（见下）                  |
| `views`                                              | array | 视图数组 `{ id, name, type }` |

`fields[]` 每项字段属性（对接写入最关键）：`id`、`name`、`alias`、`type`(类型码，见 [第 6 节](#6-字段类型与取值格式))、`required`、`isHidden`、`isReadOnly`、`isTitle`、`isUnique`、`precision`(数值/金额精度)、`subType`(关联/成员/时间的子类型)、`options`(单选/多选的选项 `{key, value, index}`)、`dataSource`(关联目标表)、`relation`、`showFields`、`bidirectional`(双向关联)、`max`(等级上限)。

#### 5.2.3 新建工作表

| 项       | 内容                        |
| ------- | ------------------------- |
| 用途      | 以 API 创建一张工作表并定义字段        |
| 方法 + 路径 | `POST /v3/app/worksheets` |

| 参数          | 位置   | 类型     | 必填 | 说明                                                                                                                                                               |
| ----------- | ---- | ------ | -- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | body | string | 是  | 工作表名称                                                                                                                                                            |
| `alias`     | body | string | 否  | 别名                                                                                                                                                               |
| `remark`    | body | string | 否  | 备注                                                                                                                                                               |
| `sectionId` | body | string | 否  | 所属分组                                                                                                                                                             |
| `fields`    | body | array  | 是  | 字段定义数组，每项：`name`(必)、`type`(必)、`alias`、`remark`、`required`、`isTitle`、`isHidden`、`isReadOnly`、`isUnique`、`precision`、`subType`、`options`、`dataSource`、`relation` 等 |

**返回** **`data`**：`{ worksheetId }`。

#### 5.2.4 更新工作表结构

| 项       | 内容                                                 |
| ------- | -------------------------------------------------- |
| 用途      | 增/改/删字段                                            |
| 方法 + 路径 | `POST /v3/app/worksheets/{worksheet_id}/structure` |

| 参数                                        | 位置   | 类型        | 必填 | 说明                                                                               |
| ----------------------------------------- | ---- | --------- | -- | -------------------------------------------------------------------------------- |
| `name` / `alias` / `remark` / `sectionId` | body | —         | 否  | 工作表属性                                                                            |
| `addFields`                               | body | array     | 否  | 新增字段，每项 `{ name`(必), `type`(必), `alias`, `remark`, `required`, `isTitle`, ...`}` |
| `editFields`                              | body | array     | 否  | 修改字段，含 `id` + 可改属性                                                               |
| `removeFields`                            | body | string\[] | 否  | 删除字段 ID 列表                                                                       |

> ⚠️ 文档两处路径写法略有差异（一处写 `/structure`，一处写直接 `/{worksheet_id}` 但 body 含 `addFields`），以 `POST .../structure` 为准；实际以联调为准。

***

### 5.3 行记录 — 列表查询（含筛选 / 分页）

#### 5.3.1 获取行记录列表

| 项       | 内容                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| 用途      | 按条件查询记录，支持筛选、分页、排序、关键词                                                                                                 |
| 方法 + 路径 | `POST /v3/app/worksheets/{worksheet_id}/rows/list`                                                                     |
| 说明      | 复杂筛选走 POST；简单场景也可 `GET /v3/app/worksheets/{worksheet_id}/rows`（⚠️ 列表接口是否同时提供 GET 版本需联调确认，规范清单只列了 `POST .../rows/list`） |

| 参数                   | 位置         | 类型        | 必填 | 说明                                                                     |
| -------------------- | ---------- | --------- | -- | ---------------------------------------------------------------------- |
| `worksheet_id`       | path       | string    | 是  | 工作表 ID                                                                 |
| `pageSize`           | body/query | integer   | 否  | 每页大小，默认 20；**最大 1000 行**（API 总量上限）                                     |
| `pageIndex`          | body/query | integer   | 否  | 页码，默认 1                                                                |
| `sortId`             | body/query | string    | 否  | 排序字段 ID                                                                |
| `isAsc`              | body/query | boolean   | 否  | 是否升序                                                                   |
| `filters` / `filter` | body       | object    | 否  | 筛选条件，结构见 [第 7 节](#7-筛选条件filters规则)；⚠️ 参数名是 `filters` 还是 `filter` 需联调确认 |
| `keywords`           | body/query | string    | 否  | 关键词搜索                                                                  |
| `viewId`             | body/query | string    | 否  | 按某视图的筛选/字段配置查询                                                         |
| `field_ids`          | body/query | string\[] | 否  | 指定返回字段（⚠️ 参数名需确认）                                                      |
| `getReference`       | body/query | boolean   | 否  | 是否展开关联记录（⚠️ 参数名与取值需确认）                                                 |

**返回** **`data`** **结构**（嵌套对象）：

```json
{
  "rows": [
    {
      "id": "row123",
      "fields": [
        { "id": "field1", "value": "示例值", "type": "2", "controlName": "文本字段" }
      ],
      "_createdBy":  { "accountId": "user123", "fullname": "张三" },
      "_owner":      { "accountId": "user123", "fullname": "张三" },
      "_createdAt":  "2024-03-25T15:52:58.000Z",
      "_updatedAt":  "2024-03-25T15:52:58.000Z",
      "_updatedBy":  { "accountId": "user123", "fullname": "张三" }
    }
  ],
  "total": 100,
  "pageIndex": 1,
  "pageSize": 20
}
```

> 注意：列表里每条记录的字段值放在 `fields[]`（而非扁平化），读取时需按 `field.id` 取 `value`。

***

### 5.4 行记录 — 详情

#### 5.4.1 获取单条记录

| 项       | 内容                                                    |
| ------- | ----------------------------------------------------- |
| 用途      | 按行 ID 获取完整记录                                          |
| 方法 + 路径 | `GET /v3/app/worksheets/{worksheet_id}/rows/{row_id}` |

| 参数             | 位置   | 类型     | 必填 | 说明     |
| -------------- | ---- | ------ | -- | ------ |
| `worksheet_id` | path | string | 是  | 工作表 ID |
| `row_id`       | path | string | 是  | 行记录 ID |

**返回** **`data`**：同 5.3 单条记录对象（含 `id`、`fields[]`、系统字段）。

***

### 5.5 行记录 — 新增

#### 5.5.1 新建单条记录

| 项       | 内容                                            |
| ------- | --------------------------------------------- |
| 用途      | 向工作表写入一条记录                                    |
| 方法 + 路径 | `POST /v3/app/worksheets/{worksheet_id}/rows` |

| 参数                | 位置   | 类型      | 必填 | 说明                                                                       |
| ----------------- | ---- | ------- | -- | ------------------------------------------------------------------------ |
| `worksheet_id`    | path | string  | 是  | 工作表 ID                                                                   |
| `fields`          | body | array   | 是  | 字段值数组，每项 `{ id, value }`（`id` 为字段别名或 ID，`value` 见 [第 6 节](#6-字段类型与取值格式)） |
| `triggerWorkflow` | body | boolean | 否  | 是否触发工作流，默认视配置；示例 `false`                                                 |

**请求示例**：

```json
{
  "fields": [
    { "id": "title", "value": "合同 A" },
    { "id": "amount", "value": "5200.00" },
    { "id": "biz_date", "value": "2026-03-26" },
    { "id": "biz_datetime", "value": "2026-03-26 11:22:33" },
    { "id": "priority_level", "value": "2" }
  ],
  "triggerWorkflow": false
}
```

**返回** **`data`**：新建记录对象（含 `id`）。⚠️ 文档未给明确 schema，建议联调确认是否直接返回 `rowId` 或完整记录。

> 字段值 `value` 一律以**字符串 / 数组**形式传入（即使是数值、日期）；关联 / 成员 / 部门字段传对应的 `rowId` / `accountId` / 部门 ID。详见 [6.3](#63-各类型取值格式与读写差异)。

***

### 5.6 行记录 — 更新

#### 5.6.1 更新单条记录

| 项       | 内容                                                      |
| ------- | ------------------------------------------------------- |
| 用途      | 局部更新某条记录的指定字段                                           |
| 方法 + 路径 | `PATCH /v3/app/worksheets/{worksheet_id}/rows/{row_id}` |

| 参数                | 位置   | 类型      | 必填 | 说明                  |
| ----------------- | ---- | ------- | -- | ------------------- |
| `worksheet_id`    | path | string  | 是  | 工作表 ID              |
| `row_id`          | path | string  | 是  | 行记录 ID              |
| `fields`          | body | array   | 是  | 同新增，`{ id, value }` |
| `triggerWorkflow` | body | boolean | 否  | 是否触发工作流             |

**请求示例**：

```json
{
  "fields": [
    { "id": "owner_user", "value": "{user_account_id}" },
    { "id": "customer_ref", "value": "{customer_row_id}" },
    { "id": "priority_level", "value": "5" }
  ],
  "triggerWorkflow": false
}
```

#### 5.6.2 更新附件字段（追加 / 覆盖）

附件字段更新通过 `type` 控制覆盖或追加：

```json
{
  "fields": [
    {
      "id": "attachment_docs",
      "type": "1",
      "value": "[{\"name\":\"file.png\",\"url\":\"https://example.com/file.png\"}]"
    }
  ],
  "triggerWorkflow": false
}
```

| `type` 取值 | 含义 |
| --------- | -- |
| `"0"`     | 覆盖 |
| `"1"`     | 追加 |

> 附件 `value` 为 JSON 字符串（或数组），元素 `{ name, url }`；支持 **URL** 与 **base64**。

***

### 5.7 行记录 — 删除

#### 5.7.1 删除单条记录

| 项       | 内容                                                       |
| ------- | -------------------------------------------------------- |
| 用途      | 删除指定行记录                                                  |
| 方法 + 路径 | `DELETE /v3/app/worksheets/{worksheet_id}/rows/{row_id}` |

| 参数                | 位置         | 类型      | 必填 | 说明                         |
| ----------------- | ---------- | ------- | -- | -------------------------- |
| `worksheet_id`    | path       | string  | 是  | 工作表 ID                     |
| `row_id`          | path       | string  | 是  | 行记录 ID                     |
| `triggerWorkflow` | body/query | boolean | 否  | 是否触发工作流 ⚠️ 单条删除是否支持该参数需确认  |
| `permanent`       | body/query | boolean | 否  | 是否彻底删除（而非进回收站）⚠️ 参数名/取值需确认 |

> 单条删除的返回以通用结构 `success/error_code` 判断；文档未给独立 schema。

***

### 5.8 批量操作

| 操作   | 方法 + 路径                                               | 请求体                                                                                        | 返回 `data`                     |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------- |
| 批量新增 | `POST /v3/app/worksheets/{worksheet_id}/rows/batch`   | `{ rows: [ { fields: [ {id, value} ] } ], triggerWorkflow: true }`                         | `{ rowIds: ["row1","row2"] }` |
| 批量更新 | `PATCH /v3/app/worksheets/{worksheet_id}/rows/batch`  | `{ rows: [ { rowId, fields: [ {id, value} ] } ], triggerWorkflow: true }` ⚠️ `rowId` 键名需确认 | 更新结果（⚠️ 文档未给明确 schema）        |
| 批量删除 | `DELETE /v3/app/worksheets/{worksheet_id}/rows/batch` | `{ rowIds: ["row1","row2"], triggerWorkflow: true, permanent: false }`                     | `{}`                          |

> ⚠️ **批量更新**的请求体结构（每行如何关联 `rowId`）文档未明示，上表为依命名规范推断，必须联调确认。
> ⚠️ 批量接口单次最多 **1000 行**；超过需分批。
> 注意 `DELETE .../batch` 仍带 JSON body（含 `rowIds`），属非常规用法，客户端需支持 DELETE + body。

***

### 5.9 关联记录

关联记录依赖工作表结构中的 `Relation` 字段（`dataSource` 指向目标表，`subType` 1=单条 / 2=多条）。

#### 5.9.1 写入关联

新增 / 更新记录时，关联字段 `value` 直接填目标记录的 `rowId`（单条为字符串，多条为数组）：

```json
{ "id": "customer_ref", "value": "{customer_row_id}" }
```

> 流程建议：先建/查目标表记录拿到 `rowId`，再写主表。筛选关联记录需先查到目标 `record_id`，再用数组值运算符（`eq`/`in`/`concurrent`）过滤。

#### 5.9.2 获取某记录的关联记录

| 项       | 内容                                                                      |
| ------- | ----------------------------------------------------------------------- |
| 用途      | 读取某条记录在某个关联字段上的关联数据                                                     |
| 方法 + 路径 | `GET /v3/app/worksheets/{worksheet_id}/rows/{row_id}/relations/{field}` |
| 路径参数    | `worksheet_id`(必)、`row_id`(必)、`field`(必，关联字段 ID/别名)                     |

***

### 5.10 其他常用行记录接口（速查）

| 接口       | 方法 + 路径                                                           |
| -------- | ----------------------------------------------------------------- |
| 行记录透视数据  | `POST /v3/app/worksheets/{worksheet_id}/rows/pivot`               |
| 获取记录分享链接 | `POST /v3/app/worksheets/{worksheet_id}/rows/{row_id}/share-link` |
| 获取行记录日志  | `GET /v3/app/worksheets/{worksheet_id}/rows/{row_id}/logs`        |
| 获取行记录讨论  | `GET /v3/app/worksheets/{worksheet_id}/rows/{row_id}/discussions` |

***

## 6. 字段类型与取值格式

### 6.1 字段类型对照表

下表整理自 apidoc 字段类型对照表。「创建」列表示是否允许通过 API 写入（新增/更新），「查询」列表示是否可作为查询条件。V3 用**数字类型码**标识字段类型。

|   Type 码 | 名称                    | 允许 API 创建 | 允许 API 查询 | 支持筛选运算符                                                                                                            |
| -------: | --------------------- | :-------: | :-------: | ------------------------------------------------------------------------------------------------------------------ |
|        2 | Text 文本               |     ✓     |     ✓     | `eq, ne, contains, concurrent, notcontains, startswith, notstartswith, endswith, notendswith, isempty, isnotempty` |
|        3 | PhoneNumber 手机        |     —     |     ✓     | 同 Text                                                                                                             |
|        4 | LandlinePhone 座机      |     —     |     ✓     | 同 Text                                                                                                             |
|        5 | Email 邮箱              |     —     |     ✓     | 同 Text                                                                                                             |
|        6 | Number 数值             |     ✓     |     ✓     | `eq, ne, gt, lt, ge, le, between, notbetween, isempty, isnotempty`                                                 |
|        7 | Certificate 证件        |     —     |     ✓     | 同 Text                                                                                                             |
|        8 | Currency 金额           |     —     |     ✓     | 同 Number                                                                                                           |
|        9 | SingleSelect 单选       |     ✓     |     ✓     | `eq, ne, in, notin, isempty, isnotempty`                                                                           |
|       10 | MultipleSelect 多选     |     ✓     |     ✓     | `eq, ne, in, notin, concurrent, isempty, isnotempty`                                                               |
|       11 | Dropdown 下拉           |     —     |     ✓     | `eq, ne, in, notin, isempty, isnotempty`                                                                           |
|       14 | Attachment 附件         |     ✓     |     ✓     | `isempty, isnotempty`                                                                                              |
|       15 | Date 日期               |     ✓     |     ✓     | `between, notbetween`                                                                                              |
|       16 | DateTime 时间           |     ✓     |     ✓     | `between, notbetween`                                                                                              |
| 19/23/24 | Region 地区             |     —     |     ✓     | `eq, ne, between, notbetween, in, isempty, isnotempty`                                                             |
|       21 | DynamicLink 自由链接      |     —     |     ✓     | `isempty, isnotempty`                                                                                              |
|       22 | Divider 分段            |     —     |     —     | —                                                                                                                  |
|       25 | AmountInWords 大写金额    |     —     |     ✓     | 同 Number                                                                                                           |
|       26 | Collaborator 成员       |     ✓     |     ✓     | `eq, ne, in, notin, concurrent, isempty, isnotempty`                                                               |
|       27 | Department 部门         |     —     |     ✓     | `eq, ne, between, notbetween, in, notin, concurrent, isempty, isnotempty`                                          |
|       28 | Rating 等级             |     —     |     ✓     | 同 Number                                                                                                           |
|       29 | **Relation 关联记录**     |     ✓     |     ✓     | `eq, ne, in, notin, concurrent, isempty, isnotempty`                                                               |
|       30 | Lookup 他表字段           |     —     |     ✓     | —                                                                                                                  |
|       31 | Formula 公式            |     —     |     ✓     | 同 Number                                                                                                           |
|       32 | Concatenate 文本拼接      |     —     |     ✓     | 同 Text                                                                                                             |
|       33 | AutoNumber 自动编号       |     —     |     ✓     | 同 Text                                                                                                             |
|       34 | SubTable 子表           |     —     |     ✓     | `isempty, isnotempty`                                                                                              |
|       35 | CascadingSelect 级联选择  |     —     |     ✓     | `eq, ne, between, notbetween, isempty, isnotempty`                                                                 |
|       36 | Checkbox 检查框          |     —     |     ✓     | `isempty, isnotempty`                                                                                              |
|       37 | Rollup 汇总             |     —     |     ✓     | 同 Number                                                                                                           |
|       38 | DateFormula 公式（日期）    |     —     |     ✓     | —                                                                                                                  |
|       39 | CodeScan 扫码           |     —     |     ✓     | —                                                                                                                  |
|       40 | Location 定位           |     —     |     ✓     | `isempty, isnotempty`                                                                                              |
|       41 | RichText 富文本          |     —     |     ✓     | `isempty, isnotempty`                                                                                              |
|       42 | Signature 签名          |     —     |     ✓     | `isempty, isnotempty`                                                                                              |
|       43 | OCR 文字识别              |     —     |     ✓     | —                                                                                                                  |
|       44 | Role 角色               |     —     |     ✓     | —                                                                                                                  |
|       45 | Embed 嵌入              |     —     |     —     | —                                                                                                                  |
|       46 | Time 时间               |     ✓     |     ✓     | `between, notbetween`                                                                                              |
|       47 | Barcode 条码            |     —     |     ✓     | —                                                                                                                  |
|       48 | OrgRole 组织角色          |     —     |     ✓     | `eq, ne, in, notin, concurrent, isempty, isnotempty`                                                               |
|       49 | Button API查询(按钮)      |     —     |     —     | —                                                                                                                  |
|       50 | APIQuery API查询(下拉)    |     —     |     —     | —                                                                                                                  |
|       51 | QueryRecord 查询记录      |     —     |     —     | —                                                                                                                  |
|       52 | Section 标签页           |     —     |     —     | —                                                                                                                  |
|       53 | FunctionFormula 函数公式  |     —     |     ✓     | —                                                                                                                  |
|       54 | CustomField 自定义字段     |     —     |     —     | —                                                                                                                  |
| 10000003 | Array 数组(工作流)         |     —     |     —     | —                                                                                                                  |
| 10000006 | Object 对象(工作流)        |     —     |     —     | —                                                                                                                  |
| 10000007 | SimpleArray 普通数组(工作流) |     —     |     —     | —                                                                                                                  |
| 10000008 | ObjectArray 对象数组(工作流) |     —     |     —     | —                                                                                                                  |

> 「创建」列标 `—` 的类型（如手机、邮箱、公式、他表字段、自动编号等）为**系统/计算型字段，API 不可写入**，仅可读取。

### 6.2 取值通用规则

- 所有 `value` 均以**字符串或数组**形式传入，即使数值、日期也建议用字符串（如 `"5200.00"`、`"2026-03-26"`）。
- 读取时 `fields[].value` 返回值的类型依字段类型而定。
- 写入前务必先调 [5.2.2](#522-获取工作表结构信息-写入前必调) 确认字段 `id`、选项 `key`、关联类型。

### 6.3 各类型取值格式与读写差异

| 类型                           | 写入 `value` 格式                                                        | 读取返回        | 备注                                             |
| ---------------------------- | -------------------------------------------------------------------- | ----------- | ---------------------------------------------- |
| 文本 / 手机 / 邮箱 / 证件            | 字符串                                                                  | 字符串         | 直接传文本                                          |
| 数值 / 金额 / 等级                 | 数字字符串，如 `"5200.00"`                                                  | 数值/字符串      | 金额受 `precision` 精度影响                           |
| 日期 Date                      | `"YYYY-MM-DD"`                                                       | 同格式字符串      | 筛选仅支持 `between/notbetween`                     |
| 时间 DateTime                  | `"YYYY-MM-DD HH:MM:SS"`                                              | 同格式字符串      | <br />                                         |
| 时间 Time(46)                  | `"HH:MM:SS"`（⚠️ 格式需确认）                                               | —           | <br />                                         |
| 单选 SingleSelect              | 选项 `key` 的数组，如 `["2"]`                                               | 选项对象/key    | 必须传 `key` 而非显示名；用 `eq/in`                      |
| 多选 MultipleSelect            | 选项 `key` 数组，如 `["2","5"]`                                            | 数组          | 用 `concurrent/in`                              |
| 下拉 Dropdown                  | 选项 `key` 数组                                                          | —           | 同单选取值方式                                        |
| 附件 Attachment                | JSON 字符串/数组：`[{"name":"x.png","url":"https://..."}]`；支持 URL 与 base64 | 附件对象数组      | 更新用 `type:"0"`覆盖/`"1"`追加；Base64 单文件 ≤7MB(SaaS) |
| 成员 Collaborator              | 用户 `accountId`（单条字符串 / 多条数组）                                         | 用户对象数组      | 特殊 AccountID：`user-self`(当前用户) 等               |
| 部门 Department                | 部门 ID（字符串 / 数组）                                                      | 部门对象数组      | <br />                                         |
| 关联记录 Relation                | 目标记录 `rowId`（单条字符串 / 多条数组）                                           | `rowId` 或数组 | 由 `subType` 决定单/多；写入前先取目标 `rowId`              |
| 检查框 Checkbox                 | ⚠️ `"1"`/`"0"` 或 `true`/`false`，需联调确认                                | —           | 文档未明确写入格式                                      |
| 地区 Region                    | 地区编码（字符串 / 数组）                                                       | —           | <br />                                         |
| 自动编号 / 公式 / 他表字段 / 汇总 / 富文本等 | **不可写入**                                                             | 依类型返回       | 系统/计算字段，仅读                                     |

> **特殊 AccountID**（成员字段可用）：`user-self`(当前用户)、`user-sub`(下属)、`user-workflow`(工作流)、`user-api`(API)。

***

## 7. 筛选条件（filters）规则

### 7.1 结构

筛选器为递归结构，节点分 `group`（条件组）与 `condition`（单条件）：

```typescript
Filter = {
  type: 'group' | 'condition';
  logic?: 'AND' | 'OR';      // type=group 时必填
  children?: Filter[];        // type=group 时；子节点须全 group 或全 condition，最多两层嵌套
  field?: string;            // type=condition 时；字段 ID 或别名
  operator?: FilterOperator; // type=condition 时；运算符
  value?: any;               // type=condition 时；字符串/数值/数组
}
```

### 7.2 运算符表

**比较运算符**

| 运算符             | 描述     | 示例值                            |
| --------------- | ------ | ------------------------------ |
| `eq`            | 等于     | `"Beijing"` 或 `["<targetid>"]` |
| `ne`            | 不等于    | `"London"` 或 `["<targetid>"]`  |
| `gt`            | 大于     | `20` 或 `"2025-02-06 00:00:00"` |
| `ge`            | 大于等于   | `10`                           |
| `lt`            | 小于     | `20`                           |
| `le`            | 小于等于   | `100`                          |
| `in`            | 是其中一个  | `["value1","value2"]`          |
| `notin`         | 不是任意一个 | `["value1","value2"]`          |
| `contains`      | 包含     | `"Ch"` 或 `["销售部","市场部"]`       |
| `notcontains`   | 不包含    | 同上                             |
| `concurrent`    | 同时包含   | `["<id1>","<id2>"]`            |
| `belongsto`     | 属于     | `["<departmentid>"]`           |
| `notbelongsto`  | 不属于    | `["<departmentid>"]`           |
| `startswith`    | 开头是    | `"张"`                          |
| `notstartswith` | 开头不是   | `"李"`                          |
| `endswith`      | 结尾是    | `"公司"`                         |
| `notendswith`   | 结尾不是   | `"有限公司"`                       |
| `between`       | 在范围内   | `["2025-01-01","2025-01-31"]`  |
| `notbetween`    | 不在范围内  | `["10","20"]`                  |

**为空运算符**（无需 `value`）

| 运算符          | 描述  |
| ------------ | --- |
| `isempty`    | 为空  |
| `isnotempty` | 不为空 |

### 7.3 示例

**示例 1：姓「张」且 1 月入职**

```json
{
  "type": "group",
  "logic": "AND",
  "children": [
    { "type": "condition", "field": "name", "operator": "startswith", "value": "张" },
    { "type": "condition", "field": "onboard_date", "operator": "between", "value": ["2025-01-01", "2025-01-31"] }
  ]
}
```

**示例 2：两层嵌套（华北区 销售部/市场部 且 姓张 + 1月入职）**

```json
{
  "type": "group",
  "logic": "AND",
  "children": [
    {
      "type": "group", "logic": "AND",
      "children": [
        { "type": "condition", "field": "name", "operator": "startswith", "value": "张" },
        { "type": "condition", "field": "onboard_date", "operator": "between", "value": ["2025-01-01", "2025-01-31"] }
      ]
    },
    {
      "type": "group", "logic": "OR",
      "children": [
        { "type": "condition", "field": "department_name", "operator": "contains", "value": ["销售部", "市场部"] },
        { "type": "condition", "field": "department_id", "operator": "belongsto", "value": ["华北区ID"] }
      ]
    }
  ]
}
```

### 7.4 注意事项

1. **嵌套限制**：最多两层（`group → group → condition`）。
2. **children 类型一致**：一个 `group` 的 `children` 只能全是 `group` 或全是 `condition`，不能混合。
3. **logic 必填**：`type=group` 时必须指定 `AND`/`OR`。
4. **为空运算符** `isempty`/`isnotempty` 不需要 `value`。
5. **数组值**：`between`/`in`/`notin`/`contains`/`concurrent`/`belongsto` 等需数组值。
6. **选项型字段**（单选/多选）：把对应 `option` 的 `key` 放到数组中作为 `value`，用数组值运算符。
7. **关联记录筛选**：先查到目标 `record_id`，再用数组值规则（`eq`/`in`/`concurrent`）筛选。

***

## 8. 本项目对接建议

针对「咸宁市博物馆音频导览」把 mock 换成明道云数据源时的落地思路：

1. **建表建议**：新建一张「展品」工作表，字段映射：
   - `name`（文本，设为标题字段 `isTitle`）
   - `cover`（附件 / URL，展示用封面）
   - `audioUrl`（URL，真实音频地址）
   - `script`（文本/富文本，讲解词）
   - `views`（数值，浏览量）
   - `exhibitionId`（关联记录 → 「展区」表，或单选）
   - `duration`（数值，时长，可选）
2. **读取链路**：`GET /v3/app`（拿 worksheetId）→ `POST .../rows/list`（按 `exhibitionId` 用 filters 过滤 + 分页）替代 `fetchArtifactsByExhibition`；`GET .../rows/{row_id}` 替代 `fetchArtifactDetail`。
3. **密钥安全**：本项目是纯前端 SPA，**不要**把 `HAP-Appkey/HAP-Sign` 写进前端代码。应加一个轻量后端代理（持有密钥、做签名与限流重试），前端通过 `vite.config.ts` 已预留的代理位转发。
4. **字段读取**：列表返回是 `rows[].fields[]` 结构，需在 `exhibition.ts` 里把 `fields` 拍平为 `ArtifactItem`（`id`→映射 `audioUrl`/`script` 等）。
5. **限流**：循环分页拉取时加间隔并对 `51/90000/90001` 加重试。

***

## 9. 待验证 / 不明确清单

以下项文档未明确或存在不一致，**联调前必须向官方 MCP「应用 API 文档」或管理员后台核实**：

1. ⚠️ **`HAP-Sign`** **签名算法**：文档完全未提供，这是联调第一优先级。
2. ⚠️ **列表接口方法/形态**：规范清单只列 `POST /v3/app/worksheets/{worksheet_id}/rows/list`；是否存在 `GET /rows` 简单列表版本需确认。
3. ⚠️ **筛选参数名**：是 `filters` 还是 `filter`（透视接口示例用 `filter` 单数，行记录列表惯例可能是 `filters`）。
4. ⚠️ **列表查询的 Query/Body 参数名**：`sortId`、`isAsc`、`keywords`、`viewId`、`field_ids`、`getReference` 的确切名称与类型需以实际接口为准。
5. ⚠️ **批量更新请求体**：每行如何关联 `rowId`（键名 `rowId` 还是 `id`），返回结构未给。
6. ⚠️ **单条删除**是否支持 `triggerWorkflow` / `permanent` 参数及其取值。
7. ⚠️ **限流错误码不一致**：通用表 `51`/`90000` vs FAQ 示例 `90001`，客户端建议全部捕获。
8. ⚠️ **响应成功判定字段**：示例出现 `success:true, error_code:0` 矛盾，以 `success===true && error_code===1` 为准。
9. ⚠️ **Checkbox 写入格式**：`"1"`/`"0"` 还是布尔。
10. ⚠️ **Time(46) 字段写入格式**：`"HH:MM:SS"` 待确认。
11. ⚠️ **附件** **`value`** **细节**：数组与 JSON 字符串两种写法是否都支持；base64 的字段组织方式。
12. ⚠️ **PAT/OAuth 的** **`HAP-Appid`** **必填范围**：具体哪些接口需要。

***

*文档生成日期：2026-08-20 ｜ 资料来源：apidoc.mingdao.com/application\_v3、help.mingdao.com/api/v3、help.mingdao.com/faq/numbers*
