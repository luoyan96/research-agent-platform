# B2a 前端联调包 · contracts 0.3.0

共同基线：`5b51290e84307c1ce1207e75f47e7d6f38ba3516`，包含 G1 受测代码及 2026-09-29 规划。分支 `backend/b2a-discovery`。确切契约与服务提交见 [阶段报告](reports/B2a-backend-2026-09-29.md)。本包只交付服务；F2a 浏览器联调、完整 G2 尚未通过。

## 启动与合成账号

Node ≥22.19（本轮 Node 24）、pnpm 11.21.0；沿用 SQLite WAL 和真实密码 Cookie 会话。使用独立运行目录，不能指向他人的测试库。旧库升级需先停自己的服务并备份数据库（WAL 数据须完整纳入备份），再迁移；不要删除库。004 只新增自报可用时间表、草案索引、快照失效触发器，不重写 B1 历史。migrate 可重复执行，重复执行不失效已有快照。

```powershell
pnpm install --frozen-lockfile
pnpm build
$env:NODE_ENV='development'
$env:DATABASE_PATH="$PWD/.runtime/b2a/platform.sqlite"
$env:BLOB_ROOT="$PWD/.runtime/b2a/blobs"
$env:TEST_CREDENTIALS_FILE="$PWD/.runtime/b2a/test-credentials.json"
$env:HOST='127.0.0.1'
$env:PORT='3100'
$env:APP_ORIGIN='http://127.0.0.1:4175'
pnpm db:migrate
pnpm db:seed
pnpm db:credentials
pnpm api:start
# 另一个终端沿用 NODE_ENV、APP_ORIGIN、TEST_CREDENTIALS_FILE
$env:API_URL='http://127.0.0.1:3100'
pnpm seed:discovery
```

`db:credentials` 在忽略的运行目录生成随机 A/B/C 密码，不输出密码。自行在本地读取凭据文件用于登录，禁止提交或贴入日志。已有凭据文件复用，密码不被 seed 重置。`seed:discovery` 经真实 HTTP 创建 A/B 各自草案、A 的待开始/进行中任务、B 待回应邀请/待验收/已验收任务及开放认领；C 只见开放摘要。无任务日期、可用时间和 AI 成功的填充。重复 seed 使用同幂等 key，不追加副本或倒退已有进展；只用于开发合成环境。可按下面接口为 B 自报时间。

认证沿用 [B1 联调包](b1-handoff.md)：POST `/api/v1/auth/login`，GET `/auth/session` 取得 CSRF；写请求携 Cookie、精确 Origin、`X-CSRF-Token` 和 `Idempotency-Key`。前端同源代理，不启用身份绕过或任意 CORS。无有效登录 401，不能用 actorId/ownerId 选择主体。

## 精确端点与兼容性

唯一类型为 [共享 routes](../../packages/contracts/src/routes.ts)、[models](../../packages/contracts/src/models.ts)，机器可读 [OpenAPI](../../packages/contracts/openapi.json) 与 [examples](../../packages/contracts/examples.json)。路由键及新增内容：

| route | HTTP（统一 /api/v1 前缀） | 行为 |
| --- | --- | --- |
| plans | GET /plans?status=draft&limit=30 | 只列本人本 lab；默认 draft，确认后移出；confirmed/superseded/all 显式查历史；无 ownerId 参数 |
| getPlan | GET /plans/{id}?snapshot=... | owner-only 完整草案；列表是 PlanSummary，不能当作编辑正文 |
| overview | GET /labs/{id}/overview?scope=lab 或 mine | 权限内全量 SQL 四列计数、可见交付版本计数、本人待回应/验收计数、受阻任务 ID、快照时刻 |
| tasks / task | GET /tasks 与 /tasks/{id} | 既有查询增加 snapshot；安全摘要增加实际 visibleStatus，用 Task.status 或 TaskSummary.visibleStatus 按共享 taskColumns 渲染 |
| actionItems | GET /labs/{id}/action-items?kind=all&limit=30 | 本人的 invitation_response / deliverable_review；支持 kind 筛选，包含操作所需的当前任务/邀请/交付版本 |
| members / me | GET /labs/{id}/members 与 /me | snapshot、授权当前承诺、自报 availability 与 freshness |
| availability | PATCH /me/availability | expectedVersion + availability（或 null 清空）；服务写 updatedAt，成员版本递增、幂等 |

0.3.0 在原模型上新增可选 `TaskSummary.visibleStatus`、`Member.availabilityStatus`、`Member.visibleCommitmentsTruncated` 和旧读取响应的 `snapshot`，用于保留已保存 0.2 fixtures/幂等响应的可解析性。**本服务的新读取始终返回这些字段**；旧字段形状、确认及协作命令不变。0.2 游标升级后需丢弃重取。旧 0.2 strict Schema 会拒绝新增字段，必须整体升级 workspace 包；不要在旧客户端静默拼 DTO。F1 界面不改动，仅更新其契约版本断言。

