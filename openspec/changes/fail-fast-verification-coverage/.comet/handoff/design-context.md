# Comet Design Handoff

- Change: fail-fast-verification-coverage
- Phase: design
- Mode: compact
- Context hash: beca32308b8465c9c9e48b15bf91246598adce661e9401c62c6147e76a652439

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/fail-fast-verification-coverage/proposal.md

- Source: openspec/changes/fail-fast-verification-coverage/proposal.md
- Lines: 1-30
- SHA256: 164a4aa0de19644633665d35bd7e25e04033ce95fe7086a15789ed8df87a9740

```md
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


```

## openspec/changes/fail-fast-verification-coverage/design.md

- Source: openspec/changes/fail-fast-verification-coverage/design.md
- Lines: 1-70
- SHA256: b1d147cf4f4b5e049e5222eb82cb387531d21c7567f66f7a5de17e1332a270b2

```md
# Design

## Context

`project detect` 能从多仓构建文件发现命令，但不能推断未来 Change 的具体 Task 或 Requirement。当前生成器因此省略 `covers`，解析后成为空数组。配置结构合法，`project prepare/review` 也允许批准；而 `createVerificationInput` 只有在 Build Check 之后才用真实 Acceptance Set 解析 coverage，导致不可达配置被延迟暴露。

Comet 0.5.1 的成熟做法是把配置错误和领域不变量放到副作用之前：执行器的 `supports`/`preflight` 在 claim 提交前只读检查，Workflow state validator 在启动、恢复和每次 transition commit 前校验，配置错误保持失败并给出恢复指引，不能转换成成功。Repoctopus 不引入 Comet SDK，但采用相同的时序和权威边界：候选配置先静态就绪检查，真实 Acceptance 出现后再做精确只读预检，正式 Verify 重用同一解析规则。

固定参考：`@rpamis/comet@0.5.1`，tag commit `35c9860b77b42bafa0c2d80d8d695889f888a924`；参考 `docs/architecture/runtime-sdk.md`、`docs/architecture/sdk-release-contract.md` 与 Workflow Application preflight 契约。

## Goals / Non-Goals

**Goals:**

- 新建项目不会批准一个完全无法覆盖 Change Acceptance 的 `verify` Profile。
- 任一 Change 在进入 Build 前证明当前 Tasks 的全部 Acceptance 都由 required Evidence 节点覆盖。
- 前置预检和 Verify 使用相同 selector 语义和错误分类。
- 检查只读、可重复，不创建 Evidence Attempt、不执行命令、不推进 lifecycle。

**Non-Goals:**

- 不自动为用户设计细粒度 `task:` 或 `requirement:` coverage。
- 不把 Build Check 的 Agent 自述或 test evidence ID 当成 Verify Receipt。
- 不改变 Evidence 执行、Receipt、Bundle 或 Acceptance Trace 的正式门禁。
- 不兼容或静默修补已经批准的错误配置；用户仍需正常修改并提交共享配置。

## Decisions

### Decision: 探测候选采用显式的保守 coverage

探测出的每个 required 命令节点写入 `covers: ['*']`，同时增加 `acceptance-coverage` unresolved finding，说明该节点暂按 workspace-wide coverage 处理，需要在审批前确认或收窄。

这是候选而非最终事实：`project detect` 仍只写草稿，用户批准前可编辑。选择 `*` 是因为探测阶段没有未来 Task/Requirement identity；留空会生成必然不可完成的配置，猜测细粒度 selector 则会伪造语义。全量覆盖成本偏高但 fail-safe，团队可随后优化。

### Decision: 配置审批检查静态可用性

项目配置审批准备阶段检查约定的默认 `verify` Profile：该 Profile 必须存在，并且至少包含一个 `required: true` 且 `covers` 非空的节点。该检查只证明默认 Profile 具备承担 Change Acceptance 的可能性，不声称它能覆盖任意具体 Change。CLI 为具体 Run 选择的其他 `verificationProfileId` 不由项目接入流程猜测，交给该 Run 的 Design 精确预检判断。

没有 coverage 的 service/前置节点仍然合法；因此不要求每个节点都声明 `covers`。非默认的独立 Evidence Profile 也可以没有 Change coverage；一旦具体 Run 把它选为 `verificationProfileId`，Design preflight 就会按该 Run 的真实 Acceptance Set 检查。

### Decision: Design gate 做精确只读 coverage preflight

Design Work 成功、Tasks 可解析后，在创建 Design Human Decision 和 Build Work 之前编译当前 Evidence Profile，并用真实 Task Acceptance 解析 selector：

- `*` 匹配全部 Acceptance；
- `task:<id>` 匹配对应 Task；
- `requirement:<ref>` 匹配 Requirement mapping；
- `acceptance-<sha256>` 精确匹配；
- 未知 selector、重复 selector、未覆盖 Acceptance、或只有 optional 节点匹配均阻断。

预检不采集 Evidence，不计算仓库 fingerprint，不写 checkbox，不创建 Build Configuration，也不改变 phase。配置修正后，原 Run 可在同一 Design checkpoint 重新观察；无需手改 Store。

接入点不是 Human Decision 之后的补充检查。`SpecificationPlanning.assess()` 在不可变 Planning Snapshot 形成后、调用 `requestSpecificationApproval()` 和 approval store commit 前执行由编排层提供的只读 preflight。preflight 返回 coverage 摘要作为 Design Gate evidence；完成后再次读取 planning manifest，并要求其 semantic digest 与 preflight 前一致。任何 coverage 失败或规划漂移都返回 blocked，不创建可批准请求。

Evidence Coordinator 提供只编译 Effective Project Config 和 Evidence Profile DAG 的只读入口；Design preflight 不复用会同时计算仓库 fingerprint 的正式 `plan()`。正式 Verify 仍在 Build Check 后计算 fingerprint，并用同一编译结果与 coverage resolver 生成 Verification Input。

### Decision: 提取单一 coverage resolver

把当前 `verification-input.ts` 中的私有 coverage 解析提升为纯领域函数，返回规范排序后的 Acceptance criteria、set hash 和 node mapping。Design preflight 与 `createVerificationInput` 都调用它；正式 Verify 仍额外绑定仓库 fingerprint、配置、composition 和 Skill identities。

这样前置检查只是对正式规则的早期调用，不产生第二套“接入校验规则”。

## Risks / Trade-offs

- [默认 `*` 使新项目初始验证范围偏大] → 草稿明确标为 unresolved，并允许在批准前收窄；安全默认优先于生成不可完成配置。
- [Design preflight 会读取当前 Evidence Profile] → 只编译配置和 selector，不执行命令或创建 Attempt；错误保持在 Design。
- [preflight 期间 Tasks 可能变化] → preflight 后重新核对 planning manifest semantic digest；漂移时不写审批请求，下一次调用重新观察。
- [项目配置随后变化] → Run 继续使用既有 project config digest 与后续兼容/失效规则；Verify 仍以当前不可变 Verification Input 做最终判断。
- [静态就绪检查无法证明未来 Change 全覆盖] → 精确证明由 Design preflight 负责，两个检查职责不同。


```

