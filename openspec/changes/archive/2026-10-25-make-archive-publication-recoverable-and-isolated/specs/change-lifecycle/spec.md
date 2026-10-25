# change-lifecycle Delta

## ADDED Requirements

### Requirement: Archive attempt 身份不可歧义

Archive CLI 和 Runtime MUST 分别命名 Verify Evidence attempt 与 Archive Work claim attempt，并在命令边界验证其类型；同一个 `--attempt` 参数不得根据子命令静默解释为 UUID 或整数。

#### Scenario: 准备 Archive 使用 Evidence attempt

- **WHEN** 调用方运行 `archive-prepare`
- **THEN** 命令只通过 `--evidence-attempt` 接受 Verify 产生的 attempt identity，并把它绑定到所选 Evidence Bundle

#### Scenario: 发布 Archive 使用 Work attempt

- **WHEN** 调用方运行或重试 `archive-publish`
- **THEN** 命令只通过 `--work-attempt` 接受 Git Work claim 序号；使用旧歧义参数时返回明确替代方式而不执行副作用

## MODIFIED Requirements

### Requirement: Archive 终态绑定精确发布证明

Change Run MUST 只在 Archive 的隔离 OpenSpec 关闭候选通过后置验证，且全部预期业务发布项和最终规格发布项都具有 repository、base、head、published head OID 与唯一 MR identity 的完整 Publication Receipt 后进入 `completed`；规格发布必须已有 completed Publication Journal，MR 的 open、merged 或 closed 状态不得改变该判断。

#### Scenario: MR 已创建但尚未合入

- **WHEN** 全部发布项都精确匹配远端，Business MR 和最终 Change MR 仍处于 open
- **THEN** Runtime 接受 Publication Receipt 并完成同一 Change Run

#### Scenario: 发布项缺少精确远端身份

- **WHEN** 任一预期仓库没有可验证的 published head OID 或唯一匹配 MR
- **THEN** Runtime 保持 `phase=archive` 并阻断完成，返回缺失或歧义的发布项

#### Scenario: 已完成 Change 的 MR 后续变化

- **WHEN** 一致性审查发现业务 MR 的 head 或 state 在 Change Run 完成后变化
- **THEN** 系统保留原 Run 和 Publication Receipt，只创建独立审查事实或后续 Change，不重开或回退原 Run

#### Scenario: 业务发布完成但规格 Journal 未终结

- **WHEN** 全部 Business items 已有 Receipt，但最终规格项只到 prepared、committed 或 pushed
- **THEN** Runtime 保持 `phase=archive` 并从规格 Journal 的下一未确认动作恢复，不接受不完整 Publication Receipt

#### Scenario: 所有发布项完成且调用者未被修改

- **WHEN** Business 与 Specification items 都通过精确远端核对，规格 Journal completed，且调用者 branch/HEAD/index/worktree 与 Archive 前一致
- **THEN** Runtime 接受组合 Publication Receipt、进入 completed，并公开空 nextActions
