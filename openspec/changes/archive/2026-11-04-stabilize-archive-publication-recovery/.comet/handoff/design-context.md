# Comet Design Handoff

- Change: stabilize-archive-publication-recovery
- Phase: design
- Mode: compact
- Context hash: f14618d810380089eb99b634b99dec1cde8d46d02583c7ba387ed7b7d7e6f95c

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/stabilize-archive-publication-recovery/proposal.md

- Source: openspec/changes/stabilize-archive-publication-recovery/proposal.md
- Lines: 1-42
- SHA256: 9c1c633921f217704896d284f649f77a5ca5d2029745aba4c76eea7011aaf98d

```md
# Proposal

## Why

第五轮真实多仓验收证明核心生命周期可以完成，但暴露了两个会误导恢复行为的 Runtime 缺陷：

1. GitHub 明确拒绝 MR 创建请求时，当前实现仍把所有异常包装成“结果未知”。Journal 因而进入只允许观察的 `mr-unknown`，即使平台已经证明本次请求未执行，修正凭据或配置后也无法在同一稳定 publication identity 上安全重试。
2. Run 已经 `completed`、Archive 已无 current Work 时，公开 continuation 仍可能被旧的 `workId=null` `continuation.selected` 事件覆盖成 `wait/transition-pending`，导致 CLI、Desktop 和遥测把终态显示为仍在推进。

这两个问题都来自把不同证据强度压成同一种投影：前者混淆“确定未执行”和“执行结果未知”，后者让历史选择覆盖当前终态。它们必须在继续扩大验收范围前修复。

## What Changes

- 为平台副作用失败建立有界的执行确定性分类：只有平台明确拒绝且证明未执行的请求可以回到可重试状态；传输中断、5xx、成功响应不可解析或创建后核验失败继续视为结果未知。
- 让 Business MR Publication Journal 在确定未执行时保留原稳定 intent、attempt 和诊断并回到安全可重试 checkpoint；未知结果仍只允许观察、采用或人工修复，禁止盲重放。
- 让 GitHub Adapter、Delivery 服务、Journal 和 CLI 保留同一低基数错误分类与可操作恢复说明，不泄露凭据或把任意平台消息写入 Metric labels。
- 让 Run 的 terminal status 在 continuation 投影中拥有绝对优先级；历史 `continuation.selected` 不得把 terminal checkpoint 改写为等待态。
- 增加平台分类、Journal 恢复、终态投影、打包 CLI 和第五轮验收形态的回归测试。

## Capabilities

### Modified Capabilities

- `delivery-governance`：区分确定未执行与结果未知，并按证据强度恢复稳定 MR 发布。
- `change-lifecycle`：保证 terminal Run 的 continuation 与 next actions 由当前权威 checkpoint 决定。

## Non-Goals

- 不对未知外部结果自动重试，不通过递增 generation、改变 publication identity 或新建 Run 绕过恢复。
- 不等待 MR 合入，不增加 webhook、守护进程、自动 merge、force push 或远端分支删除。
- 不改写既有 Journal/Trajectory 历史，不通过手工 Store mutation 修复状态。
- 不在本 Change 更新 Comet/DSH 固定基线；只记录本次检查到的上游漂移并继续采用 Comet 0.5.1 的稳定恢复原则。

## Upstream Reference

参考固定 Comet 0.5.1（`35c9860b77b42bafa0c2d80d8d695889f888a924`）的成熟边界：未知副作用不重放，先协调原执行；只有存在 `not-executed` 证据才允许重试；terminal status 是权威事实。Repoctopus 在自身多仓 Publication Journal、不可变 Work 和 OpenSpec 权威模型中独立实现，不复制 Comet 的单仓数据结构。

2026-11-04 的漂移检查显示 Comet `origin/master` 已到 `ff64a75cc51d68b57218c6ce7fad94a7383b9a76`、DSH HEAD 已到 `8bd073392eef6f54e921a093b95076248eb08cbb`；检查到的 Comet 变更未改变上述恢复原则，因此本 Change 不混入上游基线升级。

## Third-Party and License

本 Change 仅参考 Comet 的公开行为、文档和恢复边界，在 Repoctopus 架构中独立实现，不复制第三方源码或新增依赖。

```

