# API 说明

所有接口都返回 JSON（页面路由除外）。错误统一为：

```json
{ "error": "一句话说明" }
```

部分校验错误会多一个 `details` 数组，逐个列出问题：

```json
{ "error": "提交的答案不合法", "details": ["第 2 题「主要学习方式」至少需要选择 1 个选项"] }
```

登录态用 Cookie（`sid`，HttpOnly、SameSite=Lax），有效期 7 天。

## 1. 账号

### POST /api/auth/register

```json
{ "username": "demo", "password": "demo123" }
```

- 用户名：3-32 位，字母/数字/下划线/中文
- 密码：6-72 位

成功 `201`：

```json
{ "ok": true, "user": { "id": "...", "username": "demo" } }
```

失败：`400`（格式不对）、`409`（用户名已存在）。

### POST /api/auth/login

```json
{ "username": "demo", "password": "demo123" }
```

成功 `200`，同时设置 Cookie；失败 `401`。

### POST /api/auth/logout

成功 `200`，清除 Cookie 并删除会话。

### GET /api/auth/me

```json
{ "user": { "id": "...", "username": "demo" } }
```

未登录时 `user` 为 `null`。

## 2. 问卷（需要登录）

### GET /api/surveys

返回当前用户创建的问卷（不含题目）：

```json
{
  "surveys": [
    { "_id": "...", "title": "...", "status": "published", "slug": "YFttks6f", "createdAt": "...", "updatedAt": "...", "deadline": null }
  ]
}
```

### POST /api/surveys

```json
{ "title": "学习习惯调查" }
```

创建草稿，返回 `201` 和完整问卷对象（`questions` 为空数组）。

### GET /api/surveys/:id

返回自己的问卷详情。别人的问卷返回 `404`（而不是 403，避免泄露是否存在）。

### PATCH /api/surveys/:id

可改字段：

| 字段 | 说明 |
|---|---|
| `title` | 标题，不能为空 |
| `description` | 说明 |
| `anonymous` | 是否匿名 |
| `allowMultiple` | 是否允许重复填写 |
| `deadline` | ISO 时间字符串，或 `null` |
| `questions` | 题目数组；仅草稿可改，已发布返回 `409` |

`questions` 的结构：

```json
[
  {
    "qid": "q1",
    "type": "single",
    "title": "你现在读大几？",
    "required": true,
    "options": [
      { "key": "A", "label": "大一" },
      { "key": "B", "label": "大二" }
    ],
    "constraints": {},
    "jumps": [{ "when": { "option": "B" }, "to": "q2" }]
  }
]
```

不同题型的 `constraints`：

| 题型 | 可用字段 |
|---|---|
| `multiple` | `minSelect`、`maxSelect`、`exactSelect` |
| `text` | `minLength`、`maxLength` |
| `number` | `min`、`max`、`integer` |

`jumps[].when` 的写法：

| 题型 | 条件 |
|---|---|
| `single` | `{ "option": "A" }` |
| `multiple` | `{ "includes": "A" }` |
| `number` | `{ "op": "gte", "value": 60 }` 或 `{ "op": "between", "min": 18, "max": 30 }` |

`op` 支持 `eq`、`neq`、`gt`、`gte`、`lt`、`lte`、`between`。

### POST /api/surveys/:id/publish

发布前会校验：

- 至少一道题；
- 题号不重复；
- 选择题至少两个选项、选项 key 不重复；
- 跳转目标存在，且必须排在当前题之后。

成功 `200`；失败 `400`，`details` 里是具体原因。

### POST /api/surveys/:id/close

关闭问卷，之后不能再提交。

### DELETE /api/surveys/:id

只能删草稿，返回 `200`；非草稿返回 `409`。

## 3. 填写（需要登录）

### GET /api/public/surveys/:slug

返回已发布问卷的公开信息（不包含 `ownerId`）：

```json
{
  "survey": {
    "id": "...", "slug": "YFttks6f", "title": "...", "description": "...",
    "anonymous": false, "allowMultiple": true, "deadline": null, "status": "published",
    "questions": [ ... ]
  },
  "closedReason": null
}
```

草稿或不存在返回 `404`；已关闭或过期时 `closedReason` 为原因字符串。

### POST /api/public/surveys/:slug/responses

```json
{
  "answers": [
    { "qid": "q1", "value": "B" },
    { "qid": "q2", "value": ["A", "C"] },
    { "qid": "q3", "value": 15 }
  ]
}
```

服务端会：

1. 按答案重新计算跳转路径；
2. 只校验路径上的题目；
3. 必答题不能为空；
4. 校验选项、数量限制、文本长度、数字范围和整数；
5. 保存时把 `respondentId` 记为当前用户（匿名问卷记 `null`）。

成功 `201`：`{ "ok": true, "responseId": "..." }`

失败：

| 状态码 | 场景 |
|---|---|
| `400` | 答案不合法 |
| `401` | 未登录 |
| `404` | 问卷不存在 / 未发布 |
| `409` | 已关闭、已过截止、已经填过（不允许重复时） |

## 4. 统计（需要登录，仅创建者）

### GET /api/surveys/:id/stats

```json
{
  "survey": { "id": "...", "title": "...", "slug": "..." },
  "stats": {
    "total": 5,
    "generatedAt": "...",
    "questions": [
      {
        "qid": "q1", "title": "你现在读大几？", "type": "single",
        "totalAnswered": 5,
        "options": [{ "key": "A", "label": "大一", "count": 1 }]
      },
      {
        "qid": "q3", "title": "每周自学小时数", "type": "number",
        "totalAnswered": 4, "avg": 9.25, "min": 5, "max": 12, "values": [8, 12, 5, 12]
      }
    ]
  }
}
```

- 单选/多选：`options` 里带每个选项的计数，以及 `totalAnswered`（作答人数）。
- 文本：`values` 是全部文本答案。
- 数字：`avg`、`min`、`max`、`values`。

### GET /api/surveys/:id/stats/:qid

只返回一道题的统计，结构同上。

## 5. 页面路由

| 路径 | 说明 |
|---|---|
| `/login`、`/register` | 登录、注册 |
| `/dashboard` | 我的问卷 |
| `/surveys/new` | POST，创建草稿并跳到编辑页 |
| `/surveys/:id/edit` | 编辑问卷 |
| `/surveys/:id/stats` | 统计页 |
| `/survey/:slug` | 填写页 |
| `/survey/:slug/thanks` | 提交成功 |
