# Spec Delta

## ADDED Requirements

### Requirement: 生产组合中的桌面 Launcher 必须被权威用例消费

Project composition MUST 只在存在生产调用路径和纵切验收时声明 Desktop Launcher 能力；Change Run 的激活 owner MUST 通过 Cordis 注入的 Launcher Service 执行，不得由 CLI、测试或 catalog membership 冒充已接通能力。

#### Scenario: Project composition 启动 Change Run

- **WHEN** `run.change.start` 经 Command Router 调用 `WorkflowRuns` 创建或恢复 Change Run
- **THEN** 同一 composition 中的 Launcher 收到 Runtime 确认的上下文，调用结果进入公共诊断和观测事实

#### Scenario: Launcher 只有静态登记

- **WHEN** 插件 descriptor 和 composition snapshot 包含 Launcher 但公共 Change Run 入口没有生产调用或纵切测试
- **THEN** 架构或验收检查失败，不得把该能力报告为已交付
