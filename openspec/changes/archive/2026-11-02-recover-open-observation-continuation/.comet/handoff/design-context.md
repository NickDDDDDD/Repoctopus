# Comet Design Handoff

- Change: recover-open-observation-continuation
- Phase: design
- Mode: compact
- Context hash: af4ff6a3f27156a0a526dc551fef175e469739b7f00ef720af15a56ecbe547bb

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/recover-open-observation-continuation/proposal.md

- Source: openspec/changes/recover-open-observation-continuation/proposal.md
- Lines: 1-38
- SHA256: 4bfde76453c242bee581c314fbc66388ca3d0ce6b100f68daefffdd67b2a35d2

```md
# Proposal

## Why

全新多仓验收在 Open Host Outcome 已接受后复现了一个真实恢复断点：第一层 OpenSpec inspection 与 strict validation 均成功，Runtime 已把 `change.intake` Work 标记为 `validated`；随后第二层 published branch / planning approval observation 因 GitHub 短暂连接超时返回 `open-observation-unavailable`。网络恢复后，`run next` 只识别 `outcome` 为可重新验证状态，面对 `validated + reobserve` 反而提示再次执行 Open Work，使原 Work、Outcome 与 invocation 落入不可达状态。

现有回归没有覆盖这个窗口。它只在第一层 `specification.inspect` 失败，此时 Work 仍为 `outcome`，下一次 pull 可以再次进入 `validateOpenWork`；因此测试通过并不能证明“validation 已接受、planning observation 才失败”的恢复路径可达。

同一验收还证明通用 `run resume` 不能作为替代入口：Open Work 正常写入并提交规格后，仓库 HEAD 相对 Run 启动快照发生变化，resume 把该内容变化直接提升为全局 `reconciliationRequired`，要求恢复旧仓库或重启 Run。这样 Runtime 自己授权的正常工作也会阻断当前 continuation。

## What Changes

- 让 Open 推进以持久化 Work execution checkpoint 为权威：`outcome` 进入 Outcome validation，`validated` 直接进入 Open gate observation；不得从 phase/current Work 标签猜测应重放 Host。
- 让第二层 published branch / planning observation 暂时失败后，下一次受保护 `run next` 在同一 Work、attempt、checkEpoch、Outcome 与 invocation 上重新观察；成功后继续创建唯一 Open Human Decision。
- 保持 `run resume` 只恢复事务并投影当前 continuation，不把内容级 HEAD/worktree 变化自动升级为全局 reconciliation；真正的仓库 identity、branch、remote、path 或 topology 漂移仍 fail closed。
- 将 Project snapshot 差异分为 `same | content | identity`。内容变化继续由当前阶段的 planning、binding、Evidence 或 closure authority 精确重验；identity 变化才设置全局 `reconciliationRequired`。
- 修正 CLI/Service 的下一步投影：内容变化可以保留 `reobserve`/当前 Work；identity 漂移才要求人工 reconciliation 或重新开始。
- 增加两阶段 Open observation、resume content drift、真实 identity drift、重复 pull/CAS 和遥测回归，证明 Host 不重放、repair Work 不误建、人工审批不重复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：补充已验证 Open Work 的第二层 observation checkpoint、可达 reobserve 与幂等推进语义。
- `runtime-foundation`：把恢复时的仓库内容变化与身份/拓扑变化分级，避免通用 resume 覆盖当前阶段的精确恢复权威。
- `development-telemetry`：为 Open reobserve 阶段与 Project drift class 提供有界、可重放的观测分类。

## Impact

- 主要影响 `services/workflow-runs.ts` 的 Open continuation 路由、`domains/runtime/workflow-runs.ts` 的 resume 决策、`domains/project/snapshot.ts` 的 reconciliation 分类，以及 CLI next-action 投影。
- 不修改旧 Run Store、不引入兼容 migration、不重放已接受 Host Outcome；当前验收 Run 保留为只读缺陷证据，修复后用新的 Change identity 重跑。
- 不解决本轮同时发现的 OpenSpec Store 首次初始化、失败后重复项目审批、CLI 诊断过于笼统、adapter 默认值与 consumed-layer 文案问题；这些保留为后续独立项，避免扩大核心恢复修复。
- 参考 Comet `0.5.1` 的成熟边界：Run view 由持久化 Action status 选择 continuation，resume 读取同一 Run 并返回当前 Action，只有未知外部执行才进入 reconcile。Repoctopus 采用这些状态权威与身份分离原则，但保留自己的多仓 Project snapshot、OpenSpec Provider、Cordis composition 与五阶段生命周期，不引入 Comet SDK 运行时依赖。


```

