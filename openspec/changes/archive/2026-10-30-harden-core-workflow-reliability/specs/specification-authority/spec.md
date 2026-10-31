# specification-authority Delta

## MODIFIED Requirements

### Requirement: 规格操作使用稳定领域契约

Repoctopus MUST 通过规范化的 change 身份、工件引用、工件满足状态、校验结果、同步结果和关闭结果表达规格操作；Provider 专有路径、CLI 输出、状态名称与跳过规则不得泄露为 Workflow 状态规则。

#### Scenario: 更换规格 Provider

- **WHEN** 项目在新的 Run 中选择另一个兼容 Specification Provider
- **THEN** Workflow 继续使用相同领域操作，已有 Run 仍保持原 Provider 快照

#### Scenario: Provider 报告可选工件已跳过

- **WHEN** 当前 schema 与 Change 元数据允许某类规划工件被跳过，且 Provider 报告其官方状态为 `skipped`
- **THEN** Provider 投影带稳定 digest 的 `skipped` 工件，Workflow 将其视为已满足但不伪装成存在的文件

#### Scenario: Provider 报告必需工件缺失

- **WHEN** 当前 schema 要求某类工件且 Provider 未找到有效输出
- **THEN** Provider 投影 `missing`，Workflow 阻断受保护转换且不从路径、文件数量或其他工件推断满足

#### Scenario: Provider 返回信息诊断

- **WHEN** Provider 校验结果包含 `info`、`warning` 和 `error` 级别诊断
- **THEN** 领域契约逐项保留三个严重级别、代码、消息和可用工件定位，不把 `info` 或未知文本静默改写为 `error`

#### Scenario: Provider 返回未知严重级别

- **WHEN** 外部 Provider 返回领域契约不认识的诊断严重级别
- **THEN** Provider fail closed 并返回可定位的契约错误，不把未知值降级为 `info` 或 `warning`

### Requirement: 规格校验是推进前置事实

Repoctopus MUST 在 Open/Design 审查、Verify 完成、Archive 开始和规格关闭等受保护转换前，请求当前 Specification Provider 在已校验的 Specification Root 上校验该转换所需工件，并把 Store/Provider/schema identity、规范化 manifest、工件满足状态、校验结果和输入摘要作为 Change Run Evidence；调用方自述成功、文件存在、Git/MR 状态或 Workflow 对 Provider 输出的二次推断不得替代该事实。有效校验结果不得包含 `error` 诊断。

#### Scenario: Delta Spec 严格校验失败

- **WHEN** 规格 Provider 报告当前 change 校验失败
- **THEN** 受保护转换不得推进，Change Run 保持当前 phase/status 并返回可定位的规格诊断

#### Scenario: 校验结果属于旧输入

- **WHEN** Provider 曾经校验成功但当前规划产物、工件满足状态或实现输入摘要已经变化
- **THEN** Runtime 使旧校验失效并请求新结果，不把缓存成功用于当前转换

#### Scenario: Provider 同时报成功和错误诊断

- **WHEN** 外部 Provider 报告 `valid: true` 但规范化诊断中存在 `error`
- **THEN** Specification Provider 将结果视为无效的契约冲突，阻断转换并保留错误诊断供定位

### Requirement: Provider 校验 Open 与 Design Work 的完成事实

Open 和 Design 的 succeeded Outcome MUST 由当前 Specification Provider 重新观察并验证：Open 至少证明 change identity、允许根及当前 schema 要求的四类官方工件均为 `ready` 或经官方规则确认的 `skipped`，Design 必须证明全部适用工件严格有效且语义摘要可供 Human Decision；Host 或 Agent 的成功声明不得代替观察事实。

#### Scenario: Agent 声称已创建 Change 但目录缺失

- **WHEN** Open Host 返回 succeeded 而 Provider 找不到对应 change 或 metadata
- **THEN** Validator 拒绝 Outcome并保持 Open Work 可修复

#### Scenario: 官方规则跳过 Delta Specs

- **WHEN** Open Host 返回 succeeded，Provider 确认 Proposal、Design 和 Tasks 为 `ready`，并依据当前 schema 与元数据确认 Delta Specs 为 `skipped`
- **THEN** Validator 接受该四类工件协议的满足事实并继续严格校验，不以“缺少第四个文件”阻断 Open

#### Scenario: Design 文件存在但 strict validation 失败

- **WHEN** Design Host 返回 succeeded 而任一适用官方工件缺失、格式错误或引用无效
- **THEN** Validator 保持 Design blocked 或生成诊断 retry，不创建 Human Decision 请求
