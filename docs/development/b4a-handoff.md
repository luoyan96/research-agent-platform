# B4a 契约、权限与迁移交接 · 0.6.2

共同基线61eec851ac1f00e18b12e729f5fa6cdcc320f730。本文件先随契约/迁移提交，现已补齐服务与真实验证，详见阶段报告。B4b和G5未开放。

## 0.6.2 共同修复：授权人找回与撤回

G4a-01 补充 `GET /tasks/{id}/public-method-feedback`（taskSamples）。须当前完整任务权限，只按当前账号筛选本人授权/不共享记录，再计数和分页；游标绑定任务、账号、查询及快照。维护者的 `/public-text-method/samples` 权限不变。

返回 FeedbackSample 的真实版本、状态及 allowedActions。可用片段可核对；已撤回、不共享或因来源变化失效的记录不返回片段正文，后者显示 needs_review。存储中仍未撤回的授权即使已失效，原授权人仍可明确撤回；失去任务访问权后整页拒绝。撤回成功后保留不含正文的状态记录，旧成功响应不能恢复授权。

前端任务页按需展开“我在此任务的样例授权”，支持每页 10 条、刷新/关闭浏览器后找回，以及按服务返回版本撤回。退出/换账号清空上下文，失败仍用原 key/body 重试。没有新增数据库迁移，007 保持原 Git 字节。前后端须整体采用 0.6.2；原 0.6.1 交付 SHA 保留在下方作为来源。

## 精确授权矩阵

| 动作 | 来源要求 | 目标/其他要求 |
| --- | --- | --- |
| 留存结论 | 当前完整任务权限；本人是指定验收人；指定交付已验收；指定附件是该交付附件且可读取 | 显式内容/适用说明；owner_only或source_readers；不产生反馈共享 |
| 查结论/历史/列表 | 当前来源完整权限、选定revision附件未撤销；owner_only仅确认人 | SQL先授权再分页及计数；撤回后404/列表排除，持久审计保留 |
| 修订 | 原确认人仍有来源权限；新指定交付已验收 | expectedVersion与expectedTaskVersion；追加不可变revision，不改旧复用绑定 |
| 撤回结论 | 原确认人或当前来源验收人且仍有来源权限 | 隐藏所有版本内容；派生链路与缓存重新检查 |
| 选结论规划/执行 | 明确conclusionRefs(id,version)；版本current；源权限与scope通过 | 目标本人草案/本人承接任务；全部潜在读者必须已获来源权限；开放认领拒绝；禁止依赖环；无选择不入模 |
| 授予公共方法样例 | 指定已验收交付的提交人和验收人必须同为本人；selectedText必须是交付摘要原文片段 | 显式authorizeLabUse；只有片段可用，非原任务权限；首版不允许从已有复用依赖任务再公开片段 |
| 拒绝分享 | 当前来源权限与交付版本 | 可记录decline，不影响已完成或后续验收 |
| 读取样例/维护方法 | 现有内置公共能力owner；不自动授予源任务权限 | 只读明确可用片段；不枚举私人能力/方法 |
| 撤回样例 | 原grantor且现时有来源权限 | 依赖方法失效；若活动方法依赖它则停用并递增配置代次；旧试跑派生内容隐藏 |
| 候选/试跑/启用/停用 | 现有公共能力owner；候选只能引用有效样例 | 受控枚举配置，不接受代码/工具；试跑仍需本人承接目标、预算与真实Harness；精确方法试跑成功后人工确认启用 |
| 本人规划历史 | owner_id必须为当前会话成员；重新校验所有来源 | SQL先授权再count/page；无原始prompt；遵循F3-01状态与方案状态区分 |

API仍由cookie/CSRF/Origin认证，不能传actorId。版本冲突409；不可见资源404；无权动作403；陈旧结论/不合法状态409；范围扩大403；模型/能力不可用503。同原key重试不再产生新记录，缓存重放重验授权。精确Schema与每路由请求/响应样例位于packages/contracts。

## 撤回、过时和派生内容

