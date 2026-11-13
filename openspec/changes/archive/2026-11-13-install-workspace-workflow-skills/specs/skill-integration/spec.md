## MODIFIED Requirements

### Requirement: Skill 正文必须由当前 Work 的 Host 实际消费

Repoctopus MUST 从冻结的 Provider 身份解析 Action 与 augmentation Skill 正文和必要资源。Runtime MUST 给唯一的执行 Host 提供随包内容或绑定本地来源与内容身份的引用。仅当宿主能核对其实际装填的正文与资源时，才可用引用装填。引用无法核对时，宿主 MUST 使用同一 Work 的冻结随包内容。名称、路径、digest、安装结果或成功调用不能单独证明 Skill 已装填或已使用。

#### Scenario: Build Skill 已绑定但正文未交付

- **WHEN** Run 含 `tdd` 与代码边界 Skill snapshot，但 Host 只收到名称和 digest
- **THEN** Runtime 不得将其视为已交付正文，宿主须获取同一 Work 的完整内容后执行及报告消费

#### Scenario: Host 收到固定组合

- **WHEN** 当前 Work 的所有 Skill 和 Specification 指令均与冻结 identity 一致
- **THEN** Host 按 definition 顺序装填完整内容，消费事实绑定执行包 digest 和当前 claim

#### Scenario: 宿主可以核对实际装填的本地 Skill

- **WHEN** 当前 Work 的已安装静态 Skill 的实际来源、正文及资源与冻结身份一致，且宿主能按该来源装填
- **THEN** Runtime 可以在交付视图中用绑定引用表示该层，宿主按原有组合顺序装填并在实际消费后报告当前 claim 与 packet 对应的层摘要

#### Scenario: 仅支持按名称加载或安装内容漂移

- **WHEN** 宿主不能核对实际加载来源，或本地 Skill 缺失、已修改、资源不匹配、被同名 Skill 覆盖
- **THEN** 宿主获取原 Work 的冻结正文和资源，使用原 claim、packet 与层身份，无法获取完整冻结内容时停止当前 Action
- **AND** 宿主不得仅凭 Skill 名称、路径、安装清单或工具成功回报消费

### Requirement: 宿主仅装填 Runtime 指定的当前 Action Skill

对已领取的可执行 Action，Runtime MUST 给执行宿主交付当前 claim 绑定的有序内容或可验证本地引用。宿主 MUST 装填当前 Action 的真实 Skill 内容、必要资源及按序交付的受管层，并只对实际装填的层回报消费。宿主 MUST 按 Runtime 指示处理人工决定、等待、待核对或完成状态；不得根据阶段名称、同名 Skill 或旧执行包选择执行内容。

#### Scenario: 从 Open 推进到 Design

- **WHEN** 同一 Run 的 Open Outcome 被接受且人工批准完成，Runtime 返回 Design Action
- **THEN** Open 与 Design 各自只装填已经领取的当前 Action 与对应组合，消费回执绑定各自的 claim 及执行包
- **AND** 两个阶段所需的 OpenSpec Store 位置、模板、操作与产物约束仍从当前 Specification Provider 取得

#### Scenario: 当前内容无法装填

- **WHEN** 宿主无法获取必要内容，或拿到其他 Action、旧 attempt 的执行包
- **THEN** 宿主报告缺口并停止当前 Action，不回报未消费内容

#### Scenario: 换进程恢复时本地内容变化

- **WHEN** 冷恢复原 Run 时本地已安装 Skill 的内容、资源或宿主能力发生变化
- **THEN** Runtime 保持原 Work 的内容与身份，按需要交付原来绑定的随包内容，旧 attempt 的回执不得用于当前 Action

#### Scenario: 恢复时存在待决定项或未知结果

- **WHEN** Runtime 返回人工决定、等待、待核对或已完成
- **THEN** 宿主处理该返回状态，保持原 Action 的执行权与恢复语义

## ADDED Requirements

### Requirement: 已安装的方法 Skill 遵守工作流权威

安装的 Repoctopus Action 与 Matt 方法 Skill MUST 服从当前 Runtime Work、能力与写入约束。OpenSpec 静态 Skill 的宿主可发现性 MUST NOT 替代运行时 Provider 工件协议。仅作为方法参考的 `to-spec`、`to-tickets` 不得以工作流执行 Skill 形式安装。

#### Scenario: 团队启动多仓 Change

- **WHEN** Workspace 已安装宿主 Skill，团队使用共享 OpenSpec Store 进入工作流
- **THEN** Runtime 依现有团队绑定决定当前组合，OpenSpec Provider 继续提供动态工件协议与唯一规格权威
