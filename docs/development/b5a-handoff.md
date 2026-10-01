# B5a 小组试用准备：维护与前端联调包

本批基线 `b8b7f4c1bfffda351dabd4223b932a7fa04126ae`，包含 G4a 最终受测代码 `dc227c56b4e6d39df69a615942fd8c68b8925f83`、共同报告和 G5a 规划。独立分支 `backend/b5a-pilot-readiness`。仅补运行支持；不以准备演练称 G5/P1 通过。服务完整SHA为 `8f609153b4e74d49816af18819dcc07b8a895316`；逐项结果见[B5a阶段报告](reports/B5a-backend-2026-09-30.md)。

## 契约和前端交接

共享契约保持 **0.6.2**（契约来源提交 dc227c56b4e6d39df69a615942fd8c68b8925f83），AdaptiveReply 1.0.0；无 API、DTO 或任务状态机变更。正式账号仍使用 POST /api/v1/auth/login、GET /api/v1/auth/session 与已有任务接口。生产 Cookie 为 HttpOnly、SameSite=Lax、Secure，必须通过同一个 HTTPS Origin；写操作继续验证 Origin/CSRF/Idempotency-Key。维护命令是主机侧工具，绝不从网页代理暴露。

前端 R4 用本包正式模式与合成账号联调：登录→A安排邀请B→B接受/执行/交付→A验收→刷新/重登找回。重置/停用后会话收到401，沿既有登录失效流程；不要改成演示账号或缓存成功。生产断 API 返回真实502，网页不回退 fixture。关闭网页不取消后台；恢复演练后旧会话全部失效。保留原 key/body 重试规则，但重置后的已取消运行需主动检查再发新请求。

## 已核查的配置与边界

原生产配置已经要求绝对 DATABASE_PATH/BLOB_ROOT、HTTPS APP_ORIGIN，禁止 DEV_AUTH_MEMBER/FIXTURE_MODE/AUTH_BYPASS；测试 seed 和 credentials 工具在 production 中拒绝执行。既有登录有密码 KDF、共享限流、会话撤销检查；B3 worker 每次派发/心跳/写回检查账号 disabled，既有 fence 防晚到事件覆盖。

本批新增008（账号维护版本和成功审计）、受控 stdin 维护命令、协作式进程维护锁、完整备份/新路径恢复，以及 loopback HTTPS 静态网页/API代理。官方 Harness 0.2.0-rc.1、模型提示与工具范围保持不变；没有新增依赖，也没有新付费模型路径。

参考环境：Windows，Node24.19.0，pnpm11.21；普通用户终端、不安装系统服务。参考网页只监听127.0.0.1，不能直接供其他机器访问。实际主机、域名/证书、访问范围、维护者和资料范围是之后上线配置项；本包没有替用户做上线。

## 维护操作者与命令

操作者必须已经由主机管理员授予该任务数据库、私有文件和服务配置的读写权。OPERATOR_ID 是审计标签，不是另一套身份认证；能读写数据库的主机管理员属于可信边界。操作终端不得启用输入记录/调试展开密码，不传 password 参数、不放密码进.env、Git、日志、浏览器构建或命令历史。

建议用 PowerShell 安全输入辅助脚本；密码通过 Read-Host -AsSecureString 后只进入子进程 stdin，argv 不包含密码。程序内存短暂有明文，不能声称抵御主机管理员或内存转储。以安全的带外方式把每个人的独立密码交给本人，本工具不发邮件/通知。也可从获准的秘密管理器向 operate.js 管道输入 JSON，不用带明文的 shell here-string。

