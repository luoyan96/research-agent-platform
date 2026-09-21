# 可直接复制的开发与验收指令

日期：2026-09-21。代码仓库：[research-agent-platform](https://github.com/luoyan96/research-agent-platform)。这些 prompt 只启动其指定批次，不是本文件已经执行过的工作。

首次以远端 `docs/product-requirements-review` 的最新文档提交为基线；若该分支已合并，使用包含这些文件的 main。保留已有改动，每个 AI 用独立工作目录 / worktree 和任务分支。后续阶段使用上一关通过的集成提交，不能一直从最初文档分支重开。

先发下面两个“第一步”。后端先建立契约，前端可并行做 F0 视觉准备；两边结束后发“G0 验收”，通过再分别发下一阶段指令。

## 后端第一步 B0

```text
你负责 Research Agent Platform 的后端。本轮只完成 B0，完成后报告并停在该批次，不提前铺开 B1–B4。

仓库：https://github.com/luoyan96/research-agent-platform
首次从 docs/product-requirements-review 的最新共享文档提交新建独立任务分支；如果该分支已合并则使用包含文档的 main。保留已有改动，不切换或重置别人正在工作的目录。

先读 AGENTS.md、README.md、docs/roadmap.md，以及 docs/development/README.md、backend.md、contracts.md、acceptance.md；再读 docs/task-allocation.md 和 integrations/deepseek-harness/README.md。查看 docs/design/README.md 及相关 PNG。

实施 backend.md 的 B0：核实并记录服务端、事务数据库、文件存储、认证和目录方案；把接口语义草案变成共享可执行 Schema/类型、精确请求响应与可验证合成样例；给出契约版本和提交。提供最小可启动服务、真实健康检查、必要基础迁移及后续事务/可靠派发方案。

核查固定 Harness 版本的安装与最小真实调用。若缺依赖或必要凭据，准确记录阻塞和对 B3 的影响，并继续不依赖它的基础工作；不要打印凭据、用 mock 成功冒充联调或复制上游源码。

采用合理且已核实的实现选择，不要逐项向用户询问日常技术细节。遵守私有能力、身份、版本、幂等和真实状态要求。不要把现有本地 ArtifactStore 当作多人数据库。

运行 pnpm run ci 和 B0 专项检查，确保新增包确实被检查覆盖。按 acceptance.md 提交 G0-B/G0-H 阶段报告及可审查 PR，附启动命令、契约位置/版本、接口样例、实际验证、未完成事项。把前端需要的资料写入仓库；不自行部署、合并或进入 B1。
```

## 前端第一步 F0

```text
你负责 Research Agent Platform 的前端。本轮只完成 F0，完成后报告并停在该批次，不一次性实现整个平台。

仓库：https://github.com/luoyan96/research-agent-platform
首次从 docs/product-requirements-review 的最新共享文档提交新建独立任务分支；如果该分支已合并则使用包含文档的 main。使用独立工作目录/worktree，保留已有改动，不操作后端 AI 的工作目录。

先读 AGENTS.md、README.md、docs/roadmap.md，以及 docs/development/README.md、frontend.md、contracts.md、acceptance.md。打开查看 docs/design/README.md 指向的设计图片，尤其 01-entry.png、08-lab-overview.png、09-task-detail.png。

实施 frontend.md 的 F0：建立可运行的前端骨架，忠实还原需求入口、实验室总览、任务详情三页及其导航，保持简洁入口、无固定侧栏、暖白与绿色的视觉方向。补充空数据、加载、失败、长标题和窄屏情况，并做基本键盘可用性检查。

优先消费后端 B0 交付的契约。若 B0 尚未完成，可先做视觉准备，使用明确标识“演示数据·尚未连接服务”的隔离 fixture adapter；契约确定后校验样例。不自行发明最终接口或另一套状态机，不把浏览器本地状态当真实任务服务，真实模式不得静默回退演示数据。

记录前端栈和依赖版本，协调共享契约、workspace 和根锁文件变更。生产配置不得包含开发身份切换、演示回退或服务端凭据。

运行 pnpm run ci 及前端专项检查，确保新增应用被覆盖；在实际浏览器验证三页，与设计图比较并修正，记录截图、导航和错误状态。按 acceptance.md 提交 G0-F 报告及可审查 PR，说明已演示和未接通的功能、启动方法、契约版本及剩余限制。不自行部署、合并或进入 F1。
```

## G0 验收

```text
请验收 Research Agent Platform 的 G0。先读 docs/development/README.md、contracts.md、acceptance.md，以及前后端的阶段报告和 PR。找出两边的实际代码提交、契约版本和启动命令，不根据总结文字直接判定通过。

在独立集成目录检查 G0-B、G0-F、G0-I、G0-H：共享契约与样例校验、最小服务真实健康状态、三页浏览器预览与设计对照、演示/真实模式分离、依赖和锁文件集成。记录是否真正接通 Harness；核查完成但未接通必须分开写。

修复本关范围内的具体问题，保留所有已有改动；未能验证的项目记为未验证并说明阻塞。输出可复现证据、通过/失败/未验证表、集成基线及下一阶段依赖。不自行部署、合并或宣称尚未实施的功能完成。
```

## 后端下一批示例 B1

```text
继续 Research Agent Platform 后端 B1。先读取已通过的 G0 报告，采用其中记录的集成基线和契约版本，在独立任务分支工作。若 G0 仍有影响 B1 的未通过项，先修复并记录。

按 docs/development/backend.md 实施 B1，范围为真实成员身份、权限、持久化方案和任务、确认去重、邀请接受/拒绝、原子认领、文本交付与版本验收。提供合成 A/B/C 成员用于联调。不要把模型生成或 Harness 执行假装为已完成；G1 可以用手工草案。

通过 docs/development/acceptance.md 的 A1–A5 服务侧验证，使用真实事务数据库测试重试、并发、越权和重启持久化。同步契约、样例和启动说明，运行 pnpm run ci 与新增服务检查。提交阶段报告及 PR，列出前端联调需要的基线和接口；完成后停在 B1，不自行部署或跨阶段。
```

## 前端下一批示例 F1

```text
继续 Research Agent Platform 前端 F1。读取 G0 报告，采用通过的集成基线和共享契约版本，在独立分支实施 docs/development/frontend.md 的 F1。对照已交付的 B1 接口完成真实身份、草案编辑与确认、成员承接、文本交付、退回修改和验收。

若 B1 接口尚未交付，可用同契约的显式开发演示先完成相关组件，但 F1 验收必须连接真实服务。模型规划未实现时清楚显示不可用并允许手工草案，不伪造 AI 建议。

用两个独立登录会话完成 A1–A5 的浏览器联调，覆盖请求失败、版本冲突、重复点击和刷新恢复。核对页面与后端状态一致，运行 pnpm run ci 和前端/端到端检查，提交截图、操作证据、阶段报告及 PR。完成后停在 F1，不自行部署或跨阶段。
```

## 后续阶段通用指令

将下面的“阶段”替换为实际要做的 B2/F2、B3/F3 或 B4/F4；只发送给对应角色。

```text
继续 Research Agent Platform 的指定阶段：[填写 B2/F2、B3/F3 或 B4/F4]。

读取 docs/development/README.md、对应 frontend.md/backend.md、contracts.md、acceptance.md，以及上一关已通过的阶段报告。以报告记录的集成提交和契约版本为基线，在独立分支实施本阶段；保留已有改动。

只完成该阶段范围和前置缺陷，按相应 A 编号提供可复现测试与真实联调证据；不将演示、真实服务、真实模型/Harness 结果混写。涉及共享契约变更，同步版本、样例、服务和客户端，不破坏其他角色工作。

执行适当检查与 pnpm run ci，确保新增代码被覆盖。提交阶段报告与 PR，说明实现、验证、阻塞、限制和下阶段依赖；完成后停在本批次，不自行部署或合并。
```

验收后续关口时，将“G0 验收”中的编号替换为目标 G1–G4，并使用 acceptance.md 对应案例及双方报告。G5 使用真实组内任务，单独记录试点结果。
