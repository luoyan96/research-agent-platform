# F0 前端预览

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

真实模式目前是显式不可用 adapter，未猜测 API 路径或认证策略。`dev:demo` 是唯一演示开关；无 `VITE_*` 凭据或身份变量。生产构建拒绝 `--mode demo`，演示模块经编译常量裁剪；真实模式失败不回退。查询参数只选择开发场景，无法打开生产 fixtures。没有 localStorage、假登录或状态写入。

## 结构与边界

| 文件 | 用途 |
| --- | --- |
| src/main.ts | 轻量 hash 导航、页头、入口、看板卡片、成员表、详情表、状态面板、原生 dialog |
| src/style.css | 暖白/绿色视觉、4/2/1 列响应式、可横向滚动的表格、焦点样式 |
| src/view-model.ts | 仅供渲染的投影，不是后端 DTO 或另一套状态机；真实读取未接通 |
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

## 后续页面清单（未实现）

02 协作方案、04 认领、07 验收和 03 聚焦待办基本版留在 F1；08/09 的真实聚合与异常扩展留在 F2；真实 AI 留在 F3；05/06 能力与共享留在 F4。本轮不进入这些批次。

