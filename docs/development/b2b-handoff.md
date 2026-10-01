# B2b 联调契约与迁移说明 · 0.4.0

基线 658c1a815d83bc07565e378c48544fad2c1f60ae；包含 F2a-01、G2a 报告和 Windows 旧库测试准备修复。先交契约，服务随后实现与验证；不能单凭本契约提交宣布 B2b 可用。

唯一 Schema 在 packages/contracts；OpenAPI 与 examples 由同源生成。0.3 strict 客户端须整体升级 0.4.0。Task、Assignment、Schedule 原状态不另建副本。新增 TaskDetail changes/dependencyImpacts/artifacts，ActionItem change_response，overview pendingActions.changeResponses；新服务会填充可选字段，旧缓存/fixtures 可解析。前端必须明确处理新增变更待办，不能误渲染为验收。withdraw 改为不含任务材料的回执。既有协作命令保留幂等 key；退出/撤权后旧 key 也重新鉴权，不返回旧成功正文。

## 本批接口语义

- block/resume 保存与恢复原状态；恢复、开始、提交、验收均检查依赖和未复核影响。不能手工改 status 绕过。
- proposeChange 提供 scope、goal、acceptanceCriteria、schedule、dependencies、proposedLeadId、reason 和 expectedVersion。冻结发起人、验收人和已接受牵头者；提议者的提交本身记接受，其余成员须明确回应。最多一个 pending 提议，declined 保留原任务/承诺；全员接受才原子应用，保留旧任务与 assignment 版本。任务有其他变化则提议 superseded，旧请求冲突。已完成任务可提变更，通过后 changes_requested，旧验收保留。更换牵头者走退出/新邀请，不通过变更暗中替换；不同 proposedLeadId 返回 NOT_IMPLEMENTED。
- dependencies 使用共享 Dependency。仅 accepted_deliverable 开放，confirmed_decision 明确 501。指定 requiredRevision 时须该版本是当前有效已验收交付；null 在开始时绑定实际已验收版本，不随更新静默漂移。原草案 string[] 依赖继续有效。变更依赖通过同一提议/接受机制，提议与应用均检查自环、间接环和引用权限。
- 上游阻塞、关键范围/依赖/日期变更、退回、退出、取消、附件/访问撤回写入下游影响。活动下游暂停，已完成下游保留完成事实与影响，所有交付/验收版本不删除。acknowledgeImpacts 在依赖重新有效后由牵头/验收人显式复核指定影响，记录说明；resume 另行执行，不自动继续。
- withdraw 结束本人承诺、停止旧派发，保留交付与未交部分；非独立组织角色撤销访问。候选人另收 pending 邀请，仅见安全摘要，接受后才有承诺。新邀请清除前任 committed 日期。revokeAccess 由发起人执行，不能撤销发起/验收治理角色；退出或撤权均不得通过公开认领摘要重新进入。取消后除发起人审计历史外撤销访问，所有附件下载停止；不删除 outbox，未执行意图标记 cancelled，不伪称撤回外部结果。
- upload 支持共享契约限定的 text/plain、PDF、PNG，decoded 1 byte–10 MiB，JSON body 另有上限；签名/UTF-8 基础检查不是病毒扫描。文件名仅元数据，随机私有存储名不返回。binary content 每次鉴权，attachment/no-store/nosniff，禁止公开静态目录或永久下载 URL。revokeArtifact 全局撤回附件内容，保留元数据、交付引用与历史；旧上传/交付/验收缓存也检查当前附件权限。
- 交付只能引用同任务已授权且未撤回的附件；sources.kind=artifact 的 locator 为同任务附件 ID。交付 revision 固定引用 immutable artifact ID/version，文件不能原地覆盖。草案 inputArtifactIds 跨任务材料复用仍未开放，返回 501。
- invitationDecision/claim 可由承接者填写自己的 committed（confirmed=true、source=member），与建议日期、已确认硬截止分别保存；未知 null。提议的 committed 只有全部必要成员接受后生效，来源/时区不改写。拒绝和未回应不形成新承诺。
- events 为授权分页历史，复用 B2a snapshot/cursor 的 410 重取语义；详情、人员、四列全量计数与 change_response 使用同一事务和 ACL。每任务最多 100 个提议/附件，影响只展示最近 100 个并标记截断，事件完整分页。B3/B4 继续不可用。

## 迁移计划与启动

新增 005，不修改 001–004：task_versions、assignment_versions、change_proposals/decisions、依赖边/绑定/影响、附件元数据及撤回状态，全部事务写入；从现有 B2a 文档回填边与当前版本，不删除旧数据。历史版本从升级时起完整记录，不能声称恢复 B2a 未保存的早期 task 版本。

