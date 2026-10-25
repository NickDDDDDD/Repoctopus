# Spec Delta

## ADDED Requirements

### Requirement: Skill 正文必须由当前 Work 的 Host 实际消费

Repoctopus MUST 在 Work claim 后从已固定 Provider 解析 action 与 augmentation Skill 的完整正文和资源，并通过受管执行包交给唯一 Host；SkillUsageSnapshot、名称、source 或 digest 只能证明身份，不能单独证明 Skill 已加载或执行。

#### Scenario: Build Skill 已绑定但正文未交付

- **WHEN** Run 含 `tdd` 与代码边界 Skill snapshot，但 Host 只收到名称和 digest
- **THEN** Runtime 不得调用 Agent或接受 Outcome，并报告执行上下文未完整交付

#### Scenario: Host 收到固定组合

- **WHEN** 当前 Work 的所有 Skill 和 Specification 指令均与冻结 identity 一致
- **THEN** Host 按 definition 顺序收到完整内容，消费事实绑定执行包 digest 和当前 claim

### Requirement: Repoctopus 提供阶段 action Skill

Repoctopus MUST 通过独立内置 Skill Provider 提供 Open、Design、Build、Verify 和 Archive 的版本化 action Skill；阶段 Skill 负责当前 Work 的执行协议，Specification Provider 负责官方工件指令，方法 Skill 只能增强该协议且不得成为规划或任务权威。

#### Scenario: OpenSpec Provider 参与 Design

- **WHEN** 内置 Design Work 使用当前 OpenSpec Specification Provider
- **THEN** Host 同时收到 Repoctopus Design action Skill 与 Provider 返回的官方四类工件 instructions/template，产物仍由 OpenSpec 校验

#### Scenario: Specification Provider 被替换

- **WHEN** 项目组合选择兼容的另一 Specification Provider
- **THEN** lifecycle 仍使用同一阶段 action Skill 语义，并装填新 Provider 的工件协议，不引用 OpenSpec 安装路径或私有命令

## MODIFIED Requirements

### Requirement: 核心阶段提供固定默认方法组合

Repoctopus MUST 为内置生命周期固定阶段组合：Open 使用阶段 action Skill 探索并创建 change；Design 使用阶段 action Skill继续官方工件并解决未决策项；Build 使用阶段 action Skill执行当前 Task，在首次写入前加载 `tdd + codebase-design`，故障时加载 `diagnosing-bugs`；Verify 使用阶段 action Skill执行规格核对并加载 `code-review`；Archive 使用阶段 action Skill关闭规格，发布 Work 使用 `pr`。条件 Skill 只能由 definition 声明的事实触发，调用方不得任意选择。

#### Scenario: Build 首次写入尚未加载 TDD

- **WHEN** 当前 Task 的 Build Work 尚未向 Host 交付兼容的阶段 action、TDD 和代码边界 Skill 正文却请求写测试或实现
- **THEN** 应用边界拒绝写入，Runtime 先完成固定方法装填和 Host preflight 再允许执行

#### Scenario: 故障触发诊断方法

- **WHEN** Build Validator 返回 definition 声明的可诊断失败事实
- **THEN** Runtime 为同一 Work attempt 加载固定 `diagnosing-bugs` augmentation，而不是让 Agent 自选另一流程

#### Scenario: Verify 只有代码审查身份

- **WHEN** Verify Work 只记录 `code-review` snapshot 而没有向 Host 交付阶段 action 与审查正文
- **THEN** Runtime 保持 Verify 未执行，不把后续自动命令成功当作 Agent 已完成规格核对和代码审查
