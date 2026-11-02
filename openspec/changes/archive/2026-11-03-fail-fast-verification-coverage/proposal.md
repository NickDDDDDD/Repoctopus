# Proposal

## Why

多仓项目接入生成的 `verify` Profile 当前没有为命令节点声明 `covers`。这种配置可以通过 Schema 和人工接入审批，却无法覆盖任何 Change Acceptance；Runtime 直到 Build Execute 与 Build Check 全部完成、准备进入 Verify 时才报错。开发者因此在已经投入实现和审查后才发现工作流从一开始就不可完成。

## What Changes

- 让项目探测生成保守但可执行的 workspace-wide Acceptance coverage 候选，并把该选择明确列为需要人工复核的接入发现。
- 在项目配置审批前拒绝没有任何 required 节点声明 Acceptance coverage 的 Change Verify Profile。
- 在 Design 规格和 Tasks 已冻结后，使用真实 Acceptance Set 对 Verify Profile 做只读、确定性的 coverage 预检；未覆盖、未知或只由 optional 节点覆盖时不得创建 Build Work。
- Verify 阶段继续用同一 coverage 解析器构造不可变 Verification Input，避免前置检查和正式门禁形成两套规则。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-configuration`: 探测候选和接入审批必须保证 Change Verify Profile 至少具备明确的 required coverage 声明。
- `implementation-evidence`: Acceptance coverage 必须在 Design→Build 边界预检，并与 Verify 的正式解析保持同一领域规则。

## Impact

- 影响项目探测、项目配置审批、Evidence coverage 领域逻辑和 Change Design gate。
- 新项目默认获得显式但保守的 `covers: ['*']` 候选；用户可在批准前把它收窄为 `task:` 或 `requirement:` selector。
- 已有有效配置不需要迁移；已有全部 coverage 为空的配置将在新 Change 进入 Build 前得到可定位错误，而不是在 Build 完成后失败。

