# 将科研平台部署到已有 ECS

日期：2026-10-01。ECS 当前应用发布为完整提交 `69e52053d5850a195db38db9cde6832b13c91576`，包含 G5a 和 Windows CI 修复；契约 0.6.2、迁移 008、Harness 0.2.0-rc.1。**网页与任务服务已上线并通过部署合成验证；AI 尚未启用，本人账号交付与真实成员试用待完成，G5b/P1 未通过。** 本次文档和 ACME 模板补充不表示服务器应用已切换到新的提交。

用户选择沿用已有 Ubuntu 22.04 ECS、Nginx、systemd 和 Workbench 上传方式。科研平台网页、API、worker、数据库及附件都在 ECS 上运行；成员只需浏览器。服务端使用现有受限 Harness 调用 DeepSeek API，无需 GPU 或成员安装 Harness。当前网页更新仍为快照检查和手动刷新，不从简历系统借用“每五秒同步”的功能承诺。

## 已完成的实例部署与核查

已在用户授权的独立子域名新增 DNS、签发可信 HTTPS 证书，并配置自动续期与 Nginx reload hook。Linux 使用独立 Node 24.20.0、pnpm 11.21.0；通过 GitHub HTTPS 下载上述固定提交，393 个文件的路径与内容摘要均与本地 `git archive` 一致。依赖冻结安装和串行 workspace 构建通过。构建受 systemd CPU/内存上限约束，没有运行全量 CI。

API/worker 使用独立系统账号、目录和 systemd 服务，已设开机启动；API 只监听 loopback 4327。迁移重复执行两次成功。Nginx 配置和两个科研 unit 校验通过；unit verify 同时报告了系统已有 snapd/cloudmonitor 的警告，本次未修改这些服务。

真实 HTTPS 验证采用独立合成实验室及三个正式维护接口创建的测试账号：登录/安全 Cookie、邀请接受、开始、10 MiB 附件上传、成果交付与人工验收、第三人无权访问均通过。API/worker 停写后完成数据库与附件一致备份、新路径隔离恢复；服务重启后任务状态及附件哈希保持一致，权限检查通过。恢复库完整性、已完成任务、附件哈希与旧会话撤销已核对。恢复副本未替代线上数据。浏览器登录页、使用指引交互、正常控制台及实际 390×844 无横向溢出通过；本人尚未设置账号并操作真实任务。

这次未传输模型密钥、未新增模型调用，`B3_AI_ENABLED=0`；使用者可在账号开通后先做手工任务安排。备份位于同一台 ECS，已验证恢复不等于具备异机容灾或自动定期备份。实际网址、配置和证据保存在本地受控交接记录，不写入公开仓库。

通过用户已登录的 Workbench，以普通 Shell 做只读查询：Ubuntu 22.04.4、x86_64、2 个逻辑 CPU；内存 1673 MiB、当时 available 759 MiB，swap 已使用 314 MiB；磁盘余量约 16 GiB。Nginx 1.18.0 与既有招聘服务正常运行。候选端口 4327 当时空闲；拟用代码/数据/配置目录及科研 API/worker 服务不存在。

这些是单次观测，不能证明长期容量充足。API/worker 的内存上限分别为 256/384 MiB、CPU 各 50%（合计至多一个核）。实际启用后 available 约 718 MiB，10 MiB 附件验证后约 623 MiB；两个科研服务无意外重启。AI 调用峰值尚未测量。用户已另行允许在确有内存需要时暂停招聘服务；本轮未暂停，招聘站点保持 200。其他站点的响应与改动前一致，其中主域名改动前已返回 502，本次未处理该既有问题。

实例 IP、连接标识、实际域名配置和运行证据留在本地受控记录，不进入公开部署包。没有读取招聘数据库、环境文件或密钥；仅复制其已安装的 Node 分发文件到科研平台自己的运行时目录，没有改变招聘运行时。只安装/重启科研服务；共享 Nginx 仅做通过配置检查后的 reload。

准备包本机基线：`pnpm run ci` 20 个文件、258 项通过；Shell 语法检查、既有业务端口/非法端口拒绝和非 Linux 平台拒绝通过。本次部署证据来自目标 Linux 和公开 HTTPS，未以本机 CI 替代。后续模型连通性、本人账号和真实成员试用仍需完成。

