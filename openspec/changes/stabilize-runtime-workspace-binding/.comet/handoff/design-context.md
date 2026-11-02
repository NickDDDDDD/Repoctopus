# Comet Design Handoff

- Change: stabilize-runtime-workspace-binding
- Phase: design
- Mode: compact
- Context hash: 5a92941bb8a81164244c190b2ec25e3072b3622920a01ee6c44f4150de527de4

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/stabilize-runtime-workspace-binding/proposal.md

- Source: openspec/changes/stabilize-runtime-workspace-binding/proposal.md
- Lines: 1-33
- SHA256: 160e57cce19991a01e072733e80df3262df767df5c94f3522b2c1778fab72236

```md
# Proposal

## Why

一次全新多仓验收在 Workspace 仍位于目标分支时成功创建了 Change Run，直到 Open Host Outcome 已被接受后，Specification Provider 才以“source 与 target 相同”失败。Runtime 随后把确定性输入错误投影为 Provider 不可用和 `reconcile`，而重新启动又尝试把新 Work 写入旧 Run，导致合法恢复入口不存在；这会让团队在最早阶段被一个本可创建前拒绝的 Run 卡死。

## What Changes

- 在创建任何 Change Run、Work、Skill binding、Desktop activation 或遥测成功事实之前，验证 Workspace checkout 已附着到分支、source 与 target 不同，并且分支事实与冻结的 project snapshot/Workspace Repository 一致。
- 把工作区绑定纳入稳定启动身份：等价启动幂等返回原 Run；不同分支或 project snapshot 的再次启动返回结构化 binding conflict，不生成新 Work、不改写旧 checkpoint。
- 区分确定性输入无效、Provider 确认无效和观察基础设施不可用；只有无法判断外部结果时使用 reconciliation，分支约束失败不得伪装成 `open-observation-unavailable`。
- 让 Open Outcome 已接受后的临时 Provider 故障在原 Outcome、attempt 和 invocation 上重新观察，不重放 Host；确定性规格无效仍通过唯一 Open repair Work 恢复。
- 为启动前拒绝、绑定冲突、Provider 暂时不可用和恢复结果记录有界 trajectory/OTLP 分类，使验收能够证明没有创建幽灵 Run 或重复 Host 调用。
- 增加生产 CLI/服务边界回归：目标分支启动必须在 Run Store 落盘前失败；正确分支启动成功；等价重试幂等；绑定漂移返回冲突；临时 Provider 故障恢复时复用原执行身份。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：补充 Change Run 创建前的工作区绑定前置校验、稳定启动身份、错误分类与同 checkpoint 恢复语义。
- `development-telemetry`：补充启动拒绝、绑定冲突和 Provider 重观察的可审计低基数事实。

## Impact

- 主要影响 `services/workflow-runs.ts` 的 `startChange`、Open Provider 观察与 resume 路径，以及 `domains/runtime/workflow-runs.ts` 的稳定启动身份检查。
- 需要在 Project/Git inspection 边界复用现有规范化 branch facts，不把 checkout 绝对路径写入可移植 Run identity 或遥测。
- CLI 仍由 Agent/Runner 发起，Runner 仍负责创建或切换 branch/worktree；Runtime 只负责在创建 Run 前拒绝不合法绑定，不接管 Git checkout。
- 本次直接交付上述垂直切片；OpenSpec Store 首次注册缺少初始化引导、CLI adapter 选择易用性和 Host consumed-layer 文案作为后续独立 Change，不混入本次 Runtime 原子性修复。
- 参考 Comet `0.5.1` 的 workspace preparation、固定 binding、revision/CAS 与 unknown-outcome 恢复原则；不引入 Comet 运行时依赖、不复制其单仓目录或分支创建职责，MIT 许可证记录保持现有第三方审计边界。

```

## openspec/changes/stabilize-runtime-workspace-binding/design.md

- Source: openspec/changes/stabilize-runtime-workspace-binding/design.md
- Lines: 1-97
- SHA256: 8a290765917d8bd37054e2429b25cc2f65bec5b9565955f2bbb4094152d035fc

[TRUNCATED]