## openspec/changes/fail-fast-verification-coverage/tasks.md

- Source: openspec/changes/fail-fast-verification-coverage/tasks.md
- Lines: 1-36
- SHA256: 6a9dadc00006ab430d5bba46d0352a7a37a08a4dda1723a69e88a3fdd635409c

```md
# Tasks

## 1. 固定回归与 coverage 领域契约

- [ ] 1.1 增加项目探测回归，证明新生成的 required 命令节点显式使用 `covers: ['*']`，并产生需要人工复核的 coverage finding <!-- comet-task:c120d0c8-62fe-4337-afcd-91aa4fe669ab -->
  **Acceptance:** 探测候选不再生成空 coverage；finding 清楚说明 workspace-wide coverage 可在批准前收窄；探测仍不写正式配置
  **Requirements:** project-configuration / 探测候选必须提供可审查的 Change coverage

- [ ] 1.2 增加项目审批回归，证明默认 `verify` Profile 缺失或全部 coverage 为空时不能建立可批准请求，而合法的 required coverage 与无 coverage 前置节点可以共存 <!-- comet-task:f653c208-76d0-428d-8193-b15d861c760b -->
  **Acceptance:** 默认 `verify` 缺失、无 required coverage 或 optional-only coverage 时在写正式配置前返回可定位诊断；至少一个 required coverage 节点时正常准备审批；其他独立 Profile 不被误判为 Change Verify Profile
  **Requirements:** project-configuration / Change Verify Profile 必须在审批前静态可用

- [ ] 1.3 提取并测试单一 Acceptance coverage resolver，覆盖通配、Task、Requirement、精确 ID、重复、未知、未覆盖和 optional-only 规则 <!-- comet-task:dbae7715-35c0-4eb9-a55b-0104144dc19d -->
  **Acceptance:** Design preflight 与 Verification Input 使用同一纯函数；同一输入产生稳定排序和摘要；既有 Verify coverage 测试保持通过
  **Requirements:** implementation-evidence / Acceptance coverage 使用单一确定性解析权威

## 2. 在 Design→Build 边界 fail-fast

- [ ] 2.1 在 Design gate 接入只读 coverage preflight，在 Planning Snapshot 形成后、Human Decision/Build Work 前用当前 Tasks 和实际 Verification Profile 完成精确解析 <!-- comet-task:bd0fae33-6f2e-4af8-8cf6-7cd5549ecfbd -->
  **Acceptance:** coverage 不完整时 Run 保持 Design、没有审批请求、Build Work、Evidence Attempt、仓库 fingerprint 或命令执行；错误指出未覆盖 Acceptance 或无效 selector；preflight 后规划摘要漂移也 fail closed；修正配置后可从同一 Design checkpoint 重试
  **Requirements:** implementation-evidence / Design 完成前必须证明 Verification coverage

- [ ] 2.2 增加真实 Runtime 回归，复现旧行为会在 Build Check 后失败，并证明新行为在进入 Build 前阻断，同时合法 coverage 的 Open→Design→Build 路径不受影响 <!-- comet-task:3fa8819f-ba2d-44fc-9ab5-60eab0e9779f -->
  **Acceptance:** 回归同时断言 phase、current Work、Task 状态、Evidence Attempt 数量和 Build Work 缺失；合法路径至少推进到 Build Configure
  **Requirements:** implementation-evidence / Design 完成前必须证明 Verification coverage

## 3. 文档与验证

- [ ] 3.1 更新项目接入和 Evidence 文档，解释生成的 `*` 是待确认的安全候选、细粒度 selector 的收窄方式以及 Design preflight 的失败恢复 <!-- comet-task:dde9bfba-dd86-406c-b77f-8a0ce66d2aba -->
  **Acceptance:** 文档不把 `*` 描述为所有团队的最佳实践；明确修改共享配置并重试原 Design checkpoint，不允许手改 Store
  **Requirements:** project-configuration / 探测候选必须提供可审查的 Change coverage; implementation-evidence / Design 完成前必须证明 Verification coverage

- [ ] 3.2 运行定向测试、生产 CLI 多仓初始化复现、完整 `npm run verify`、package E2E、tracer E2E、严格 OpenSpec 校验和 Comet 0.5.1 Guard/Check <!-- comet-task:fcc4b227-2a35-473e-8e0e-f1381cb73bdc -->
  **Acceptance:** 旧失败场景在修复前证据可复现、修复后从新初始化项目完成静态和精确 coverage 预检；全部声明检查退出 0；临时项目与日志清理完成
  **Requirements:** project-configuration / Change Verify Profile 必须在审批前静态可用; implementation-evidence / Acceptance coverage 使用单一确定性解析权威


```

