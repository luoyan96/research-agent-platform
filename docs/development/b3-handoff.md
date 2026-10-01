# B3 契约与服务交接 · 0.5.0

共同基线 `98bef3bbab897b7d27b1507cb0c557299dab56b6` 包含 G2 受测代码、报告与最终 CI 数据准备修复。本文件先随共享契约提交；服务与真实调用证据随后补充，不能据此宣布 G3 通过。

## 先行契约与兼容性

唯一类型仍在 packages/contracts。业务契约 0.5.0，新结构化回复 replyVersion=1.0.0；旧 strict 客户端整体升级。既有 Task、Plan、Assignment 状态不复制。运行为 RunRecord，独立于业务任务；usage 的未报告字段为 null，费用未知不能填零。

planning-requests 增加 auto/draft/progress/find_work 意图、可选同一草案 ID/版本、授权任务 ID。draft 是模型建议，只保存本人未确认草案；禁止覆盖 confirmed 方案或已接受任务。修改承诺仍走 G2 协商。progress/find_work 的任务、版本、动作和时刻由服务重新读取，模型不能填写进度事实。auto 可由模型分类；明确的 progress/find_work 无需调用模型即可读取真实服务。候选仅限授权集合，截断明确；不依据数量推断负荷，未填专长、可用时间和日期保持未知。

AdaptiveReply 只含受控 Schema、服务校验的对象版本和允许动作；无 HTML/代码执行。读取历史请求也重新校验输入和对象权限，不重放旧授权材料。无结果返回空列表及缺口，不编造任务或能力。

run 经本人明确授权创建执行意图；public_agent 方案仅可用已启用公共能力，由确认者本人担任人类责任人，不替别人承诺。未确认草案不派发。现有通知 outbox 不作为执行队列扫描；新增专用执行队列。getRun/cancelRun/retryRun/submitCandidate 使用共享资源版本、权限与幂等规则。成功仅产生带引文的可检查候选，承接者显式提交候选后仍须指定验收人验收。

本批首个内置公共能力只分析当前任务下已授权 UTF-8 文本附件：项目指标/证据清单。输入记录附件 ID/版本/哈希；引文必须匹配授权原文。没有引用支持的事实不能标为材料已支持；原文仍需人审，匹配引文不等于科学事实已被外部核实。PDF OCR、搜索、任意代码和全部十项 Skills 不在本批。

## 迁移与执行计划

新增 006，保留 001—005 及 G2 数据：持久规划请求、运行/尝试、能力配置、任务权限代次和专用执行意图；任务、能力、输入、授权版本都参与派发与写回检查。任务取消/撤权/关键变化立即使旧运行失效；晚到输出不可覆盖。租约过期的运行标 interrupted，不盲目重放不确定的模型调用；排队任务可在重启后重新领取。已知可重试失败有次数/时间/总 token 上限，未知用量不自动重试；等待材料明确 waiting_input。

迁移前备份 SQLite/WAL 与附件目录，停止自身服务，执行 `pnpm build`、`pnpm db:migrate`；再次执行检查校验和，不重置旧库。已验证真实有 G2 数据的 001—005 数据库重复升级、旧表逐行保留及原会话读取附件。

Harness 实际采用官方 `0.2.0-rc.1`（`0.2.0-rc.2` 独立安装成功，但根仓库发布时间限制尚不允许；保留原安全规则）；使用公开接口，所有模型调用位于服务端，不挂载 shell、私人方法、本地 ArtifactStore 工具或共享目录。受限模型执行与有数据库权限的服务协调分离；模型不能按材料内容选择任意工具。凭据不写入 Git、请求、记录或日志。真实调用需要 DEEPSEEK_API_KEY；实际已通过本批真实服务专项，逐项结果见阶段报告，不以 CI 替代。


## 启动、账户与配置