结论通过不可变revision绑定sourceTaskVersion、交付id/version、附件id/version/hash和确认人。任何源任务版本变化、指定交付变化/退回、头revision更新均使旧revision needs_review，不能新派发；历史保留，用户只能显式追加新revision并重新选用。源撤权/附件撤销/结论撤回与“过时”不同：前者阻止相关内容读取，后者保留可读的历史并标需复核。

复用依赖保存于job、plan、task，使用递归来源图在服务SQL过滤列表/计数/详情/人员承诺及缓存。派生任务上的材料、交付和事件沿任务访问保护。撤回后不通过复制草案、confirm缓存、旧交付候选恢复访问；worker派发/写回也检查来源。不能追回已下载或已由用户手工复制到平台外的副本。

规划不再自动把其他任务全文加入模型上下文：taskIds及conclusionRefs须主动选择。修改已含结论的草案/执行已含结论的任务也须明确重选其绑定来源，不能偷偷省略依赖。公开认领或增加不具备来源权限的受邀者被拒绝。

## 方法与配置代次

既有capability.version继续表示启用配置generation，以兼容B3/F3。新增独立不可变methodVersion，运行同时绑定两者。007把B3原算法导入为method1/origin=legacy_b3，保留原generation和历史运行capability.version；不生成伪造“已发布/已试跑”历史。候选方法只允许emphasis/detail/exact_quote枚举；每次新候选追加版本，人工启用使generation递增，旧排队/运行绑定失效而非静默换方法；已结束记录仍保留旧方法。

试跑使用获准片段作为材料，经现有持久worker/Harness0.2.0-rc.1执行。模型工具仍为空；维护者不获得任务原文/附件/私人方法。样例失效的所有依赖方法不可新调用，活动方法必须停用；不声称进行了训练或能从模型“遗忘”。

## 007迁移

先备份本任务DB/WAL和附件，停止相关服务；不重置旧库。新增conclusions/conclusion_versions、reuse_edges/source权限视图、public_samples/sample_edges、public_methods/public_method_state/method_events。001—006不改。迁移runner仍在事务内按checksum只执行一次；再次运行检查相同历史。

`pnpm install --frozen-lockfile`、`pnpm build`后，使用同一私有配置两次运行 `node --env-file=.env apps/api/dist/manage.js migrate`。迁移runner已接入，旧B3库重复升级及原字段保留已经专项验证。007规范文件SHA-256为576980ba93aa60aa2773cb54d8364db409aacd4b075ad630ae30274514f91526；使用Git检出的LF文件，不手改已应用迁移或重写旧库校验和。

## 0.6.1 前端权限与来源投影补充

Task.allowedActions新增retain_conclusion/share_feedback/decline_feedback；RetainedConclusion.allowedActions为revise/revoke；FeedbackSample为revoke；Capability为manage_methods；MethodState为create_method/disable；PublicMethod为trial/activate并返回授权validationRunIds。客户端只按服务动作呈现，提交仍重新鉴权。Plan/Task返回conclusionRefs(id,version,status)，getPlanRequest.reply.plan沿用同一Plan；来源撤权优先404/移除整项，不以空文本伪装可复用。此为0.6.0先行契约的显式兼容升级，请整体升级0.6.1，不自行比较角色或建第二套状态机。


## 完整提交与复现

| 内容 | 完整SHA |
| --- | --- |
| 共同G3及G4a规划基线 | 61eec851ac1f00e18b12e729f5fa6cdcc320f730 |
| 先行0.6.0契约、权限矩阵与007 | 16b2fee6244545a5dc248ddd760bbc0f2c6ee846 |
| 最终可执行0.6.1契约及允许动作/来源投影 | 0dfb54c006e990b3502e6e87d4fbbb561197f656 |
| B4a服务及专项 | daa59a8ad6ef194455a9853e6faf2669a9476daa |

分支backend/b4a-authorized-reuse，工作目录D:/deepseek-agent/research-agent-platform-b4a。后续仅补文档；集成时包含本分支父提交及最后文档，不只摘取服务而漏掉Schema和007。实际结果见 [B4a阶段报告](reports/B4a-backend-2026-09-30.md)。只改前端契约版本测试，不修改F4a页面。

## 启动与合成联调

