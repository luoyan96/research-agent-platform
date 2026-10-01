# 任务协作、真实执行与授权复用

F5a 已通过 [G5a 共同验收](../../docs/development/reports/G5a-overall-2026-09-30.md)，实际多人部署与真实试用尚未完成。首次使用见[成员短指引](../../docs/first-use.md)和页面 `#/help`。正式模式按 [B5a 联调包](../../docs/development/b5a-handoff.md)启动生产静态网页、同源 HTTPS 代理、API/worker，并用受控维护命令开通独立合成账号。下述 A/B/C 是历史开发回归环境，不能替代 R1/R4 正式账号验证。前端 F5a 没有新依赖或模型路径变更。

真实模式支持密码登录、草案找回、授权总览/待处理事项、成员当前可见承诺、本人自报可用时间，以及原 F1 手工方案、邀请/认领、文本交付和验收。任务详情还支持时间填写、依赖/阻塞及复核恢复、范围/时间变更接受或拒绝、退出转交、取消/撤权和附件版本。F3 已接通自然语言规划/同草案修改、授权进度与可承接查询、公共文本能力和后台运行，见 [G3 共同报告](../../docs/development/reports/G3-overall-2026-09-30.md)。任务数和人数不代表人员负荷。沿用原生 TypeScript、Vite、图标、样式和轻量 hash 导航，无固定侧栏。

先按 [B4a 联调包](../../docs/development/b4a-handoff.md) 在自己的工作目录构建、迁移、准备合成账号；API 运行于 `127.0.0.1:3100`，`APP_ORIGIN=http://127.0.0.1:4175`。另开终端运行：

```sh
pnpm --filter @research-agent/web dev --port 4175
```

打开 `http://127.0.0.1:4175/`，用本地 `.runtime/test-credentials.json` 的账号登录。A/B/C 要用独立浏览器 profile/context；同一 profile 的多个标签共享 cookie，不能当不同身份。凭据文件被 Git 忽略，不截图、不上传。前端无身份切换、服务端密钥或 `VITE_*` 认证变量，`/api` 同源代理保留 Origin/CSRF 校验。

F4a 在任务上下文增加结论留存/主动复用，入口增加本人请求历史；维护者可试跑并启停公共方法。普通成员可在原任务展开“我在此任务的样例授权”找回和撤回本人共享，不必拥有维护者权限。具体范围和后续试用准备见共同报告。

操作路径：入口 → 手工创建方案 → 保存 → 退出重登后从“我的已保存草案”找回 → 编辑/确认 → 任务详情。`#/plans` 分页列本人草案，已确认方案单独查看；确认后移出草案。入口优先呈现本人待回应/验收，可展开近期可推进事项；`#/lab` 切换 lab/mine，按需展开人员安排，再进入 `#/availability` 更新本人可用时间。B 承接后开始、提交；A 退回，B 重提，A 验收，沿用原 F1 组件。未保存输入只在当前页面内存保留，不冒充服务端草案。

错误保留输入和原请求；“重试同一请求”复用原 key/原正文。409 不自动换版本：读取最新状态、比较，再明确放弃原请求并重新确认。不同意图使用新 key；命令在途屏蔽重复点击。服务/契约/权限错误不回退演示数据。验收不共享私有方法或反馈。

当前契约 **0.6.2**，AdaptiveReply **1.0.0**；G4a 最终受测代码 `dc227c56b4e6d39df69a615942fd8c68b8925f83`。见 [共同报告](../../docs/development/reports/G4a-overall-2026-09-30.md)。下述 B3 来源仅作历史：B3 服务 `c350a81f38c27d74303e42d98bdb406c4d341385`，F3 交付 `77f432fdaaff4590504925689fea66e4e320b46a`，共同 F3-01 修复 `65c6a70c43feca8a04c83b15c7823c8fb4e25839`。共享 Schema 校验请求/响应；AI 内容仅以受控组件呈现。前端未增加依赖，固定 Harness runtime 与根锁文件来自 B3。

首次使用可阅读[成员短指引](../../docs/first-use.md)，或在入口按需展开帮助。`#/help` 不依赖登录/API；正常入口默认不展开。

操作路径：入口输入需求并发送 → `#/planning/<id>` 轮询 → 打开完整草案编辑/确认；同草案修改须绑定其版本。任务内“公共能力运行”上传并授权文本材料 → 查看运行与引文 → 明确提交候选 → 指定版本验收。生成成功不代表任务完成；历史回复重读后显示当前方案状态，已确认方案只读。

