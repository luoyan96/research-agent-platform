# G0-H 核查，2026-09-21

核查完成；Harness 可用性未通过，B3 真实执行仍阻塞。根 CI 不覆盖适配构建或模型调用。

固定候选：上游源码 `47f943859bef60e4160492346772ded9b24f765a`（此前短 SHA 47f943859b），对应本地参考版本 0.1.0-rc.5；现有适配要求 `@deepseek-ai/cordis@4.0.1`、`@deepseek-ai/dsh-skill@0.1.0-rc.5`、`@deepseek-ai/dsh-tools@0.1.0-rc.5`。本次没有更换到不兼容的 latest/next，也没有复制上游源码。

环境：Windows、Node 24.19.0、pnpm 11.21.0；网络放行后访问公开 npm registry，排除了沙箱网络不通造成的假“缺包”。只检查变量是否存在，不读取或打印值；本任务进程 `DEEPSEEK_API_KEY`、`DSH_API_KEY` 均未设置。没有搜索其他目录内凭据，不能推断整台机器没有凭据。

| 操作 | 实际结果 | 结论 |
| --- | --- | --- |
| `pnpm view @deepseek-ai/dsh-tools@0.1.0-rc.5 version` | ERR_PNPM_PACKAGE_NOT_FOUND / No matching version | 固定工具 SDK 不可由本次 registry 请求取得 |
| `pnpm --dir integrations/deepseek-harness install --ignore-workspace --ignore-scripts` | exit 1，ERR_PNPM_NO_MATCHING_VERSION，首先报 dsh-skill@0.1.0-rc.5；latest=0.0.1-rc.1，next=0.1.5-rc.2，alpha=0.1.6-alpha.2 | 干净独立目录的真实安装失败；不是适配构建成功 |
| `pnpm view @deepseek-ai/dsh-tools@0.0.1-rc.1 dependencies --json` | schemastery ^3.18.1-rc.1 | 仅检查旧公开版本元数据，不当作兼容替代 |
| `pnpm view @deepseek-ai/dsh-type-meta version` | ERR_PNPM_FETCH_404 | 当次访问仍不可取得；没有将这一条误称完整旧依赖链的重新安装结果 |
| 适配 typecheck / 插件装载 / 最小工具调用 / 真实模型 | 未执行，安装先失败；当前进程也无上述模型凭据 | 未验证，不报告成功 |

pnpm 在缺版本错误后另出现 Windows libuv `UV_HANDLE_CLOSING` assertion；这不改变明确的 package/version 缺失证据。没有提交原始终端环境、授权头或个人运行日志。

预定最小真实通路：固定候选安装和构建通过 → Harness 装载插件 → 确认 6 工具及 10 Skills 注册 → 通过 Harness 工具调度调用 research_health、project_create、artifact_save → 重启后 project_get/artifact_get 对照哈希 → 检查卸载与失败。不能通过直接调用底层 ArtifactStore、手写类型替身或 mock 注册器声称联调完成；本轮没有这样做。真实模型规划/工具执行还需服务端模型配置、受限输入和预算。

恢复 B3 的前置：提供可完整取得的固定发行版本或在独立上游 checkout 构建该固定源码（依赖仍需真实验证），核对其工具/Skills 接口并通过适配 typecheck、插件生命周期及上述真实通路；之后再使用必要凭据进行合成模型调用。当前插件只有本地项目/成果工具，不能直接接入多人服务：B3 必须由平台授权上下文约束输入、公开能力与输出，不把原本地工作目录接口暴露成跨成员文件访问。

此阻塞不影响 B1/B2 人的任务协作；不能因此提前编写或通过 B3，也不在 B0 暗中 vendor 上游。