## openspec/changes/stabilize-archive-publication-recovery/design.md

- Source: openspec/changes/stabilize-archive-publication-recovery/design.md
- Lines: 1-121
- SHA256: d1660b9ad8184276573626904bbb0f6adc31183ce37de0637b9569cd87ef1ee9

[TRUNCATED]

```md
# Design

## Context

Archive 发布由稳定 Publication Intent、逐项 Journal 与最终 Receipt 组成。Business MR 创建前已经完成精确观察，并在调用平台前把 item 写成 `mr-invoking`；调用返回后再接受唯一 repository/base/head/head OID 匹配的结果。这个结构本来足以实现 Comet 风格的“先记录意图，再协调外部事实”。

当前缺口在错误语义：`observeOrCreateMergeRequest()` 捕获创建、创建后状态核验和恢复观察中的所有错误，统一抛出 `PublicationResultUnknownError`。GitHub Adapter 的 401、403、404、422/其他 4xx 与网络断开、5xx、成功响应 JSON 损坏也只有错误码差异，没有“副作用是否可能已发生”的领域语义。Journal 看到统一异常后只能进入 `mr-unknown`，后续正确地拒绝再次调用 create，却也因此无法从平台明确拒绝中恢复。

另一个缺口在只读投影：`classifyWorkContinuation()` 已能从 `runStatus=completed` 得到 `done/terminal`，但 `projectCommittedContinuation()` 随后仍搜索历史 `continuation.selected`。当 terminal checkpoint 的 workId 为 `null` 时，一个旧的 null-work 事件会被错误视为当前选择并覆盖终态。

## Goals / Non-Goals

**Goals:**

- 以可证明的外部执行确定性决定是否允许再次创建 MR。
- 保持相同 runId、publicationId、repository/base/head/head OID 和 Journal item；恢复不是新操作身份。
- 让业务发布与最终规格发布共享一致的“确定未执行 / 结果未知”边界，但只修改本 Change 触达的 MR 创建路径。
- 让所有终态读取面稳定返回 terminal，不依赖历史事件扫描顺序。
- 提供有界、脱敏、可操作且可测试的诊断。

**Non-Goals:**

- 猜测 5xx、传输错误或不可解析成功响应一定未执行。
- 把人类可读 message 当作恢复分支条件。
- 自动循环重试、后台 reconcile 或改变 MR identity。
- 为旧版本维护双读、migration adapter 或兼容分支。

## Decisions

### 1. 外部执行确定性是显式领域类型

新增受限分类 `not-applied | unknown`，并由副作用发生位置最近的 Adapter 产生：

- GitHub 明确返回 4xx：`not-applied`。服务端已处理并拒绝这次请求，MR create 没有被接受；401/403/404/409/422/429 等均保留细分平台 code，但恢复只消费统一 certainty。
- HTTP 5xx：`unknown`。响应可能来自执行链中任一层，不能证明写操作未提交。
- fetch/连接/超时异常：`unknown`。
- 2xx 后响应体无法解析：`unknown`，因为写操作可能已经提交。
- create 返回 identity 后的 status/精确 OID 核验失败：`unknown`。

领域层不得通过 `instanceof` 依赖 GitHub 具体实现。平台错误通过共享的只读 contract 暴露 bounded code、effect certainty 和 stage；未知第三方错误默认 `unknown`，保持 fail closed。

### 2. 确定未执行与结果未知使用不同错误合同

Delivery 层使用两个明确分支：

- `PublicationNotAppliedError`：绑定 publicationId、stage、bounded reason 和原 cause，表示本次 create 被证明未执行。
- `PublicationResultUnknownError`：保持现有稳定身份和 side-effect stage，表示没有足够证据安全重放。

错误 message 只包含有界类别、平台和 repository identity；认证值、Authorization header、完整响应 body、Token、绝对路径和任意远端文本不得持久化。Metric labels 只使用枚举 certainty/stage/reason；详细 cause 只进入受现有安全策略约束的 trace/diagnostic chain。

### 3. Journal 以原子转换恢复确定未执行

MR item 从 `pushed` 进入 `mr-invoking` 后：

- 成功或精确观察到匹配 MR：进入 `published`。
- `PublicationNotAppliedError`：以 CAS 原子写回 `pushed`，保留 intent、operationId、attempts 和历史事件，记录 bounded diagnostic/last failure；当前 Archive 调用返回明确失败，不在同一次调用内循环 create。下一次显式 pull 会先重新观察，再以相同 stable identity 发起 create。
- `PublicationResultUnknownError` 或其他无法分类异常：进入 `mr-unknown`；以后只执行 observe/adopt，零匹配也继续阻断，不调用 create。

attempt 计数可以反映实际 invocation 次数，但不参与 publication identity。确定未执行不会伪造 Receipt，不会标记 Work 为 external-result-unknown；未知结果继续映射为外部副作用 reconcile。

### 4. 恢复入口必须给出精确下一步

服务和 CLI 对 `not-applied` 返回：失败阶段、bounded reason、原稳定 publication item，以及“修正凭据/权限/配置后重新拉取同一 Archive Work”的动作；不得建议新建 Run、手工编辑 Store 或改变分支。对 `unknown` 返回：观察同一 repository/base/head/head OID、可采用唯一人工 MR 或人工证明未执行；不得建议直接重试 create。

Runtime 仍由 Agent/Runner pull 驱动，不增加 daemon。一次调用最多执行一次新的外部 invocation。

### 5. terminal continuation 在历史投影前短路

`projectCommittedContinuation()` 在读取当前 checkpoint 并完成纯分类后，若结果为 `done/terminal`，立即返回该结果，不再搜索 `continuation.selected`。终态投影必须满足：

- `continuation=done`、`reason=terminal`；
- `workId=null`、`attempt=null`，保留当前 `checkEpoch`；
- `projectLifecycleNextActions()` 返回空数组；
- CLI、Desktop、Runtime status 和遥测使用同一只读投影。

本 Change 先固定 `completed` 的已观察生产缺陷。`failed` 与 `migration_required` 虽然没有 next actions，但现有恢复/诊断可能仍需要非 `done` continuation，不在缺少状态机证据时扩大为相同终态语义。

### 6. 历史事件只在精确活动 checkpoint 上重放

非终态仍可重放已提交 `continuation.selected`，但匹配至少受 run、state/check epoch、current work identity 和 attempt 约束。null-work 历史选择不得跨 state revision 覆盖新的 checkpoint。若现有事件缺少足够身份，则回退到当前 checkpoint 的纯分类，而不是猜测。

```

