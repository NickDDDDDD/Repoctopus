# 并行 Run 桌面工作台验证

## 实施范围

按本次 [OpenSpec 设计](../../openspec/changes/show-parallel-runs-in-desktop/design.md) 实现并行 Run 宫格、全窗口 Run、当前人工待办、子 Agent 活动及诊断。刷新数据沿现有本地 OTLP、Desktop Host 和 IPC 路径。新增子 Agent 活动从团队目的地中排除，完成回执沿用原契约。

## 真实 Windows 验收

从候选 `.tgz` 安装 CLI，启动隔离用户目录的 Windows Electron Desktop Host。实验分别创建两个三仓 Workspace，使用各自的本地 Git 和 OpenSpec Store，未向产品远端创建实验分支或发布实验变更。

- `desktop-design-review` 保持在 Design 的有效人工决定。另一条 Run 从 Open 到 Build 时，其提示没有被撤下。
- `desktop-live-agents` 按多 Agent + TDD + 分支隔离运行。真实 Codex 子 Agent 执行 `web-front` 的任务 `1.1`，提交宿主确认的派发和返回事实。Electron 在活动期间显示一个子 Agent、所属仓库和任务，返回后撤下头像。重复派发事实返回 `duplicate`，原观测只保留一条。
- 实际实施前的检查退出码为 1。子 Agent 写入精确的 30 字节文件，宿主完成 GREEN 和回归，并把提交推到实验远端。Runtime 接受原工作包及子 Agent 完成回执。
- 停止第一段实验驱动后，从另一个 CLI 进程执行 `run resume`。保留 `change-workspace-desktop-live-agents-d0e8c55d9d2220c5`、原 Plan 和已完成的首个工作包。
- 真实窗口中进入放大视图，核对当前 Build、子 Agent 和诊断入口，再用 Escape 返回原卡片按钮。独立离屏 Electron 检查覆盖 12 条 Run、五位子 Agent 在 1472 CSS 像素按 4+1 换行、490 CSS 像素逐行排列，以及返回时恢复焦点和滚动位置。

实验过程中发现 Cordis 的两处依赖注入和销毁后的补发缺口。已修复并复验 CLI 报告、默认安全发现和接收。两个实验 Run 的初始 CLI 与修复后用于活动上报的 CLI 来自不同候选，沿用同一已接受父调用。Windows Electron 可见链路的验收没有使用 NSIS 安装器。

## 自动化回归和独立审查

- 先复现相同 Run ID 跨 Workspace 混用序列、子 Agent 任务覆盖父 Work，以及旧首屏没有宫格和待办色级，再启用实现使回归通过。
- 投影与接收验证同 ID 的不同轨迹、当前 Run 独立 freshness、迟到数据、长任务的真实里程碑、过期、历史收敛及远端隔离。
- 由旧投影快照升级时，仍能区分两个 Workspace 中碰巧相同的事件身份，后到 Workspace 连续推进到第三条事件。
- 宿主活动校验覆盖错误调用者、越出冻结工作包、过期调用、重复和阶段倒退。观测不会替代 Work Outcome。
- Build 独立审查的问题已修复，涵盖实际启动入口、首屏当前动作、窄屏提示框裁切、跨 Run 状态隔离及默认接收发现。
- 此报告绑定 Comet Verify 的实际验证命令。正式检查和验证收据由同一 Run 的 Guard 记录。