使用Node24.19、pnpm11.21，沿用固定Harness0.2.0-rc.1；无新增第三方依赖。所有命令在checkout根目录。API/worker使用相同私有.env（被Git忽略），只给服务端读取；配置名同B3：NODE_ENV、HOST、PORT、APP_ORIGIN、DATABASE_PATH、BLOB_ROOT、TEST_CREDENTIALS_FILE、B3_AI_ENABLED、DEEPSEEK_API_KEY、可选DEEPSEEK_MODEL/DEEPSEEK_BASE_URL。API_URL只供合成脚本定位本地服务。不要把Key送入Vite或浏览器。

```powershell
pnpm install --frozen-lockfile
pnpm build
node --env-file=.env apps/api/dist/manage.js migrate
node --env-file=.env apps/api/dist/manage.js migrate
node --env-file=.env apps/api/dist/manage.js seed
node --env-file=.env apps/api/dist/credentials.js
# 首次配置已存在的那一种能力，明确真实owner，不新建能力市场。
node --env-file=.env apps/api/dist/capability-config.js enable lab_synthetic member_A
node --env-file=.env apps/api/dist/main.js
# 另一个服务端终端：
node --env-file=.env apps/api/dist/worker.js
```

APP_ORIGIN须与网页精确Origin一致；默认API3100，可用前端代理/api。配置与证据目录必须为本任务独立路径，勿指向别人正在运行的库。db:credentials生成随机A/B/C密码，保存在TEST_CREDENTIALS_FILE、不打印。认证仍为密码登录→HttpOnly cookie→session.csrfToken；写操作携带Origin、X-CSRF-Token、Idempotency-Key，不传actorId。重试同一操作保留原key和原body；若用户选择了新版本，就是新操作、新key。

```powershell
# 设置API_URL、APP_ORIGIN和TEST_CREDENTIALS_FILE后；不需要运行worker。
node --env-file=.env scripts/seed-b4a-demo.mjs
node --env-file=.env scripts/seed-b4a-demo.mjs
# 显式付费专项会启动并管理自己的worker，请先停该合成库其他worker。
node --env-file=.env scripts/check-b4a-live.mjs
pnpm check:b4a
pnpm run ci
```

seed稳定创建一项已验收合成来源、显式保留结论和一项后续任务；两次返回同一身份，不生成模型调用、不分享样例。真实专项主动授予一个片段、创建方法候选、真实试跑、人工确认启用，再检查停用/撤回；会消耗真实模型配额，并保留试验状态。再次跑完整专项宜使用新的独立合成库；它不是无副作用seed。B4A_REUSE_ONLY=1仅验证真实结论复用，用于定向检查，不能据此称方法试跑完成。

## 请求与响应要点

精确定义与每路由可验证样例：[Schema](../../packages/contracts/src/models.ts)、[routes](../../packages/contracts/src/routes.ts)、[OpenAPI](../../packages/contracts/openapi.json)、[examples](../../packages/contracts/examples.json)。全部路径带/api/v1。不要把deliverable.revision（人类交付序号）误当deliverable.version（资源版本）；来源对象使用后者。当前版本从服务读取。

```json
{"expectedVersion":4,"deliverable":{"id":"synthetic_delivery","version":2},"artifactRefs":[],"conclusion":"Synthetic cohort A measured twelve samples.","applicability":"Only synthetic cohort A; cohort B remains unknown.","scope":"source_readers"}
```

POST /tasks/:id/conclusions只留存结论；字段包含sourceTaskVersion、confirmedBy、createdAt、status、allowedActions。首版支持最多10附件的交付；artifactRefs必须明确列全该交付附件的id/version/sha256，不允许通过省略一个来源绕过撤回。

```json
{"labId":"lab_synthetic","intent":"draft","prompt":"基于选定结论安排后续核对","plan":null,"taskIds":[],"inputArtifactIds":[],"conclusionRefs":[{"id":"synthetic_conclusion","version":1}],"budget":{"maxTokens":100000,"maxSeconds":120}}
```

