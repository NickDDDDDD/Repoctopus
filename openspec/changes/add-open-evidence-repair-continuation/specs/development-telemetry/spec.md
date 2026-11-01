## ADDED Requirements

### Requirement: Open Evidence 恢复必须形成可重放观测事实

Runtime MUST 为 Open Provider Evidence acceptance/rejection、observation unavailable、repair Work派发、批准后重验、execution retirement和最终恢复记录可关联的 Trajectory与 OTLP事实。事件 MUST 允许离线复算一次 Open返工是否保留同一 Run、是否重复调用 Host以及何时建立新 Human Decision；Metric label MUST 仅使用 phase、source、result、postApproval和 retirement等有界字段，不得包含 digest、路径、诊断正文、changeId、runId、workId或个人身份。

#### Scenario: Strict validation 触发 Open repair

- **WHEN** Open Outcome后的 Provider Evidence因 strict validation失败而安装 replacement Work
- **THEN** Trace关联 Evidence拒绝、旧新 Work/epoch和 retirement，Metric记录 `source=strict-validation,result=repair-dispatched`且不包含高基数身份

#### Scenario: Provider observation unavailable

- **WHEN** Provider调用未返回可分类结果且 Runtime保留原 execution
- **THEN** 遥测记录 `result=reconcile`和 `host_replayed=false`，不把异常正文作为 Metric label

#### Scenario: 批准后漂移恢复

- **WHEN** Open批准后重验发现 planning摘要变化，新的 Open Work最终通过并建立新决定
- **THEN** Trajectory可按顺序关联旧决定失效、repair Work、Provider Evidence、新 Human Decision与 Open到 Design转换
