# 科研数据核心

从原科研插件提取的独立 TypeScript 包，提供 Project、Artifact、来源引用及本地文件存储。来源见[迁移记录](../../docs/migration.md)。

支持创建/读取项目，保存/列出/读取带来源、状态和 SHA-256 的 Markdown 成果。`factual: true` 或省略时要求来源记录；这只校验记录存在，不代表内容或引用真实性已被验证。计划与假设可显式使用 `factual: false`。

```ts
import { ArtifactStore } from '@research-agent-platform/research-core'

const store = new ArtifactStore('/path/to/workspace')
await store.createProject({ id: 'demo', name: 'Demo' })
await store.saveArtifact('demo', {
  id: 'plan', type: 'plan', content: '# Task plan',
  factual: false, sources: [],
})
```

数据位于指定工作区的 `research-projects/<project-id>/`。现有项目重建请求返回已存项目；成果 ID 不可重复，修改成果需使用新 ID。

当前存储限于受信任的本地工作区与同一实例的串行写入。单文件通过临时文件和重命名写入，但成果正文与索引不是跨文件事务；进程中断可能留下未索引文件。它不提供多进程并发、成员权限、符号链接隔离或长期记忆管理。多人平台接入前需采用平台数据服务与事务存储。

检查从仓库根目录运行 `pnpm run ci`。本地恢复、重复 ID 不覆盖原内容、同实例并发、路径和 schema 检查包含在测试中。
