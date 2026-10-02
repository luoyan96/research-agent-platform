# 当前契约 0.8.0

新增实验室管理员会话标记，以及管理员查看、创建、撤销注册码的同源接口。管理员身份由服务端确认，创建接口返回一次性原码；普通成员无权调用。见[注册说明](../../docs/deployment/registration.md)。0.7.0 保留为历史基线。

新增 B5b `POST /api/v1/auth/register`，以有限期、有限名额的邀请码加入既有实验室并设置个人账号；严格 Origin、原请求重试和普通成员权限。注册成功不创建会话，继续走既有登录入口。数据库迁移新增 009，恢复时撤销邀请码。见[注册说明](../../docs/deployment/registration.md)；0.6.2 及以下说明保留为历史。

## 契约 0.6.2

共同修复新增 taskSamples：在当前任务权限下分页找回本人的样例授权记录，返回状态/版本/允许动作，失效或撤回片段不返回正文。见 [联调说明](../../docs/development/b4a-handoff.md)。不扩大维护者权限；以下旧版本保留为历史。

# Shared contract 0.6.1

B4a当前契约、服务动作和来源绑定见 [B4a联调包](../../docs/development/b4a-handoff.md)。B4b仍不可用。B3历史状态见文末。以下 B1—B2b 段落保留升级历史，其中“尚未实现/不可用”描述仅适用于各自历史版本；当前 B3 端点已实现，B4 仍不可用。

B2b 0.4.0 契约先行：变更、依赖影响、退出/撤权和附件；兼容与迁移说明见 [B2b 联调包](../../docs/development/b2b-handoff.md)。服务状态以最终阶段报告为准。

B2a 升级 0.3.0，已实现本人草案分页、真实 overview/actionItems、授权承诺与 availability；新增共享快照语义及兼容字段。完整接口/错误/兼容影响见 [B2a 联调包](../../docs/development/b2a-handoff.md)。尚未实现的 B2b/B3/B4 路由继续 501（规划返回 MODEL_UNAVAILABLE）。下段为 B1 历史变更。

B1 从 0.1.0 升级为 0.2.0。`TaskSummary.pendingInvitation` 是必填可空字段（仅当前受邀者得到 id/version/scope/schedule）；摘要 allowedActions 增加 decide。`Health.checks.authentication` 改为 ok/unavailable/not_checked；增加 409 INVALID_STATE。B1 路由已实现；B2–B4 仍不可用，规划请求只返回 MODEL_UNAVAILABLE。Task、Plan、Assignment、Deliverable 与看板状态形状保持不变。严格使用旧 0.1.0 Schema 的客户端需整体升级包并重新生成样例，不能只复制新字段。

唯一可执行定义：[models.ts](src/models.ts)、[routes.ts](src/routes.ts)。面向前端的静态文件：[OpenAPI 3.1](openapi.json)、[合成请求响应与场景](examples.json)。协议规则：[protocol.md](protocol.md)。每个路由有 method、path、stage、implemented、request、response、status、rule；request/response 是可直接 parse 的 Zod Schema。

```ts
import { routes, taskColumns, contractVersion } from '@research-agent-platform/contracts'
import type { RequestFor, ResponseFor } from '@research-agent-platform/contracts'
import { fixtures } from '@research-agent-platform/contracts/fixtures'

const demo = fixtures.blockedTask.schema.parse(fixtures.blockedTask.value)
const column = taskColumns[demo.data.status]
const request: RequestFor<'claim'> = {
  params: { id: 'task_claim' }, query: {},
  headers: { 'Idempotency-Key': 'synthetic_command_0001' },
  body: { expectedVersion: 1 },
}
routes.claim.request.parse(request)
// B1 client: ResponseFor<'claim'>. Add authenticated Cookie, Origin, X-CSRF-Token at the HTTP layer.
```

`pnpm build && pnpm contracts:export` 更新 JSON；`pnpm check:b0` 校验样例及服务；根 CI 检查生成文件未漂移。前端引入 workspace 包时使用 `workspace:*`，等待契约提交集成后再安装，不复制 Schema。fixture 子入口只用于明确标识的开发演示，不在生产 API 中导入。样例声明 synthetic=true 与 contractVersion；privateCapabilityOwner 与 privateCapabilityOther 是不同读取者的合成投影，并非权限实现证据。

语义 refine 在 Zod 中执行；JSON Schema/OpenAPI 无法表达所有跨对象约束（授权、环、版本、日期来源等），服务仍需事务规则验证。生成结构样例仅演示形状，核心行为场景是 examples.json.scenarios；两者均通过同一 Schema。二进制下载的结构样例是字节 120（文本 x），线上使用 binary body，不是 JSON 包装。

受邀者从 tasks(scope=mine) 或 task 获取 invitationSummary：用 pendingInvitation.id 作 decision 路径参数；pendingInvitation.version 作 expectedVersion；摘要 version 作 expectedTaskVersion。接受后重新读 task 得到完整详情；拒绝后该摘要不再可见。操作者始终来自会话，不能在正文添加 actorId。


## B3 · 0.5.0

Versioned adaptive replies, planning intents, durable public execution and evidence candidates use the same exported Schema/route definitions. See [B3 handoff](../../docs/development/b3-handoff.md). Run success is not task completion. Unknown usage is null. New `execution_attention` action items require exhaustive client handling; regenerate clients from openapi.json. G4 routes remain explicitly unavailable.