## openspec/changes/fail-fast-verification-coverage/.openspec.yaml

- Source: openspec/changes/fail-fast-verification-coverage/.openspec.yaml
- Lines: 1-2
- SHA256: b6d27c089c6ee9596ce0433bd8f7f771b477758efe1ce7f7a7505af47316ecd0

```md
schema: spec-driven
created: 2026-11-03

```

## openspec/changes/fail-fast-verification-coverage/specs/implementation-evidence/spec.md

- Source: openspec/changes/fail-fast-verification-coverage/specs/implementation-evidence/spec.md
- Lines: 1-49
- SHA256: 8d0307c286667c63d318fae65029f29d406ec4110da5a3f0bec863671f5731de

```md
# implementation-evidence Delta

## MODIFIED Requirements

### Requirement: Evidence Profile 编译完整 Acceptance Coverage Plan

用于 Change Verify 的 Evidence Profile MUST 显式声明 required 节点覆盖的 Acceptance selector，并在执行任何节点前解析为绑定完整 Acceptance Set、Profile plan、仓库和配置摘要的不可变 coverage plan；缺失、未知、重复或仅由 optional 节点覆盖的 Acceptance 必须阻断执行。相同的确定性 coverage resolver MUST 在 Design 规格与 Tasks 冻结后、创建 Design Human Decision 或 Build Work 前执行只读 preflight；该 preflight 不得运行 Evidence 节点、创建 Attempt 或计算正式 Verify 仓库 fingerprint。preflight 完成后、写入审批请求前 MUST 重新核对 Planning Manifest identity，防止预检与获批内容来自不同版本。

#### Scenario: Profile 没有覆盖 UI Acceptance

- **WHEN** Design Tasks 包含 UI 行为 Acceptance，但 Profile 只有未声明覆盖该 Acceptance 的 typecheck 节点
- **THEN** Runtime 在建立 Build Work 和运行 typecheck 前保持 Design，并报告未覆盖的 Acceptance identity

#### Scenario: 共享 Profile 显式覆盖全部 Acceptance

- **WHEN** required 节点使用 `*` selector 且 Profile、配置和 Acceptance Set 可被固定
- **THEN** Design preflight 解析出每条 Acceptance 到节点的显式映射，随后 Verify 把同一映射连同仓库和执行输入固定进 Verification Input

#### Scenario: coverage 只由 optional 节点声明

- **WHEN** 每条 Acceptance 都只能匹配 optional Evidence 节点
- **THEN** Design preflight fail closed，不创建 Build Work，也不把 optional 结果提升为正式门禁

#### Scenario: 修正 Profile 后重试 Design

- **WHEN** Design 因 coverage 不完整而阻断，团队通过正常共享配置变更补齐 selector
- **THEN** Runtime 从原 Design checkpoint 重新执行只读 preflight；不得要求重做已完成 Host Work、手改 Store 或伪造 Evidence Receipt

#### Scenario: preflight 期间 Planning Manifest 漂移

- **WHEN** Runtime 完成 coverage 解析后发现 Tasks 或其他受保护规划产物的 semantic digest 已变化
- **THEN** Runtime 保持 Design 并丢弃该次预检结果，不创建 Design Human Decision；下一次推进重新观察当前规划

## ADDED Requirements

### Requirement: Acceptance coverage 使用单一确定性解析权威

Repoctopus MUST 用同一个纯领域 resolver 处理 Design preflight 和 Verification Input 的 Acceptance selector 语义、required 节点过滤、稳定排序、Acceptance Set hash 与诊断。编排层、项目接入层和 Agent MUST NOT 复制或放宽该解析规则。

#### Scenario: 相同输入在两个阶段解析

- **WHEN** Design preflight 与 Verify 使用相同 Tasks 和 Evidence Profile plan
- **THEN** 两者得到相同的 Acceptance Set、节点映射和稳定摘要

#### Scenario: selector 在 Design 后变为未知

- **WHEN** Profile selector 不再匹配冻结的 Task、Requirement 或 Acceptance identity
- **THEN** Resolver 在副作用前返回同一类未知 selector 诊断，不能由 Verify 静默解释成通配覆盖


```

