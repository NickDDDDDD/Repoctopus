# development-telemetry Specification Delta

## ADDED Requirements

### Requirement: Workspace intent 修订必须可观测且保持低基数

Runtime MUST 为 Execution Workspace binding failure、Build→Open intent revision、可信 isolation 决策、Open→Design 恢复和 execution checkpoint retirement 记录可关联 trajectory/OTLP 事实。Binding telemetry MUST 同时携带受限 error code 与 `intent-revision | binding-retry | halt` 恢复类别；Trace MAY 使用受控 run/work identity 做关联，Metric label MUST 只使用 phase、work kind、受限 binding error code/recovery、`current|branch|worktree` isolation 与 retirement boolean，不得包含 checkout 路径、branch、digest、错误文本、runId、workId、changeId、worktree 名称或个人身份。

#### Scenario: linked worktree 拒绝 current

- **WHEN** Open prevalidation 或 Build Configure 发现 `current-linked-worktree`
- **THEN** trace 记录受限 error code 与候选/旧 isolation，不导出绝对路径或本机 worktree identity

#### Scenario: 同 Run intent 修订成功

- **WHEN** 用户批准新 worktree intent且 Runtime进入 Design
- **THEN** trajectory 可关联 Build→Open wait、Human Decision、Open→Design、新 epoch 和旧 checkpoint retirement

#### Scenario: 不可修订身份漂移

- **WHEN** binding failure 分类为 remote identity 或 repository topology drift
- **THEN** 遥测记录有界 fail-closed 分类，不把自由文本或仓库 URL 作为 Metric label