以前尚未实现的 overview 去掉 `members` 内嵌上限列表；成员从独立分页端点读取同一 snapshot。增加 `blockedTaskIdsTruncated` 和 `pendingActions`。受阻 ID 仅完整授权任务，最多 100 个，超出明确标记并通过 tasks?status=blocked 分页。Member 当前承诺最多 100 个，`visibleCommitmentsTruncated=true` 时不可当成全部；可用同快照 tasks(scope=lab) 分页后按完整详情读取其余获准承诺。不会用可见任务数推断个人负荷或缺失承诺。

四列使用原映射，cancelled 不入列但可在任务列表显式查询。scope=mine 包括本人发起、牵头、已授权参与、验收、待接受邀请；scope 不扩大权限。摘要授权可见任务状态与必要摘要，但交付统计、受阻细节及成员承诺只从 full ACL 任务计算。`submittedDeliverables` 是全部可见提交版本数（包括已退回/已验收版本），`acceptedDeliverables` 是有 accepted 验收的版本数，不是自动完成比例。

可用时间是成员主动公开给本 lab 的自报资料。`availability=null` / status=unknown 表示未报；日期按本人填写的 IANA 时区、含首尾日判断 upcoming/current/expired；过期保留原资料以供修改，UI 应显示待更新，不能继续解释为当前可用。hours=null 是未知，0 是明确零。所有判断使用 snapshot.at，跨请求不会因午夜边界自相矛盾。成员任务承诺只计 accepted 且任务非 completed/cancelled；pending、declined 不计入。未知任务日期保持 null。

## 同一快照与错误处理

每次真实读取在同一 SQLite 事务中鉴权、SQL 裁剪、统计或分页。先读取 overview（或任一支持的查询），保存顶层 `snapshot={token,at,expiresAt}`；其余 tasks/detail/plans/members/action-items/me 请求传 `?snapshot=<token>`。下一页使用原筛选和 limit、返回的 nextCursor；游标内带原快照，可省略显式 snapshot。plans/tasks/action-items 按创建时刻倒序、ID 倒序；members 按 ID 正序，创建时间相同不漏不重。

token 绑定真实主体、lab、数据库 revision 与读取时间，15 分钟有效；签名与 revision 持久化，两进程及重启后可共用。同 lab 下也不能复用另一个账号的 token。无业务变化时一整组请求一致；任何业务数据/ACL 变动后 token/cursor 返回 HTTP 410 `CURSOR_EXPIRED`，丢弃旧组合、重新取得 overview 和各页；不会返回旧数据伪装最新。当前采取全库保守失效，别人的业务更新也可能要求重取；不暴露原始 revision 数字。认证/健康探针本身不失效快照，管理员直接改业务表也由触发器失效。没有 token 的请求读取各自最新数据，不保证跨请求原子一致。

401 清理显示并要求真实登录；403 不允许操作；无权枚举资源 404 `NOT_FOUND`；旧 expectedVersion 409 `VERSION_CONFLICT`；同 key 改正文 409 `IDEMPOTENCY_CONFLICT`；错误只有 code/message/requestId，不带私有标题/内部路径。网络断开没有成功响应，保留待重试状态；不要回退 fixture 或合并不同快照的计数。快照有效也不能作为执行授权；所有写命令重新鉴权及版本校验。可用时间写回后重新 GET /me，不将历史幂等响应里的 freshness 当作最新值。

```json
{"expectedVersion":1,"availability":{"from":"2026-10-01","to":"2026-10-03","timezone":"Asia/Shanghai","level":"limited","hours":null,"updatedAt":"2026-09-29T00:00:00Z"}}
```

上述日期仅为合成请求，服务不会推断为真实成员的计划；updatedAt 由服务覆盖。错误样例：

```json
{"error":{"code":"CURSOR_EXPIRED","message":"Request could not be completed.","requestId":"synthetic_request"}}
```

## 验证与停止点

`pnpm check:b2a` 包含 A9a 真实进程/文件 SQLite 检查与 G1 A1–A5 回归、基础迁移检查；先 `pnpm build`。`pnpm run ci` 保留后端真实进程与前端生产隔离。根 Vitest 自动纳入 apps/api/tests/discovery.spec.ts；没有 mock 仓库或 mock HTTP 成功。

本轮不新增搜索、附件、依赖协调、退出/转交、变更/撤权命令；不改 F1 操作界面。快照失效中的 ACL 直接写入仅用于权限边界测试，不代表 B2b 撤权流程已实现。F2a 浏览器刷新/断线提示和完整 G2 待集成人复核。Harness 最近记录仍为固定依赖安装阻塞、真实调用未验证，本轮没有重新核查上游，不宣称 AI 接通。没有部署、合并或启动 B2b/B3。
