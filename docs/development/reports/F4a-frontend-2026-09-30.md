# F4a 前端 · 结论留存与复用 · 2026-09-30

**主要实现及真实联调已完成；F4a 尚未全量验收通过。** 剩余接口缺口：非维护者共享样例后，刷新任务页无法从服务找回本人授权记录并撤回。下面分别记录已通过与未通过内容，不以维护者自己的样例撤回代替非维护者场景。停在 F4a，等待该缺口协调及共同 G4a；不进入 G4b/G5，不合并或部署。

## 基线与版本

独立分支 `frontend/f4a-authorized-reuse`，目录 `D:/deepseek-agent/research-agent-platform-f4a`。保留其他前后端工作目录。

| 内容 | 完整 SHA |
| --- | --- |
| 与后端相同的 G3/G4a 规划交接基线 | `61eec851ac1f00e18b12e729f5fa6cdcc320f730` |
| 基线包含的 F3-01 | `65c6a70c43feca8a04c83b15c7823c8fb4e25839` |
| B4a 契约 0.6.0 先行提交 | `16b2fee6244545a5dc248ddd760bbc0f2c6ee846` |
| 实际使用契约 0.6.1，含 allowedActions / conclusionRefs | `0dfb54c006e990b3502e6e87d4fbbb561197f656` |
| 实际服务 | `daa59a8ad6ef194455a9853e6faf2669a9476daa` |
| 后端最终说明与证据 | `22696df20105f1ef17cefe930fef4b7b1cb799de` |
| 前端功能与回归代码 | **`e5004e88e5558de57fca3cb8175fd0c89c09ccff`** |

完整引入上述后端提交；未自行改动服务、共享 Schema、迁移、根依赖或锁文件。`apps/api`、`packages/contracts`、Harness runtime、根 package.json / pnpm-lock.yaml 与后端最终交付无差异。报告提交只追加本报告和合成证据。

环境：Windows，Node 24.19.0，pnpm 11.21.0；延续 TypeScript 6.0.3、Vite 8.3.0、Vitest 4.1.8、Phosphor 2.1.2，无新增前端依赖。Browser plugin not available，按 frontend-testing-debugging 技能使用已安装 Playwright 1.62.1 / Edge。真实服务和 worker 使用独立 SQLite/附件目录；截图和输入都是合成材料，不含私有研究资料、密码或密钥。

## 页面与操作路径

- 唯一入口保持原导航、暖白和绿色、无固定侧栏。入口展开“复用已有结论”后主动勾选当前版本；不选择就不把旧结论加入请求。手工方案继续可用；手工 PlanInput 尚无绑定字段，因此手工草案确认后在任务的新运行中选择结论，不能假称手工保存已经绑定。
- 已验收任务 → “结论与自愿共享” → 展开“保留结论” → 核对交付资源版本、全部附件、文本、适用说明与共享范围 → 明确确认。接受交付与分享反馈是不同操作；“不共享”提交 null 片段及 false 授权，显示服务确认结果。
- 结论详情 `#/conclusions/:id` 展示来源与历史，按服务 allowedActions 开放修订/撤回。源版本变化时展示原版本和新版本，明确采用后才换编辑基准；失败保留原请求。
- 草案和任务展示服务返回的既有 conclusionRefs；新生成、新运行必须再次主动选择。复用选择按同一快照读取分页来源，不默认勾选；过时版本禁用。原 key 重试与“新意图”仍分开。
- 任务 → “公共能力运行” → 服务允许的“维护公共文本方法” → `#/methods`。只展示获准样例与受控配置，候选、真实试跑、核对、启用、停用分开。明确提示创建候选也推进配置代次并取消旧配置未结束的运行；旧运行显示原方法版本，不冒充新方法完成。
- 入口 → “我的生成请求” → 请求详情；另有本人分页列表 `#/requests`。列表不返回原始 prompt，不把生成完成等同于草案尚未确认；保留 F3-01 取消/确认语义。后端按不透明 ID 分页，不声称是时间倒序。
- ID、hash、provider、用量与方法/配置版本放在可展开核对区；运行成功仍是候选，提交和验收继续由人确认。引用来源可能为材料、结论或样例，不再把虚拟结论引用错误标作可下载附件。

## 检查与证据

