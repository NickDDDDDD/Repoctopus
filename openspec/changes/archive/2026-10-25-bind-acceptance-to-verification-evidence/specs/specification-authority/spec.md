# specification-authority Delta Specification

## ADDED Requirements

### Requirement: Provider 公开稳定 Acceptance 身份

Specification Provider MUST 从唯一官方 Tasks 权威导出每条 Acceptance 的稳定内容身份、Task identity、规范化文本、Requirement mappings 和可移植来源；checkbox 状态、等价格式和运行结果不得改变 Acceptance 身份，语义内容或映射变化必须使旧身份失效。

#### Scenario: 只勾选已经实现的 Task

- **WHEN** `tasks.md` 仅把同一 Task 从 `[ ]` 改为 `[x]`
- **THEN** Provider 保持 Task revision 与 Acceptance identity 不变，并把完成状态作为独立声明投影

#### Scenario: 修改验收语义

- **WHEN** Acceptance 文本、所属 Task、Requirement mapping 或规范来源发生语义变化
- **THEN** Provider 生成新的 Acceptance identity，使旧 Verification Input 和 Evidence Trace 不再兼容

### Requirement: Task checkbox 只投影完成声明

Specification Provider MUST 只通过绑定 expected Task revision 的完成操作写入 checkbox，并把已有 `[x]` 投影为 imported completion claim；Provider 不得把 checkbox、提交消息或 Agent 摘要投影为 Work Receipt、Acceptance Evidence 或 Verify 结果。

#### Scenario: 启动时 Task 已勾选

- **WHEN** Runtime 在批准后读取到语义匹配且已 `[x]` 的官方 Task
- **THEN** Provider 返回 imported completion claim，Runtime 可以避免重复实现但仍要求完整 Verify Evidence

#### Scenario: 陈旧执行者完成 Task

- **WHEN** 执行者使用旧 taskRevision 请求勾选已发生语义变化的 Task
- **THEN** Provider 拒绝写入且不改变当前 Tasks 文档

