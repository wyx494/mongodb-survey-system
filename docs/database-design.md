# 数据库设计

本项目只使用 MongoDB，所有业务数据都落在 `survey_system` 库里。设计的目标不是“把表搬过来”，而是按 MongoDB 的文档模型重新想一遍：哪些数据总是一起读、哪些会无限增长、哪些需要独立查询。

## 1. 集合总览

| 集合 | 存什么 | 大致量级 | 访问方式 |
|---|---|---|---|
| `users` | 账号 | 与用户数相同 | 按用户名查、按 `_id` 查 |
| `surveys` | 问卷 + 题目（内嵌） | 与问卷数相同 | 按 `_id`、`slug`、`ownerId` 查 |
| `responses` | 每一份答卷 | 比问卷多得多，持续增长 | 按 `surveyId` 查、聚合统计 |
| `sessions` | 登录会话 | 与在线用户数相关 | 按 token 查，TTL 自动清理 |

四个集合分开，而不是塞进一个 `data` 集合，原因在最后两节展开。

## 2. users

```json
{
  "_id": ObjectId("..."),
  "username": "demo",
  "usernameLower": "demo",
  "passwordHash": "9f2c...",
  "passwordSalt": "3a1b...",
  "createdAt": ISODate("2026-10-22T09:00:00Z")
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `username` | string | 显示用，保留大小写 |
| `usernameLower` | string | 小写副本，用于大小写不敏感的唯一性 |
| `passwordHash` | string | `scrypt(password, salt, 64)` 的十六进制 |
| `passwordSalt` | string | 每个用户独立随机盐 |
| `createdAt` | date | 注册时间 |

**为什么单独存一份 `usernameLower`？** MongoDB 的唯一索引区分大小写，如果不存小写副本，`Alice` 和 `alice` 会被当成两个账号。用副本 + 唯一索引，比在查询时用 `$regex` 或排序规则（collation）更直接，也不依赖索引以外的逻辑。

## 3. surveys：题目内嵌

```json
{
  "_id": ObjectId("..."),
  "ownerId": ObjectId("..."),
  "slug": "YFttks6f",
  "title": "课程学习体验调查",
  "description": "几道小题，了解一下大家的学习习惯。",
  "anonymous": false,
  "allowMultiple": true,
  "status": "published",
  "deadline": null,
  "questions": [
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
      "jumps": [{ "when": { "option": "D" }, "to": "q4" }]
    }
  ],
  "schemaVersion": 1,
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("..."),
  "publishedAt": ISODate("...")
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `ownerId` | ObjectId | 引用 `users._id`，创建者 |
| `slug` | string | 8 位短码，拼成 `/survey/xxxx` |
| `status` | string | `draft` / `published` / `closed` |
| `anonymous` | bool | 是否匿名（答卷不记填写人） |
| `allowMultiple` | bool | 是否允许同一人重复填写 |
| `deadline` | date \| null | 截止时间 |
| `questions` | array | 题目数组，顺序即默认作答顺序 |
| `schemaVersion` | int | 结构版本，为第二阶段迁移预留 |

### 题目结构

| 字段 | 说明 |
|---|---|
| `qid` | 题目在问卷内的稳定标识，跳转规则用它指向目标 |
| `type` | `single` / `multiple` / `text` / `number` |
| `options` | 选择题的选项，`key` 用于答案存储，`label` 用于显示 |
| `constraints` | 多选的 min/max/exact、文本的 minLength/maxLength、数字的 min/max/integer |
| `jumps` | 跳转规则数组，`{ when, to }`，按顺序匹配 |

**为什么把题目内嵌进问卷？**

- 题目和问卷总是一起读：打开编辑页、发布校验、填写页取卷，都是一次查询拿全。
- 题目数量有上限（本项目限制 100 题），不会撞 16MB 文档上限。
- 修改题目是“整份问卷的一次更新”，天然原子，不需要跨集合事务。

**为什么 `jumps` 也放在题目里？** 跳转是题目的属性（这道题选 A 去第 5 题），放进去后，发布校验、填写时的路径计算、编辑器渲染都可以只遍历 `questions` 一个数组。

## 4. responses：答卷单独存

```json
{
  "_id": ObjectId("..."),
  "surveyId": ObjectId("..."),
  "respondentId": ObjectId("..."),
  "anonymous": false,
  "answers": [
    { "qid": "q1", "value": "B" },
    { "qid": "q2", "value": ["A", "C"] },
    { "qid": "q3", "value": 8 }
  ],
  "path": ["q1", "q2", "q3"],
  "submittedAt": ISODate("...")
}
```

| 字段 | 说明 |
|---|---|
| `surveyId` | 引用问卷 |
| `respondentId` | 填写人；匿名问卷为 `null` |
| `answers` | 只保存实际经过的题目 |
| `path` | 这次填写实际走过的题号顺序，方便核对跳转是否符合预期 |
| `submittedAt` | 提交时间，统计按时间排序时用 |

**为什么答卷不内嵌进问卷？**

1. 答卷数量无上限。一份热门问卷可能几千份，内嵌会让单个文档迅速膨胀，最终撞上 16MB 上限。
2. 写入并发。每次提交都在改同一个问卷文档，会造成写冲突和锁竞争；拆开后每份答卷是独立文档，写入互不影响。
3. 查询模式不同。统计只关心 `responses`，没必要把整份问卷（含题目）读出来。
4. 索引不同。`responses` 需要 `surveyId + submittedAt` 这样的索引，问卷文档不需要。

**为什么保存 `path`？** 这不是需求要求的字段，但它让“跳转是否真的生效”变得可验证：测试里可以直接断言 `path` 是 `["q1","q4"]`，出问题时也能快速定位是前端跳错还是后端算错。