## 目录、服务与入口

| 项目 | 拟用位置 |
| --- | --- |
| 系统账号 | `research-agent`，无交互登录，只用于本服务 |
| 固定版本代码 | `/opt/research-agent-platform/releases/<完整SHA>` |
| 当前版本链接 | `/opt/research-agent-platform/current` |
| 独立 Node 24 | `/opt/research-agent-platform/runtime/bin/node` |
| 公共运行配置 | `/etc/research-agent-platform/platform.env` |
| 模型秘密配置 | `/etc/research-agent-platform/model.env`，仅 worker 注入 |
| 数据库 / 附件 | `/var/lib/research-agent-platform/data/platform.sqlite` 和 `data/blobs` |
| 备份父目录 | `/var/backups/research-agent-platform`，仅维护者和服务账号可访问 |
| API / worker 服务 | `research-agent-api.service` / `research-agent-worker.service` |
| 新 Nginx 站点 | `/etc/nginx/conf.d/research-agent-platform.conf` |
| 内部 API | `127.0.0.1:4327`，启动前再次核对占用 |

维护人员使用[部署准备包](../../deploy/ecs/README.md)。Nginx 直接提供 `apps/web/dist` 并将 `/api/` 转发给 API；不使用仅支持 loopback Origin 的 `serve-pilot.mjs` 作为公网入口。浏览器、APP_ORIGIN 和证书域名必须一致。数据库/附件目录不放在 Nginx root 下；附件只走既有鉴权下载接口。

## 操作顺序与停止条件

1. **只读核查。** 在已确认的目标 ECS 执行 `bash preflight.sh 4327`。进一步只读取 Nginx 站点名称、监听端口、静态根和证书路径；不输出 `nginx -T` 全文、进程环境或其他项目配置。确认域名、DNS、证书、资源与目录后才生成最终配置。
2. **准备确切版本。** 本地以完整提交 SHA 运行 `git archive --format=tar.gz --output=<新文件绝对路径> <SHA>`，并用 `Get-FileHash -Algorithm SHA256` 记录校验和。通过 Workbench 上传包，ECS 使用 `sha256sum` 核对。源码包不带 Windows node_modules、数据库或秘密配置。保存源 SHA、锁文件和配置修订号。
3. **独立构建。** 在 Linux x86_64 的匹配环境使用独立 Node 24 与 pnpm 11.21.0，执行 `pnpm install --frozen-lockfile`、`pnpm build`。保留 workspace 结构、所有运行期依赖和 `apps/api/migrations`，不只复制 web/dist。密钥不进入构建环境。目标 ECS 内存不足时在其他匹配 Linux 环境构建；不要复制 Windows 原生依赖或修改现有项目 Node/PATH。构建产物传入新的 release 目录，避免覆盖旧版本。
4. **初始化独立运行目录。** 确认目标不存在后创建专用账号和目录。代码及运行时由维护者持有、服务只读；数据/备份目录归服务账号并设 0700，配置文件 root:research-agent 0640，配置目录 0750。Nginx 仅需静态资源及父目录的读/遍历权限。模板中的资源上限须结合核查结果校准。
5. **迁移并建正式账号。** 先保持 AI 关闭。按下方命令迁移两次，再使用生产维护入口创建实验室及各人的独立账号，不能用测试 seed。密码采用安全交互输入，最终只通过 stdin 进入 `operate.js`；不放在 shell 参数、命令历史或聊天里。Windows 的 `pilot-account.ps1` 不能原样在 Ubuntu 运行；执行者须在实际安全终端使用等效 stdin 入口，或提供并验证 Ubuntu 密码交互辅助程序。
6. **接上网页。** 为选定子域名配置 DNS 与覆盖该名称的可信证书；不能默认现有站点的证书覆盖新子域名。替换 Nginx 模板全部占位符。只添加本站配置，先 `nginx -t`，成功后 reload Nginx，不 stop/restart Nginx。API 端口只监听 loopback，不新增公网业务端口。对比操作前后既有站点健康情况。
7. **常驻与验证。** 将审查后的两个 unit 安装到 `/etc/systemd/system`，`systemd-analyze verify` 通过后 daemon-reload，再启用并启动本平台 API/worker。健康就绪后完成两个独立账号的 HTTPS 登录、邀请/承接/交付/验收、附件、刷新、服务重启、撤权和失败显示。进程 active 或首页 200 不等于平台验收。
8. **启用 AI 与恢复演练。** 在用户指定的秘密配置中提供模型连接，仅 worker 读取；不默认复制招聘系统的 Key。API/worker 的 B3_AI_ENABLED 同步改为 1，再沿既有 capability-config 维护入口显式启用公共能力。以获准合成内容验证真实规划及公共文本能力、用量与内存；仅查看 health 不能证明 AI 可用。演练停写备份与新目录恢复后，才将真实资料交给成员使用。

