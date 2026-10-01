# B1 collaboration API

从仓库根运行 `pnpm build`、`pnpm db:migrate`、`pnpm db:seed`、`pnpm db:credentials`、`pnpm api:start`。APP_ORIGIN 设置为前端精确来源；完整步骤、合成任务 seed、凭据准备和 API 示例见 [B1 联调包](../../docs/development/b1-handoff.md)。共享契约见 [contracts 0.2.0](../../packages/contracts/README.md)，[B0 架构](../../docs/development/b0-architecture.md)保留设计背景。

已实现健康、身份/会话、手工方案、任务/邀请/认领、开始、文本交付和验收。种子账号必须通过真实密码认证；readiness 503 表示依赖不可用，不回退演示数据。B2–B4 端点仍501，规划请求明确503 MODEL_UNAVAILABLE。

`pnpm check:b1` 使用两个独立服务进程、真实 HTTP 与同一文件 SQLite 验证 A1–A5；`pnpm check:b0` 保留基础检查；根 `pnpm run ci` 同时覆盖前端生产隔离和后端真实进程检查。未接入模型或 Harness，未部署。
