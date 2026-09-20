# DeepSeek Harness 适配源码

**状态：待联调，不属于默认 workspace、构建或 CI。** 这里保存原 `dsh-research-plugins` 的六项工具注册方式，已改为使用本仓库科研核心与完整十项 Skills。尚未证明它在某个干净安装的 Harness 版本中可用。

## 为什么暂时独立

2026-09-20 的安装检查发现：原插件声明的 `@deepseek-ai/dsh-tools@0.1.0-rc.5` 在公开 npm registry 无法取得；当时公开的 `0.0.1-rc.1` 依赖链又因缺少 `@deepseek-ai/dsh-type-meta` 返回 404。这是已经观察到的依赖问题，不代表所有 Harness 发行方式都不可用。

因此保留原代码对应的 SDK 版本约束，不用手写类型替身或关闭类型检查来宣称兼容。这里的 `package.json` 记录待解决的依赖，不承诺直接 `pnpm install` 可成功。根目录的锁文件仅覆盖两个可独立验证的基础包。

## 迁入接口

`research_health`、`project_create`、`project_get`、`artifact_save`、`artifact_list`、`artifact_get`。它们使用本地存储，不提供团队授权、论文检索、PDF 解析、引用真实性验证或实验执行。

所有 Skills 从 `@research-agent-platform/research-skills` 取得，并声明对应本地参考目录，不再保留第二份精简正文。没有迁入依赖旧界面结构的侧栏挂载代码。

## 接入验收

1. 选择一个完整可获取的 Harness 发布版本或固定源码提交，解决并记录 SDK 解析方式。
2. 在干净环境安装并构建适配包，验证插件装载、工具和十项 Skills 注册、卸载行为。
3. 经真实 Harness 工具通路创建项目、保存成果、重启并读取，核对失败处理与记录。
4. 将兼容验证纳入检查后，再给出组员可执行的安装说明。

当前参考源码提交是 Harness `47f943859b`（2026-08-13）。产品目标和该本地快照的状态见[产品规划](../../docs/product-plan.md)。常开服务器、成员授权与无人在线调度由平台服务补齐，不由这个插件自动获得。