POST /planning-requests的conclusionRefs是用户主动选择；GET请求返回reply.plan.conclusionRefs。新任务执行POST /tasks/:id/runs同样附conclusionRefs，并附最新任务expectedVersion、公共能力capability和budget；可以只有选定结论、不附新文件。引用原样进入材料数组，引用ID为conclusion_<id>_v<version>。模型成功仅生成候选，submitCandidate仍需明确提交，再走原指定交付版本验收。

GET /planning-requests与GET /conclusions支持limit/cursor/snapshot，返回data、nextCursor、**total全授权计数**和snapshot。游标按当前身份、查询及数据库revision签名；变化/换账号后的旧游标410，重新读取。规划列表按稳定不透明id升序分页，不能假定为时间倒序；返回createdAt/updatedAt供展示，且不返回原始prompt。仅列表可见不等于仍可执行，写操作重验所有来源和版本。

POST /conclusions/:id/revisions须expectedVersion（结论头版本）、expectedTaskVersion及完整新ConclusionInput；旧revision保持不变。GET history可以核对当时文本和来源。新草案/运行只接受current版本；复核后要主动重新选择新版本。派生对象保存全部历史依赖以保护旧交付/事件，conclusionRefs投影显示每个结论最近采用的版本。若旧来源已撤回导致对象404，应新建有权访问的目标，不通过删掉引用恢复旧文本。

公共方法端点是/public-text-method，而不是未实现的B4b /capabilities。查看state后使用allowedActions：POST /versions创建受控候选；POST /trials指定methodVersion、本人承接的taskId、expectedTaskVersion和budget；试跑返回RunRecord.methodTrial=true，不能submitCandidate。PublicMethod.validationRunIds只列服务记录的真实Harness成功试跑；POST /activate明确confirm=true并绑定其中runId；POST /disable使旧代次排队/执行中运行失效。读方法/事件仅现有能力owner。

**维护冲突策略**：创建候选、启用、停用都会递增configuration generation；创建候选虽然不切换activeMethodVersion，也会使旧代次排队/进行中的运行取消。这是首版保守隔离策略，维护前端必须提示该影响，不能显示“完全不影响现有运行”。所有旧运行保留methodVersion和configurationGeneration，绝不原地换方法。legacy_b3/v1没有伪造试跑或发布事件；保留原B3提示规则。方法样例失效后依赖版本usable=false，活动版本自动停用，审计记录sample_revoked（也覆盖样例因来源更新失效的情况）。

反馈需用户另行确认：POST /tasks/:id/public-method-feedback可decline，selectedText=null、authorizeLabUse=false；share_selected必须显式authorizeLabUse=true且只选择已验收摘要原文片段。为避免未经同意扩大披露，首版只允许本人同时为提交人与验收人的完成任务，且该任务没有复用依赖。维护者仅能读这个明确片段，不因此获得源任务或原附件权限。来源更新后失效样例须另行提交新的显式授权，不在原样例里换文字。

典型失败：404 NOT_FOUND（包括来源撤回或派生对象被隐藏）、403 FORBIDDEN（目标扩大范围/无维护权限）、409 VERSION_CONFLICT（旧资源版本）、409 IDEMPOTENCY_CONFLICT（同key改body）、409 INVALID_STATE（旧结论需复核/试跑未满足真实验证）、410 CURSOR_EXPIRED、503 MODEL_UNAVAILABLE或CAPABILITY_UNAVAILABLE。前端按共享ErrorResponse显示；不能把失败退回演示数据。

## 已知限制与停止点

只做同实验室内的严格来源授权，默认不共享；没有全库搜索、向量库、跨域共享、任意提示词/代码/工具配置或私人能力托管。来源物理存储/系统管理员仍由受信运行环境管理；不声称OS级隔离或追回已下载副本。public method samples不训练模型，“撤回”是停止未来使用和隐藏派生访问，不是模型遗忘。

只有维护者owner一种角色，不新增通用授权管理界面。规划/公共候选继续沿用B3持久worker、预算、未知用量规则、取消/租约/原key重试。root CI234项、服务专项71项通过；实际模型证据另列。F4a浏览器、共同G4a及G5均未由本后端验收替代；完成后停在B4a。
