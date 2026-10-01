# ECS 部署准备包

目标环境：用户已有的 Ubuntu 22.04 ECS、Nginx 和 systemd。**2026-10-01 已完成该实例的网页与任务服务部署；AI 配置、本人账号交付及真实成员试用尚未完成。** 模板须为具体目标替换配置；不能直接用于其他实例。完整步骤、备份与回退见[部署说明](../../docs/deployment/ecs.md)。

第一步只运行[只读检查](preflight.sh)，默认候选端口 4327，显式避开既有招聘系统 4317：

```bash
bash preflight.sh 4327
```

输出只包含系统版本、资源、监听端口、指定服务状态和目标目录是否已存在；不读取环境文件、密钥、数据库或业务日志。不使用 `sudo`，不安装任何软件。已有端口/目录不覆盖；检查结果并非容量充足的保证。

| 文件 | 用途 |
| --- | --- |
| [platform.env.example](platform.env.example) | 非秘密运行配置；AI 默认关闭，域名和端口需要替换 |
| [research-agent-api.service.example](research-agent-api.service.example) | API 常驻服务；不会在启动时自动迁移数据库 |
| [research-agent-worker.service.example](research-agent-worker.service.example) | 后台任务服务；单独注入模型配置，保留有界调用的退出时间 |
| [nginx.conf.template](nginx.conf.template) | 独立 HTTPS 站点；仅代理 API 并提供前端构建产物 |

本实例已通过 `nginx -t`、两个科研 unit 的 `systemd-analyze verify`、真实 HTTPS 协作、10 MiB 附件、服务重启和隔离恢复检查。保留 HTTP-01 路径以供证书续期；ACME 根目录需由部署者创建。模板里的 CPU/内存限制仍需持续结合实际负载评估，不能从一次合成验证推断长期容量。这里没有一键覆盖服务器的安装脚本。