```md
# Design

## Context

参见 [proposal.md](./proposal.md) 的动机。本次验收暴露的顺序是：`startChange` 先创建稳定 Run 和 Open Work，Open Outcome 被 Host 接受后才由 Specification planning branch 校验发现 source 与 target 相同；一个宽泛 `catch` 又把所有 inspection/validation 错误投影为 `open-observation-unavailable`。调用方随后切换分支并重放 `run start` 时，Coordinator 恢复旧 Run，而 Service 仍用新 snapshot 构造并记录候选 Work，触发“Created Work is not the Runtime-selected current Work”。

Project snapshot 同时包含稳定语义和易变事实：repository identity、branch 与 topology 可参与启动绑定，HEAD、worktree digest、path 和 captured time 会在正常开发中变化。若直接把整个 snapshot digest 当作幂等启动身份，任何代码修改都会错误地产生冲突；若完全忽略 snapshot，又无法识别分支切换和仓库替换。

Comet 0.5.1 的可借鉴原则是：workspace preparation/validation 先于 Run；Run 绑定固定 workspace identity 和 revision；恢复使用原 Action/checkpoint；只有外部结果未知才 reconciliation。Repoctopus 保持自己的多仓与职责边界：Runner 准备 checkout，Runtime 校验和冻结语义，不引入 Comet SDK 或让 Runtime 执行 Git switch/worktree。

## Goals / Non-Goals

**Goals:**

- 在 Run Store 第一次写入前拒绝 detached HEAD、source=target 和不匹配的 Workspace Repository identity。
- 以排除正常代码变化的 semantic binding identity 区分新建、幂等恢复和冲突。
- 让 Service 只对真正新建的 Run执行初始 Work/Skill 记录，恢复路径完全采用 Store 中的 current Work。
- 让 Open observation retry 复用原 Outcome/attempt/invocation，并把确定性无效与不可判定错误分开。
- 用生产边界黑盒测试证明“失败时没有幽灵 Run、恢复时没有重复 Host”。

**Non-Goals:**

- Runtime 不创建、切换、删除或回收 branch/worktree。
- 不为开发期已卡死的 Run 增加兼容迁移或直接 Store 修复；它们保留为只读缺陷证据。
- 不解决 OpenSpec Store 首次初始化、CLI adapter 默认值和 consumed-layer 文案问题。
- 不增加后台 daemon、轮询器或第二套生命周期。

## Decisions

### 1. 用纯领域值对象表达启动绑定，而不是复用完整 ProjectSnapshot digest

新增版本化 `ChangeStartBinding` 纯值对象，由 Workspace Repository snapshot 与已经解析的 target branch facts 派生。它包含：Workspace Repository id、规范化 remote identity、attached source branch、target remote identity、target branch，以及按 repository id + remote identity 计算的 topology identity；不包含本机 path、HEAD、worktree 状态和时间。构造器返回稳定 digest，并以受限错误码拒绝：

- `workspace-repository-missing`
- `source-branch-detached`
- `source-target-equal`
- `remote-identity-mismatch`
- `repository-topology-mismatch`

`startChange` 在 `verifyRoot`、Workspace Repository 定位与远端 target branch observation 完成后立即派生该值；失败发生在 runId 可计算但 Run Store 尚未 initialize 的位置。`ChangeStartBinding` 放入 `change.open` trigger facts，因此 Coordinator 现有 trigger identity/CAS 可以冻结它。

选择该方案而不是比较完整 snapshot，是为了允许同一 branch 上正常的 HEAD、dirty 状态和多仓实现进展；选择它而不是只比较 branch 字符串，是为了防止仓库 remote 或 topology 被替换后误恢复旧 Run。

### 2. `startOrResume` 显式返回 started/resumed disposition

Coordinator 的幂等入口返回 `{ status, disposition }`（或等价的强类型结果），而不是要求 Service 从诊断文案猜测是否新建。`started` 才允许执行初始 Skill snapshot、effective composition、`work.created` 和首次 Desktop activation 记录；`resumed` 直接返回 Store 中的 authoritative lifecycle/current Work。若 workflow、trigger（含 binding）或其他冻结 identity 不匹配，抛出带公共受限 code 的 `RunIdentityConflictError`，CLI failure envelope 保留该 code。

正常开发后的完整 ProjectSnapshot 可以用于 `resume` 的 drift observation，但不作为 `run start` 的 binding identity。这样“同 branch 的内容变化”走原 Run 的恢复/失效协议，“切换 source、target、remote 或 topology”在启动边界 fail closed。

选择显式 disposition 而不是复用 `runtime.idempotent-start` diagnostic，是为了让控制流依赖类型而非展示字符串；选择返回原 status 而不是重新构造候选 Work，是为了消除本次 invariant failure 的根因。

### 3. Open observation 使用分类边界，不按异常文本决定恢复

Open gate 保留三条路径：

1. Provider 成功返回 strict invalid 或 planning artifacts 可确定无效：原子安装唯一 repair Work、递增 epoch、退役旧 execution。
2. Provider/Store/进程暂时失败，无法判断有效性：保留原 Work/Outcome/attempt/invocation，返回 `reobserve` continuation；下一次 `run next/resume` 再调用 observation，不调用 Host reconcile。
3. 原 Host execution 的外部结果未知：只有 Work execution authority 才返回 `reconcile` 并调用 Host reconciliation。

启动 binding 错误在路径 1–3 之前被消除。对于并发或遗留状态仍可能抛出的 branch identity 错误，Specification planning 与启动 binding 共享一个受限 typed error family，Open gate 将其投影为 binding/input conflict，而不是捕获消息文本或误报 Provider unavailable。

选择 `reobserve`（同 checkpoint 内部重试）而不是 `reconcile`，是因为 Provider read 不是原 Host 的未知外部副作用；选择保留成功 Outcome，是为了避免重复消耗 Skill 或重复写入规划工件。

### 4. 观测事实遵循“无 Run 不造 trajectory”

创建前拒绝没有合法 Run，因此通过现有 durable canonical observation outbox 写入 `change.start.preflight`，使用候选稳定 run identity 仅作 Trace/Event 关联，并明确 `run_created=false`；不为遥测初始化 Run Store。已有 Run 的 `start.reused`、`start.conflict`、`open.observation.unavailable|accepted|rejected` 和 `open.reobserved` 从持久 trajectory 映射到同一 outbox。

事件属性使用受控枚举；branch、remote、path、digest 与错误正文只留在本地诊断或领域对象，不进入 Metric label。OTLP export 失败不改变 preflight 或 Run 结果。

### 5. 验证以失败路径的持久副作用为核心

测试分三层：

- 领域测试：相同输入得到相同 binding digest；易变 HEAD/worktree/path 不改变 binding；branch/remote/topology 改变会改变或拒绝 binding。
- Service/Coordinator 测试：source=target 在 Store initialize 前失败；新建只记录一次初始 Work；等价重放返回同 Work；binding 漂移返回 typed conflict且 checkpoint/trajectory 不变。
- 生产 CLI/Provider 黑盒：临时多仓 fixture 从 target branch 启动失败且没有 Run 目录，切换公开 feature branch 后成功；接受一次 Open Host Outcome，注入一次 Provider unavailable，再恢复 Provider，证明 invocation/attempt/Outcome 未变化且没有调用 Host reconcile。

Telemetry 测试把 outbox envelopes 与 trajectory 对齐，并断言敏感字段和高基数值不进入 Metric labels。最终 Evidence 绑定 `npm run verify`、严格 OpenSpec validation、Windows CLI E2E 以及工作区卫生。

## Risks / Trade-offs

```

