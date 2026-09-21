# B0 API foundation

从仓库根运行 `pnpm build`、`pnpm db:migrate`、可选 `pnpm db:seed`、`pnpm api:start`。完整配置和事务决定见[架构与启动](../../docs/development/b0-architecture.md)；共享契约见[contracts](../../packages/contracts/README.md)。

仅 `/api/v1/health/live` 与 `/api/v1/health/ready` 已实现。所有后续业务和身份端点 501，不使用种子冒充登录成员。readiness 503 表示真实依赖不可用，不代表需要切到演示数据。

`pnpm check:b0` 含 Schema、HTTP、真实文件数据库和服务子进程重启检查；根 `pnpm run ci` 同样覆盖这些内容。未接入模型或 Harness，未部署。
