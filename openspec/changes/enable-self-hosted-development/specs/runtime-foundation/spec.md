# Spec Delta

## ADDED Requirements

### Requirement: 外部事件通过受保护入口启动 Run

WorkflowRuns MUST 只接受已经持久化且映射到当前项目与 change 的平台投递启动 Post-merge Run，并使用稳定幂等键避免并发事件创建重复 Run；平台 Adapter 不得直接写 Run State。

#### Scenario: 两个合入事件同时满足关闭条件

- **WHEN** 两个 Runner 并发请求为同一 change 和合入事实启动收尾
- **THEN** RunStore 只创建一个逻辑 Post-merge Run，另一请求复用既有身份

### Requirement: Run 绑定方法和规格实现身份

WorkflowRuns MUST 把实际使用的 Skill 快照和 Specification Provider 身份作为 Run 语义输入持久化，并在恢复、Evidence 接受和规格关闭前重新核对兼容性。

#### Scenario: 规格 Provider 在收尾中断期间改变

- **WHEN** Post-merge Run 恢复时当前 Specification Provider 与快照不兼容
- **THEN** Run 进入 `migration_required`，不使用新 Provider 继续关闭

### Requirement: 自举开发使用产品公共能力

Repoctopus MUST 能用已发布或当前工作树构建的产品入口执行自身真实 change 的需求澄清、规格校验、实施 Evidence、交付、合入后验证与关闭，不得使用只存在于测试中的旁路状态转换。

#### Scenario: Repoctopus 交付自身 change

- **WHEN** 维护者以 Repoctopus 仓库作为项目运行自举工作流
- **THEN** Run、Evidence、Delivery、平台事件和规格关闭均通过生产 composition 与公共服务完成，并留下可核对 Trajectory

### Requirement: 人工等待与后台恢复不占用进程

WorkflowRuns MUST 把等待用户决定、等待 MR 合入和等待重试时间表示为持久状态与可唤醒条件，不要求单一进程、IDE 会话或 Fiber 在等待期间持续存活。

#### Scenario: Run 等待 MR 合入时 Runner 重启

- **WHEN** Runner 在等待状态退出并于后续平台事件到来时重新启动
- **THEN** 系统从 Store 恢复等待条件并继续同一 Run，不依赖旧内存回调