Full source: openspec/changes/stabilize-runtime-workspace-binding/design.md

## openspec/changes/stabilize-runtime-workspace-binding/tasks.md

- Source: openspec/changes/stabilize-runtime-workspace-binding/tasks.md
- Lines: 1-44
- SHA256: 3462fd36d9aeb37d8537281e845632af7023e28e0b9a5e37a395a06226b2f36a

```md
# Tasks

## 1. 启动绑定领域契约

- [ ] 1.1 先写 `ChangeStartBinding` 的失败单元测试，覆盖 detached HEAD、source=target、remote 不一致和 topology 漂移，并运行对应 Vitest 文件确认测试按预期失败 <!-- comet-task:6ebd1e88-c261-4cc0-8dd8-bb41c10d01c0 -->
- [ ] 1.2 实现版本化 `ChangeStartBinding` 值对象、稳定摘要与受限错误码，并运行对应 Vitest 文件确认失败用例全部通过 <!-- comet-task:d345a9a3-da8d-47bd-b660-01c25702d4a6 -->
- [ ] 1.3 增加易变 ProjectSnapshot 字段测试，证明 HEAD、worktree、path 与 captured time 不改变 semantic binding identity，并运行对应 Vitest 文件通过 <!-- comet-task:acb74feb-a8f2-4c98-95f5-dbf269bf458a -->
- [ ] 1.4 在 Architecture/类型导出中记录 Runner 准备 checkout、Runtime 只校验绑定的职责边界，并运行 `npm run check:architecture` 通过 <!-- comet-task:8a4d1616-423b-4c3a-9770-e92d73256789 -->

## 2. Run 创建前校验与幂等启动

- [ ] 2.1 先写 Service 回归测试，证明 source=target 在 Run Store initialize、Skill composition、`work.created` 和 Desktop activation 前失败，并运行目标测试确认失败 <!-- comet-task:042d5607-afd4-4632-85dd-72901142e5de -->
- [ ] 2.2 在 `startChange` 中先解析 target facts并派生启动绑定，把它放入 `change.open` trigger identity，再运行 2.1 的目标测试通过 <!-- comet-task:8d7047db-948a-4952-acad-0e02eb0230a2 -->
- [ ] 2.3 为 Coordinator `startOrResume` 增加强类型 `started|resumed` disposition，迁移调用点并运行 Runtime 单元测试通过 <!-- comet-task:6ba049a5-f60a-4141-aea3-05d74fb78fd9 -->
- [ ] 2.4 让 Change Service 仅在 `started` 时记录初始 Skill/Work事实，在 `resumed` 时返回 Store 中的 authoritative current Work，并运行等价重放测试证明只有一个 `work.created` <!-- comet-task:8f61b0f2-826e-4ce6-b5ab-a638a0d900d0 -->
- [ ] 2.5 为 binding identity 漂移返回公共 `workspace-binding-conflict`，让 CLI failure envelope 保留受限 code，并运行 CLI 契约测试确认没有解析错误文本 <!-- comet-task:dd44a603-49e1-43e9-8ee4-7eb85f1e3e9e -->
- [ ] 2.6 增加并发启动测试，证明同一绑定只创建一个 Run，冲突绑定不改变原 stateVersion、checkpoint 或 trajectory，并运行目标测试通过 <!-- comet-task:ac73f079-6beb-423c-b5d8-ded547b20efe -->

## 3. Open observation 分类与恢复

- [ ] 3.1 先写 Open gate 回归测试，注入一次 Provider unavailable 并断言原 Outcome/attempt/invocation 被保留、Host reconcile 未调用，运行目标测试确认失败 <!-- comet-task:8c1c9504-77ee-43b5-a84f-d6996e4da634 -->
- [ ] 3.2 引入 typed observation/binding error 分类，把 Provider 暂时不可用投影为同 checkpoint 的 `reobserve`，并运行 3.1 的目标测试通过 <!-- comet-task:03d5f36e-6c18-4556-9d4d-ffdbb11bc3aa -->
- [ ] 3.3 保留 strict invalid 的唯一 Open repair Work 路径，增加重复 `next/resume` 测试证明 repair Work、checkEpoch 和 execution retirement 只提交一次 <!-- comet-task:4b76a843-38bc-431e-b7ff-5934ea318a87 -->
- [ ] 3.4 增加并发或遗留 branch identity 错误测试，证明它返回 binding/input conflict而不是 `open-observation-unavailable` 或 Host reconciliation <!-- comet-task:62c788f2-5d3f-483a-b70c-910019a81876 -->

## 4. 启动与重观察遥测

- [ ] 4.1 为创建前拒绝增加 canonical outbox 观测映射和脱敏测试，确认 `run_created=false` 且 payload/Metric labels 不包含 branch、path、remote、digest 或错误正文 <!-- comet-task:f8cd6ff4-2203-4fcd-a45d-7a5628186234 -->
- [ ] 4.2 为 idempotent reuse 与 binding conflict 增加持久观测事实，运行映射测试确认 `work_created=false`、`checkpoint_changed=false` 和有界 result/recovery 分类 <!-- comet-task:758a4242-8b21-4afd-91e6-9470c8d14dc2 -->
- [ ] 4.3 为 Open unavailable→reobserved 链路增加 trajectory/OTLP 映射，运行测试确认同一 Run/Work/invocation 且 `host_replayed=false` <!-- comet-task:fdaf9ade-e9d9-4e23-b53d-27c3e1789f31 -->
- [ ] 4.4 用测试 receiver 对 logs、traces、metrics 与 trajectory/outbox 做关联校验，并运行 Desktop/OTLP codec 目标测试通过 <!-- comet-task:8916a520-f614-4de7-bc06-f74c1fca3a30 -->

## 5. 生产边界验收

- [ ] 5.1 增加 Windows CLI E2E fixture，从 target branch 执行 `run start`，断言结构化失败且没有 Run Store 目录、Work、Desktop activation 或成功 lifecycle 事件 <!-- comet-task:b60a56e3-d3fa-45d2-a156-f1c5064b0436 -->
- [ ] 5.2 在同一 fixture 切换到 feature branch 后启动成功，再以等价输入重放并断言返回同一 Run、Work 和 attempt <!-- comet-task:84aef510-8809-4098-ab15-ba40c18e5530 -->
- [ ] 5.3 在同一 fixture 启动后切换 source branch，断言 `workspace-binding-conflict` 且原 checkpoint 字节和 trajectory 长度不变 <!-- comet-task:9d135c5f-11ef-4de9-9320-bb821a1ee8aa -->
- [ ] 5.4 完成一次真实 Open Host Outcome，模拟 Provider 首次不可用后恢复，断言 Provider 重观察成功、Host invocation 计数不变且未调用 `work-reconcile` <!-- comet-task:7c47368c-02da-48d8-b6c1-7f4dff74b6b8 -->
- [ ] 5.5 运行 `npm run verify`、`npx --yes --package=@rpamis/comet@0.5.1 comet classic openspec -- validate stabilize-runtime-workspace-binding --strict` 与 `git diff --check`，保存绑定最终 HEAD/tree/config/tool 输入的正式 Evidence 并清理临时日志和 scratch 输出 <!-- comet-task:0f85079e-eb93-4724-8642-ad0e29facd4c -->

## Workflow follow-up

- 在 Open 与 Design 审查通过、实现和 Verify Evidence 完成后归档本 Change。
- 保留原验收中卡死 Run 为只读缺陷证据；使用新 Change identity 重新运行模拟多仓最小验收，不修改旧 Store。

```