```powershell
$env:OPERATOR_ID='local_maintainer'
# ConfigFile只包含运行配置；同一操作重试保留RequestId和所有输入。
./scripts/pilot-account.ps1 -ConfigFile .env -Action create-lab -LabId pilot_lab -LabName 'Synthetic pilot' -RequestId pilot_lab_001
./scripts/pilot-account.ps1 -ConfigFile .env -Action create-account -LabId pilot_lab -MemberId pilot_A -Username pilot_A -DisplayName 'Synthetic A' -RequestId pilot_a_001
./scripts/pilot-account.ps1 -ConfigFile .env -Action create-account -LabId pilot_lab -MemberId pilot_B -Username pilot_B -DisplayName 'Synthetic B' -RequestId pilot_b_001
./scripts/pilot-account.ps1 -ConfigFile .env -Action inspect-account -LabId pilot_lab -MemberId pilot_A -RequestId inspect_a_001
./scripts/pilot-account.ps1 -ConfigFile .env -Action reset-password -LabId pilot_lab -MemberId pilot_A -ExpectedVersion 1 -RequestId reset_a_001
./scripts/pilot-account.ps1 -ConfigFile .env -Action disable-account -LabId pilot_lab -MemberId pilot_B -ExpectedVersion 1 -RequestId disable_b_001
```

上述姓名均为合成示例；不要运行最后两个命令来初始化正常账号。查询只显示账号ID/登录名/disabled/维护版本，不返回密码散列。首次账号版本1；重置/停用使其+1。维护版本独立于成员业务版本。用户名全库唯一，命令限定labId和memberId；不同实验室不得重置同名ID。

| 动作 | 重复/失败与影响 |
| --- | --- |
| create-lab / create-account | 原requestId+原内容返回原成功结果；换key但身份已存在则拒绝，不覆盖资料/密码；同key改内容或操作者则REQUEST_CONFLICT |
| reset-password | expectedVersion冲突拒绝；撤销该账号全部旧会话，取消该账号 queued/running/waiting_input 并递增fence；晚到内容丢弃，只允许既有用量记账；新密码可重新登录 |
| disable-account | 同样撤销会话/取消执行，禁止再次登录；若是公共能力owner还停用该能力、递增配置代次，取消依赖旧代次的在途工作；不删除/转交任何承诺或交付 |
| inspect-account | 当前状态只读；历史重试结果不等于当前状态，维护后用inspect确认 |

账号停用不是任务撤权/退出：其他有权成员仍可看到该成员原承诺，协调者需按原协商、取消或转交流程另行处理。重置不隐式重新启用已停用账号；本批不提供重新启用、账号删除或所有权转移命令。

维护事务与审计一起提交：maintenance_audit存操作ID、操作者、lab/member、时间、动作和无秘密结果；账号密码只存随机盐scrypt。请求摘要用数据库签名key的HMAC，不保存原请求或无盐密码摘要。失败全部回滚、非零退出，stderr只有脱敏错误码；失败不伪装成功审计，由主机操作者保存脱敏退出记录。操作返回丢失可用原内容重试；若忘记原密码输入则先inspect，不盲目覆盖。恢复旋转签名key后不要重放旧维护requestId，先inspect再发新操作。

## 构建、升级和启动

先用本包备份工具备份G4a旧库（支持已知001—007前缀），停止所有旧版本API/worker及其他数据库写入者，再升级008。新进程锁只能识别新入口注册的进程，不能自动证明旧二进制或手工SQLite连接已停写。不要绕过入口嵌入服务后声称受锁保护。

```powershell
pnpm install --frozen-lockfile
pnpm build
node --env-file=.env apps/api/dist/manage.js migrate
node --env-file=.env apps/api/dist/manage.js migrate
# 分别在三个本任务终端启动；不是系统服务。
node --env-file=.env apps/api/dist/main.js
node --env-file=.env apps/api/dist/worker.js
node --env-file=.env scripts/serve-pilot.mjs
```

