# Spec Delta

## ADDED Requirements

### Requirement: Specification Provider 提供阶段工件协议

Specification Provider MUST 为 Open、Design、Build、Verify 和 Archive 中涉及规格的 Work 返回版本化阶段协议，包含适用工件、官方 instructions/template、允许操作、内容 identity 和校验入口；Runtime 将其作为执行包中的独立高优先级层交付，阶段 Skill 不得复制或覆盖 Provider 协议。

#### Scenario: Design 装填四类工件协议

- **WHEN** Design Work 准备创建或继续 Proposal、Delta Specs、Design 和 Tasks
- **THEN** Provider 返回当前 schema 的官方 instructions/template 与 digest，Host 在写入前收到这些内容且产物由同一 Provider strict validation

#### Scenario: 阶段不涉及 Specification 写入

- **WHEN** Work 的 output contract 不声明 Specification artifact 且不执行规格关闭
- **THEN** 执行包不装填无关模板，但仍记录当前 Specification Provider identity 供恢复兼容检查

### Requirement: Provider 校验 Open 与 Design Work 的完成事实

Open 和 Design 的 succeeded Outcome MUST 由当前 Specification Provider 重新观察并验证：Open 至少证明 change identity 与允许根已建立，Design 必须证明官方四类工件完整、严格有效且语义摘要可供 Human Decision；Host 或 Agent 的成功声明不得代替观察事实。

#### Scenario: Agent 声称已创建 Change 但目录缺失

- **WHEN** Open Host 返回 succeeded 而 Provider 找不到对应 change 或 metadata
- **THEN** Validator 拒绝 Outcome并保持 Open Work 可修复

#### Scenario: Design 文件存在但 strict validation 失败

- **WHEN** Design Host 返回 succeeded 而任一官方工件缺失、格式错误或引用无效
- **THEN** Validator 保持 Design blocked 或生成诊断 retry，不创建 Human Decision 请求

### Requirement: Fresh 模式不从 checkbox 合成受管完成事实

Specification Provider MUST 保留 Tasks checkbox 作为规划权威，但在 fresh Run 中将没有当前 Runtime Work Receipt 的预勾选项报告为 adoption conflict；只有显式 adopt-existing 模式可把它投影为 imported completion claim。

#### Scenario: Fresh Build 发现预勾选 Task

- **WHEN** Provider 读取到已勾选 Task，当前 Run 没有对应 Work completion 且启动模式为 fresh
- **THEN** Provider 返回 adoption conflict 和任务 identity，不把它视为可跳过的 completed Task

#### Scenario: Runtime Validator 完成 Task

- **WHEN** 当前 Build Work 的 Outcome、Receipt 与 Validator 全部匹配
- **THEN** Provider 幂等更新 checkbox 并投影 `runtime-work` completion，后续恢复不会重复执行该 Task