Node >=22.19（本次24.19）、pnpm11.21。全部命令在独立 checkout 根运行。先 `pnpm install --frozen-lockfile`、`pnpm build`。本地 `.env` 必须被 Git 忽略，配置如下；密钥只在私有文件/进程环境，以下不含密钥值：

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3100
APP_ORIGIN=http://127.0.0.1:4175
DATABASE_PATH=.runtime/platform.sqlite
BLOB_ROOT=.runtime/blobs
TEST_CREDENTIALS_FILE=.runtime/test-credentials.json
B3_AI_ENABLED=1
DEEPSEEK_MODEL=deepseek-v4-flash
```

另在同一私有文件设置 DEEPSEEK_API_KEY。DEEPSEEK_BASE_URL 默认不配置，使用官方 provider；不要填空 URL 或将 key 传到浏览器。命令中 `.env` 可替换为授权文件绝对路径；API 和 worker 必须使用相同数据库/附件路径、AI 开关与模型配置。

```powershell
node --env-file=.env apps/api/dist/manage.js migrate
node --env-file=.env apps/api/dist/manage.js migrate
node --env-file=.env apps/api/dist/manage.js seed
node --env-file=.env apps/api/dist/credentials.js
node --env-file=.env scripts/check-harness-live.mjs
node --env-file=.env apps/api/dist/capability-config.js enable lab_synthetic member_A
node --env-file=.env apps/api/dist/main.js
# 独立终端运行，可启动两个 worker 验证租约；每进程顺序执行。
node --env-file=.env apps/api/dist/worker.js
```

无凭据时保留 B3_AI_ENABLED=0，手工人类协作和授权 progress/find_work 仍可用；draft/auto 返回 MODEL_UNAVAILABLE。配置启用但凭据无效时请求可排队，worker 会保存实际错误；“available”仅表示能力配置，不能据此标模型调用成功。

`db:credentials` 生成随机 A/B/C 密码，仅写 TEST_CREDENTIALS_FILE，不打印；测试用户名 synthetic_a/b/c。按 B1 的 POST /auth/login 密码认证，GET /auth/session 取 csrfToken，后续写请求带精确 Origin、会话 HttpOnly cookie、X-CSRF-Token 和稳定 Idempotency-Key。不同新操作使用新幂等键，重试同一操作使用原键和原 body。绝不传 actorId。

启动 API 后设置 API_URL（例如 http://127.0.0.1:3100），APP_ORIGIN 与服务一致：

```powershell
node --env-file=.env scripts/seed-b3-demo.mjs
node --env-file=.env scripts/seed-b3-demo.mjs
# 下面两条会真实调用模型并消耗配额；使用独立合成数据库。
node --env-file=.env scripts/check-b3-live.mjs
# 本命令自行启动本地 HTTP 服务及 worker，期间停止该测试库其他 worker。
node --env-file=.env scripts/check-b3-resilience-live.mjs
```

seed 可重复，不付费执行；创建本人合成任务和带出处文本，包括作为数据处理的恶意指令样本。live 检查每次新建合成任务，默认把受检记录保留在 `.runtime`；不是 seed，不能称零消耗。恢复专项会故意调用不存在的模型、取消/撤权、强制终止自己的 worker，并等待真实租约过期。不得对真实研究库运行这些专项。

## 前端接口与错误

以下接口路径均省略共同前缀 `/api/v1`。类型入口 [models.ts](../../packages/contracts/src/models.ts)、路由入口 [routes.ts](../../packages/contracts/src/routes.ts)、[OpenAPI](../../packages/contracts/openapi.json)、[可验证合成样例](../../packages/contracts/examples.json)。客户端直接引用 @research-agent-platform/contracts 0.5.0，不另写状态机。升级影响：新 PlanningRequest/RunRecord 与 reply Schema；未知 usage 可为 null；待办 discriminant 新增 execution_attention，总览 pendingActions.executionAttention。现有前端仅补该标签兼容，不实现 F3 页面。

| 接口 | 输入/输出及使用方式 |
| --- | --- |
| POST /planning-requests | labId,prompt,intent,plan(可选 id/version),taskIds,inputArtifactIds,budget；返回202持久 request；明确 progress/find_work 可立即 ready |
| GET /planning-requests/:id | 仅本人，轮询 queued/running/draft/ready/failed/interrupted/cancelled；返回服务校验的 reply，而非任意模型渲染指令 |
| POST /planning-requests/:id/cancel | expectedVersion,reason；fence 使晚到输出无效 |
| GET /public-capabilities | 当前 lab 已配置内置能力及 available/unavailable；不枚举私人能力 |
| POST /tasks/:id/runs | expectedVersion,capability(id/version/visibility),budget,inputArtifactIds；当前承接者显式授权，202 RunRecord |
| GET /runs/:id | 当前完整任务权限；历史记录也重验 ACL；candidate 只是候选 |
| POST /runs/:id/cancel | expectedVersion,reason；发起人/承接者取消 |
| POST /runs/:id/retry | expectedVersion,expectedTaskVersion,inputArtifactIds；原预算/最多3次，不接受未知用量的同 run 重试 |
| POST /runs/:id/submit | expectedVersion,expectedTaskVersion；重新授权并产生真实交付版本，之后仍须原验收接口指定版本验收 |

完整请求形状（ID 来自真实授权响应，不复制占位 ID）：

```json
{"labId":"lab_synthetic","prompt":"根据授权材料拟一项指标核对任务，未给的日期保持未知","intent":"draft","plan":null,"taskIds":[],"inputArtifactIds":[],"budget":{"maxTokens":100000,"maxSeconds":120}}
```

修改时仍用该接口，plan={id:原planId,version:当前版本}；服务只写同一未确认草案，不变更已确认/已接受任务。progress 或 find_work 用同一 Schema，taskIds 可限定授权对象，reply.origin=service_facts；无匹配返回空列表及 gaps，不能拿模型文本当状态。

```json
{"expectedVersion":2,"capability":{"id":"text-evidence-checklist","version":1,"visibility":"lab_public"},"inputArtifactIds":["artifact_from_upload"],"budget":{"maxTokens":100000,"maxSeconds":120}}
```

响应统一 `{data: ...}`；planning 成功状态为 draft/ready，公共运行成功状态为 succeeded。reply 的 actions 和 ref 只用于展示本次允许动作；提交仍带最新版本并处理冲突。任何错误先按共享 ErrorResponse 解析，不把网络成功等同业务完成。典型错误：VERSION_CONFLICT（409，刷新对象）、IDEMPOTENCY_CONFLICT（409，同键不同请求）、NOT_FOUND（404，包括不可见材料）、MODEL_UNAVAILABLE/CAPABILITY_UNAVAILABLE（503）、INVALID_STATE（409，如未知用量拒绝重试）。模型/provider 失败保存在运行 failure，例如 MISSING_CREDENTIAL、INVALID_REQUEST、INVALID_MODEL_OUTPUT；不返回原始 provider 错误、密钥或内部路径。

## 执行、迁移与人审边界

公共方案确认会建立本人责任承诺与 waiting_input 运行；不替别人接受。当前附件必须属于已存在任务，因此确认前不支持引用其他任务附件自动执行。上传附件改变任务版本并使旧等待运行失效；前端以最新任务/能力版本显式 POST run，重新授权材料。不要悄悄修改旧运行的输入绑定。

006 在一个事务保存执行意图、版本状态、历史及确认结果；历史通知 outbox 保留但不作为运行派发。worker 租约15秒、心跳1秒；排队可恢复，执行中失去租约标 interrupted/LEASE_EXPIRED_USAGE_UNCERTAIN，要求人工决定新授权运行，不声称外部恰好一次。最多3次尝试；仅明确可重试且用量已报告的限流/服务不可用才自动重试。未知 token/费用保持 null，不以0抵扣。最大单次输出4096 tokens、执行120秒，累计预算同时约束；输入按 UTF-8 字节数加保守预留估算，不承诺等于 provider tokenizer。

调度、重试、读取输入、写回候选及提交均校验本人身份、任务/方案/权限/能力/输入版本和依赖。旧输入撤权后历史候选不再返回。存储中的原始执行请求仅供受信服务运维，不开放数据库或 attempt 原始 prompt API。材料无工具权限，不能触发 shell、任意安装、外发通知或读取其他目录。

模型子进程不获得平台数据库路径、附件路径、会话或通用工具，按任务授权的服务工具读取和提交材料。运行于相同 OS 用户，属于受控代码组合而非操作系统隔离容器；生产运维隔离与独立 worker 服务认证需另行设计。引用验证只证明引文来自授权文本，不证明科学真实性或语义推理正确；验收人仍须核对。

G1/G2/A9a 规则、附件与承诺保留；新增运行待处理项使用相同权限和快照机制，全量计数不依赖当前页。任务成功运行仍处 in_progress，承接者 submit 后 pending_review，指定交付版本验收才 completed。未实现的 G4 端点仍返回 NOT_IMPLEMENTED；本批无私人能力托管、记忆复用、通知、外部发布或部署。

自动选入规划上下文的任务也记录 id/version/原投影权限；任务撤权后 GET 请求、草案列表及详情均重新检查，不能从持久 AI 草案绕过撤权。

健康检查只验证本次执行的本地 DB/存储/认证检查，harness=not_verified 表示健康端点不主动发起付费模型探测；能力配置、具体运行结果与真实专项报告分别读取，不能由健康检查推断模型成功。

## 交付提交

独立分支 `backend/b3-durable-ai`。先行契约 `23f9c4a31b9894948fd7bbdbcfbd82ccfe69eb33`，最终可执行契约0.5.0 `ab43b0f42fcd99da65ef046c1f5f1cdd27e9f92d`，服务 `c350a81f38c27d74303e42d98bdb406c4d341385`。后续文档提交不改受测代码。证据和未完成项见 [B3 阶段报告](reports/B3-backend-2026-09-30.md)。集成人从本分支整体合入共同候选基线，保留其后的文档提交；不只挑取服务提交而漏掉父契约。
