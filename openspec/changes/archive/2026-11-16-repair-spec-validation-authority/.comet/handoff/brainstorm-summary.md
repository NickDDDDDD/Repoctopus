# Design 讨论摘要

## 已确认

- Open 已批准四类 OpenSpec 产物和 8 项任务。
- 候选包确认失败校验提前绑定、不同有效草案摘要被拒、跨 Change 校验写入三个问题。
- 工作区使用当前发布的独立 worktree，沿用原 OpenSpec Store 和受管阶段。

## 候选方案

- 将手动校验改为只读身份核对，由受保护 Open/Design 转换在同一提交中确认本阶段校验证据。
- 复用当前持久化快照和生命周期事件，单独核对 Provider 兼容性。正式 Archive 沿用 Closure Receipt 和 Publication Journal。
- 规划观察使用明确的不可用结果，调用处按原 checkpoint 等待后续重查。已证实失效才走 Design 回退。
- 验收增加命令边界、竞争和中断故障注入，最后复跑实际候选包的多仓原 Run 与发布冷恢复。

候选内容请以本 Change 的 design.md 为准。正式 Design 批准待记录。
