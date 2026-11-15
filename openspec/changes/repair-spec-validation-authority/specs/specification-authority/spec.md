# Spec Delta

## ADDED Requirements

### Requirement: 手动规格校验只读并绑定查询归属

规格校验 MUST 返回当前工件的严格校验结论和诊断。指定 Run 时，Runtime MUST 核对该 Run 与 Change 的归属。手动校验 MUST 保持 Run 状态、checkpoint、批准与已接受证据不变。校验结论仅对本次观察的工件生效。

#### Scenario: 修正失败的规格草案

- **WHEN** 同一个 Open Run 对应的草案首次校验失败，修正后再次校验
- **THEN** 命令分别返回实际失败与通过结论，冷启动后仍能通过 Open 阶段的正式审查继续原 Run

#### Scenario: 批准前迭代有效草案

- **WHEN** 同一个 Open Run 的两份草案先后通过严格校验且产生不同摘要
- **THEN** 两次查询都能完成，Runtime 的正式审批只对提交并复核的当前提案生效

#### Scenario: 查询指定了另一份 Change

- **WHEN** 调用方给出的 Change ID 与指定 Run 的 Change ID 不同
- **THEN** Runtime 拒绝查询关联，且指定 Run 的持久化状态保持原样

### Requirement: 阶段校验证据随受保护转换提交

Open 与 Design 的有效 Provider 校验证据 MUST 绑定各自阶段、当前 Work 或批准请求、工件身份与输入版本。Runtime MUST 仅在当前受保护转换接受证据时提交其权威绑定。重放同一接受 MUST 幂等，过期候选 MUST 被拒绝。Provider 身份检查与阶段校验摘要 MUST 各自按其语义执行。

#### Scenario: Design 合法深化 Open 草案

- **WHEN** Design 合法细化规格并产生与已接受 Open 证据不同的校验摘要，当前 Design 获得独立批准
- **THEN** Runtime 接受当前 Design 证据并进入 Build，保留 Open 的历史决定和阶段证据

#### Scenario: 阶段接受遇到中断或并发

- **WHEN** Provider 校验通过后受保护提交失败、版本被另一进程推进，或原请求在重启后重放
- **THEN** 持久化事实只能对应实际接受的当前阶段，原提交不得提前固定摘要或覆盖新阶段

### Requirement: 规划观察区分不可用和确定性失效

Build、Verify 和 Archive 的公开恢复与受保护入口 MUST 区分 Provider 暂时无法观察和已经证实的规划失效。无法观察时 MUST 保留当前 Work、审批、有效执行和证据事实，等待重新观察。确定性失效 MUST 沿现有规划恢复分类进入受保护的 Design 修订。

#### Scenario: Provider 暂时不可用后恢复

- **WHEN** 当前规划无法观察，随后同一 Provider 恢复并返回仍然有效的输入
- **THEN** Runtime 保留原 checkpoint 并继续原 Run，期间不会派发替代 Design Work 或执行归档副作用

#### Scenario: 已批准输入发生确定性变更

- **WHEN** Provider 成功观察到实际规划语义变化或现有批准失效
- **THEN** Runtime 使用现有分类生成受保护的 Design 修订，并按依赖失效后续事实