私有.env所需配置名与示例（路径必须换成自己的隔离目录；示例不含密钥）：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3100
APP_ORIGIN=https://127.0.0.1:4443
API_UPSTREAM=http://127.0.0.1:3100
DATABASE_PATH=D:/pilot-private/data/platform.sqlite
BLOB_ROOT=D:/pilot-private/data/blobs
TLS_CERT_FILE=D:/pilot-private/tls/server.crt
TLS_KEY_FILE=D:/pilot-private/tls/server.key
B3_AI_ENABLED=0
DEEPSEEK_MODEL=deepseek-v4-flash
OPERATOR_ID=local_maintainer
CONFIG_REVISION=pilot-config-v1
```

DEEPSEEK_API_KEY仅供服务端，需要真实AI时由独立秘密配置注入API/worker，并令B3_AI_ENABLED=1；公共能力首次启用沿用 `node --env-file=.env apps/api/dist/capability-config.js enable pilot_lab pilot_A`，owner必须已有有效账号。没有密钥就保持手工任务可用、AI明确不可用。TLS证书/私钥只给网页代理；参考代理只读取证书和网络配置，不把环境送到前端。实际运行建议分别最小化API/worker和网页进程环境；不要把同一含Key文件用于Vite构建。

生产静态资源来自 apps/web/dist；代理仅转发/api/到loopback API，保留Origin/Cookie，不信任客户端Forwarded/X-Forwarded头。代理不信任外部IP，因此API限流按同一代理IP计算（40次/15分钟）；小组需避免集中反复登录，遇429等待，不通过信任任意转发头绕过。HTTP直连API不是成员登录入口，Secure Cookie应由HTTPS浏览器管理。网页无目录列表、隐藏路径访问或.env静态暴露。

本地合成证书仅用于演练，未安装到系统信任；正式访问需要获准证书。生产专项用既有OpenSSL生成一天有效的临时loopback证书，HTTPS客户端显式信任该证书，并验证SAN，不关闭全局TLS验证：

```powershell
$env:OPENSSL_BIN='D:/git/Git/usr/bin/openssl.exe' # 替换为本机已安装的工具
$env:RELEASE_SHA='<受测完整40位SHA>'
pnpm check:b5a-production
```

专项自动创建独立.runtime目录、合成非seed账号、临时证书，执行HTTP协作和恢复后停止全部自有进程；不注册真实成员、不调用模型。需要已完成build。R4浏览器、移动视口及成员可操作性由前端另验。

## 健康、停止、重启和故障处理

GET /api/v1/health/live只证明API存活；GET /api/v1/health/ready真实检查DB读写、迁移、私有附件读写。harness仍为not_verified，不把健康检查当模型成功。网页代理502说明API不可达。可用 `curl.exe --cacert <证书> https://127.0.0.1:4443/api/v1/health/ready` 检查，不在命令中放密码或Cookie。

先停止接入网页，再在各自API/worker终端Ctrl+C，并等待进程退出；worker会等待当前有限调用完成或超时。需要强制结束只针对自己确认的PID，记录可能已产生外部用量；重启后过期租约标interrupted，不盲目重放结果未知的调用。不要用按名称杀全部node进程的命令。常规重启保留会话和已确认事实；没有浏览器时worker照常工作。

启动与备份以数据库路径旁的 `.processes` 和 `.maintenance-lock` 协作。备份/迁移遇活跃PID拒绝；僵尸记录只有PID已不存在才清理，PID复用会保守拒绝。进程若在锁持有期崩溃，锁可能残留：维护者先确认该环境所有API/worker/维护进程已停，再核对完整路径，移除这个空维护锁目录后重试。不要删数据库、WAL、进程记录来强行绕过仍存活进程。

401重新登录或联系维护者；重置/停用不恢复旧会话。503检查迁移、目录权限、Origin及AI配置，手工协作不依赖模型；409重取当前版本，保留用户输入；失败不要改key来隐藏重复提交。共享健康就绪不代表公共能力已启用。私有附件缺失/哈希错误时停止使用该恢复点并排查备份，不能把缺失附件当空材料继续。

## 一致备份与新路径恢复

