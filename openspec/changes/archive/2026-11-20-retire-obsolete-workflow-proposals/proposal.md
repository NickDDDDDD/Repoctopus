# Proposal

## Why

三个旧提案仍列在活动 Change 中，但其部分目标已由现有能力覆盖，部分方案已不再采用。它们没有可续接的 Comet 状态，继续展示为待实施任务会混淆当前工作范围。

## What Changes

- 撤出 `add-managed-team-required-checks`、`verify-open-intake-method`、`verify-tdd-method` 三个活动提案，记录取消、暂缓及保留目标的理由和原始 Git 坐标。
- 取消 Open 通用 Method Receipt 及自动判定 Agent 已理解需求的方案；保留现有 Skill 交付、规格校验与人工审查职责。
- 暂缓独立团队检查 Work；普通命令检查继续使用已有 Verify Profile，不宣称二者能力等价。
- 从旧 TDD 方案只保留后续目标：利用现有命令 Evidence 核验真实 RED/GREEN/回归执行。将来排期重新设计，不继承旧通用 Receipt 框架或旧任务清单。
- 清理活动引用；历史验证报告保持原样。旧提案不按已实现 Change 归档，不勾选旧任务，不应用旧 delta specs。

本次仅交付文档整理。Runtime、技能加载、验证行为与遥测均不变，不开发上述后续能力。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本次没有规格级行为变化，使用 `skip_specs: true`。

## Impact

涉及三个旧 Change 目录、当前 Change 的设计记录，以及文档中的当前状态说明。引入一份简短的处理结论与后续目标索引；该索引不包含第二套规格或执行任务。无第三方源码采用、依赖或许可证变化，无发布包及兼容性变化。