| 检查 | 实际结果 |
| --- | --- |
| 根 `pnpm run ci` | 最终 **19 文件 / 245 项通过**；含构建、类型、内容、契约导出、真实进程和生产隔离。默认 CI 不调用真实模型 |
| 前端确定性测试 | 9 文件 / 68 项；新增 11 项覆盖留存/启用编辑基准、明确重确认、换账号清除、拒绝分享、不可用附件、权限投影、历史状态和转义 |
| 新 F4a 真实 HTTP 浏览器 | [7 组通过](f4a-evidence/http-browser.json)，独立 A/B/C，无 worker，无模型替身成功响应 |
| 新真实模型及关联浏览器 | [8 组结果](f4a-evidence/actual-model-browser.json)，实际模型运行及维护动作；不是 fixture 或生成动画 |
| G1 | [11 组通过](f4a-evidence/g1.json)，完整交付/退回/重提/验收、重复点击、竞争认领、越权、进程重启 |
| F1-01 | [7 组通过](f4a-evidence/f1-01.json)，同标签页退出重登、不同账号清空、同账号失效恢复原输入/请求 |
| A9a / F2a-01 | [15 组通过](f4a-evidence/a9a-f2a-01.json)，草案找回、lab/mine、两个本人入口清除旧筛选、可用时间、断线与授权快照 |
| G2 A6—A9 | [17 组通过](f4a-evidence/g2.json)，协商/依赖/退出/转交/附件撤权/取消/失败重试及断线恢复 |
| F3 确定性真实 HTTP UI | [3 组通过](f4a-evidence/f3-ui.json)，后台排队/前台恢复轮询、外部取消、AI 修改冲突比较、原运行等待输入重试；取消/中断/晚到写回的服务边界同时由根 CI 回归 |
| 生产断服务 | [实际 API 停止后 502](f4a-evidence/production-offline.json)，显示读取失败、零任务卡片、无 fixture 回退；favicon 200；构建拒绝 demo 模式 |
| 响应式与控制台 | 桌面 1487×1058 截图；留存及方法页实测 DOM `390×844`、scrollWidth=390。正常控制台及未捕获异常为零；主动故障/撤权触发的 ERR_FAILED、403、410 单独记录 |

| 案例 | 实际覆盖 | 结论 |
| --- | --- | --- |
| A14a | 真实接受后不共享仍保持 completed；另行留存，原 key/body 重试，来源/范围可核对 | 通过 |
| A14b | 另一个任务明确选结论后真实进入 Harness，候选含准确结论引用；关闭全部浏览器仍执行，重登恢复，任务仍 in_progress | 通过 |
| A14c | B/C 不见 owner_only 列表/直链；拟邀请 B 的目标扩大范围被拒；撤回后成功候选/派生任务旧链接 404，已呈现派生页通过快照探测清理 | 通过上述前端路径；分页/旧响应重放/派发和晚到写回另外由服务专项覆盖 |
| A14d | 明确修订到 v2，历史 v1 标 needs_review；新需求无自动选择；版本冲突保持基准并比较 | 浏览器修订路径通过；来源任务/附件变化的完整矩阵由服务专项覆盖，未逐一重复付费调用 |
| A14e | 维护者 A 的授权片段 → 方法 v2 真实试跑 → 精确运行确认启用 → 停用 → 样例撤回、旧试跑不可读；B/C 维护端点拒绝 | **部分通过；非维护者 grantor 刷新后找回/撤回仍缺服务投影** |
| A14f | 关闭所有浏览器、重登从入口找回排队请求；外部取消显示真实取消；真实 BUDGET_EXCEEDED 请求重登后找回 | 通过；预算拒绝发生在模型派发前，没有额外付费调用 |

没有以演示验证替代真实服务。本批未使用 fixture adapter，也没有新增演示数据或生产身份切换。先前 B3 页面准备证据只保留在忽略的本地 runtime 中，不当作 F4a 验收。

## 实际模型记录及失败

服务端加载既有获准配置，官方 Harness **0.2.0-rc.1** / **deepseek-v4-flash**；浏览器不接触凭据。模型记录见上方 JSON，包含合成候选、准确引用和服务用量。

| 调用 | 运行 ID | 方法 / 配置代次 | 服务报告输入/输出 tokens | elapsedMs |
| --- | --- | --- | --- | --- |
| 结论复用，第二次尝试成功 | `3048a793-f372-4626-ae3e-f5e6f80a7b3a` | 1 / 1 | 486 / 8027（该运行累计） | 34140 |
| 获准方法候选试跑 | `1f5c8d34-2e96-42e5-9f30-f77d054b1355` | 2 / 2 | 306 / 774 | 4221 |

启用后配置为第 3 代、方法 v2；停用后原试跑的 methodVersion 不变。费用和币种均为 null，不能填零。

首轮隔离网络调用返回 TRANSPORT，用量未知；开通本次获准外网访问后，一次模型输出返回 INVALID_MODEL_OUTPUT。页面没有伪造成功，使用原运行重试后才获得合格候选。真实重试保留原结论绑定和累计预算。连续重登还触发真实 429 登录限流，等待窗口自然恢复后继续，未降低限流或篡改计数。