## openspec/changes/recover-open-observation-continuation/design.md

- Source: openspec/changes/recover-open-observation-continuation/design.md
- Lines: 1-142
- SHA256: 0c0d87fb39f52f983739e656b8b0cbadb085184999926e87f5c2d8175e682bc4

[TRUNCATED]

```md
---
comet_change: recover-open-observation-continuation
role: technical-design
canonical_spec: openspec
---

# Design

## Context

Open 实际包含两个顺序观察边界：

1. `validateOpenWork` 读取 OpenSpec artifacts、strict validation、Action receipt 与 intent，成功后把 Work execution 从 `outcome` 标为 `validated`。
2. `advanceOpenGate` 再读取 published change branch 与 planning approval snapshot，决定进入 Open Human Decision、repair 或 Design。

旧回归只在第 1 步注入失败，因此 Work 保持 `outcome`，下一次 `run next` 会再次调用 `validateOpenWork`。真实验收在第 1 步已经成功后，第 2 步的第二次 `git ls-remote` 暂时超时：Runtime 正确选择了 `reobserve`，但下一次 `run next` 的路由只处理 `outcome`，将 `validated` 错误投影为“Execute Open intake Work”。这不是 Provider 长期不可用，也不是 Host 结果未知，而是一个已接受 checkpoint 后的只读 observation retry。

随后执行正式 `run resume`，Runtime 又把 Open Work 自己产生并已提交的规格 HEAD 变化与 branch/remote/topology 漂移放进同一个 `changed` 布尔值，并设置全局 `reconciliationRequired`。这会让通用恢复层抢走 Open planning authority 的职责，也会在后续 Build/Verify 正常提交后产生同类误阻断。

### Comet 0.5.1 参考

固定参考 `@rpamis/comet@0.5.1` 的以下实现原则：

- `dist/domains/workflow-application/run-view.js` 从持久化 Action status 选择 `execute | wait | ask | reconcile | done`；它明确“不从阶段名猜测或重建推进规则”。已领取 Action 等待原宿主，未知外部结果才 reconcile。
- `dist/domains/workflow-application/skill-invocation.js` 的 `resume` 以只读方式加载原 Run，再投影当前 Action/Wait；它不因为工作区内容变化伪造新 Action。
- `dist/domains/engine/portable-run-checkpoint.js` 只把复制时仍为 `running` 的 Action 转为 `unknown` 并要求 reconciliation；已完成/已接受的 Action身份保持不变。

Repoctopus 不复制 Comet 的单仓存储或 Runtime SDK。可复用的是三条不变量：恢复以持久状态而非 phase 标签为权威；只读 observation 失败不改变已接受执行身份；内容变化由依赖它的 gate 精确重验，而不是由通用 resume 全局阻断。

## Goals / Non-Goals

**Goals:**

- 让 `validated + reobserve` 成为明确、可测试、可重复 pull 的 Open continuation。
- 保留原 Work、attempt、checkEpoch、intent、Outcome、receipt、packet 与 Host invocation，绝不为 Provider retry 重放 Host。
- 把 Project snapshot 的内容差异与 identity 差异分级，并让只有 identity 差异触发全局 reconciliation。
- 保持 Open/Design/Build/Verify/Archive 各自对其依赖输入的精确 revalidation 权威。
- 用生产 composition 与 Windows CLI 黑盒复现真实顺序：strict validation 成功，planning branch observation 失败一次，恢复后进入唯一 Open approval。

**Non-Goals:**

- 不为当前已卡住的验收 Run 写 Store migration 或修补脚本。
- 不让 `run resume` 自动执行 Provider I/O、Host Work 或 phase transition；它只恢复持久状态并返回合法下一步。
- 不弱化真实 branch、remote、path、repository identity 或 topology 漂移的 fail-closed 行为。
- 不在本 Change 修复 Store 首次初始化、审批重提 UX、adapter 选择或诊断文案。

## Decisions

### 1. Open continuation 由 Work execution checkpoint 路由

从现有 `WorkExecutionAuthority.recovery()` 抽出纯 continuation classifier，由 recovery 与 `WorkflowRuns.next()` 共同调用；不再新增第三套状态判断。classifier 对当前 `change.intake` Work 使用以下穷尽规则：

| Work execution | Runtime 行为 |
| --- | --- |
| 无 execution / 未领取 | 返回 `execute`，允许 Host claim |
| claimed/context-delivered/invoking | 返回 `wait` 或既有 recovery，不重派 |
| outcome+succeeded | 执行第一层 Outcome/Provider validation |
| validated + Open intake | 返回 `reobserve/open-gate-pending`，跳过 Host 与第一层 validation，直接执行 `advanceOpenGate` |
| validated + 其他 phase Work | 返回该 phase 已声明的 transition continuation；未声明组合 fail closed |
| outcome+failed/rejected | 按现有 repair/retry 权威处理 |
| unknown external result | 仅此类进入 Host reconciliation |

`run next`、`WorkExecutionAuthority.recovery()`、恢复后的 next-action 投影和 managed execution 必须复用同一 classifier，不能各自用 `phase + currentWork` 的临时条件分支。`open-gate-pending` 表示当前持久 checkpoint需要继续 gate；发生暂时故障的那次响应仍使用 `open-observation-unavailable`，trajectory据此区分“待观察状态”与“一次失败观察”。`auto_transition` 只决定是否在一次 pull 内继续调用下一合法步骤，不改变上述状态合法性。

选择从 `validated` 直接进入 gate，而不是把 execution 改回 `outcome`，是为了保留第一层 validator receipt，避免重复 strict validation、副作用统计和 Skill Outcome 事件；选择不清空 `currentWork`，是为了让同一 Work identity 继续承载 gate checkpoint，直到 Open gate 原子接受 waiting/repair/design transition。

### 2. 两层 observation 使用同一执行身份、不同 checkpoint

第一层成功后 `markValidated` 是持久 checkpoint。第二层 observation 失败只记录有界 `reobserve` continuation；不得递增 attempt/checkEpoch，不得清除 accepted submission，不得创建 repair Work，也不得调用 Host reconcile。

下一次受保护 pull 发现 `validated` 后：

1. 重新读取 published branch 与 planning snapshot；
2. 若仍不可用，幂等返回同一 `reobserve`，事件 identity 去重或按有界 attempt observation 规则记录，不制造逻辑重试次数；
3. 若明确 invalid，按现有 revision-bound Open repair 转换处理；
4. 若 waiting，原子清除 current Work并创建唯一 Open Human Decision；
5. 若已批准，原子创建唯一 Design Work。

planning snapshot、approval request 与 Design Work仍由既有 CAS/revision 约束。并行或重复 `run next` 最多一个调用提交 transition；其他调用读取已提交状态。


```

