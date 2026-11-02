# Spec Delta

## MODIFIED Requirements

### Requirement: Open 观察错误按可判定性分类

Runtime MUST 将创建前工作区输入无效、Provider 明确返回的规格无效、Provider 暂时不可用和外部执行结果未知分为不同事实。只有无法判定原外部执行结果时进入 Host reconciliation；已接受 Open Outcome 后的暂时 Provider 故障只重新观察原 checkpoint。Open Outcome validation 与 planning gate observation MUST 是可恢复的顺序 checkpoint：第一层已通过时，后续 pull MUST 从持久化 `validated` checkpoint 继续第二层 observation，不得回退、重放 Host或从 phase/current Work标签猜测执行入口。

#### Scenario: Provider 暂时不可用后恢复

- **WHEN** Open Host Outcome 已接受，任一只读 Provider/planning observation 因暂时基础设施错误无法返回有效或无效结论，随后同一 observation authority恢复
- **THEN** Runtime 保留原 Work、Outcome、attempt、checkEpoch和 invocation，在下一次受保护 pull从最近已接受 checkpoint重新观察并继续原 gate，不重放 Host或创建 repair Work

#### Scenario: strict validation 之后 planning observation 暂时不可用

- **WHEN** Open Host Outcome 已接受，artifacts inspection、strict validation 与 Outcome validator 已通过并持久化 `validated`，随后 published branch 或 planning approval observation 因暂时基础设施错误不可用
- **THEN** Runtime 返回绑定原 Work、attempt、checkEpoch、Outcome、receipt 和 invocation 的 `reobserve`，不创建 repair Work、不递增执行身份、不调用 Host reconciliation

#### Scenario: planning observation 恢复

- **WHEN** 上述 Run 在 Provider 恢复后执行下一次受保护 `run next`
- **THEN** Runtime 直接从 `validated` checkpoint 重试 planning gate，成功后进入唯一 Open Human Decision或已批准的 Design continuation，Host invocation 与 Skill consumption 计数不变

#### Scenario: planning observation 连续不可用

- **WHEN** 相同 Run 被重复 pull且 planning observation 仍暂时不可用
- **THEN** Runtime 幂等返回同一逻辑 `reobserve`，不回退到 `execute`、不新增 attempt/checkEpoch/approval request，也不把只读观察失败升级为未知 Host 结果

#### Scenario: Provider 明确返回 strict invalid

- **WHEN** Provider 成功返回当前四类规划工件 strict invalid 和可定位诊断
- **THEN** Runtime 通过单次 revision-bound transition 安装唯一 Open repair Work并退役旧 execution，不进入 Host reconciliation

#### Scenario: 分支约束错误在 Open inspection 中被发现

- **WHEN** 遗留或并发状态使 Provider inspection 发现 source 与 target 相同等确定性启动输入错误
- **THEN** Runtime 返回受限 binding/input conflict并保持原 checkpoint，不把该错误标记为 Provider unavailable，也不调用只适用于未知 Host 结果的 reconciliation

