# implementation-evidence Delta

## ADDED Requirements

### Requirement: 关键方法必须提交可机器核对的 Method Receipt

Repoctopus MUST 为 definition 声明为 required 的方法接受版本化 `MethodReceipt`，其 envelope 绑定 method/validator identity、Run、Work、Host invocation、input/packet/layer digest 和内容寻址 Evidence references。只有登记 Validator 从当前 Outcome 与 Evidence Store 实际解析并接受 Receipt 后，方法 Gate 才满足；Agent 摘要、Prompt/回复、文件存在、最终成功或占位引用不得替代 Receipt。

#### Scenario: Host 只声明遵循了方法

- **WHEN** Outcome 自述已执行 Open 方法，但没有匹配当前输入的 Method Receipt 和机器 Evidence
- **THEN** Runtime 保留该说明为 observed finding，required 方法状态保持 incomplete

#### Scenario: Method Receipt 输入已漂移

- **WHEN** Receipt 引用的 Work input、packet、Skill layer或 Validator 与当前 Gate 不一致
- **THEN** Runtime 拒绝 method verified，保存有界拒绝原因且不重写原 Evidence

### Requirement: Open 方法验证核对事实覆盖与未决 frontier

Open Validator MUST 要求 `OpenMethodReceipt` 记录 definition 声明的 repository、现有 specification、项目配置和 Provider facts 的已检查类别及摘要、未决 decision references、frontier 状态、零提问理由和四类 OpenSpec 工件摘要；可从授权环境取得的事实不得作为用户决策问题。Receipt MUST NOT 保存 Prompt、问答正文、模型回复或内部思考。

#### Scenario: 完整输入无需提问

- **WHEN** Agent 已从仓库、规格和配置核对全部 material facts，frontier 为空且四件套与 Receipt 摘要一致
- **THEN** Open 可以零问题提交 Outcome，Validator 接受方法执行但仍等待独立 Open Human Decision

#### Scenario: 完整 PRD 与代码事实冲突

- **WHEN** 用户输入看似完整，但 Agent 可访问的代码或当前规格与其关键假设不一致
- **THEN** Receipt 记录已核对冲突并把真正的语义选择留在 frontier；未做代码核对的零提问 Outcome 被拒绝