先按 B3 交接为 API/worker 配置同一数据库及 AI 环境、启用合成实验室公共能力；Vite 终端不加载密钥。真实运行仅支持本任务的 UTF-8 text/plain，未开放 OCR/联网/私人方法。启动与脚本详见 [F3 报告](../../docs/development/reports/F3-frontend-2026-09-30.md#启动与重跑)：`check-f3-browser.mjs` 需真实 API+worker，会消耗模型用量；`check-f3-resilience-browser.mjs` 自行管理测试 API/worker；`check-f3-ui-browser.mjs` 不启动 worker，仅验证真实排队/冲突/取消。各用独立合成库，不能把后一项当 AI 成功证据。

排队、运行及失败的本人生成请求可从入口“我的生成请求 · 找回未完成与失败请求”找回，不依赖收藏 URL。已生成草案从草案列表找回，运行从任务/待办找回。

任务中展开“变化与异常”：报告受阻 → 复核前置影响 → 显式恢复；提议范围/日期/依赖 → 必要成员回应 → 全部接受才应用。拒绝保留旧承诺。退出可指定候选人，但需另行接受；撤权/取消不会宣称追回已下载副本或外部结果。附件先上传并重读成功，才可勾选到交付；撤回后元数据和交付引用保留，内容禁止下载。草案中填建议/硬截止/检查节点（草案不能预写成员承诺）；邀请接受或认领时本人可填承诺日期，未知留空。

新增专项：`node apps/web/scripts/check-f2b-browser.mjs`，配置 `F1_BASE_URL`、`F1_CREDENTIALS_FILE`、`PLAYWRIGHT_MODULE`、`F1_BROWSER_CHANNEL=msedge`、`F2B_EVIDENCE_DIR`。API 需先启动；使用独立合成数据库，避免多轮验证互相消耗真实登录限流。G1、F1-01 和 A9a 脚本继续保留。

总览数字为全量授权计数，卡片为当前分页，不能相互替代。快照读时刻可见，点击刷新获取更新；可见的列表及任务详情每 15 秒检查一次（页面读取后至少等待 15 秒，通常 15–30 秒发现失效），数据/权限变化、过期或失败即清除旧组合并提示重同步。任务失效后清除呈现并保留未提交输入及原请求；重读时比较版本，不能直接覆盖。草案/可用时间表单不后台覆盖；浏览器离线事件立即清除旧内容。服务快照到期也会清理视图，重新读取后恢复。

真实浏览器自动回归脚本 `scripts/check-f1-browser.mjs` 使用已安装 Playwright 1.62.1；通过 `PLAYWRIGHT_MODULE` 指向外部安装的 `index.mjs`，或由环境提供 `playwright` 包。`F1_BROWSER_CHANNEL=msedge` 可使用本机 Edge。先构建/迁移/准备凭据并启动上述 Vite，停止自己占用 3100 的 API 后，从根运行：

```sh
node apps/web/scripts/check-f1-browser.mjs --manage-api
```

脚本管理自己启动的 API（含重启），创建三个独立 cookie context，通过真实 UI/HTTP 验证 A1–A5；唯一请求注入是主动断网失败，不伪造成功响应。截图/不含凭据的结果默认写入 `.runtime/f1-browser`；可用 `F1_EVIDENCE_DIR` 指定目录。默认 UI URL 4175，可用 `F1_BASE_URL` 指定；`F1_CREDENTIALS_FILE` 指定本地凭据文件。脚本会新增合成任务，不重置已有数据库。它作为显式本地联调检查，不要求默认 CI 安装浏览器；根 CI 自动覆盖前端编译/类型/单测/契约和生产隔离，以及后端真实 HTTP 事务测试。

F2a 专项在真实 B2a 已启动时运行 `node apps/web/scripts/check-f2a-browser.mjs`，沿用 `PLAYWRIGHT_MODULE`、`F1_BROWSER_CHANNEL`、`F1_BASE_URL`、`F1_CREDENTIALS_FILE`，并用 `F2A_EVIDENCE_DIR` 指定截图目录。默认凭据 `.runtime/f2a/credentials.json`、URL 4177；请显式设置以匹配实际服务。脚本会新增合成资料。频繁重跑多个登录场景会触发真实 15 分钟限流，应等窗口结束或使用新的独立合成数据库，不能修改生产限流来通过测试。

F2a-01 已在共同集成代码中修复：首页两个“我参与的”入口会清除旧实验室范围与状态筛选，恢复本人全部任务；新增真实浏览器回归。F2b 本批结果见 [阶段报告](../../docs/development/reports/F2b-2026-09-29.md)。本批已通过 [G2 共同报告](../../docs/development/reports/G2-overall-2026-09-30.md) 的独立复核；此前证据见 [G2a 共同报告](../../docs/development/reports/G2a-overall-2026-09-29.md)。原交付证据见 [F2a 报告](../../docs/development/reports/F2a-2026-09-29.md)，原主线见 [F1 报告](../../docs/development/reports/G1-F-2026-09-21.md)。以下保留 F0 的开发演示说明，不能用它代替真实验收。

## F0 开发演示（隔离保留）

只实现需求入口、实验室总览、任务详情及其导航。任务与承诺、文献与交付均为合成展示，不代表后台已经执行。没有登录、任务写入、真实 AI 或本地任务持久化。

## 启动

从仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm --filter @research-agent-platform/contracts build
pnpm --filter @research-agent/web dev:demo --port 4173
```

打开 `http://127.0.0.1:4173/`。入口 `#/`、总览 `#/lab`、详情 `#/tasks/proposal`。六类需求按钮只填入同一个文本框，不创建六套任务入口。点击未接通动作会说明其限制，不会显示成功结果。

页面下方的“预览状态”支持正常、空数据、加载、失败和长标题。也可用 `?scenario=empty#/lab`、`?scenario=error#/lab`、`?scenario=loading#/tasks/proposal`、`?scenario=long#/tasks/proposal`。加载场景延迟 60 秒；离开页面会取消读取。未知任务 ID 返回不可访问提示，清除旧详情。

```sh
# 默认开发模式不加载任何演示数据
pnpm --filter @research-agent/web dev --port 4174
# 生产资源构建与本地预览
pnpm --filter @research-agent/web build
pnpm --filter @research-agent/web preview --port 4174
pnpm --filter @research-agent/web check:production
```

`dev:demo` 是唯一演示开关；无 `VITE_*` 凭据或身份变量。生产构建拒绝 `--mode demo`，演示模块经编译常量裁剪；真实模式失败不回退。查询参数只选择开发场景，无法打开生产 fixtures。演示没有 localStorage、假登录或状态写入。

## F0 演示结构与边界（历史）

| 文件 | 用途 |
| --- | --- |
| src/preview.ts | 原 F0 轻量 hash 导航、页头、入口、看板卡片、成员表、详情表、状态面板、原生 dialog |
| src/style.css | 暖白/绿色视觉、4/2/1 列响应式、可横向滚动的表格、焦点样式 |
| src/view-model.ts | 仅供渲染的投影，不是后端 DTO 或另一套状态机；此文件仅供 F0 演示，真实读取位于 collaboration/ai-view 等模块 |
| src/fixture-adapter.ts | 独立合成展示数据，无写入命令或状态流转 |
| tests/boundary.spec.ts | 无回退、错误、空数据、取消读取、文本转义 |
| scripts/check-production.mjs | 检查生产 JS 不含合成内容，并验证演示构建被拒绝 |

已消费 B0 契约 **0.1.0**：上游提交 `b2289595f2cdae5c5d0de0dfd3921f48d6670f87`，本分支 cherry-pick 为 `b4f1384`；原始文档基线 `ed36ac6`。依赖 `@research-agent-platform/contracts` 的共享 Schema、样例和 `taskColumns`；不复制最终 DTO 或定义状态流转。展示卡片由通过 Task.parse 的任务投影得到，成员、子任务和交付同 Schema 校验。`contract-projection.ts` 仅做中文翻译和共享列映射，已取消不映射为已完成。12 个共享场景与 43 个端点样例也进入前端专项校验。展示用 View 类型不能作为服务契约。

日期无数据时明确待定，示例确定日期沿设计图；建议日期/待确认日期在详情中单独标注。验收数量是交付项数，不是工时百分比。成员时间显示自报周期和更新时间，未知不推断为空闲。公共任务不展示成员私有方法。

## 栈与检查

Node 24.19.0、pnpm 11.21.0；TypeScript 6.0.3、Vite 8.3.0、Phosphor Web 2.1.2、仓库 Vitest 4.1.8。版本与 Node 兼容性已通过 registry 和 [Vite 官方指南](https://vite.dev/guide/)核实。图标使用 [Phosphor 官方包](https://github.com/phosphor-icons/web)，系统中文字体，不发起外部字体请求。F0 范围小，暂用原生 TypeScript 和语义 HTML；F1 是否引入组件框架由真实协作复杂度决定。

`pnpm run ci` 已覆盖应用构建、类型检查、前端边界测试及生产隔离检查。专项运行：

```sh
pnpm --filter @research-agent/web typecheck
pnpm --filter @research-agent/web test
pnpm --filter @research-agent/web check:production
```

浏览器证据和逐项结果见 [G0-F 报告](../../docs/development/reports/G0-F-2026-09-21.md)。基础 CI 不等于 Harness、真实模型、服务权限或多人协作验证。

## F0 原阶段后续清单（历史）

02 协作方案、04 认领、07 验收和 03 聚焦待办基本版留在 F1；08/09 的真实聚合与异常扩展留在 F2；真实 AI 留在 F3；05/06 能力与共享留在 F4。本轮不进入这些批次。
