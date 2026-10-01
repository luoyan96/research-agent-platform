# B0 架构决定与启动

日期：2026-09-21。范围仅 B0。共享基线 `ed36ac6ca1d2f342d7ca0f36a5c81a64734595ce`，任务分支 `backend/b0-foundation`。运行时结果与契约定义分开：只有健康检查已实现，登录和任务命令尚不可用。

## 选择与依据

| 项目 | 固定选择 | 已核实范围 / 边界 |
| --- | --- | --- |
| 服务器 | Fastify 5.12.5、TypeScript 6.0.3 | registry 可安装；HTTP 集成测试；不用开发服务器模拟后端 |
| Schema | Zod 4.1.12，契约 0.1.0 | 运行时校验、推导 TS 类型、OpenAPI 3.1 和合成 JSON 同源；原有字段未知时用 null |
| 事务库 | Node `node:sqlite` DatabaseSync，WAL + foreign_keys + synchronous FULL + busy_timeout 2000ms | 本机 Node 24.19.0 / SQLite 3.53.3；文件库重开、回滚、跨进程锁已测。原有 Node ≥22.19 CI 矩阵保留；其他 Node 的 SQLite 引擎版本随运行时变化，不能冒称均为 3.53.3 |
| 文件 | 单服务器专用本地文件卷；`BLOB_ROOT` | readiness 真正写入、读取、删除随机探针；无公共静态挂载。B2 才实施附件内容存储和授权读取 |
| 身份 | B1 实施预置账号密码 + 数据库不透明会话 | B0 仅有账号/会话基础表和精确契约，没有可登录身份或绕过入口 |
| 运行分离 | API 与后续 worker 独立进程，共用同机事务库 | worker 预留 `apps/worker`，本批次不创建假 worker、不消费 outbox |

这是面向小组单机的事务服务，浏览器不打开数据库文件。SQLite WAL 允许读写并行但同一时刻一个写事务，所有数据库进程必须在同一台主机、可靠本地文件系统；不支持 NFS/SMB、多主机共享卷和无限并发。事务很短，网络/模型/文件复制不能放在写锁内。需要多主机或测出写入瓶颈时迁移 PostgreSQL，而不是继续扩展 JSON 索引。Node SQLite 接口仍有实验性/版本兼容风险，以 CI 和固定运行时复核，不把本地 ArtifactStore 当权威团队数据库。