Full source: openspec/changes/recover-open-observation-continuation/design.md

## openspec/changes/recover-open-observation-continuation/tasks.md

- Source: openspec/changes/recover-open-observation-continuation/tasks.md
- Lines: 1-66
- SHA256: 6b38de094a421b25bb8bce3caf67c2147f60e96bf4a86a9a2912b32f73c967e8

```md
# Tasks

## 1. 锁定真实失败窗口

- [ ] 1.1 在 Open Service 测试中先让 artifacts inspection、strict validation 和 `markValidated` 成功，再让 `project.changeBranch` 暂时失败，证明当前第二次 `run next` 错误返回 `execute`而不是重观察。   <!-- comet-task:2da357b8-8ddf-44ad-883e-6e75c9cf4213 -->
  **Acceptance:** RED 只由缺少 `validated + reobserve` 路由导致，并精确断言原 Work、attempt、checkEpoch、Outcome、receipt 与 invocation。
- [ ] 1.2 增加 `specificationPlanning.assess` 暂时失败的等价 RED，证明两个第二层 observation 入口共享同一恢复语义。   <!-- comet-task:35e0414e-27dd-4018-996f-2ba3d75fdf2b -->
  **Acceptance:** 两个故障点都不调用 Host reconcile、不创建 repair Work，且当前实现测试按预期失败。
- [ ] 1.3 增加通用 resume RED：Open artifacts 正常提交只改变 HEAD/worktree时，当前实现错误设置全局 `reconciliationRequired`。   <!-- comet-task:33fb1e43-a8c4-4d98-8513-6ecedb96db2a -->
  **Acceptance:** fixture 同时保留稳定 repository id、remote、branch、path 与 topology，失败只来自 content/identity 未分级。

## 2. 建立可穷尽的 Open continuation

- [ ] 2.1 为纯 Work continuation classifier 增加表驱动领域测试，覆盖无 execution、claimed、context-delivered、outcome succeeded/failed、Open validated、其他 phase validated与 unknown external result。   <!-- comet-task:ab0dc4db-dede-40a3-92aa-e99525b5c1c5 -->
  **Acceptance:** 每个合法 Work execution组合恰好映射一个 continuation，Open validated为 `reobserve/open-gate-pending`，只有 unknown external result映射 Host reconciliation。
- [ ] 2.2 从现有 `WorkExecutionAuthority.recovery()` 抽出并接入单一 classifier，让 Open `validated` 直接进入 `advanceOpenGate`，不回退为 `outcome`、不清空 validator receipt。   <!-- comet-task:a4b4deff-59e3-4d96-81a6-041a20cd3464 -->
  **Acceptance:** 1.1/1.2 与 classifier测试转绿，现有首次 validation、repair和其他 phase恢复路径保持通过。
- [ ] 2.3 让 managed execution、`run next`、`WorkExecutionAuthority.recovery()` 与恢复后的 next-action投影复用相同 classifier，删除重复的 phase/status猜测分支。   <!-- comet-task:8e03f9d7-a8ac-4c2d-aa1b-33196188960d -->
  **Acceptance:** TypeScript穷尽检查通过，CLI不再对 `validated + reobserve` 输出“Execute Open intake Work”，状态视图能区分 `open-gate-pending` 与当次 `open-observation-unavailable`。
- [ ] 2.4 为重复/并发 pull 增加 CAS 测试。   <!-- comet-task:a9e8fe50-56dc-47c3-aca6-eb36e108a0c5 -->
  **Acceptance:** Provider 恢复后最多创建一张 Open approval卡或一个 Design Work；Work、attempt、checkEpoch、Host invocation 与 Skill consumption均不重复。

## 3. 分级 Project reconciliation

- [ ] 3.1 为 `same | content | identity` 建立表驱动 RED，覆盖 head、worktree、branch、remoteIdentity、path、add/remove、project/root identity 与 diagnostics。   <!-- comet-task:ead65d0d-fcc2-47ae-b880-1f958fbfb988 -->
  **Acceptance:** 无法安全分类的差异默认 identity，当前单布尔实现测试按预期失败。
- [ ] 3.2 一次性扩展 `ProjectReconciliation` 类型与 `reconcileProjectSnapshots`，提供 `changeClass` 和 `requiresReconciliation`。   <!-- comet-task:6896ffbf-27b3-467c-a49a-4c23177e85cd -->
  **Acceptance:** content 完整报告差异但 `requiresReconciliation=false`；identity 为 true；所有调用点通过编译器迁移，不保留第二套兼容判断。
- [ ] 3.3 修改 Runtime Coordinator resume，只让 identity drift 设置 `reconciliationRequired` 和 `recovery.reconciled`。   <!-- comet-task:76c8c6ab-d44f-4248-b1aa-5f326c007e00 -->
  **Acceptance:** content drift 记录 `run.resumed` 并保留当前 state/continuation；identity drift 仍 fail closed。
- [ ] 3.4 修改 WorkflowRuns Service 与 CLI next-action 投影，禁止以 `reconciliation.changed` 直接覆盖 execution continuation。   <!-- comet-task:6910b7ce-1713-4469-b3e8-da664bfd1709 -->
  **Acceptance:** content + `reobserve` 返回 `run next`；identity drift 返回显式 reconciliation 指引。
- [ ] 3.5 回归各 phase 的精确失效边界。   <!-- comet-task:b6316238-c70b-4314-9932-214dd8637bb7 -->
  **Acceptance:** Open planning、Design snapshot、Build Binding/Plan Evidence、Verify Evidence 与 Archive closure对相关 content drift仍重验，不能因取消全局阻塞而接受陈旧证据。

## 4. 遥测与诊断

- [ ] 4.1 为 Open observation stage 增加有界 trajectory/OTLP 分类。   <!-- comet-task:f61874d9-f092-4071-a28b-023751eab089 -->
  **Acceptance:** `provider-validation|planning-gate` 能关联同一 run/work/attempt/checkEpoch，恢复记录 `host_replayed=false`。
- [ ] 4.2 为 Project reconciliation class 增加公共 telemetry catalog 与 mapping。   <!-- comet-task:5e20fcf6-e22b-4cf7-b197-660e0ed96cca -->
  **Acceptance:** `none|content|identity` 使用低基数属性，Metric labels不含 branch、path、remote、OID、digest、错误正文或 changeId。
- [ ] 4.3 增加逻辑去重回归。   <!-- comet-task:ed46942e-34a2-4c91-ae49-9a4d25b7bed6 -->
  **Acceptance:** 重复 reobserve/export replay 不增加 Host invocation、Skill consumed、workflow execution或 failure计数。

## 5. 生产边界验收

- [ ] 5.1 扩展 production-composition Windows CLI fixture，完成真实 Open Host Outcome并提交四类 artifacts。   <!-- comet-task:65bfc3dc-7ad2-4752-833f-de7d7b5df833 -->
  **Acceptance:** Work 在注入故障前已持久化 `validated`，且 fixture 的 HEAD 相对 Run 启动快照确实变化。
- [ ] 5.2 在 planning branch observation 注入一次可恢复超时，随后执行 `run resume`。   <!-- comet-task:0706ddf4-a97f-4189-823b-bd4557adb709 -->
  **Acceptance:** resume 报告 content drift但不设置全局 reconciliation，原 Work、attempt、Outcome、receipt、packet与 invocation保持不变。
- [ ] 5.3 Provider 恢复后执行 `run next`。   <!-- comet-task:95a89980-e5d7-47e2-b88b-e7d4a50df53f -->
  **Acceptance:** Run 进入唯一 Open Human Decision；Host invocation、Skill consumed 与 repair Work计数不变，trajectory包含可关联 unavailable→recovered事实。
- [ ] 5.4 在同一 fixture 分别改变 branch/remote/topology。   <!-- comet-task:af414554-ae06-446c-9e19-afd0d88c0a41 -->
  **Acceptance:** 三类 identity drift继续返回 reconciliation required，不能进入 planning gate。
- [ ] 5.5 从头重跑一个新的模拟多仓最小 Change 至 Open approval后Design入口。   <!-- comet-task:0150572b-15b3-4963-9315-ae4491b1fcfe -->
  **Acceptance:** 不修改旧验收 Store，不使用手工状态补丁，桌面/OTLP投影与 CLI 状态一致。

## 6. 完整门禁与交付

- [ ] 6.1 更新 Runtime/telemetry公开文档，解释 resume、content drift、identity drift与phase authority的职责边界。   <!-- comet-task:ec3be39c-8c8c-4ba7-8881-96b975d55f7b -->
  **Acceptance:** 文档不引入第二套生命周期、migration或后台 daemon，并通过格式/契约检查。
- [ ] 6.2 运行目标测试、`npm run verify`、Comet OpenSpec strict validation 与 `git diff --check`。   <!-- comet-task:f1bb6b0c-de43-417c-93a4-23f3d5f7f857 -->
  **Acceptance:** 全部门禁绑定最终 HEAD/tree/config/tool输入通过，失败 Attempt保留在正式 Evidence中但不伪装成功。
- [ ] 6.3 保存 verification report并清理临时日志、JSON、mock remote和scratch输出。   <!-- comet-task:c15292a2-6f34-40c1-a9cb-f9281956f928 -->
  **Acceptance:** 工作树只包含预期源文件、OpenSpec归档与正式 Evidence；每个提交均已推送远端。


```