停自己的 API 并完整备份 SQLite/WAL 后运行 pnpm build、pnpm db:migrate；重复执行校验 checksum，不重置数据。DATABASE_PATH、BLOB_ROOT、APP_ORIGIN、HOST、PORT、NODE_ENV 沿用 B2a；本地合成账号继续 db:seed / db:credentials，凭据只在忽略目录。附件文件与数据库一起备份；普通事务失败清理本次新文件，进程崩溃可能留下无元数据孤儿，绝不通过目录直接读取。正式备份恢复、恶意文档扫描及配额运维未验收。

确切契约与服务 SHA、验证结果见 [B2b 阶段报告](reports/B2b-backend-2026-09-29.md)。F2b 浏览器和共同 G2 不由后端服务测试代替。本批不开放真实通知、AI worker 或进入 B3，不部署/合并。

## 实际启动与合成联调

```powershell
pnpm install --frozen-lockfile
pnpm build
$env:NODE_ENV='development'
$env:DATABASE_PATH="$PWD/.runtime/b2b/platform.sqlite"
$env:BLOB_ROOT="$PWD/.runtime/b2b/blobs"
$env:TEST_CREDENTIALS_FILE="$PWD/.runtime/b2b/test-credentials.json"
$env:HOST='127.0.0.1'
$env:PORT='3100'
$env:APP_ORIGIN='http://127.0.0.1:4175'
pnpm db:migrate
pnpm db:seed
pnpm db:credentials
pnpm api:start
# 另一个终端沿用 APP_ORIGIN、TEST_CREDENTIALS_FILE、NODE_ENV
$env:API_URL='http://127.0.0.1:3100'
pnpm seed:coordination
```

沿用真实密码 Cookie、Origin、X-CSRF-Token 和 Idempotency-Key；没有身份切换/绕过。seed:coordination 只使用合成 A/B/C：A 上游受阻，B 下游暂停，B 有一项范围变更待回应，另有 B 已提交附件并退出、等待 C 接受的转交。重复执行不重建任务、不抹进展；权限已经被手工撤回时不强行恢复。初始未知日期继续 null。账号随机密码在忽略文件内自行读取，不复制到日志或 Git。旧库不要执行合成 seed；按上节备份、迁移即可。

## 前端对接次序与例子

唯一类型：[routes.ts](../../packages/contracts/src/routes.ts)、[models.ts](../../packages/contracts/src/models.ts)；完整请求/响应示例：[examples.json](../../packages/contracts/examples.json)。新写命令均需要稳定幂等 key 和资源版本；不要新建 DTO 或猜状态。下列示例省略真实认证头，ID 仅为合成示意。

```json
{
  "expectedVersion": 2,
  "scope": "补充合成核对清单",
  "goal": "核对合成材料",
  "acceptanceCriteria": "逐项注明缺失证据",
  "schedule": {"suggested":null,"hardDeadline":null,"committed":null,"estimatedHumanHours":null,"checkpoint":null},
  "dependencies": [{"taskId":"synthetic_upstream","kind":"accepted_deliverable","requiredRevision":2}],
  "proposedLeadId": "member_B",
  "reason": "等待上游第二版通过验收"
}
```

POST `/api/v1/tasks/{id}/change-proposals` 返回 proposal；B 从 `actionItems?kind=change_response` 或 taskDetail.changes 获取同一 proposal/version，POST `/change-proposals/{id}/decision` 正文 `{"expectedVersion":1,"decision":"accepted"}` 或 declined。旧 task.version 会令提议过期，不覆盖新事实。单人自承诺任务只有自己需要接受，提交提议即为明示接受并立即应用。当前模型只支持一个已接受牵头者；新增参与名额不是本批功能。

POST `/tasks/{id}/block` 用 expectedVersion/reason/requestedMemberId/requestedAction；requestedMemberId 必须已有任务 full 权限，不能借阻塞请求给无关成员透露资料。POST resume 只恢复原状态，依赖未验收或影响未复核返回 409 DEPENDENCY_BLOCKED。TaskDetail.dependencyImpacts 的无权上游 ID/version 会置 null，只给本任务受影响交付版本；受限上游的正文从未读给下游成员。显式依赖边是方案/提议中获准共享的关系，不自动授予上游材料权限。

POST `/tasks/{id}/dependency-impacts/acknowledge` 正文 `{"expectedVersion":5,"impactIds":["synthetic_impact"],"comment":"已按获准证据复核原成果"}`。不得用“关闭弹窗”自动调用；必须先满足依赖，再明确确认。历史交付与验收不会删除；已完成任务的上游影响并不伪称原验收从未发生。确有关键更新需要重新工作时，通过变更将已完成任务转为 changes_requested，再提交新版本。