## openspec/changes/stabilize-runtime-workspace-binding/specs/change-lifecycle/spec.md

- Source: openspec/changes/stabilize-runtime-workspace-binding/specs/change-lifecycle/spec.md
- Lines: 1-55
- SHA256: d64c58ab26304f2c9adef2a72f407127831e4a55acd04198ab4ec8bbdbdbe6c2

```md
# Spec Delta

## ADDED Requirements

### Requirement: Change Run 创建前固定合法的工作区启动绑定

Runtime MUST 在持久化 Change Run、Work、Skill binding、Desktop activation 或成功遥测事实之前，从可信 Workspace Repository inspection 形成启动绑定，并验证 checkout 已附着到 source branch、source 与 target 不同、repository identity 和拓扑与本次 project snapshot 一致。Runner 负责准备 checkout；Runtime 不创建、切换或修复 Git branch/worktree。

#### Scenario: 从目标分支启动 Change

- **WHEN** Runner 请求以当前 checkout 的 `main` 作为 source，并以 `main` 作为 target 启动新 Change
- **THEN** Runtime 返回结构化 `workspace-binding-invalid`，且 Run Store、Work execution、Desktop activation 和 lifecycle trajectory 均不存在该 Change 的新成功事实

#### Scenario: 从已准备的功能分支启动 Change

- **WHEN** Runner 已准备 attached source branch，source 与 target 不同，且所有 Workspace Repository facts 与 project snapshot 匹配
- **THEN** Runtime 创建唯一 Change Run，并把规范化的 source、target 与 repository identity 作为稳定启动身份的一部分

#### Scenario: detached HEAD 启动 Change

- **WHEN** Workspace Repository inspection 返回 detached HEAD 或无法证明当前 source branch
- **THEN** Runtime 在创建 Run 前拒绝请求并返回可定位的 binding 诊断，不把错误延迟到 Specification Provider 或 Archive

### Requirement: 稳定启动只能幂等恢复同一绑定

相同 Workspace/change 的重复启动 MUST 先比较已冻结的 workflow、trigger、project snapshot 和 workspace binding identity。完全等价时返回原 Run 和当前 continuation；任一绑定事实不同时返回结构化 conflict，保持原 checkpoint 不变，不构造或记录候选 Work，不通过再次启动重绑活动 Run。

#### Scenario: 等价启动请求重放

- **WHEN** Runner 因响应丢失而以相同 trigger、project snapshot、source、target 和 repository identity 重放 `run start`
- **THEN** Runtime 返回原 Run、原 current Work/attempt 和逻辑等价 continuation，不新增 `work.created`、Human Decision 或 Host invocation

#### Scenario: 启动后切换分支再重试

- **WHEN** 已有 Run 绑定了一个 source branch，而调用方切换 checkout 后再次启动相同 Workspace/change
- **THEN** Runtime 返回 `workspace-binding-conflict` 和原 Run identity，不以新 project snapshot 创建 Work，也不把新 binding 写入旧 Run

### Requirement: Open 观察错误按可判定性分类

Runtime MUST 将创建前工作区输入无效、Provider 明确返回的规格无效、Provider 暂时不可用和外部执行结果未知分为不同事实。只有无法判定原外部执行结果时进入 Host reconciliation；已接受 Open Outcome 后的暂时 Provider 故障只重新观察原 checkpoint，确定性输入错误不得投影为 `open-observation-unavailable`。

#### Scenario: Provider 暂时不可用后恢复

- **WHEN** Open Host Outcome 已接受，首次 Provider inspection 因暂时基础设施错误无法返回有效或无效结论，随后同一 Provider 恢复
- **THEN** Runtime 保留原 Work、Outcome、attempt 和 invocation，在下一次受保护 pull 重新观察并继续原 gate，不重放 Host 或创建 repair Work

#### Scenario: Provider 明确返回 strict invalid

- **WHEN** Provider 成功返回当前四类规划工件 strict invalid 和可定位诊断
- **THEN** Runtime 通过单次 revision-bound transition 安装唯一 Open repair Work并退役旧 execution，不进入 Host reconciliation

#### Scenario: 分支约束错误在 Open inspection 中被发现

- **WHEN** 遗留或并发状态使 Provider inspection 发现 source 与 target 相同等确定性启动输入错误
- **THEN** Runtime 返回受限 binding/input conflict并保持原 checkpoint，不把该错误标记为 Provider unavailable，也不调用只适用于未知 Host 结果的 reconciliation

```

