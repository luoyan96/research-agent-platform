# B3 Harness 核查 · 2026-09-30

**固定依赖安装和最小真实调用均通过。** 用户随后明确授权使用本机配置文件；仅通过 Node `--env-file` 注入服务端环境，没有打印密钥、扫描其他凭据或采用替身成功。下表保留首次缺凭据的历史结果，并记录解除阻塞后的验证。

## 官方来源和固定版本

本次联网重新读取 [官方仓库](https://github.com/deepseek-ai/deepseek-harness)、[SDK 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md)、[TypeScript SDK](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/sdk/client) 和 [LlmRuntime](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm)。npm package.repository 指回官方仓库。上游 master 文档会变化；实现以实际安装的固定包导出和类型为准，不把较新 master 当成已安装版本的兼容证明。

| 操作 | 结果 |
| --- | --- |
| `pnpm view @deepseek-ai/dsh dist-tags versions --json` | 当次 latest/next=0.2.0-rc.2；不是所有版本均不可用 |
| 隔离 `.runtime/harness-probe` 安装 `@deepseek-ai/dsh@0.2.0-rc.2`，`--ignore-workspace --ignore-scripts` | exit 0；530 包；没有把探针依赖搬进源码 |
| `node .runtime/harness-probe/node_modules/@deepseek-ai/dsh/lib/bin.js --version` | exit 0，0.2.0-rc.2；仅证实 CLI，不是模型成功 |
| 根 workspace 安装 rc.2 组件 | exit 1，ERR_PNPM_NO_MATURE_MATCHING_VERSION：多项依赖发布于 2026-09-29 09:37—09:42 UTC，不满足既有 1440 分钟限制 |
| 申请持久放宽整个固定版本包族的发布时间豁免 | 自动审批拒绝，理由是安全例外超出安装核查范围；未实施该豁免 |
| 查询固定 rc.1 发行时间 | dsh 0.2.0-rc.1 发布于 2026-09-28T12:34:03.181Z，满足原限制 |
| 固定 `dsh-llm` / `dsh-llm-deepseek-api-key` 0.2.0-rc.1 + Cordis 4.0.4，根 `pnpm install` | exit 0；保留 minimumReleaseAge=1440 和 strictDepBuilds，无豁免、无类型桩 |
| 适配 build / typecheck | 使用真实安装类型；进入根默认检查 |
| 首次 `pnpm check:harness-live`（未配置凭据） | **exit 2**；Harness 返回 MISSING_CREDENTIAL，nonemptyResponse=false；inputTokens/outputTokens/cost/currency 均 null，应用 elapsedMs=11 |

随后执行 `node --env-file=<用户授权配置文件> scripts/check-harness-live.mjs`，**exit 0**：harnessVersion=0.2.0-rc.1，model=deepseek-v4-flash，status=responded，failure=null，nonemptyResponse=true，inputTokens=42，outputTokens=29，elapsedMs=688，cost/currency=null。纯合成提示，maxTokens=32，timeoutMs=30000；未设置自定义 BASE_URL，调用官方 provider。最初缺凭据的失败未发出有效模型请求，不能被改写为成功或零费用。

固定包 integrity（完整图以 pnpm-lock.yaml 为准）：

- dsh-llm 0.2.0-rc.1：`sha512-F5ZlBG8z8o5PfEWeEF/PN9t/A1N/oEErvqmpqE4J8f9mJR85DvBdV+rjDs7OjAbMJsJ8INjkbroruG5NNKDg5A==`
- dsh-llm-deepseek-api-key 0.2.0-rc.1：`sha512-Qi2eXq0WVjYKU3RMiu523He2THnTK2Iek+qS1MMtVB45jwXJ3pVoKE0z30lN2+i368GLIJmsU5DeSWFo6DxRWg==`

## 可重复真实验证

在此独立工作目录被忽略的 `.env` 中配置 `DEEPSEEK_API_KEY`，必要时指定 `DEEPSEEK_MODEL`；仅向执行任务提供文件路径，不把值粘贴进聊天、Git 或报告。默认官方端点无需 DEEPSEEK_BASE_URL；如使用代理，需其支持该官方适配器的 Messages 协议并单独授权验证。

先执行 `node --env-file=.env scripts/check-harness-live.mjs`；成功后按 [B3 联调包](../../docs/development/b3-handoff.md) 启动 API、worker、合成账号和能力配置，执行显式 `check:b3-live`。另运行 `node --env-file=.env scripts/check-b3-resilience-live.mjs`。真实草案创建/修改、授权文本候选、退出发起会话、取消/撤权、provider 拒绝与 worker 中断恢复已验证，逐项证据见 [B3 报告](../../docs/development/reports/B3-backend-2026-09-30.md)。F3 页面以及关闭/重开浏览器的共同验收仍待 G3；确定性测试和根 CI 不替代它。

旧 G0-H 报告只说明当时 0.1.0-rc.5 的安装问题，保留历史不改写。本批已接通受限的真实模型与公共文本能力；没有接入旧本地六工具或进入 G4，不等于完整产品 AI 流程或 G3 已通过。
