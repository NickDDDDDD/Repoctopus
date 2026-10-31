# development-telemetry Delta

## ADDED Requirements

### Requirement: Build 策略绑定与人工等待必须可观测

Repoctopus MUST 分别记录 BuildStrategy proposed/approved/reused/invalidated、ExecutionBinding validated/drifted、Human Decision created/reused/superseded 和 Plan preflight finding，并保留 phase、Build action、strategy/binding revision、composition identity、reason class 与 duration 关联。相同 semantic digest 的恢复或返工 MUST 产生 decision reused 而不是新的 approval request；Metric labels MUST 只使用有界策略、结果和原因枚举。

#### Scenario: Configure 自动重验 binding

- **WHEN** Host 或 checkout 变化但批准 Strategy 语义未变，Runtime 接受新 ExecutionBinding
- **THEN** Trace 表示 binding revision 和受影响 Evidence invalidation，approval count 不增加且不导出 checkout 路径

#### Scenario: Plan 提前阻断越界写入

- **WHEN** Plan Evidence 发现 package write scope 超出任务或仓库边界
- **THEN** Trace 在 Execute 前记录有界 planning finding，使团队可计算 preflight catch rate，Metric 不使用路径文本作为 label
