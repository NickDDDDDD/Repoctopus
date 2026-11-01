# Spec Delta

## ADDED Requirements

### Requirement: Execution checkpoint 兼容性必须按依赖身份判定

Runtime MUST 以 current Work、attempt、`checkEpoch`、packet、Host invocation 及该 Work 声明的输入依赖逐项判断 execution checkpoint 是否仍可续行；未被变化身份依赖的 checkpoint MUST 保留，直接依赖不兼容身份的 checkpoint MUST 原子退役。Runtime 不得以全局 planning 或 composition 摘要不同为由无差别丢弃执行事实。

#### Scenario: 当前 Work 输入完全相同

- **WHEN** Runner 恢复时 current Work、attempt、epoch、packet 和全部声明输入身份均与 checkpoint 相同
- **THEN** Runtime 返回原 execution continuation，不创建新的 ActionIntent、packet、claim 或 Host invocation

#### Scenario: 变化不属于当前 Work 依赖

- **WHEN** Run 中某个 publication 或其他旁路身份变化，但当前 Work 的显式输入依赖均未变化
- **THEN** Runtime 保留原 execution checkpoint 并继续真实断点

#### Scenario: 当前 Work 的受保护输入不兼容

- **WHEN** 当前 Work 依赖的 Provider、definition、packet 或 repository binding 无法证明与 checkpoint 兼容
- **THEN** Runtime 原子退役当前投影并返回 `reconcile` 或 `migration_required`，不得从最新文件重组 packet 后重放 Host

### Requirement: 未知外部结果必须优先 reconciliation

当 Host、工具、Git、平台或 Specification 副作用可能已经开始但结果未知时，Runtime MUST 保留原 invocation、幂等键、attempt、packet 与输入身份并返回有界 `reconcile` continuation；只有取得确定性未执行证明后才可创建新 attempt，取得匹配 Receipt 或 Outcome 后必须从原 checkpoint 继续。

#### Scenario: Host 响应在提交后丢失

- **WHEN** Runtime 已记录 invocation，但无法确定 Host 是否完成了具有副作用的操作
- **THEN** 下一次 pull 返回原 invocation 的 reconciliation，不重新调用 Host

#### Scenario: reconciliation 发现匹配 Outcome

- **WHEN** Reconciler 找到绑定原 invocation、packet、attempt 和输入身份的持久 Outcome 或 Receipt
- **THEN** Runtime 幂等接纳该事实并从 Validator 或 transition 继续，不创建新的执行身份

#### Scenario: reconciliation 证明未执行

- **WHEN** 权威适配器能确定性证明原 invocation 未跨过副作用边界
- **THEN** Runtime 按 definition retry policy 创建更高 attempt，并保留原 attempt 的审计事实

### Requirement: 恢复不得重建已存在的人机协议

Human Decision request、Build Configuration proposal、Build Plan candidate rejection 和可纠正 Host submission MUST 作为原 checkpoint 的稳定协议事实恢复；重复 `next`、进程重启或 Runner 交接不得仅因重新观察当前文件而生成另一份 proposal/request 或改变其 hash。

#### Scenario: 等待 Build Configuration 决定时恢复

- **WHEN** Run 已持久化 Build Configuration proposal 和 Human Decision request，但尚未收到用户决定
- **THEN** 新 Runner 展示同一 request、proposal hash 和 choices，不重新进入 Configure Host Work

#### Scenario: 可纠正 submission 被拒绝后恢复

- **WHEN** 当前 invocation 已有 rejected submission 且冻结输入仍匹配
- **THEN** Runtime 保留原 claim/attempt/invocation 并等待新的 submission identity，不重新执行 Agent