## openspec/changes/recover-open-observation-continuation/specs/change-lifecycle/spec.md

- Source: openspec/changes/recover-open-observation-continuation/specs/change-lifecycle/spec.md
- Lines: 1-38
- SHA256: 1268882b433c684d663535ea30bb3ccb4ce9c81eedbbe731107b6a3bbb92d2c7

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: Open 观察错误按可判定性分类

Runtime MUST 将创建前工作区输入无效、Provider 明确返回的规格无效、Provider 暂时不可用和外部执行结果未知分为不同事实。只有无法判定原外部执行结果时进入 Host reconciliation；已接受 Open Outcome 后的暂时 Provider 故障只重新观察原 checkpoint。Open Outcome validation 与 planning gate observation MUST 是可恢复的顺序 checkpoint：第一层已通过时，后续 pull MUST 从持久化 `validated` checkpoint 继续第二层 observation，不得回退、重放 Host或从 phase/current Work标签猜测执行入口。

#### Scenario: Provider 暂时不可用后恢复

- **WHEN** Open Host Outcome 已接受，任一只读 Provider/planning observation 因暂时基础设施错误无法返回有效或无效结论，随后同一 observation authority恢复
- **THEN** Runtime 保留原 Work、Outcome、attempt、checkEpoch和 invocation，在下一次受保护 pull从最近已接受 checkpoint重新观察并继续原 gate，不重放 Host或创建 repair Work

