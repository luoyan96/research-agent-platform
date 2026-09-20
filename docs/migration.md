# 初始迁移记录

日期：2026-09-20。方式：从干净的本地源仓库按文件选择性迁入，建立新的单仓库初始提交；未导入完整 Git 历史。原始提交可通过下面的链接追溯，旧仓库未改动或删除。

| 来源 | 原始提交 | 新位置 |
|---|---|---|
| [dsh-research-plugins](https://github.com/luoyan96/dsh-research-plugins) | [42bbeffd85ff76893d59d30080efebd7d7dbd92c](https://github.com/luoyan96/dsh-research-plugins/commit/42bbeffd85ff76893d59d30080efebd7d7dbd92c) | `packages/research-core`、`integrations/deepseek-harness` |
| [dsh-research-skills](https://github.com/luoyan96/dsh-research-skills) | [5cd8a6a4940648bc3679a526da04fa722964c171](https://github.com/luoyan96/dsh-research-skills/commit/5cd8a6a4940648bc3679a526da04fa722964c171) | `agents/skills`、`agents/templates`、`evaluations` |
| 本次产品讨论 | 2026-09-20 产品规划 v0.1 | `docs/product-plan.md`，链接和工程状态说明已适配本仓库 |

## 本次调整

- 从 Harness 插件中提取平台可独立使用的对象与存储逻辑。
- 完整十项 Skills 作为唯一内容来源，移除新代码对旧六项精简正文的依赖。
- 新增 Skill 打包与加载，随包保留相对引用文件。
- 修正成果 ID 重复时先覆盖正文再报错的问题，补充原内容不变的回归验证。
- 同一存储实例的项目创建进入写入队列，避免与创建后保存成果相互覆盖索引；复用项目时统一进行 schema 检查。
- 补充跨盘绝对路径检查。当前文件存储仍不声明跨进程事务或针对恶意本地文件系统的隔离。
- 添加可独立运行的基础检查、演示和协作说明。

## 有意保留为后续参考的内容

科研桌面原型中的固定连接状态、占位成果、未接通的创建项目页面没有迁入。外链门户、主题、桌面壳和第三方任务面板也没有直接合并进平台，以免引入未验证界面和额外依赖。之后按真实任务与交互需要单独选择复用。

未迁入上游 Harness 源码、node_modules、已有构建产物、私有科研文件、运行数据库、API key 或发布凭据。旧 npm 自动发布流程也没有迁入；本仓库两个包及适配包都标记为 private。

## 已观察到的依赖问题

原插件依赖本机相邻 Harness 目录。尝试替换为公开依赖时，原 `0.1.0-rc.5` 工具包不可取得，公开 `0.0.1-rc.1` 的安装又因缺少 `@deepseek-ai/dsh-type-meta` 返回 404。当前以基础包独立开发、适配源码待验证处理，详见[适配说明](../integrations/deepseek-harness/README.md)。

新平台已迁入模块的后续维护以本仓库为主。旧仓库可保持既有用途，后续是否归档或改变发布来源单独决定。
