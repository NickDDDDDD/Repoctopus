# Proposal

## Why

Skill 的 resolved、delivered 和 consumed 只能证明内容被解析、交付和由 Host 声明消费，不能证明 Open Agent 已核对代码、现有规格和配置，也不能证明问题 frontier 已正确收敛。完整 PRD 可能与代码事实冲突，仅依赖 Agent 自述会让 Open approval 建立在未经验证的理解上。

本 Change 建立通用 Method Receipt envelope，并首先以 `OpenMethodReceipt` 机器核对 Open 所需事实覆盖、冲突、未决决策和四件套摘要。

## What Changes

- 增加版本化、内容寻址的 Method Receipt envelope 和 Validator registry。
- Open Outcome 提交 `OpenMethodReceipt`，绑定当前 Run、Work、packet/layer 与 Evidence。
- Validator 核对 repository/spec/config/provider facts、frontier、decision references、零提问理由和四件套摘要。
- 增加 `method_verified` 事实、Gate、OTLP 和桌面投影。

## Capabilities

### Modified Capabilities

- `implementation-evidence`: 增加 Method Receipt 与 Open 专用验证。
- `skill-integration`: 区分 consumed 和 method verified。
- `development-telemetry`: 记录 Receipt 提交、接受和拒绝。
- `desktop-observability-dashboard`: 展示 Open 方法验证状态。

## Dependencies

本 Change 使用现有 Work packet、Evidence Store 和 Validator 边界；若 `add-auditable-team-skill-composition` 已完成，则复用其 layer identity，但不依赖团队自定义 Skill 才能交付。

## 非目标

- 不保存 Prompt、问答正文、模型回复或思考过程。
- 不强迫 Open 必须提问；frontier 为空且证据充分时允许零提问。
- 不实现 TDD Receipt 或团队 required check。