Full source: openspec/changes/stabilize-archive-publication-recovery/design.md

## openspec/changes/stabilize-archive-publication-recovery/tasks.md

- Source: openspec/changes/stabilize-archive-publication-recovery/tasks.md
- Lines: 1-52
- SHA256: 927d56410b53346595f2fd9937c388883fa01f8af1b1c3c11dead5c1e2f56d91

```md
# Tasks

## 1. Freeze the production regressions

- [ ] 1.1 添加 terminal checkpoint + 历史 null-work `continuation.selected` 的 red test，证明 completed Run 当前被错误投影为 `transition-pending`。 <!-- comet-task:6d44c990-5ac0-4cea-95fd-ae0f6e17410f -->
  **Acceptance:** 测试从公开 projector/status API 构造生产形态，修复前稳定失败，且断言 next actions 为空。
- [ ] 1.2 添加 GitHub 4xx create rejection 的 red test，证明当前路径把“确定未执行”错误包装为 unknown。 <!-- comet-task:7af771ba-2368-4867-bca2-cdc1627eaea1 -->
  **Acceptance:** fixture 使用可控 fetch，断言平台 code、effect certainty 和脱敏 message，不访问真实 GitHub。
- [ ] 1.3 添加 Publication Journal red test：4xx 后不应进入永久 `mr-unknown`；网络断开/5xx/2xx invalid JSON 仍必须进入 unknown。 <!-- comet-task:7fdcc054-f3b4-46fe-9901-5f0fa699e30b -->
  **Acceptance:** 断言 Journal item、attempt、operationId、create/observe 调用次数和恢复动作。

## 2. Model external-effect certainty

- [ ] 2.1 在 Delivery 边界定义有界 `not-applied | unknown` contract 和 `PublicationNotAppliedError`，保留现有 unknown 类型的 fail-closed 语义。 <!-- comet-task:d532123d-6d54-4bc0-92ea-a1c263af665b -->
  **Acceptance:** 未知 Error 默认 unknown；领域层不导入 GitHub Adapter 类型；错误不含凭据或任意响应 body。
- [ ] 2.2 扩展 GitHub `PlatformRequestError`：4xx 映射 `not-applied`，5xx/transport/2xx parse failure 映射 `unknown`。 <!-- comet-task:f279aa1e-58f6-4977-b7f7-afc70b26f43c -->
  **Acceptance:** 401、403、404、409/422、429、500、fetch reject 和 invalid JSON 表驱动测试全部通过。
- [ ] 2.3 让 stable create-or-observe 只把真正不确定的结果包装为 unknown，并把明确拒绝转换为 not-applied。 <!-- comet-task:6d0c3bc1-ceb3-4c6c-9927-e43b58b3c753 -->
  **Acceptance:** create 后核验失败仍 unknown；lost response 后观察到精确 MR 仍以 `recovered` 完成。

## 3. Recover the Publication Journal safely

- [ ] 3.1 在 Business Publication Journal 中实现 `mr-invoking -> pushed` 的确定未执行 CAS 转换，保留 intent/operationId/attempt/history 和 bounded diagnostic。 <!-- comet-task:bd2af5eb-851a-4679-8d2a-34d04e0e8280 -->
  **Acceptance:** 当前调用失败且不循环重试；下一次显式执行先观察再最多 create 一次。
- [ ] 3.2 保持 `mr-invoking|mr-unknown` 的 unknown 恢复为 observation-only，覆盖零匹配、唯一精确匹配、歧义和 OID mismatch。 <!-- comet-task:c5de9105-754f-4652-8a95-253cd7ab5f0b -->
  **Acceptance:** unknown 路径任意重复恢复的 create count 不增加；唯一匹配可完成并记录 `recovered`。
- [ ] 3.3 对齐 Specification MR 发布路径的错误分类，确保共享 Adapter contract 不产生相反语义。 <!-- comet-task:5e7a996b-31a8-4521-8071-1ac0a0f98cdd -->
  **Acceptance:** 规格发布的确定拒绝可在同一稳定 intent 上显式重试，未知结果仍只观察；不改变 push unknown 规则。
- [ ] 3.4 更新 WorkflowRuns/Work Execution 映射，只把真正 unknown 标为 external side-effect unknown。 <!-- comet-task:5f6bdcf1-fbd6-4756-9367-dba1fc8e5df7 -->
  **Acceptance:** not-applied 保持同一 Archive Work 可重试；unknown 继续返回 `reconcile/external-result-unknown`。

## 4. Make terminal projection authoritative

- [ ] 4.1 让 `done/terminal` 在 `projectCommittedContinuation()` 中先于 trajectory replay 返回。 <!-- comet-task:46371dc0-6fce-4c46-81f9-5948a71ba78e -->
  **Acceptance:** completed Run 始终返回 null work/attempt、当前 epoch 和空 next actions。
- [ ] 4.2 收紧非终态 `continuation.selected` 的 checkpoint 匹配，避免旧 null-work event 跨 revision/epoch 重放。 <!-- comet-task:64e74557-21e4-4d5b-b5ce-d87f9eaa1c1c -->
  **Acceptance:** 当前活动 Work 的合法 selection 仍可重放；旧 state、epoch、work 或 attempt 被忽略。
- [ ] 4.3 覆盖 Runtime status、CLI 和 Desktop projection 的纵向回归。 <!-- comet-task:86e77841-206d-460e-a92f-032f2da8dded -->
  **Acceptance:** 同一持久 checkpoint 在三个读取面都显示 terminal，不触发 I/O 或状态写入。

## 5. Diagnostics, telemetry, and acceptance

- [ ] 5.1 增加有界恢复诊断：not-applied 指向修正后重拉同一 Archive Work，unknown 指向观察/采用/人工证明未执行。 <!-- comet-task:2fb9d881-fb2d-4366-886b-6b669fac9026 -->
  **Acceptance:** CLI 不建议新建 Run、手改 Store 或盲重试；输出不含 token、header、response body 或绝对路径。
- [ ] 5.2 在现有 telemetry 映射中记录 bounded stage/certainty/result，禁止 repository/branch/path/error message 进入 Metric labels。 <!-- comet-task:7fbadff0-bbc3-40b0-a702-b7f7edcac868 -->
  **Acceptance:** telemetry cardinality/privacy 测试通过，trace 可关联原 publication/work identity。
- [ ] 5.3 使用打包 CLI 和失败注入 adapter 完成 Archive 恢复验收，并重放第五轮 terminal fixture。 <!-- comet-task:ef729e5f-6f32-446f-820e-a8ba4d29afec -->
  **Acceptance:** 4xx 修正后同一 item 完成；unknown 不重放；completed Run 只投影 terminal；不创建真实 MR。
- [ ] 5.4 更新交付恢复/Runtime 文档，记录 Comet 原则、HTTP 分类边界和操作手册。 <!-- comet-task:6062e26f-ad45-4434-b7ad-b4e679867be1 -->
  **Acceptance:** 文档明确 4xx/5xx/transport/parse/status verify 的分类与操作者下一步。
- [ ] 5.5 运行 strict OpenSpec、定向测试、`npm run verify` 和打包验收，清理临时日志/fixture 输出并记录正式验证证据。 <!-- comet-task:e0933926-1174-4887-a632-ce6c82d7bdd0 -->
  **Acceptance:** 工作树只保留本 Change 权威产物；所有必需检查通过或以可定位证据阻断。

```

