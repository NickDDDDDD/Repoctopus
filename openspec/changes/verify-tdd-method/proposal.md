# Proposal

## Why

加载并消费 TDD Skill 不能证明测试先行。最终测试通过也不能区分真实 RED/GREEN 循环、实现后补测或无关基础设施失败。团队需要机器可核对的证据，才能判断工作流是否真正执行了批准的 TDD 策略。

本 Change 在 `verify-open-intake-method` 建立的 Method Receipt 基础上增加 `TddCycleReceipt`，验证当前 Task/Work Package 的 RED、GREEN 和 regression 命令 Evidence 及其输入和时间关系。

## What Changes

- 增加 `TddCycleReceipt` schema 和 Validator。
- 当批准策略选择 `tddMode=tdd` 时，将有效 Receipt 作为 Execute/Check Gate。
- `tddMode=direct` 不要求 RED/GREEN 顺序，但不降低相关测试、Build Check 和 Verify。
- 增加反作弊测试、OTLP 和桌面方法状态。

## Capabilities

### Modified Capabilities

- `implementation-evidence`: 增加 TDD 循环证据验证。
- `skill-integration`: 区分 TDD layer consumed 与 method verified。
- `development-telemetry`: 记录 TDD Receipt 生命周期。
- `desktop-observability-dashboard`: 展示 TDD 方法状态和失败类别。

## Dependencies

本 Change 依赖 `verify-open-intake-method` 交付通用 Method Receipt envelope、Validator registry 和 Evidence resolver；它不依赖 Open 专用 payload 语义。

## 非目标

- 不从 Git 时间戳、自由文本或最终测试成功推断 TDD。
- 不要求 `tddMode=direct` 伪造 RED/GREEN Receipt。
- 不改变 Build execution mode、Review mode 或 isolation。
