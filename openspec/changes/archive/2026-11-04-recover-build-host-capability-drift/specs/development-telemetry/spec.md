# development-telemetry Delta

## MODIFIED Requirements

### Requirement: Build 策略绑定与人工等待必须可观测

Repoctopus MUST分别记录BuildStrategy proposed/approved/reused/invalidated、ExecutionBinding validated/drifted、Work claim capability accepted/rejected、executor availability blocked、Human Decision created/reused/superseded和Plan preflight finding。Telemetry MUST区分Work-scoped capability rejection与真正的Binding-owned identity drift；它不得从Plan、Execute或Check invocation的capability list推断Binding变化。Metric labels MUST只使用有界phase、action、result和reason枚举，Host、Work、claim和digest只作为Trace/Event关联身份。

#### Scenario: 当前Work能力不足

- **WHEN** Host缺少当前Work的required capability并在claim前被拒绝
- **THEN** Trace记录`work.claim-capability-rejected`和有界missing-capability class，claim/invocation计数不增加，binding drift计数不增加

#### Scenario: Configure 自动重验 binding

- **WHEN** coordinator Host identity或checkout变化但批准Strategy语义未变，Runtime接受新ExecutionBinding
- **THEN** Trace表示binding revision和受影响Evidence invalidation，approval count不增加且不导出checkout路径

#### Scenario: Plan 提前阻断越界写入

- **WHEN** Plan Evidence发现package write scope超出任务或仓库边界
- **THEN** Trace在Execute前记录有界planning finding，使团队可计算preflight catch rate，Metric不使用路径文本作为label

#### Scenario: 不同Work使用不同能力集合

- **WHEN** 同一coordinator Host成功领取Plan和Execute且两次声明的能力集合不同
- **THEN** Trace分别记录两个合法Work claim；Dashboard和聚合不得显示ExecutionBinding漂移或Configure重试

#### Scenario: 外部执行结果未知

- **WHEN** 已claim Work的外部结果无法判定并进入reconcile
- **THEN** Trace保留原claim/invocation关联并记录unknown/reconcile outcome，不把恢复投影为新Work成功或Binding重建