#### Scenario: strict validation 之后 planning observation 暂时不可用

- **WHEN** Open Host Outcome 已接受，artifacts inspection、strict validation 与 Outcome validator 已通过并持久化 `validated`，随后 published branch 或 planning approval observation 因暂时基础设施错误不可用
- **THEN** Runtime 返回绑定原 Work、attempt、checkEpoch、Outcome、receipt 和 invocation 的 `reobserve`，不创建 repair Work、不递增执行身份、不调用 Host reconciliation

#### Scenario: planning observation 恢复

- **WHEN** 上述 Run 在 Provider 恢复后执行下一次受保护 `run next`
- **THEN** Runtime 将持久状态投影为 `reobserve/open-gate-pending`，直接从 `validated` checkpoint重试 planning gate，成功后进入唯一 Open Human Decision或已批准的 Design continuation，Host invocation 与 Skill consumption计数不变

#### Scenario: planning observation 连续不可用

- **WHEN** 相同 Run 被重复 pull且 planning observation 仍暂时不可用
- **THEN** Runtime 幂等返回同一逻辑 `reobserve`，不回退到 `execute`、不新增 attempt/checkEpoch/approval request，也不把只读观察失败升级为未知 Host 结果

#### Scenario: Provider 明确返回 strict invalid

- **WHEN** Provider 成功返回当前四类规划工件 strict invalid 和可定位诊断
- **THEN** Runtime 通过单次 revision-bound transition 安装唯一 Open repair Work并退役旧 execution，不进入 Host reconciliation