POST `/tasks/{id}/withdraw` 用 expectedVersion/reason/remainingScope/transferToMemberId（可空），返回 taskId/taskVersion/status=withdrawn 回执。非发起/验收角色随即失去任务访问，重试旧成功操作会被拒绝；不能把“重放失败”解释为退出未发生。候选人只得到必要摘要，使用既有 invitationDecision 再接受。离任者历史承诺保留；新候选人的 committed 日期清空，需本人填写。发起/验收角色独立保留治理权限，不以退出牵头冒充撤销组织角色。

POST `/tasks/{id}/revoke-access` 用 expectedVersion/memberId/reason；POST `/tasks/{id}/cancel` 用 expectedVersion/reason。取消后发起人保留审计详情，其他成员被撤权、所有附件内容不再下载、排队意图保留为 cancelled；已经下载的副本不能从他人设备追回。已完成任务不能直接 cancel，需先明确变更重开。撤权没有隐式恢复接口，旧邀请/认领不能重新入场。B3 队列执行仍未开放，不能拿 outbox 记录宣称 AI 已运行。

POST `/api/v1/artifacts` 例：

```json
{"taskId":"synthetic_task","expectedVersion":2,"filename":"synthetic.txt","mediaType":"text/plain","contentBase64":"eA=="}
```

上传会递增 task.version，随后重新读任务再提交。GET `/artifacts/{id}` 返回授权元数据；GET `/artifacts/{id}/content` 返回二进制，必须用 fetch + authenticated cookie 读取 Blob，不能用通用 JSON response parser。网页应遵守 no-store，不保存永久公开 URL。POST `/artifacts/{id}/revoke` 用附件 expectedVersion/reason，撤回全体下载权；保留 accessStatus=revoked 元数据。Artifact.version 是元数据版本，内容自创建不可覆盖；服务在 deliverable_artifacts 中记录提交当时的 artifact_version，交付中的 artifactRefs 是 immutable ID。来源为 artifact 时 locator 必须属于同任务并同时列入 artifactRefs。

GET `/tasks/{id}/events` 为 full ACL 分页历史；末页 nextCursor=null，新增业务后旧 snapshot/cursor 返回 410，整组重新读取。没有 SSE、实时通知或增量保留游标承诺。TaskDetail 最近 100 项影响以未复核优先；复核后下一批未处理项可见，truncated 标记不伪装完整。proposal 与 artifact 每任务最多 100 项，超出明确拒绝；事件历史继续分页。

沿用 B2a snapshot 组合：overview、tasks、detail、members、actionItems、events 同一 token；修改后全部重取。overview 四列仍为 SQL 全量授权计数，pendingActions.changeResponses 是本人尚未回应的提议数，不是本页长度。变更与待验收可以同时出现，所以 actionItems 以任务+kind 分页去重；旧 0.3 游标升级后丢弃重取。B2b 写接口对先前成功响应也重新检查当前角色、任务和附件权限。

| HTTP / code | 处理 |
| --- | --- |
| 400 VALIDATION_ERROR | 字段、环、日期来源、类型签名或文件名非法；修正输入 |
| 401 UNAUTHENTICATED | 会话失效，重新登录 |
| 403 FORBIDDEN / 404 NOT_FOUND | 没有操作或资料权限；清除相关显示，不能回退旧成功数据 |
| 409 VERSION_CONFLICT | 重新读版本与差异；已过期提议不继续投票 |
| 409 DEPENDENCY_BLOCKED | 指定版本未验收、附件已撤回或影响未复核 |
| 409 INVALID_STATE | 当前任务/提议状态不允许该动作 |
| 409 IDEMPOTENCY_CONFLICT | 同 key 改了正文；不把它当重试 |
| 410 CURSOR_EXPIRED | 放弃旧组合，重新取得快照与分页 |
| 413 PAYLOAD_TOO_LARGE | JSON/解码附件超过上限 |
| 501 NOT_IMPLEMENTED | 未开放能力（如 confirmed_decision、跨任务草案材料复用、提议中更换牵头） |
| 503 MODEL_UNAVAILABLE / SERVICE_UNAVAILABLE | 真实依赖不可用；不显示成功或 fixture |

## 检查及明确边界

`pnpm check:b2b` 运行 A6—A9 与 G1/A9a/基础回归；先 build。根 `pnpm run ci` 保留全部 workspace、后端真实进程和前端生产隔离。测试使用真实 HTTP、磁盘 SQLite、双进程/重启、随机密码和真实附件文件；不会调用真实通知或模型。

本批没有实现 F2b 操作表单或浏览器复核。F2a 旧页面只提供原有操作，前端须消费 change_response、影响与附件状态后再进行 F2b 验收；后端通过不关闭共同 G2。历史队列只是意图，不是已派发消息。Harness 固定依赖的最近记录仍为安装阻塞、真实调用未验证，本轮没有重新验证其发行渠道。正式账号、联网部署、病毒扫描、文件配额、崩溃孤儿清理命令及备份恢复仍待运维验收。