## openspec/changes/fail-fast-verification-coverage/specs/project-configuration/spec.md

- Source: openspec/changes/fail-fast-verification-coverage/specs/project-configuration/spec.md
- Lines: 1-38
- SHA256: ff54ccadc0890e073c611ab31440ca168ef8c603e7320e9e8dbe1beac567a0fe

```md
# project-configuration Delta

## MODIFIED Requirements

### Requirement: 项目探测只生成候选草稿

`project detect` MUST 只读扫描显式作用域内的仓库和常见构建文件，把候选配置写入 `.repoctopus/drafts/`，不得直接创建或覆盖正式共享配置。为探测出的 Change Verify 命令生成候选时，required 节点 MUST 使用显式、保守的 workspace-wide Acceptance selector，并 MUST 把该 coverage 选择登记为待人工复核项；Runtime MUST NOT 猜测未来 Task 或 Requirement selector。

#### Scenario: 首次探测项目

- **WHEN** 工作区尚无 `repoctopus.yaml`
- **THEN** 命令生成带来源和不确定项的候选草稿，并提示由 Agent 补全后交给用户确认
- **AND** 每个探测出的 required Verify 命令显式声明 `covers: ['*']`，其 workspace-wide coverage 被标记为需要确认或收窄

#### Scenario: 已存在共享配置

- **WHEN** 探测结果与当前 `repoctopus.yaml` 不同
- **THEN** 命令输出 reconcile diff 且保持正式配置不变

### Requirement: 用户确认后才能写入共享配置

Repoctopus MUST 把候选配置、Agent 补全内容和现有配置差异作为 Human Decision 输入，只有可信用户确认后才允许生成或更新 `repoctopus.yaml`。约定的默认 Change `verify` Profile MUST 在建立审批请求前存在，并至少包含一个声明非空 Acceptance coverage 的 required 节点；完全无 coverage 或只有 optional coverage 的候选 MUST 被拒绝。具体 Run 显式选择的其他 `verificationProfileId` MUST 由该 Run 的 Design preflight 精确校验。

#### Scenario: 没有可信确认通道

- **WHEN** Agent 已补全候选配置但 Runtime 无法获得可信用户决定
- **THEN** 草稿保持待确认状态且正式配置不变

#### Scenario: Verify Profile 没有 required coverage

- **WHEN** 候选 `verify` Profile 的节点全部未声明 coverage，或 coverage 只存在于 optional 节点
- **THEN** Repoctopus 在创建可批准请求和写正式配置前拒绝候选，并指出需要 `*`、`task:`、`requirement:` 或精确 Acceptance selector

#### Scenario: 前置节点不直接覆盖 Acceptance

- **WHEN** Profile 至少有一个 required 验证节点声明 coverage，另有 service 或准备节点不直接覆盖 Acceptance
- **THEN** 静态可用性检查允许该结构，精确覆盖关系交给 Change Design preflight 判断


```
