---
comet_change: fail-fast-verification-coverage
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-03-fail-fast-verification-coverage
status: final
---
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
