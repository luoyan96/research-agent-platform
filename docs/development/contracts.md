# 共享接口与数据语义基线

版本：v0.1-draft。日期：2026-09-21。**这是拟实现契约，不是当前可调用的 API。** B0 后端负责人将其转成仓库中的共享运行时 Schema / 类型、接口定义和合成样例，再登记固定契约版本与提交；前端从同一来源消费，不手写不一致的模型。

[任务分配规则](../task-allocation.md)优先约束语义。具体框架、认证实现、数据库和 Schema 工具由 B0 核实并记录；这里不预设未经验证的依赖版本。

## 1. 通用语义

- 路径统一以 `/api/v1` 开头。正文 JSON；ID 为不透明字符串；时间点用含时区的 ISO 8601，只有日期的截止保留日期与时区，不自行变成 UTC 零点。
- 未知日期、投入、负责人用 null / 明确缺项表示。建议日期、硬性截止、已接受的承诺日期分开存储与展示。
- 身份从服务端认证上下文取得，不能相信请求正文的 actorId 或仅凭 labId 授权。B0 固定认证入口、会话、登出、跨域和会话失效策略；实际部署中不能启用模拟成员切换。
- 成功响应包含 `data`；列表另外返回 `nextCursor`，空列表返回 []。错误包含 `error.code`、可公开的 `message` 和 `requestId`，不返回私有提示词、内部路径或完整工具日志。
- 查询先限定可见集合，再排序、分页、汇总和生成 AI 上下文；不能读完整私有数据后仅在页面隐藏。
- 服务端响应携带资源 `version`。修改携带 `expectedVersion`；过时修改返回 409 与允许公开的冲突说明，前端重新读取后让用户比较，不静默覆盖。
- 确认、邀请决定、认领、提交、验收和运行请求使用 `Idempotency-Key`。作用域为认证主体 + 命令 + 资源；同 key 同负载返回同一结果，不重复产生副作用，同 key 不同负载返回冲突。鉴权和权限撤回检查发生在返回缓存结果之前。
- 通用错误码至少涵盖 UNAUTHENTICATED、NOT_FOUND、FORBIDDEN、VALIDATION_ERROR、VERSION_CONFLICT、IDEMPOTENCY_CONFLICT、ALREADY_CLAIMED、DEPENDENCY_BLOCKED、CAPABILITY_UNAVAILABLE、MODEL_UNAVAILABLE。无权知道资源存在时使用 NOT_FOUND；B0 固定 HTTP 状态映射与重试语义。
- 接口可返回当前 `allowedActions` 帮助界面呈现；服务端执行时仍重新鉴权。不能凭此字段授权。
- B0 明确每个命令的事务边界、合法前置状态、版本检查和副作用；不要提供客户端任意写 status 的通用更新口。

## 2. 核心对象

| 对象 | 最低字段 / 语义 |
| --- | --- |
| Member | id、labId、displayName；本人主动公开的专长；availability 的适用区间、粗粒度可用情况、updatedAt；当前可见承诺。无数据时为未知 |
| Plan | id、ownerId、version、status、goal、proposedItems、unresolvedQuestions、createdAt。版本状态至少 draft / confirmed / superseded；确认产生稳定的任务身份 |
| ProposedItem | 稳定草案项 id、目标、交付与验收标准、分配方式、建议成员或公共能力、前置草案项、日期的来源与确认状态、输入资料引用、用量上限 |
| Task | id、labId、parentTaskId、planId / planVersion、title、taskType、goal、acceptanceCriteria、initiatorId、leadId、reviewerId、participantIds、status、blocker、dependencies、schedule、version、createdAt / updatedAt |
| Assignment | id、taskId、kind（self / invitation / claim / public_agent）、受邀对象或公共能力版本、承诺状态、接受的范围和时间、version。接受前不填充“正在负责” |
| Deliverable | id、taskId、revision、submittedBy、artifactRefs、summary、必要来源、submittedAt、review。验收绑定具体交付版本；附件位置不直接等于访问授权 |
| Capability | id、ownerId、visibility（private / lab_public）、version、输入输出约定、可用状态、维护者、验证结果引用。共同任务响应不包含他人 private 对象或 ID |
| Execution | id、taskId、公共能力及版本、status、运行尝试、用量、失败的可公开说明、结果引用、timestamps。个人执行记录用所有者范围单独存储与查询 |
| TaskEvent | id、taskId、actor、kind、resourceVersion、timestamp、允许公开的变化摘要。用于恢复、追溯与客户端刷新，不存入私人执行细节 |

能力缺失是一种显式状态；不要创造一个看似真实的 capabilityId。共同方案只含公共能力和愿意公开的成员能力；个人执行方式使用独立的私人对象，不能随整份方案序列化给其他人。

B0 对字段必填、枚举、长度与大小上限、日期结构、访问策略字段、依赖边类型及退出 / 转交承诺补齐 Schema。保留可复用的科学对象逻辑，但平台身份与事务不能由现有本地索引代替。

## 3. 状态与视图映射

| 任务枚举 | 中文 | 总览列 |
| --- | --- | --- |
| unassigned | 待安排 | 待安排 |
| awaiting_acceptance | 待承接 | 待安排 |
| ready | 待开始 | 待安排 |
| in_progress | 进行中 | 进行中 |
| blocked | 受阻 | 进行中，并保留原因 |
| in_review | 待验收 | 待验收 |
| changes_requested | 需修改 | 进行中，并保留修改要求 |
| completed | 已完成 | 已完成 |
| cancelled | 已取消 | 单独筛选，默认四列不混入 |