## 5. sessions：TTL 自动过期

```json
{
  "_id": "8f3c2a...（随机 32 字节 hex）",
  "userId": ObjectId("..."),
  "createdAt": ISODate("..."),
  "expiresAt": ISODate("...")
}
```

会话没有放在 Node 进程内存里，而是写进 MongoDB：

- 服务重启不会把所有人踢下线；
- `expiresAt` 上建 TTL 索引，过期文档由 MongoDB 自动删除，不用写定时任务；
- 查会话就是一次 `_id` 查询，很快。

## 6. 索引

| 集合 | 索引 | 用途 |
|---|---|---|
| `users` | `{ usernameLower: 1 }` unique | 登录查询、注册查重 |
| `surveys` | `{ slug: 1 }` unique | 短链访问 |
| `surveys` | `{ ownerId: 1, createdAt: -1 }` | “我的问卷”列表 |
| `surveys` | `{ status: 1 }` | 按状态筛选（发布/关闭） |
| `responses` | `{ surveyId: 1, submittedAt: -1 }` | 按问卷取答卷、按时间排序 |
| `responses` | `{ surveyId: 1, respondentId: 1 }` | 判断“这个人是否已经填过” |
| `sessions` | `{ expiresAt: 1 }` TTL | 自动清理过期会话 |
| `sessions` | `{ userId: 1 }` | 按用户清理会话（预留） |

索引不是越多越好：每个索引都会增加写入成本。这里只建了查询真正会用到的组合，比如“我的问卷”用 `ownerId + createdAt` 的复合索引，而不是分别建两个单字段索引。

## 7. 集合校验器

除了应用层校验，四个集合都加了 `$jsonSchema` 校验器（见 `src/db.js`），约束字段类型、必填项和枚举值，例如：

- `surveys.status` 只能是 `draft` / `published` / `closed`；
- `users` 必须有 `username`、`passwordHash`、`passwordSalt`；
- `responses` 必须有 `surveyId`、`answers`、`submittedAt`。

这样即使有人绕过接口直接写库，也不会写出结构错误的数据。校验器在 `npm run init-db` 和每次启动时通过 `collMod` 幂等地更新。

## 8. 为什么不用关系型结构

如果硬套关系型模型，大概会拆成 `users`、`surveys`、`questions`、`options`、`responses`、`answers` 六张表，一次填写要跨 3-4 张表关联，统计要写多层 `JOIN + GROUP BY`。

这个项目的实际情况是：

- 题目类型异构（单选/多选/文本/数字），字段不一样，关系型要么建很多空列，要么拆子表；
- 题目、选项、答案天然是嵌套结构，文档模型可以直接表达；
- 统计需要“按题目分组、按选项展开”，聚合管道比多表 JOIN 更直观；
- 数据量不大，但写入并发和结构变化是真实存在的（第二阶段还要改需求）。

所以选 MongoDB 不是为了“新”，而是它的文档模型和这个问题的形状更贴合。

## 9. 哪些地方刻意没有冗余

- 答卷里不冗余存题目文字和选项文字，只存 `qid` 和选项 `key`，显示时回问卷里取。这样改题目文案不会影响历史答卷的统计口径（不过本项目发布后锁定题目，见下）。
- 问卷里不冗余存答卷数量，统计时用 `countDocuments` / 聚合现算，避免计数器和真实数据不一致。
- 用户名不在问卷里冗余，列表页需要时再查（当前页面只显示自己的问卷，用不到）。

## 10. 一致性上的几个约定

| 场景 | 做法 | 理由 |
|---|---|---|
| 发布后改题目 | 禁止（返回 409） | 否则已收回的答卷和题目对不上，统计会失真 |
| 匿名问卷 | 仍要求登录，但 `respondentId` 存 `null` | 需求同时要求“填写需登录”和“允许匿名”，这样解释两者不冲突 |
| 重复填写 | 问卷级开关 `allowMultiple` | 需求写的是“同一个人填写多次（如果允许）” |
| 截止时间 | 提交时校验 | 到点后拒绝新答卷，已收的不受影响 |
| 跳转 | 只能向后，发布前校验 | 防止环，也避免“往回跳”导致同一题重复作答 |

## 11. 统计用的聚合

单选题按选项计数：

```js
db.responses.aggregate([
  { $match: { surveyId } },
  { $unwind: "$answers" },
  { $match: { "answers.qid": "q1" } },
  { $group: { _id: "$answers.value", count: { $sum: 1 } } },
]);
```

多选题要多展开一层（答案本身是数组）：

```js
{ $unwind: "$answers" },
{ $match: { "answers.qid": "q2" } },
{ $unwind: "$answers.value" },
{ $group: { _id: "$answers.value", count: { $sum: 1 } } }
```

数字题直接在一次分组里算平均和最值：

```js
{
  $group: {
    _id: null,
    count: { $sum: 1 },
    avg: { $avg: "$answers.value" },
    min: { $min: "$answers.value" },
    max: { $max: "$answers.value" }
  }
}
```

“作答人数”没有用选项次数求和，而是单独 `countDocuments({ surveyId, "answers.qid": qid })`。原因是多选题一个人会贡献多次选项计数，求和会把人数算多（这个问题在开发时实际踩过，见报告）。

## 12. 为第二阶段留的口子

- `schemaVersion`：将来结构变化时可以做迁移或兼容读取。
- 题型用字符串枚举，新增题型只需要加分支，不动集合结构。
- 跳转规则是数组，后续可以扩展成更复杂的条件（与/或、组合条件），不影响已有数据。
- 统计按题目循环生成，新增题型只需要补一个聚合分支。
