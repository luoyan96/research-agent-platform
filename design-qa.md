# F0 设计对照

final result: passed

范围：仅 01 需求入口、08 实验室总览、09 任务详情的视觉与基础交互。通过不表示真实任务服务、登录或 Harness 可用。

## 依据与捕获

源图位于 [设计索引](docs/design/README.md) 的 v1.1，均为 1487×1058 PNG。实际浏览器为 Codex In-app Browser（Chromium），桌面 CSS viewport 1487×1058，devicePixelRatio=1；截图工具返回内容区域约 1472×1047，比较面板将其规范到 1487×1058，仅用于肉眼对照，不声称逐像素相同。窄屏 CSS viewport 390×844，完整页面截图单独保存，不拿移动布局和桌面源图做逐像素比较。

| 页面 | 实际截图 | 同一输入并列比较（左源图、右实现） |
| --- | --- | --- |
| 01 | [入口](docs/development/reports/f0-evidence/01-entry.png) | [对照](docs/development/reports/f0-evidence/01-entry-comparison.png) |
| 08 | [总览](docs/development/reports/f0-evidence/08-lab-overview.png) | [对照](docs/development/reports/f0-evidence/08-lab-overview-comparison.png) |
| 09 | [详情](docs/development/reports/f0-evidence/09-task-detail.png) | [对照](docs/development/reports/f0-evidence/09-task-detail-comparison.png) |

状态为显式合成演示、实验室范围、未填写输入。密集内容另做 [表格局部对照](docs/development/reports/f0-evidence/detail-table-comparison.png)，上源图、下实现；按原始像素裁取内容区域检查字号、列宽、行距和状态文字。

## 发现与修正历史

1. 首轮 P2：卡片独占一行的状态和重复日期说明使人员区下移，底部输入被推离主要视区。改为卡片顶部状态文字，压缩间距，确定日期简写，未知/建议仍保留明确说明。最终 08 对照包含四列、人员表和底部输入。
2. 首轮 P2：仅页脚标识在长页面和窄屏首屏不可见。页头增加“演示数据 · 尚未连接服务”，页脚保留；真实模式显示服务未接通。
3. 首轮 P2：进行中步骤用了验收勾号。改为时钟图标并保留文字状态，验收仅用于已验收项。
4. 局部对照 P2：详情表文字偏小。将正文调至 17px、次级交付说明 15px、行高 1.4，保留表头/正文层次。修正后重拍 09 和窄屏长标题。
5. 编译阶段图标导出路径与声明问题已修复；最终浏览器控制台 error/warn 为空。此项是功能修复，不作为视觉比对的替代证据。

## 五项视觉核对

- 字体：系统中文无衬线，桌面入口 50px、页标题 40px、卡片 20px、详情正文 17px；长标题自然换行。未取得生成图的具体字体，系统字体渲染细微差异为 P3。
- 布局：暖白背景，无固定侧栏；约 1170px 内容宽，入口约 1004px；四列看板、人员表、详情表和两栏交付/更新保持源图层次。中屏两列、窄屏单列；表格保留横向滚动和键盘焦点。
- 颜色：背景 #faf9f6、正文 #15212b、强调 #246f61、警示浅黄 #fff4df。状态同时有文字，不靠颜色区分。
- 图像与图标：品牌小图从已有源图精确裁取，未用 CSS 重绘；线性图标来自 Phosphor。没有新增照片或插画。源图图标带生成纹理，实现采用清晰标准图标，属有意差异。
- 文案：不复制源图中会被误认为真实能力的陈述。保留未知日期、示例成员时间、未接通能力、交付项数含义和阶段说明；看板提示从当前范围数据汇总。菜单点改为具体状态，无假菜单。

## 交互与边界

入口 → 总览 → 详情 → 总览 / 对话、范围切换、需求示例填入、未接通提示弹窗、错误重试、未知 ID、空/加载/失败状态已在浏览器操作。Enter 打开 dialog，Escape 关闭后焦点回触发按钮；跳过导航到 main；窄屏表格 ArrowRight 实际滚动 40px。390px 下 document scrollWidth 不超过 innerWidth。完整记录见 [G0-F 报告](docs/development/reports/G0-F-2026-09-21.md)。

无未解决 P0/P1/P2。P3：系统字体与生成图纹理不完全相同；图标包仍含旧字体格式资源，可在后续性能工作中按真实设备需求裁剪。本批次不新增功能以掩盖限制。
