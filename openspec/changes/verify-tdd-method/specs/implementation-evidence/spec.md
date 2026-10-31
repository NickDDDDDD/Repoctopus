# implementation-evidence Delta

## ADDED Requirements

### Requirement: TDD 方法验证解析真实 RED GREEN 与回归证据

当批准 Build 策略选择 `tddMode=tdd` 时，Repoctopus MUST 要求 `TddCycleReceipt` 引用 Evidence Store 中当前 Task/package 的 RED、GREEN 和 regression command Receipt，并验证 RED 在相应实现变化前因预期行为失败、GREEN 在兼容输入上通过、回归覆盖当前代码输入。`tddMode=direct` MAY 不要求该 Receipt，但相关测试、Build Check 与 Verify 门禁不得降低。

#### Scenario: 真实先红后绿

- **WHEN** RED Receipt 证明新行为测试在实现前按预期失败，GREEN 和回归 Receipt 绑定后续当前输入并通过
- **THEN** TDD Method Validator 接受 Receipt 并产生 method verified

#### Scenario: 使用占位 Evidence identity

- **WHEN** Receipt 使用不存在的对象、同一成功 Receipt 同时充当 RED/GREEN，或只引用最终通过命令
- **THEN** Validator 拒绝 Receipt，Execute/Build Check 不能把 TDD 标为已验证

#### Scenario: RED 是无关基础设施失败

- **WHEN** RED 命令失败原因是依赖缺失、语法错误、环境不可用或与预期行为无关
- **THEN** Validator 保存诊断但不接受该失败作为 RED 证据