## openspec/changes/stabilize-runtime-workspace-binding/specs/development-telemetry/spec.md

- Source: openspec/changes/stabilize-runtime-workspace-binding/specs/development-telemetry/spec.md
- Lines: 1-27
- SHA256: b304f8fb556ea50d44f7466baea2a5f39d5716dd2a8d72057ea5313609ef9b76

```md
# Spec Delta

## ADDED Requirements

### Requirement: Change 启动绑定与 Open 重观察必须可审计

Runtime MUST 为 Change 启动 preflight、稳定启动复用或冲突、Open Provider observation 和恢复结果记录版本化观测事实。Run 创建前的拒绝只进入持久 canonical observation outbox/OTLP，不得为遥测创建 Run；已有 Run 的事实从 trajectory 投影到同一 outbox。Metric label 只允许使用有界的 phase、result、binding error class、observation class、recovery kind 和 host replayed 布尔值；branch、path、digest、错误正文及自由 identity 不得成为 Metric label。

#### Scenario: 启动前拒绝相同 source 与 target

- **WHEN** Change 启动 preflight 发现 source 与 target 相同并在 Run 创建前拒绝请求
- **THEN** 遥测记录 `result=rejected`、受限 `binding_error=source-target-equal` 和 `run_created=false`，不输出 branch 名或 checkout 路径

#### Scenario: 等价启动复用原 Run

- **WHEN** 相同启动身份的请求恢复已存在 Run
- **THEN** trajectory/OTLP 记录 `result=reused` 和 `work_created=false`，并可与原 Run 关联，不把恢复统计为第二次逻辑 Run 或 Work

#### Scenario: 绑定漂移被拒绝

- **WHEN** 相同 Workspace/change 的新启动请求与原 Run 的 workspace binding identity 不同
- **THEN** 遥测记录有界 `result=conflict`、`recovery=halt` 和 `checkpoint_changed=false`，不导出新旧 branch、路径或自由错误文本

#### Scenario: Provider 暂时不可用后重观察成功

- **WHEN** Open Outcome 已接受，Provider observation 首次不可用并在后续受保护 pull 成功
- **THEN** Trace/Event 把两次 observation 关联到同一 Run、Work attempt 和 Host invocation，记录 `recovery=reobserve` 与 `host_replayed=false`

```
