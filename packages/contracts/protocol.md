# HTTP 协议 0.1.0

完整精确接口见 [OpenAPI](openapi.json)，所有接口的合成请求响应见 [examples](examples.json)。当前只有 GET /api/v1/health/live、/health/ready 可调用；其他 41 个端点统一 501 NOT_IMPLEMENTED，不返回 fixture，不创建任务。

## 身份、认证与跨域（B1 实施）

预置账号，POST /api/v1/auth/login 使用 username/password，服务端 Node scrypt（每个密码独立随机 salt；N=32768,r=8,p=1、maxmem≥64MiB；限速后执行）与 timingSafeEqual 验证；禁止公开注册和默认生产密码。成员与实验室由数据库认证上下文决定，正文不允许 actorId。登录失败统一 401，不区分账号是否存在；每账号与来源地址限速，审计不记明文密码。

成功签发随机 32 字节不透明 session token，DB 仅存 SHA-256 hash，Cookie 名 rap_session；HttpOnly、Secure（生产强制 HTTPS）、SameSite=Lax、Path=/、无 Domain；绝对 12 小时到期，无无限滑动延期，登录轮换，登出数据库撤销并 Max-Age=0。会话失效和禁用账号返回 UNAUTHENTICATED。GET /auth/session 返回 member、expiresAt、独立随机 CSRF token；客户端不能用 Member 或 labId 作为身份断言。

同源部署；本地前端代理 /api 到 127.0.0.1:3100。不配置通配 CORS、不信任未经限定的反向代理头。所有有副作用请求校验精确 Origin；除登录外要求 X-CSRF-Token 与会话 hash 匹配；登录也检查 Origin 和 JSON Content-Type。认证/CSRF 是公共传输约束：routes.request.headers 定义业务头 Idempotency-Key，Cookie 和 X-CSRF-Token 在 HTTP 层处理，OpenAPI 安全/参数另有定义。跨域需求必须新增明确允许源列表，不能为方便联调关闭校验。

## 请求响应与错误

JSON 严格拒绝未知字段；不透明 ID 为 1–96 位 ASCII 字母数字下划线连字符，不表示授权。版本从 1 开始。字符串、数组和大小限制在 Schema 中；文本按 Unicode 字符串处理，输出由前端转义，不能当 HTML。GET 无正文，route.request.body=null；query 的 limit 从 URL 字符串解码为整数后校验。修改命令均有版本（创建资源除外），非登录/登出命令必须 Idempotency-Key 16–128 位 URL-safe 字符。幂等和版本检查语义见 [架构记录](../../docs/development/b0-architecture.md)。

成功 `{data: ...}`；列表 `{data: [], nextCursor: null}`；错误 `{error:{code,message,requestId}}`。服务器生成 requestId，不回显不受信任请求 ID。X-Contract-Version: 0.1.0；Cache-Control: no-store。唯一例外为附件 content 路由直接返回字节并用 Content-Type/Content-Disposition 标记。readiness 失败 503 仍是 Health 数据结构，便于自动探针解析。

| HTTP | error.code | 客户端行为 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 修正请求，不原样重试 |
| 401 | UNAUTHENTICATED | 登录后重新读取资源 |
| 403 | FORBIDDEN | 已知资源存在但操作不允许；不自动重试 |
| 404 | NOT_FOUND | 无资源或不允许知道其存在，同样公开信息 |
| 409 | VERSION_CONFLICT / IDEMPOTENCY_CONFLICT / ALREADY_CLAIMED / DEPENDENCY_BLOCKED | 重新读取并由人决定；不自动改版本或换 key |
| 410 | CURSOR_EXPIRED | 清空旧分页快照，全量重新读取 |
| 413 | PAYLOAD_TOO_LARGE | 减小内容 |
| 429 | RATE_LIMITED | 遵守 Retry-After 秒数后重试；认证限速由 B1 实施 |
| 501 | NOT_IMPLEMENTED | 本阶段未交付，禁用动作，不伪装成功 |
| 503 | MODEL_UNAVAILABLE / CAPABILITY_UNAVAILABLE / SERVICE_UNAVAILABLE | 保留未完成状态；依赖恢复后同 key 重试 |
| 500 | INTERNAL_ERROR | 可能结果未知；同 key 有限退避，不能新 key 重放外部操作 |

