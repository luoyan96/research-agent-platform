# Shared contract 0.1.0

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
// Future B1 client: ResponseFor<'claim'>; B0 server returns 501, not this fixture.
```

`pnpm build && pnpm contracts:export` 更新 JSON；`pnpm check:b0` 校验样例及服务；根 CI 检查生成文件未漂移。前端引入 workspace 包时使用 `workspace:*`，等待契约提交集成后再安装，不复制 Schema。fixture 子入口只用于明确标识的开发演示，不在生产 API 中导入。样例声明 synthetic=true 与 contractVersion；privateCapabilityOwner 与 privateCapabilityOther 是不同读取者的合成投影，并非权限实现证据。

语义 refine 在 Zod 中执行；JSON Schema/OpenAPI 无法表达所有跨对象约束（授权、环、版本、日期来源等），服务仍需事务规则验证。生成结构样例仅演示形状，核心行为场景是 examples.json.scenarios；两者均通过同一 Schema。二进制下载的结构样例是字节 120（文本 x），线上使用 binary body，不是 JSON 包装。