#### Scenario: 分支约束错误在 Open inspection 中被发现

- **WHEN** 遗留或并发状态使 Provider inspection 发现 source 与 target 相同等确定性启动输入错误
- **THEN** Runtime 返回受限 binding/input conflict并保持原 checkpoint，不把该错误标记为 Provider unavailable，也不调用只适用于未知 Host 结果的 reconciliation


```

## openspec/changes/recover-open-observation-continuation/specs/development-telemetry/spec.md

- Source: openspec/changes/recover-open-observation-continuation/specs/development-telemetry/spec.md
- Lines: 1-23
- SHA256: fca77e644a2e5d8c4777df70a956daec982611a0359a6f14eb853335c49880d0

```md
# Spec Delta

## ADDED Requirements

### Requirement: Open 重观察与仓库漂移分类必须可审计

Runtime MUST 从权威 checkpoint/trajectory 导出 Open observation stage 与 Project reconciliation class，使团队能够区分第一层 Provider validation、第二层 planning gate、内容变化和身份变化。公开 Metric attributes MUST 使用固定低基数枚举；branch、path、remote、OID、digest、错误正文与 changeId 不得进入 Metric label。

#### Scenario: planning gate 暂时不可用后恢复

- **WHEN** 同一 Work 在 `validated` 后经历 planning observation unavailable并在后续 pull恢复
- **THEN** telemetry 以相同 run/work/attempt/checkEpoch 关联 unavailable 与 recovered，记录 `host_replayed=false`，且不新增 Skill invocation、Skill consumed 或 workflow failure 逻辑计数

