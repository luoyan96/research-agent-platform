# B1 人的协作：服务联调包

基线 `f00f43c6b3610d3d67083eca9864ef66f616da92`，分支 `backend/b1-collaboration`。从 G0 组合基线建立独立 worktree；G0 旧报告中的 F0-01 未关闭是历史记录，不是当前阻塞。

契约 **0.2.0**：独立提交 `44deea7b245081fe090767f33830f4d83a26a41e`，包 `@research-agent-platform/contracts`。源 Schema、[OpenAPI](../../packages/contracts/openapi.json)、[13 个语义场景和全部端点样例](../../packages/contracts/examples.json)、[协议](../../packages/contracts/protocol.md)同源。服务实现起点 `1c762ae62f805473cb00434e5bf091179b0c0ed7`；最终采用提交见阶段报告及后续修正，不能只拿早期服务提交冒称最终验证。

## 启动、迁移、账号和数据

从自己的 worktree 根目录运行，Node ≥22.19，建议与本次验证相同的 Node 24.19.0、pnpm 11.21.0。没有新增依赖，沿用已固定 Fastify 5.12.5 / Zod 4.1.12 / SQLite。

```powershell
pnpm install --frozen-lockfile
pnpm build
$env:NODE_ENV = 'development'
$env:APP_ORIGIN = 'http://127.0.0.1:4175'
$env:PORT = '3100'
pnpm db:migrate
pnpm db:seed
pnpm db:credentials
pnpm api:start
```

另一个终端设置相同 APP_ORIGIN 后可选执行 `pnpm seed:collaboration`，通过真实登录和 HTTP 建立三项合成任务：A 自承担、邀请 B、开放 B/C 认领。重复执行使用固定幂等 key，不重复建立任务，也不重置已经接受或交付的进度。要完全独立的新数据集，显式使用新的 DATABASE_PATH/BLOB_ROOT，不删除他人数据或重置共享库。

`db:seed` 可重复，仅建立合成实验室和 A/B/C；`db:credentials` 默认生成 `.runtime/test-credentials.json`，内容是数组，每项含 memberId、username、password。成员对应 member_A/B/C；用户名 synthetic_a/b/c；密码每次首次准备时随机生成，仓库和终端不打印、不保存固定密码。用户可在自己编辑器里打开本地文件取得测试密码，不把文件、截图或密码发到 PR/报告。设置 TEST_CREDENTIALS_FILE 可另选私有路径。再次运行同一文件会校验原密码并保留已有会话；主动改文件中的密码再运行会更新 hash、撤销该成员所有会话。文件仅限 development/test；production 禁止这两个测试 seed 和测试凭据命令。

| 配置名 | 用途 |
| --- | --- |
| NODE_ENV | development/test/production；禁止身份绕过和 fixture 开关 |
| HOST / PORT | 默认 127.0.0.1 / 3100 |
| APP_ORIGIN | 浏览器看到的精确 origin。必须匹配协议、主机、端口；生产要求显式 HTTPS |
| DATABASE_PATH | 默认当前根目录 .runtime/platform.sqlite；生产要求绝对路径 |
| BLOB_ROOT | 默认 .runtime/blobs；B1 只做探针，不提供附件 API |
| TEST_CREDENTIALS_FILE | 仅本地凭据命令/合成任务 seed 读取，不是登录绕过 |
| API_URL | 仅 seed:collaboration 的本地服务地址，默认 http://127.0.0.1:3100；仅允许 loopback |

前端在自己的 4175 端口运行，代理 `/api` 到后端 3100；不要添加允许任意来源的 CORS。若前端端口不同，同步 APP_ORIGIN。使用 localhost 与 127.0.0.1 也必须一致。浏览器 fetch 保持同源 cookie；命令行客户端保留 Cookie 并显式发 Origin。

001 保持原 checksum。002 增加方案/版本、任务/ACL、分配、交付/验收、事件、签名密钥、登录限速；003 补齐邀请接受/拒绝及其可空 comment 的不可重复决定记录。所有迁移显式执行；旧 B0 文件可增量升级且保留成员。不要编辑已应用 SQL 或删除 checksum。readiness 返回 503 时先检查迁移、写权限和文件卷，不用 live=200 代替 readiness。

## 认证与调用方式

