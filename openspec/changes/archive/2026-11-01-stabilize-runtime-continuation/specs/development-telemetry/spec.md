# Spec Delta

## ADDED Requirements

### Requirement: 增量失效必须形成可复算观测事实

Runtime MUST 在本地提交增量失效后记录变化权威、变化类别、受影响 identity kind、保留/退役节点数量、失效范围是否精确、fallback 原因和 resulting continuation；Trace/Event MAY 携带允许列表内的旧新 identity 关联，Metric labels MUST 仅使用有界 authority、classification、scope、result 与 continuation kind。

#### Scenario: 局部 Plan revision 保留完成事实

- **WHEN** Build 或 Verify finding 只失效部分 Work Packages 并保留其余 completions
- **THEN** Trajectory 与 OTLP 记录受影响/保留数量、精确范围结果和旧新 Plan 关联，使团队可以复算返工放大率

#### Scenario: 无法计算最小范围

- **WHEN** Runtime 因缺少依赖身份而采用保守失效或 Human Decision
- **THEN** 事件记录 `scope=conservative` 与有界 reason code，不输出自由文本、Task 内容、路径或 digest 作为 Metric label

#### Scenario: composition 变化不触发 planning invalidation

- **WHEN** Runtime 接受 compatible composition adoption 且 planning semantic identity 不变
- **THEN** OTLP 关联 adoption 与恢复 continuation，不产生 planning invalidation 或 Design approval refresh 事件

### Requirement: Continuation 去重必须可观测

Runtime MUST 为相同 checkpoint 上的 continuation request、idempotent replay、revision conflict、dispatch suppressed 和 reconciliation 记录持久化可关联事实，使团队能区分正常恢复、重复调度缺陷和未知副作用；Metric labels MUST 使用有界 request kind、outcome、phase、Work kind 与 recovery classification。

#### Scenario: 重复 next 返回原 checkpoint

- **WHEN** 相同 Run revision 和 current Work 上的 `run next` 重放没有产生新事实
- **THEN** 遥测记录 `dispatch-suppressed` 或 idempotent replay，并关联原 Work/attempt，但不生成第二个 Work started Span

#### Scenario: 响应丢失后的 transition 重放

- **WHEN** 调用方重放已经成功提交的 transition 命令
- **THEN** 事件表示从 checkpoint 恢复既有 continuation，phase transition、invalidation 与 Human Decision requested 计数均不重复

#### Scenario: 未知外部结果进入 reconciliation

- **WHEN** Runtime 不能确定原 invocation 是否跨过副作用边界
- **THEN** Trajectory 与 OTLP 记录 `reconcile` continuation 和原 invocation 关联，不记录 retry 或新 Host invocation 成功

### Requirement: Runtime 稳定性指标必须来自审计事实

Telemetry Provider MUST 从持久事件派生重复批准率、Build Protocol 重建率、精确/保守失效率、保留 completion 比率、checkpoint 恢复结果、reconciliation 数量和重复派发抑制数量；这些 Metric 不得根据最终 phase、目录扫描、Dashboard 交互或日志文本推断。

#### Scenario: 团队评估 Runtime 稳定性

- **WHEN** 多个 Change 完成、返工或中断恢复
- **THEN** 后端可按有界 phase、authority、classification 和 result 聚合稳定性指标，并从 Trace/Event 回到具体审计链解释异常

#### Scenario: 缺少必要审计事实

- **WHEN** 某个旧 Run 没有计算指标所需的版本化事件
- **THEN** Provider 标记数据不可用，不从现有文件或终态猜测成功、失效或重复次数
