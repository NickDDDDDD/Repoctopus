# 工作流入口与 Action Skill 装填规格

## ADDED Requirements

### Requirement: 宿主通过 Repoctopus Skill 进入工作流

Workspace 的 `repoctopus` 入口 Skill MUST 通过公开接口按明确用户意图启动 Change 或恢复已识别的 Run。入口 MUST 以 Runtime 返回的 continuation 为准；无法确定目标时 MUST 提示用户补足身份或意图，不得猜测并创建第二个 Run。入口 Skill 不持有阶段、审批或写入授权。

#### Scenario: 在宿主显式调用入口

- **WHEN** 用户在已接入 Workspace 的宿主里调用 `repoctopus`，并给出启动所需的 Change 和目标信息
- **THEN** 宿主经公开 CLI 启动该 Change，沿 Runtime 返回的 Run 和当前 continuation 执行
- **AND** 不要求宿主预先发现全部阶段 Skill

#### Scenario: 从新会话恢复已有 Run

- **WHEN** 用户调用入口并给出已有 Run 的身份
- **THEN** 宿主恢复原 Run，并按当前 continuation 处理，不基于本地文档重建阶段或新建 Run

### Requirement: 宿主仅装填 Runtime 指定的当前 Action Skill

对已领取的可执行 Action，Runtime MUST 交付当前 claim 绑定的固定 Skill 正文和所需资源；宿主 MUST 在执行前装填该内容及按序交付的其他受管层，并只对实际装填的层回报消费。宿主 MUST 按 Runtime 指示处理人工决定、等待、待核对或完成状态；不可从阶段名称、同名 Skill 或旧执行包自行选择执行内容。

#### Scenario: 从 Open 推进到 Design

- **WHEN** 宿主从同一 Run 取得并领取 Open Action，随后当前 Open Outcome 被接受且人工批准完成，Runtime 返回 Design Action
- **THEN** 宿主先装填 Open 的受管内容；审批前不装填 Design；领取 Design 后装填该 Action 自己的受管内容
- **AND** 消费回执与各自的 claim 及执行包绑定

#### Scenario: 当前内容无法装填

- **WHEN** 所需内容缺失、宿主无法加载，或拿到的是其他 Action、旧 attempt 的执行包
- **THEN** 宿主报告缺口并停止该 Action，不回报未消费内容、不改用同名 Skill，不让 Runtime 将其视为成功

#### Scenario: 恢复时存在待决定项或未知结果

- **WHEN** Runtime 返回人工决定、等待、待核对或已完成
- **THEN** 宿主处理该返回状态，不以入口调用为由重新领取或重放已执行的 Action