采用明确停写方案：停止网页入口、API、worker、其他维护/旧版进程及直接数据库连接，再执行备份。工具以独占维护锁阻止本版新进程启动；使用 SQLite `VACUUM INTO` 取得包含WAL的逻辑快照，并复制数据库引用的全部私有附件（包括已撤回附件），验证字节/哈希。它不是运行中只拷贝主文件。[SQLite官方快照语义](https://www.sqlite.org/lang_vacuum.html)说明了此选择；本方案停写同时保证附件一致。

```powershell
# BACKUP_PATH的父目录预先由维护者创建并限制ACL，目标目录必须不存在。
$env:BACKUP_PATH='D:/pilot-private/backups/point-001'
$env:RELEASE_SHA='<本次运行完整40位SHA>'
node --env-file=.env apps/api/dist/recover.js backup
# 仅在新隔离目录恢复；不能覆盖原库或已有目录。
$env:RESTORE_ROOT='D:/pilot-private/restore-drill-001'
node --env-file=.env apps/api/dist/recover.js restore
```

备份包含database.sqlite、blobs和最后写入的manifest.json。manifest记录releaseSha、配置修订、契约、迁移校验和、非秘密Origin/model/启用标记、文件大小及SHA-256；不打包.env、DeepSeek密钥、TLS私钥或其他本机目录。数据库本身包含密码散列、会话/签名密钥和受限研究内容，因此**整个备份仍是高敏感资料**，只给获准维护者，用独立受限存储保管，不能进Git/公网。POSIX mode不是Windows ACL保证；Windows需在存放前用文件夹安全属性确认只有维护账号和获准备份管理员可访问，并在外部介质采用组织批准的加密方案。

所需DeepSeek密钥与TLS私钥独立保存于获准秘密保管处；没有这些密钥也应可恢复任务/账号资料，但不能声称AI或原HTTPS身份可用。manifest不代替秘密备份。保存确切源代码SHA/锁文件及非秘密配置修订，不以“用了最新版”替代恢复依据。

恢复先校验manifest、数据库hash和每个附件，再创建全新目录，检查数据库完整性/外键、所有附件引用和字节；按本版已知迁移补008，重复迁移安全。缺文件/损坏/不匹配失败，不覆盖原环境；失败产生的目标保留待审查，下次选择另一全新路径，不强行复用半成品。只有restore-receipt.json成功回执和后续实际API验证一起构成恢复证据。

恢复副本统一撤销旧会话、旋转签名key（旧游标失效）；queued/running/waiting_input全部改interrupted/RESTORED_REQUIRES_REVIEW并增加fence，保留请求、尝试、历史用量和业务承诺。历史pending/leased通知意图标uncertain，不自动发送。成员重新登录后审查材料和任务版本，再显式重试；如果调用用量/外部结果未知，原B3规则继续拒绝盲重试。成功/失败历史不改为新成功。恢复不回滚原库、不重新启用停用账号、不撤销原任务/附件的撤权记录。

恢复配置须把DATABASE_PATH改为新目录/platform.sqlite、BLOB_ROOT改为新目录/blobs，用独立端口/Origin/网页代理联调，不把恢复副本连到真实外部通知或同时派发原环境的工作。核对任务、承诺、交付、附件字节及越权/撤权结果后，由用户决定是否上线；本批只演练。

## 验证与停止点

默认 `pnpm run ci` 保留原生产隔离与B0进程检查，覆盖008、维护/恢复代码构建/类型、R1—R3新增服务测试、G1—G4a回归及脚本语法；`pnpm check:b5a-production` 单列真实HTTPS生产模式演练。没有新模型提示/工具/底座变化，不为文案或运维路径重复付费；确定性晚到结果测试不冒充真实AI。

仅B5a后端准备；R4和共同G5a待验收。实际小组参与者、主机/域名、材料访问和运维值守需用户另行确定。不开公网、不安装系统级常驻服务、不部署、不发通知、不合并main，不实施G4b。G5b真实使用和P1继续未通过。
