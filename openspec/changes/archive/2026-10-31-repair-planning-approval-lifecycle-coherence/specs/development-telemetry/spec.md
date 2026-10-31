# development-telemetry Specification Delta

## ADDED Requirements

### Requirement: 规划恢复必须上报权威失效与 checkpoint 退役事实

Runtime MUST 为 planning authority invalidation、lifecycle Design recovery 和 execution checkpoint retirement 记录可关联的 trajectory 与 OTLP 事实，使团队能够区分语义漂移、批准授权失效、原子恢复成功和遗留 torn checkpoint。正常 lifecycle 恢复 MUST 绑定 `change.lifecycle.transitioned`，遗留状态收敛 MUST 绑定幂等 `recovery.reconciled`；Trace MAY 携带受控 identity 关联，Metric label MUST 只使用 phase、work kind、invalidation kind、continuation reason 与布尔结果等低基数字段，不得包含 digest、路径、自由文本、runId、workId、changeId 或个人身份。

#### Scenario: Archive 在副作用前回到 Design

- **WHEN** Archive preflight 因 planning authority 失效回到 Design
- **THEN** trace 记录 from/to phase、失效类型、旧/新 epoch 与 execution 是否退役，Dashboard 可从同一 Run 解释恢复原因

#### Scenario: 遗留 checkpoint 被只读恢复防线忽略

- **WHEN** recovery 发现 `workExecution` 与 lifecycle current Work/epoch 不匹配
- **THEN** 系统记录 `checkpoint-superseded` 诊断或事件，但 Metric 不包含旧 workId、digest 或错误文本

#### Scenario: 正常 phase transition 保留匹配 checkpoint

- **WHEN** lifecycle transition 未替换 current Work且 checkpoint 仍匹配同一 workId/checkEpoch
- **THEN** Runtime 不上报虚假的 retirement，避免把普通重试或同 Work 校验误计为状态撕裂