执行状态另为 queued / running / waiting_input / failed / interrupted / cancelled / succeeded。succeeded 不自动令任务 completed；成果需提交与验收。晚到的执行事件不能覆盖取消、撤权或更新版本后的状态。

邀请至少区分 pending / accepted / declined / withdrawn；退出与转交保留原记录，新牵头者另行接受。B0 补齐承诺状态，不能将邀请直接作为任务完成状态。

典型路径：确认草案 → 待承接或待开始 → 实际开始 → 进行中 → 提交 → 待验收 → 验收完成；退回则需修改。受阻须保留恢复目标状态。取消是明确命令。父任务验收独立，子项进展只是摘要，不能按勾选比例自动完成父任务。

接口返回原始任务状态；前端使用共享映射渲染四列。变更、能力草案、验收意见等各有自己的状态，不复用 TaskStatus。

## 4. 接口分组与最低行为

下表约定主资源和操作；B0 必须将每行展开成精确的请求 / 响应 Schema、状态码和示例。不要让前端从描述猜字段。身份与运行时健康检查的具体路径也在 B0 固定。

| 组 / 建议路径 | 操作与约束 | 进入阶段 |
| --- | --- | --- |
| GET /me；GET /labs/{id}/members | 当前身份；只返回允许公开的成员资料和承诺 | B1 |
| PATCH /me/availability | 更新本人的时间范围、可用情况；不改变他人承诺 | B2 |
| POST /plans；GET /plans/{id}；PATCH /plans/{id} | 创建、读取、修改结构化草案；版本校验，不派发 | B1 |
| POST /plans/{id}/confirm | 确认指定版本，事务创建或更新任务并登记派发事件；重复确认可安全重试 | B1 |
| GET /tasks；GET /tasks/{id} | 分页 / 范围 / 状态筛选；详情含可见的承诺、依赖、交付与下一步 | B1，B2 补齐聚合 |
| POST /tasks/{id}/invitations；POST /invitations/{id}/decision | 创建邀请；受邀者接受或拒绝；访问摘要与接受后的资料分开 | B1 |
| POST /tasks/{id}/claim | 对开放的牵头名额原子认领，冲突返回实际结果 | B1 |
| POST /tasks/{id}/start；POST /tasks/{id}/block | 开始 / 报告受阻；校验身份、依赖和合法状态 | B1 的开始，B2 的完整受阻 |
| POST /tasks/{id}/deliverables；POST /deliverables/{id}/review | 提交新版本；有权验收人通过或要求修改 | B1 |
| POST /tasks/{id}/change-proposals；POST /change-proposals/{id}/decision | 范围 / 时间 / 人员变更先提议再接受，保留原承诺；B0 定义多人接受规则 | B2 |
| POST /tasks/{id}/withdraw；POST /tasks/{id}/cancel | 明确退出或取消，停止后续访问 / 派发并记录影响，不冒充已撤销外部副作用 | B2 |
| GET /labs/{id}/overview；GET /tasks/{id}/events | 当前可见任务、交付计数、卡点、成员承诺与更新时间；事件带可恢复游标 | B2 |
| POST /artifacts；GET /artifacts/{id}；GET /artifacts/{id}/content | B0 固定上传协议 / 大小限制 / 文件存储；每次读写检查任务权限 | B2；B1 可先用纯文本交付 |
| POST /planning-requests；GET /planning-requests/{id} | 自然语言生成建议，返回请求状态和 planId；只创建草案，不默认确认 | B3 |
| POST /tasks/{id}/runs；GET /runs/{id}；POST /runs/{id}/cancel | 经授权派发、查询、取消公共执行，幂等并限制用量；重复启动和排队竞争受控 | B3 |
| GET /capabilities；POST /capabilities；POST /capabilities/{id}/test-runs | 公共与本人私有目录、草案、真实样例验证；他人私有内容不进入响应 | B4 |
| POST /capabilities/{id}/publish；POST /capabilities/{id}/disable | 所有者 / 已获授权维护者明确发布指定版本或停用，不能借组织身份强行公开 | B4 |
| GET /tasks/{id}/knowledge；POST /tasks/{id}/feedback-sharing | 授权任务结论与明确选择的反馈共享；撤回 / 修订策略在 B4 固定 | B4 |

GET /tasks 的最小查询支持 labId、scope（lab / mine）、status、cursor、limit。scope=mine 的参与规则由 B0 固定：本人发起、负责、参与、验收或待接受的邀请；依然受访问规则约束。认领前公开摘要使用专门的安全投影，不能通过列表把受限详情先发给所有人。

分页大小限制、排序、搜索范围、事件快照、过期游标、断线后全量重取和轮询回退由 B0 定义。更换传输方式不更改业务语义；流式输出中途失败时保留 draft / failed 状态，不伪装成完整方案。

## 5. 契约样例与变更

B0 至少提供以下合成样例，并通过共享 Schema 验证：缺截止的草案；含邀请的方案；认领前摘要；受阻任务；待验收交付；已取消任务；成员可用时间未知；版本冲突；并发认领失败；未配置模型；私有能力仅本人可见。

所有契约样例带固定版本，前端演示从这些样例或同 Schema 的 fixtures 读取。生产启动禁止 fixture 模式；真实服务失败也不能自动回退到示例数据。

字段 / 状态 / 错误变更更新版本、样例、客户端和服务端测试；破坏性变更由集成人协调同一批交付。阶段报告记录 contractVersion 和对应 commit。当前 v0.1-draft 不代表这些校验或接口已存在。