## openspec/changes/stabilize-archive-publication-recovery/specs/change-lifecycle/spec.md

- Source: openspec/changes/stabilize-archive-publication-recovery/specs/change-lifecycle/spec.md
- Lines: 1-22
- SHA256: cab37aab3a1a366fd1ca920700e94aef2ffae98fbb99b3ea0f1e5f8a732c3fec

```md
# change-lifecycle Delta

## ADDED Requirements

### Requirement: terminal Run 的 continuation 必须由当前 checkpoint 绝对决定

当权威 Change Run checkpoint 已进入 completed terminal status 时，Repoctopus MUST 投影 `done/terminal` continuation、空 current Work/attempt 和空 next actions；历史 `continuation.selected`、Trajectory 顺序、目录状态、Git/MR 状态或展示端推断 MUST NOT 把该终态覆盖为 execute、wait、ask、reconcile 或 transition-pending。该投影 MUST 为只读，并由 Runtime status、CLI、Desktop 和遥测共同消费。

#### Scenario: completed checkpoint 存在旧 null-work selection

- **WHEN** 当前 checkpoint 为 completed 且 current Work 为 null，但 Trajectory 中存在旧的 `workId=null` `continuation.selected` 等待事件
- **THEN** 所有读取面返回 `done/terminal`、null work/attempt、当前 check epoch 和空 next actions，不重放旧等待事件

#### Scenario: completed checkpoint 存在旧活动 Work selection

- **WHEN** 当前 checkpoint 为 completed，但历史记录包含同一 Run 较早 epoch 或 revision 的 execute/reconcile selection
- **THEN** Runtime 忽略历史活动 Work continuation，并且读取不触发 Host、packet、平台或文件系统 I/O

#### Scenario: 非终态重放精确 continuation

- **WHEN** 当前 Run 尚未完成，最近的 `continuation.selected` 精确匹配当前 run、checkpoint revision/epoch、Work identity 和 attempt
- **THEN** Runtime 可以重放该选择；缺少或不匹配当前身份时回退到当前 checkpoint 的纯分类，不猜测历史事件仍有效

```

