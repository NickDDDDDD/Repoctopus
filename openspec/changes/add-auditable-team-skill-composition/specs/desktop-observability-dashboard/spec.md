# desktop-observability-dashboard Delta

## MODIFIED Requirements

### Requirement: 当前 Work 显示 Skill 装填与消费状态

桌面应用 MUST 按 Action、内置 augmentation、team guidance 和 augmentation replacement 角色列出当前或所选 Work 的 Skill，并分别显示 resolved、delivered、consumed、验证失败或未上报。界面 MUST 将 consumed 描述为 Host 声明并经 Runtime 校验的内容消费证明，不得描述为 Agent 内部思考或方法执行证据。

#### Scenario: Design Work 装填两个 Skill

- **WHEN** Runtime 为 Design Work 上报 Action、`codebase-design` 和一个团队 guidance 的完整链路
- **THEN** Dashboard 按角色和冻结顺序展示三个 Skill，以及各自 resolved、delivered 和 consumed 状态

#### Scenario: Skill 只完成交付

- **WHEN** Dashboard 已收到 Skill resolved 与 delivered，但尚未收到该 Work 的 consumed
- **THEN** Skill 显示为已交付、消费尚未上报，不得提前显示已使用或方法已验证

#### Scenario: Skill 消费证明被 Runtime 拒绝

- **WHEN** Host 声明的 Skill layer 与当前 Work packet 不匹配且 Runtime 拒绝 Outcome
- **THEN** Dashboard 显示消费校验失败及有界原因类别，不把该 Skill 或 Work 表示为成功完成

#### Scenario: replacement 覆盖内置 slot

- **WHEN** 当前有效组合为显式 slot 选择了团队 replacement
- **THEN** Dashboard 展示 slot、团队来源与 replacement 身份，并把未采用的内置默认项表示为被替换而不是执行失败