1. POST `/api/v1/auth/login`，JSON `{username,password}`，Origin 必须匹配。验证 scrypt hash 后签发 HttpOnly、SameSite=Lax 的 rap_session Cookie；生产加 Secure。凭据错误统一 401。
2. GET `/api/v1/auth/session`，带 Cookie，得到 `{data:{member,csrfToken,expiresAt}}`。服务重启后数据库会话继续有效；绝对12小时到期。
3. 所有副作用请求带 Origin 和 `X-CSRF-Token`（登录除外）；业务命令再带 `Idempotency-Key`。修改时带 expectedVersion。不要发送 actorId/ownerId/status，严格 Schema 拒绝未知字段。
4. POST `/api/v1/auth/logout`，正文 `{}`；校验 CSRF 后撤销数据库会话并清 Cookie。禁用账号、过期/撤销会话即401。

Node 原生 [scrypt / timingSafeEqual](https://nodejs.org/api/crypto.html)负责密码校验。每账号10次/15分钟、每来源IP40次/15分钟登录尝试在库中累计，跨服务进程有效，429带 Retry-After:900；测试重试不要无限重新登录。数据库仅存 session/CSRF hash；CSRF 用持久随机密钥 HMAC 派生，换密钥需要同步撤销旧会话。生产入口 TLS/账号正式供应是部署责任，本批次没有部署、注册、找回密码或管理控制台。

## 手工协作最短路径

以下字段均为合成示例，Cookie、CSRF、Idempotency-Key 由客户端实际产生/获得。完整请求响应可使用 routes.<name>.request/response 校验；无需复制 DTO。

POST `/api/v1/plans`：

```json
{
  "labId":"lab_synthetic",
  "goal":"整理合成材料",
  "proposedItems":[{
    "id":"item_1","title":"整理清单","goal":"仅接受后可见的任务说明",
    "deliverable":"文本材料清单","acceptanceCriteria":"缺失项明确",
    "allocation":{"kind":"invitation","memberId":"member_B"},
    "dependencies":[],
    "schedule":{"suggested":null,"hardDeadline":null,"committed":null,"estimatedHumanHours":null,"checkpoint":null},
    "inputArtifactIds":[],"budget":null
  }],
  "unresolvedQuestions":["交付时间待确认"]
}
```

创建返回201和 `{data:Plan}`，此时无任务、有效分配或派发。PATCH `/plans/{id}` 发送完整上述输入加 expectedVersion，只允许 owner 修改 draft。POST `/plans/{id}/confirm` 发送 `{expectedVersion}`；返回 `{data:{plan,taskIds}}`。任务 planVersion 记录被确认的草案版本，确认后的 plan.version 自增；不能用返回的确认后版本替换原 key 请求中的版本。同 key 同负载返回原结果；旧版本用新 key 返回409，已确认方案不能 PATCH。

B 用 GET `/tasks?labId=lab_synthetic&scope=mine` 找待处理邀请，或者 GET `/tasks/{id}`。接受前只返回安全 TaskSummary：

```json
{
  "projection":"claim_summary",
  "id":"task_example","labId":"lab_synthetic","title":"整理清单",
  "summary":"文本材料清单","deliverable":"文本材料清单","acceptanceCriteria":"缺失项明确",
  "schedule":{"suggested":null,"hardDeadline":null,"committed":null,"estimatedHumanHours":null,"checkpoint":null},
  "initiatorId":"member_A","reviewerId":"member_A","version":1,
  "allowedActions":["decide"],
  "pendingInvitation":{"id":"invitation_example","version":1,"scope":"文本材料清单","schedule":{"suggested":null,"hardDeadline":null,"committed":null,"estimatedHumanHours":null,"checkpoint":null}}
}
```

POST `/invitations/{pendingInvitation.id}/decision`：`{expectedVersion:pendingInvitation.version,expectedTaskVersion:summary.version,decision:"accepted",comment:null}`。返回 Assignment；随后重读 task 获完整 `{task,assignments,deliverables,executions:[]}`。拒绝用 declined；拒绝保留分配及决定记录，任务变 unassigned，B 失去摘要读取；A 可在同一 task ID 上再次发邀请。决定 comment 持久化供后续审计，本轮不扩展 B2 事件查询。

开放认领将 allocation 换为 `{kind:"claim",audience:"lab_members",summary:"明确允许公开的摘要"}`。同实验室成员看到摘要，POST `/tasks/{id}/claim` 携 `{expectedVersion}`；数据库只允许一个 accepted lead，竞争者409 ALREADY_CLAIMED。认领后重读 task，不将摘要当完整 Task。

承接后 POST `/tasks/{id}/start` 携最新 expectedVersion。POST `/tasks/{id}/deliverables` 携 `{expectedVersion,summary:"合成文本成果",artifactRefs:[],sources:[]}`；返回201 Deliverable，task进入in_review。A POST `/deliverables/{id}/review`：

```json
{"expectedVersion":1,"expectedTaskVersion":4,"revision":1,"decision":"changes_requested","comment":"请补充缺项依据"}
```

以上版本数只是示例，始终取最新任务和交付值。退回后 B 在 changes_requested 可直接重新提交，也可先 start；新交付 revision 自增。A 验收最新交付时 decision=accepted，绑定该 id/revision/version 后才将任务设 completed。验收不触发反馈共享，不要求填写私人方法。已提交同 key 的重试返回原交付/验收结果，不新增版本。状态不合法409 INVALID_STATE，版本不符409 VERSION_CONFLICT；任务与执行仍分开，没有 AI execution 被创建。

## 错误、权限、刷新和边界

所有业务错误 `{error:{code,message,requestId}}`；不含 SQL、内部路径或隐藏私人字段。前端按 code 处理，不匹配 message 文本。401重新登录；403停止操作；404统一“不可访问或不存在”；409重新读取比较，不能静默换 key/version；410丢弃分页游标重取；429遵守 Retry-After；503保留失败/不可用状态。

未知 actorId 不是权限入口：在正文中会400。C 猜任务/方案/邀请/交付 ID 不能获取内容；未接受邀请不返回 goal、planId、依赖、附件引用或其他分配详情。成员公开承诺也只查询当前读取者拥有 full ACL 的任务。私有能力未实现也不会被查询来解释公共缺口。

每次请求在服务端复核会话、当前ACL和操作角色；重放成功请求也先复核权限，再读幂等缓存。BEGIN IMMEDIATE 包围业务版本、事件、outbox、幂等结果和响应校验，失败一起回滚。确认 `(plan_id,item_id)` 唯一，accepted lead 部分唯一索引，交付 `(task_id,revision)` 唯一，验收与邀请决定各有唯一记录。网络断线重试原 key/原负载；数据库锁超时503可退避原请求。

GET任务列表先在SQL限定ACL，分页默认30、最多100。B1签名游标绑定用户/过滤器/全局数据revision，15分钟有效；任何业务写入使旧页410，保守地要求刷新，避免前后页混合版本。未发生写入时跨进程/重启可继续分页。事件只落库，事件查询/总览/附件/变更/取消/退出留待B2；不在本轮新增这些功能。

AI 建议明确不可用：合法认证的 POST /planning-requests 返回503 MODEL_UNAVAILABLE；可手工编辑草案。包含 public_agent 的草案可保存，但确认整体返回 CAPABILITY_UNAVAILABLE 且不创建任务。Harness 保持“固定依赖安装阻塞、真实调用未验证”，未调用/修改上游适配。

输入附件和附件型来源当前 NOT_IMPLEMENTED，纯文本和 note/url 来源可提交但不冒称引用已验证。任务类型暂为 other（PlanInput 无类型字段）；日期默认未知，不能把建议或他人时间填入 committed。草案依赖拒绝环，开始前检查前置已完成；B2才处理更完整的依赖变更/失效传播。每任务最多100条历史分配、100版交付；需要更多历史时应在后续契约增加分页。本机SQLite WAL限定同机本地卷；外部通知outbox只保存意图，不声称已发通知，不启动worker。

## 验证与集成

```sh
pnpm check:b1
pnpm run ci
```

B1 专项是真实密码+两个独立HTTP进程+同一SQLite文件，覆盖A1–A5、失效会话/CSRF、跨进程锁和幂等、强制事务失败、重启后读取及重试，以及本地凭据/合成任务命令。根CI继续保留后端真实进程检查和前端生产fixture隔离检查。

升级0.2.0需同步严格Schema消费者；前端F0现有契约测试仅更新版本断言，没有修改F0页面或私建前端业务实现。根package.json只新增B1命令，workspace/锁文件/Vitest发现规则继续使用G0集成结果。最终前后端共同基线发布、组合验收和PR集成由总体验收任务处理；本分支不合并、不部署、不进入B2。