浏览器脚本调试中修正了嵌套 summary 选择器、把“运行后 ready”的错误断言改为“未验收”，以及快照观察等待。只读探测每 15 秒执行且受读取时刻/前后台影响，观察需要允许约 30 秒；原 25 秒断言超时后，以另一项真实已绑定来源的任务复核清理，未重复付费模型。完整主脚本已改为前台观察并等待最多 40 秒；两条实际模型证据保留原真实记录，不合成成功响应。

## 剩余缺口

非维护者可以按 Task.allowedActions 明确授权本人已验收片段，但 `GET /public-text-method/samples` 仅维护者可读，任务详情没有本人已授权样例投影，也没有单条读取路由。刷新后无法取得样例 ID / version / allowedActions 来呈现合法撤回。不能用浏览器本地记录或角色猜测补出权威授权状态。

建议后端提供“本人在该任务已经共享的样例”的授权读取投影，含状态、版本和 allowedActions；撤权时同步清理。此前允许跨任务协调的是 allowedActions 和 conclusionRefs 两项，已在 0.6.1 解决。发送本第三项时自动审批拒绝，原因是超出该授权；已单独请求授权，尚未收到回复。因此该项保持未通过，不宣称 F4a 全量完成。

其他首版边界：最多 10 个附件的交付才能留存且须全部绑定；只按来源既有读者范围复用；手工草案本身无结论绑定字段；方法维护只取各类首 100 项并显示限制；不能追回已下载副本。未实现私人能力托管、任意代码/提示词编辑、向量库或跨域分享。

## 启动与复核

在本分支根目录安装和构建：`pnpm install --frozen-lockfile`、`pnpm build`。数据库/附件路径必须属于自己的独立环境，勿指向后端或总体验收目录。设置 `DATABASE_PATH`、`BLOB_ROOT`、`APP_ORIGIN`、`PORT`；真实模型额外使用服务端 `B3_AI_ENABLED=1`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`，不得设置 VITE 凭据变量。

```powershell
# 私有配置必须指向本任务独立数据库；不要把实际凭据文件提交 Git。
node --env-file=<本任务私有配置> apps/api/dist/manage.js migrate
node --env-file=<本任务私有配置> apps/api/dist/manage.js seed
node --env-file=<本任务私有配置> apps/api/dist/credentials.js
node --env-file=<本任务私有配置> apps/api/dist/capability-config.js enable lab_synthetic member_A
node --env-file=<本任务私有配置> apps/api/dist/main.js
# 另一个终端启动 worker；确定性 UI 检查期间不启动。
node --env-file=<本任务私有配置> apps/api/dist/worker.js
pnpm --filter @research-agent/web dev --port 4187
```

默认 Vite 代理 API 3100；APP_ORIGIN 对应页面 4187。此次真实联调用 API3174 / Vite4187，使用忽略的本地 Vite 配置明确代理；历史回归用另一数据库和 API3100 / Vite4189。生产 preview4188 单独停止 API 后验证。所有本任务创建的服务、worker、浏览器与 Vite 进程均已停止。

可复核脚本：`apps/web/scripts/check-f4a-browser.mjs`（真实 HTTP、无 worker）；`apps/web/scripts/check-f4a-live-browser.mjs`（真实付费模型、独立 worker）。设置 `F1_BASE_URL`、`F1_CREDENTIALS_FILE`、`PLAYWRIGHT_MODULE`、`F1_BROWSER_CHANNEL=msedge`、`F4A_EVIDENCE_DIR`，均指向自己合成环境。历史脚本沿用相应 F1/F2A/F2B/F3 evidence 变量；G1 `--manage-api` 和 F3 UI 会自行管理3100端口，运行前确认该端口不属于其他任务。不要连续重跑付费路径或把限流失败改成成功。

## 合成截图

[留存桌面](f4a-evidence/retained-desktop.png) · [留存390×844](f4a-evidence/retained-390.png) · [真实复用候选](f4a-evidence/actual-conclusion-reuse.png) · [真实方法试跑](f4a-evidence/actual-method-trial.png) · [方法390×844](f4a-evidence/method-390.png) · [范围扩大拒绝](f4a-evidence/scope-expansion-refused.png) · [撤权后清理](f4a-evidence/derived-content-cleared.png) · [重登找回排队请求](f4a-evidence/request-recovered.png) · [重登找回失败请求](f4a-evidence/failed-request-recovered.png) · [生产断服务](f4a-evidence/production-offline-390.png)。