首次迁移示例；前提是目录、配置、构建和 current 链接已经核对完成，API/worker 尚未启动：

```bash
cd /opt/research-agent-platform/current
sudo -u research-agent /opt/research-agent-platform/runtime/bin/node --env-file=/etc/research-agent-platform/platform.env apps/api/dist/manage.js migrate
sudo -u research-agent /opt/research-agent-platform/runtime/bin/node --env-file=/etc/research-agent-platform/platform.env apps/api/dist/manage.js migrate
```

不运行安装脚本也不代表不需要迁移。服务启动不自动执行 migrate，确保新代码不会在首次公开访问时才触发升级失败。

## Nginx 与 systemd 的核对重点

- 原样传递浏览器的 Origin、Cookie、CSRF 和 Idempotency-Key；不能由代理伪造合法 Origin，也不移除 Secure Cookie。当前 API 不信任转发 IP，登录限流按代理地址合并计算；保持此边界，不用信任任意头来解决限流。
- 附件走 base64 JSON，Nginx `client_max_body_size 14m` 给 API 的 14,000,000 字节检查留出空间；正式验收包含附件，不能只测首页。关闭 API 缓存、代理重试和错误页面替换，确保失败不会变成缓存成功。Nginx 的附件缓冲临时文件需纳入运维考虑，模板关闭请求/响应缓冲以减少落盘。
- worker 最长模型调用为 120 秒，模板用 KillMode=mixed 和 150 秒停止超时让父进程先正常收尾；超时强制终止后按现有中断规则审查，不自动重放费用未知的请求。
- API/worker 共用数据库进程维护锁，启停顺序仍需核对。服务限制没有替代代码权限，也不能把同一 OS 账号宣称为完整隔离沙箱。

依据：[Nginx 代理](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[请求体大小](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)、[Ubuntu 22.04 systemd.service](https://manpages.ubuntu.com/manpages/jammy/man5/systemd.service.5.html)。本实例已通过 `nginx -t` / unit verify；其他实例须重新校验。

## 备份、更新与回退

复用[B5a 备份恢复工具](../development/b5a-handoff.md#一致备份与新路径恢复)，同时备份数据库与附件。停止本平台 API/worker 和其他写入者，确认数据库维护锁允许独占，再执行 `recover.js backup`。备份目标必须是新的目录；保存 RELEASE_SHA、CONFIG_REVISION 与 manifest。不能在运行中仅复制 SQLite 主文件。备份另存获准的独立存储，密钥与证书私钥另行保管。

更新时先构建新的 release，保留旧版本；停止本平台进程、完成停写备份后，以新代码迁移并切换 current。新版本验证通过才恢复成员访问。共享 Nginx 不必停机，本平台 API 停止期间请求应明确失败。

回退分两种：若没有数据库迁移且已确认兼容，停止本平台进程后把 current 指回旧版本；若数据库已升级，不直接让旧代码读取新库，使用与备份匹配的代码恢复到新隔离目录，修改本平台配置后复核。恢复会撤销旧会话、标记未结束任务运行待检查；告知成员重登，不抹掉业务历史。没有备份或兼容证据时保留现场，不覆盖原数据库尝试回退。

上线交付物应包含真实网址、个人账号交付方式、运行版本、维护责任人、备份恢复点和已知边界；成员使用[简短指引](../first-use.md)。开发者合成验收后才进入用户和非开发成员的自然任务试用，按[试点计划](../validation-plan.md)判断 P1。