核查来源：[Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/)、[Node SQLite](https://nodejs.org/api/sqlite.html)、[SQLite WAL](https://www.sqlite.org/wal.html)、[SQLite isolation](https://www.sqlite.org/isolation.html)。具体可安装版本以锁文件为准。

## 真实目录和命令

| 目录 | 职责 |
| --- | --- |
| `apps/api` | 最小服务、配置、事务连接与迁移命令 |
| `apps/api/migrations` | 有 checksum 的版本化 SQL；不在服务启动时自动迁移 |
| `packages/contracts` | 共享 Schema、类型、状态映射、所有接口的请求响应、合成样例 |
| `integrations/deepseek-harness` | 原适配边界和核查；仍不纳入默认运行依赖 |
| `.runtime`（Git 忽略） | 仅本地开发默认数据库/文件目录；生产必须显式配置绝对路径 |

从仓库根执行，Node ≥22.19（本次实际 24.19.0）、pnpm 11.21.0：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
pnpm db:seed
pnpm api:start
```

默认 `http://127.0.0.1:3100`。`NODE_ENV`、`HOST`、`PORT`、`DATABASE_PATH`、`BLOB_ROOT` 是 B0 配置名；不要将运行数据或凭据提交 Git。默认根目录相对路径由进程 cwd 解析，因此按上面从根启动。生产只接受显式绝对数据路径，禁止 `DEV_AUTH_MEMBER`、`AUTH_BYPASS`、`FIXTURE_MODE`；无开发成员 HTTP 切换。B0 可作为基础服务启动，但没有业务认证，不能当可用产品部署。

```sh
curl http://127.0.0.1:3100/api/v1/health/live
curl -i http://127.0.0.1:3100/api/v1/health/ready
pnpm check:b0
pnpm run ci
```

live=200 只证明进程应答。ready=200 证明当前库迁移匹配、WAL、短事务写读成功及文件卷探针成功；任一失败返回 503。响应始终明示 authentication=not_implemented、harness=not_verified，不等于 G1/G3 可用。没有数据库时不自动建库；修复并迁移后可重新检查。缺目录、只读数据库、锁超时或 checksum 不符不会伪报成功。生产建议只向内部探针开放健康路径；异常正文不含路径/SQL/工具日志。当前 1MiB JSON 请求上限，B2 实现上传时再按契约单独提高上传路由上限。

种子在 development/test 中重复执行仅建立合成 lab 与 A/B/C 成员，不建立密码或会话，不代表多人权限验证。production seed 失败。B1 再增加仅限测试环境的显式凭据提供机制，不能给生产提供固定默认密码。

## 迁移计划、事务和可靠派发

001 已实现 labs、members、auth_accounts、sessions、idempotency_results、outbox、健康探针表、迁移 checksum。每次迁移使用 BEGIN IMMEDIATE，checksum/未知版本失败即停止；重复执行不重复种子或表。结构升级前离线备份，备份需使用 SQLite backup 工具或正常停机后一起处理 DB/WAL，不能随意只拷贝运行中的主文件。本批次不承诺自动降级迁移。

002（B1，未实现）增加 plans/plan_items、tasks、task_access、assignments、deliverables/reviews、task_events。任务以 `(plan_id,item_id)` 唯一映射维持稳定身份；`tasks.version` 正整数；assignment 有一个 active lead 的部分唯一索引；同任务交付 revision 唯一；ACL 关联实验室与成员外键。B2 增加 dependency_edges、change_proposals/decisions、artifact_metadata、access_revision；B3 增加 executions/attempts 与 fencing token。私有能力和个人运行在单独的 owner 范围表，不能混入共同任务 JSON。

每个后续命令在同一短事务内依次检查 session、当前 ACL（包括撤权）、幂等记录、预期版本和合法状态，写业务对象/版本/事件/outbox/幂等结果，再提交。命令逐项前置条件见 `routes.ts` 的 rule 和 OpenAPI description；没有任意写 status 的接口。幂等作用域为主体+命令+资源；同 key 同规范 JSON 的 SHA-256 返回相同结果，同 key 不同负载 409；先复核权限再读缓存。命令记录在相关业务保留期内不自动 TTL 删除，避免旧重试再次产生副作用。资源创建以 lab 为作用域、请求内稳定 key 去重；业务版本冲突不悄悄升级。

确认同时保存稳定任务、邀请/自承担、公有执行意图及事件；没有确认不能派发。认领在写锁中先检查资格和名额，数据库唯一约束兜底，失去竞争返回 ALREADY_CLAIMED，不透露无权读取的获胜者信息。提交与验收绑定具体交付版本；父任务独立验收，succeeded 不等于 completed。

outbox 仅有基础结构，尚未派发。后续 worker 短事务领取 lease（条件更新 status/lease_until/owner），提交后执行网络操作；完成后凭 lease owner、资源版本、ACL revision 与 fence 条件更新。租约到期有限重试，接收端以 outbox ID 去重；每次重试再次查权限、取消、依赖和预算。业务更新和 outbox 同事务避免“已提交但丢派发”；外部效果未知写 uncertain/interrupted 并交人处理，不宣称 exactly-once。晚到结果不能覆盖取消或撤权。浏览器关闭不撤销服务端任务。以上为 B1–B3 实施约束，本批次没有用空 worker 假装可靠派发完成。

文件（B2）：最多 10MiB、JSON base64 上传，任务 ID 和版本必填；验证解码长度、MIME 和权限，随机服务端存储 key，不采用用户文件名拼路径。临时文件与最终文件同卷原子 rename；数据库事务记录哈希/ACL/元数据后返回。失败遗留文件由无引用清理回收；下载逐次鉴权，attachment + nosniff + no-store，不返回路径、不以猜到 ID 当授权。文件系统权限保护服务账号数据，但不声称隔离服务器管理员。