#### Scenario: resume 观察到内容变化

- **WHEN** `run resume` 只观察到 HEAD/worktree 内容变化
- **THEN** Event/Trace 记录有界 `project_change_class=content` 并保留当前 continuation，Metric 不包含变化仓库身份或内容摘要

#### Scenario: resume 观察到身份变化

- **WHEN** `run resume` 观察到 branch、remote、path、repository identity 或 topology 变化
- **THEN** Event/Trace 记录有界 `project_change_class=identity` 与 reconciliation required，且不导出具体 branch、remote、path或摘要作为 Metric label


```

## openspec/changes/recover-open-observation-continuation/specs/runtime-foundation/spec.md

- Source: openspec/changes/recover-open-observation-continuation/specs/runtime-foundation/spec.md
- Lines: 1-38
- SHA256: 3f38925e25ed11902179357ad23a01938b97417f13e75957a01bdd7aaa43da1e

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: Checkpoint 支持中断后幂等恢复

Runtime MUST 使用转换 Journal 和原子替换协调 Trajectory、Run State 与 Checkpoint，并在进程于任一写入边界中断后恢复为同一最终状态或明确的人工修复状态。恢复时重新探测的 Project snapshot MUST 区分内容变化与 repository identity/ownership/topology 变化：内容变化必须报告并交给依赖该内容的 phase authority 精确重验，只有身份级变化才能设置全局 `reconciliationRequired`。

#### Scenario: 状态写入中途进程退出

- **WHEN** 进程在 Trajectory、Run State 或 Checkpoint 的任一写入边界退出
- **THEN** 下一次 `run resume` 根据 Journal 完成或回滚同一转换，不重复产生业务结果

#### Scenario: 外部仓库事实已经变化

- **WHEN** 恢复时仓库 HEAD、分支、路径或工作树摘要与 Checkpoint 不同
- **THEN** Runtime 报告逐仓差异与 `content|identity` 分类，只使依赖已变化内容的决定或 Evidence精确失效；仅 identity级差异设置全局 reconciliation

#### Scenario: 当前 Work 产生正常内容提交

- **WHEN** 已授权 Work 写入并提交规格或实现，使 repository HEAD/worktree 相对 Run 启动快照变化，但 repository identity、remote、branch、path 与 topology 保持一致
- **THEN** `run resume` 返回 `content` drift observation且不设置全局 reconciliation，保留原持久 continuation，由当前 planning、binding、Evidence 或 closure authority重新验证依赖

#### Scenario: 内容由外部参与者改变

- **WHEN** 同事或 CI 在相同 repository identity、remote、branch 与 topology 上产生新的 HEAD/worktree 内容
- **THEN** Runtime 同样分类为 `content`，不得用作者或进程身份猜测所有权；受影响 phase authority必须在接受后继状态前检测摘要变化并精确失效相关决定或 Evidence

#### Scenario: 仓库身份事实已经变化

- **WHEN** 恢复时 repository add/remove、project/root identity、remote identity、branch、path、ownership 或 topology 与 Checkpoint 不同，或差异无法安全分类
- **THEN** Runtime 返回 `identity` reconciliation、设置全局 `reconciliationRequired` 并阻止后继 Action，直到显式恢复原绑定或开始合法的新 Run

#### Scenario: content drift 与 Open reobserve 同时存在

- **WHEN** Open Work 已持久化 `validated + reobserve`，且其规格提交使 HEAD 相对启动快照变化
- **THEN** `run resume` 保留 `reobserve` 为合法下一步；后续 `run next` 重试 Open planning gate，不要求重放 Host、恢复旧 HEAD或创建新 Run


```
