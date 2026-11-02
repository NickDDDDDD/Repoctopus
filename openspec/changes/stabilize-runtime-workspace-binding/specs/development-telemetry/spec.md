# Spec Delta

## ADDED Requirements

### Requirement: Change 启动绑定与 Open 重观察必须可审计

Runtime MUST 为 Change 启动 preflight、稳定启动复用或冲突、Open Provider observation 和恢复结果记录版本化观测事实。Run 创建前的拒绝只进入持久 canonical observation outbox/OTLP，不得为遥测创建 Run；已有 Run 的事实从 trajectory 投影到同一 outbox。Metric label 只允许使用有界的 phase、result、binding error class、observation class、recovery kind 和 host replayed 布尔值；branch、path、digest、错误正文及自由 identity 不得成为 Metric label。

#### Scenario: 启动前拒绝相同 source 与 target

- **WHEN** Change 启动 preflight 发现 source 与 target 相同并在 Run 创建前拒绝请求
- **THEN** 遥测记录 `result=rejected`、受限 `binding_error=source-target-equal` 和 `run_created=false`，不输出 branch 名或 checkout 路径

#### Scenario: 等价启动复用原 Run

- **WHEN** 相同启动身份的请求恢复已存在 Run
- **THEN** trajectory/OTLP 记录 `result=reused` 和 `work_created=false`，并可与原 Run 关联，不把恢复统计为第二次逻辑 Run 或 Work

#### Scenario: 绑定漂移被拒绝

- **WHEN** 相同 Workspace/change 的新启动请求与原 Run 的 workspace binding identity 不同
- **THEN** 遥测记录有界 `result=conflict`、`recovery=halt` 和 `checkpoint_changed=false`，不导出新旧 branch、路径或自由错误文本

#### Scenario: Provider 暂时不可用后重观察成功

- **WHEN** Open Outcome 已接受，Provider observation 首次不可用并在后续受保护 pull 成功
- **THEN** Trace/Event 把两次 observation 关联到同一 Run、Work attempt 和 Host invocation，记录 `recovery=reobserve` 与 `host_replayed=false`