## openspec/changes/stabilize-archive-publication-recovery/specs/delivery-governance/spec.md

- Source: openspec/changes/stabilize-archive-publication-recovery/specs/delivery-governance/spec.md
- Lines: 1-41
- SHA256: 3a43c6bf3ea0e815082c1f85b863c12cd8c1331f9fcf78f6592d5f8a335ac6c6

```md
# delivery-governance Delta

## ADDED Requirements

### Requirement: 外部发布恢复必须区分确定未执行与结果未知

Repoctopus MUST 在执行 MR create-or-observe 时持久化稳定 Publication Intent，并根据平台可证明的执行事实把失败分类为 `not-applied` 或 `unknown`。只有平台明确拒绝且证明请求未执行时，Runtime 才能在后续显式 Archive pull 中以同一 runId、publicationId、repository、base、head 和精确 head OID 再次调用 create；网络/超时、HTTP 5xx、成功响应不可解析、创建后核验失败或其他无法证明未执行的结果 MUST 保持 unknown，只允许观察、采用或人工修复，不得盲重放。

#### Scenario: 平台明确拒绝 MR 创建

- **WHEN** GitHub 或其他 Adapter 返回可证明请求未执行的 4xx 拒绝，并且远端观察仍没有精确匹配 MR
- **THEN** Journal 保留原稳定 intent、operation identity、attempt 和拒绝诊断，回到可显式重试的发布 checkpoint；当前调用不循环重试，修正原因后的下一次 pull 先观察再最多调用 create 一次

#### Scenario: MR 创建响应结果未知

- **WHEN** create 请求发生传输中断、HTTP 5xx、2xx 响应不可解析、创建后 status 核验失败或其他无法证明未执行的错误
- **THEN** Journal 进入 unknown 并保留原 invocation；后续恢复只按 repository/base/head/head OID 观察并采用唯一匹配 MR，零匹配时仍不再次调用 create

#### Scenario: 未知结果后观察到唯一 MR

- **WHEN** Journal 为 unknown，平台随后返回唯一且 repository、base、head 和精确 head OID 全部匹配的 MR
- **THEN** Runtime 以 `recovered` provenance 完成同一 publication item，不创建第二个 MR 或改变 publication identity

#### Scenario: 失败无法分类

- **WHEN** 第三方 Adapter 抛出没有可靠 effect certainty 的异常
- **THEN** Runtime 默认按 unknown fail closed，不从错误 message、HTTP 文本或 Agent 判断推导 not-applied

### Requirement: 发布恢复诊断必须有界且可操作

Repoctopus MUST 为外部发布失败保存受限 stage、certainty、platform code 与恢复动作，并通过 CLI、trace 和审计事件关联原 Work/Publication identity；Metric labels MUST 只使用低基数枚举。Token、Authorization header、Cookie、完整响应 body、带凭据 URL、绝对路径和任意错误 message MUST NOT 进入 Journal、Metric labels 或公开状态。

#### Scenario: 确定未执行需要修正配置

- **WHEN** MR create 因认证、权限、配置、冲突或限流被明确拒绝
- **THEN** CLI 指示操作者修正原因后重新拉取同一 Archive Work，并明确当前调用未自动重试

#### Scenario: 结果未知需要协调

- **WHEN** MR create 的执行结果未知
- **THEN** CLI 指示按原 repository/base/head/head OID 观察、采用唯一人工 MR 或提供权威未执行证明，不建议新建 Run、手改 Store 或直接重放 create

```