未收到响应/网络错误：GET 可退避重试；修改只用原 key、原负载重试。禁止在错误 message 包含私人能力名称、隐藏资源 ID、SQL、内部路径或工具日志。认证限速只定义契约，不在 B0 冒称已实施。

## 日期、状态、访问投影和分页

日期 DateValue 区分 date + IANA timezone 与含 offset 的 instant。schedule.suggested / hardDeadline / committed 分别保存来源、confirmed；缺失 null。确认硬截止需要 user/authorized_material 来源和明示确认；成员承诺只在本人接受后写入；服务端不能直接采信客户端 committed 或 confirmed。availability 缺失/过期显示未知/待更新，不用任务数推断负荷。

任务/分配/执行分别用 TaskStatus、Assignment.status、ExecutionStatus；taskColumns 是唯一看板映射，取消不进四列。block 保存服务端原状态，resume 重查依赖；任务验收和运行结束分开。公共能力缺失 capability=null，missingReason 说明公开缺口，不编造 ID。共同方案禁止 private ref；公共引用仍须数据库验证其真实 visibility 和版本，不能相信客户端写 lab_public。

列表、搜索、计数、上下文先 ACL 裁剪再聚合。scope=mine 包括发起、牵头、参与、验收、待接受邀请；待接受邀请和认领前只有 TaskSummary，绝不返回受限输入、依赖详情、私人方法。B0 summary.projection='claim_summary' 同时用于预承接安全摘要；前端不得把它当 Task 完整详情。其他成员的私有能力在 public/mine 两种目录中均不可见；维护公共能力不自动取得任务材料。

分页默认 30，1–100。资源列表固定 createdAt DESC + id DESC；members 按 id ASC；capabilities 按 id ASC；任务事件按持久 sequence ASC。游标由服务端签名，绑定主体、lab、过滤器、排序、ACL revision、首屏 snapshot 上界和最后键，15 分钟过期；客户端不得解析。后续页沿同一快照排序，新增数据下次刷新出现；修改/撤权改变 ACL revision 使旧 cursor 410，始终重新授权。没有搜索 q 参数，不能暗示已实现搜索。服务端时间和读取版本定义快照，不能依赖浏览器时间。overview 限制返回 100 个阻塞项和成员，完整列表通过分页接口读取，计数仍基于完整可见集合。

事件当前采用 GET /tasks/{id}/events 轮询，前台 5 秒、错误指数退避至 60 秒；返回 nextCursor 用于恢复，无新事件返回空数组并维持 cursor。首次无 cursor 返回当前可见保留事件起点，事件保留至少 30 天；历史或 ACL 变化使游标失效返回 410。断线/410 后重新读取任务快照与事件，不以遗漏事件推测任务已完成。B3 流式输出仅传建议，失败保留 failed/draft，不用断流当成功。

多人变更：冻结受影响的已接受成员、发起人、验收人及拟新牵头者集合；全部接受才原子应用，任一拒绝整项拒绝。等待期间旧承诺继续；任务版本有其他变化则提案 superseded，必须重提。退出和转交保存原 assignment；新牵头者另收邀请，不直接继承承诺。共享反馈独立于验收；B4 只允许明确选择文本，撤回阻止未来复用，不保证抹去已有副本。

版本变化必须同步 Schema、JSON、样例、测试、客户端和阶段报告。0.x 破坏性变更提升 minor；兼容新增提升 patch，并在集成关登记采用提交；`/api/v1` 不替代契约版本。
