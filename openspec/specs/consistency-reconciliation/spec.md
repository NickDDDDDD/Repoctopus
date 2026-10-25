# consistency-reconciliation Specification

## Purpose
定义已完成 Change 如何在不等待、不监听和不重开原 Run 的前提下，按需发现业务 MR 后续变化、判断规格影响并通过普通后续 Change 达成最终一致。

## Requirements

### Requirement: 一致性检查使用短生命周期拉取

Repoctopus MUST 通过显式 `change reconcile` 或正常任务启动后的有界检查，按已完成 Change 的 Publication Receipt 查询业务 MR 当前 head 与 state；检查必须执行后退出，不启动监听端口、Timer、Webhook、Event Inbox 或长驻 Runner，平台故障不得阻断新任务。

#### Scenario: 远端事实没有变化

- **WHEN** 当前业务 MR head/state 与最近一次已审查事实一致
- **THEN** Reconciler 返回 no-op，不创建 Work、后续 Change 或新的生命周期状态

#### Scenario: 平台暂时不可用

- **WHEN** 正常任务启动时无法查询一个已发布 MR
- **THEN** 系统记录有界 stale 诊断并继续启动新任务，不把任何已完成 Run 改为 waiting 或 failed

### Requirement: Head 或状态变化产生结构化规格影响审查

业务 MR 的 head 或 state 相对 Publication Receipt 发生变化时，Repoctopus MUST 生成绑定原 proposal/design/spec、Verify evidence、原 head、当前 head 和可核对 diff identity 的 `ConsistencyReviewRequest`；固定 Work/Skill 组合只能输出 `no-spec-impact`、`spec-update-required` 或 `uncertain`，不得只按文件路径自动宣称无规格影响。

#### Scenario: 流水线修复不改变行为契约

- **WHEN** 最终差异只调整测试、格式、构建、内部重构或实现细节，且证据证明规范性行为不变
- **THEN** 审查输出 `no-spec-impact` Receipt 并结束，不创建规格 Change

#### Scenario: 最终差异改变规范性行为

- **WHEN** 最终差异改变 API、配置、权限、数据契约、用户可观察行为或已接受范围
- **THEN** 审查输出 `spec-update-required` 并请求可信人工确认后续规格修正

#### Scenario: 语义证据不足

- **WHEN** Agent 无法从规格、Evidence 和最终 diff 唯一判断行为契约是否变化
- **THEN** 审查输出 `uncertain`，不得静默按无影响完成

### Requirement: 规格修正使用普通后续 Change

确认需要修正规格时，Repoctopus MUST 通过正常 Open 阶段建立引用原 Change、Publication Receipt、Consistency Review 和受影响 MR 的新 OpenSpec change；原 Run、归档目录和历史 Receipt 保持不可变。

#### Scenario: 规格 MR 已经合入后发现漂移

- **WHEN** 原规格归档已经进入目标分支且业务 MR 最终行为发生变化
- **THEN** 系统创建后续 Change 处理增量修正，不修改旧 archive

#### Scenario: 原规格 MR 尚未合入

- **WHEN** 原最终规格 MR 仍开放但确认业务变化需要修正规格
- **THEN** 系统仍以可审计的后续 Change 表达修正，并由团队决定 MR 合入顺序，不重开原 Run
