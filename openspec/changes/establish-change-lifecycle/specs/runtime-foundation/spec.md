# runtime-foundation Specification

## MODIFIED Requirements

### Requirement: WorkflowRuns 协调工作流用例与平台端口

WorkflowRuns MUST 作为 Cordis Service 加载持久化 Run、调用纯 Engine 与 lifecycle transition handler、在 RunStore 事务内核对事实并协调 Evidence 与 Action Service；Change 的 phase、status、current Work、wait condition 和 next action 必须来自同一 Change Run，CLI、Evidence、Delivery、平台事件和 Adapter 不得复制转换规则、直接写 Run 或建立产品级 Runtime。

#### Scenario: 文本 CLI 与 JSON CLI 查询同一 Run

- **WHEN** 用户分别请求文本和 JSON 状态
- **THEN** 两种输出由同一个 WorkflowRuns 查询结果渲染，并报告一致的 phase、status、当前 Work、诊断和合法后继

#### Scenario: 普通成功记录尝试绕过 Evidence

- **WHEN** 当前 Work 声明需要 Validator 或 Evidence Profile 且调用方只提交普通 `succeeded` 结果
- **THEN** WorkflowRuns 可以记录尝试但拒绝完成 Work 或推进阶段，直到相同输入和 Run 下存在满足事实

#### Scenario: 公共入口缺少产品 Service

- **WHEN** CLI、IDE 或 API 请求 Run 能力但当前 Context 没有活动 WorkflowRuns Service
- **THEN** 入口返回结构化不可用诊断，不回退到直接实例化或隐藏兼容实现

### Requirement: 外部事件通过受保护入口启动 Run

WorkflowRuns MUST 只接受已经持久化且映射到当前 Workspace 与 change 的平台投递作为外部事实或唤醒条件，并使用稳定幂等键恢复对应的现有 Change Run；平台事件、Webhook、补偿检查和 Adapter 不得直接写 Run State、创建独立 Post-merge Run或在缺少权威 Run 时猜测生命周期。

#### Scenario: 两个合入事件同时满足关闭条件

- **WHEN** 两个 Runner 并发投递同一 change 和合入事实
- **THEN** Event Inbox 去重或收敛事实并唤醒同一个 `archive/waiting` Change Run，不创建第二个逻辑 Run

#### Scenario: 全新状态卷收到历史合入事件

- **WHEN** Runner 无法加载该 change 的权威 Change Run 但收到已合入事实
- **THEN** WorkflowRuns 返回恢复或迁移诊断，不根据 MR 作者、分支或载荷临时创建 Post-merge Run

### Requirement: 人工等待与后台恢复不占用进程

WorkflowRuns MUST 把等待用户决定、等待 MR 合入和等待重试时间表示为 Change Run 内持久化的 phase、status 与可唤醒条件，不要求单一进程、IDE 会话或 Fiber 在等待期间持续存活；唤醒只能恢复同一 Run 并重新核对当前事实。

#### Scenario: Run 等待 MR 合入时 Runner 重启

- **WHEN** `archive/waiting` 的 Run 所在 Runner 退出并于后续平台事件到来时重新启动
- **THEN** 系统从 Store 恢复等待条件并继续同一 Run，不依赖旧内存回调或创建 Post-merge Run

#### Scenario: 等待人工决定期间产物漂移

- **WHEN** `design/waiting` 的 Run 被用户响应唤醒但当前规划语义摘要已变化
- **THEN** Runtime 拒绝旧决定并生成基于当前摘要的新等待事实
