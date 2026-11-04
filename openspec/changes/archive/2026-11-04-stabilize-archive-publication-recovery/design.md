---
comet_change: stabilize-archive-publication-recovery
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-04-stabilize-archive-publication-recovery
status: final
---

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

这一收紧与 terminal 短路分别处理两个风险：短路保证已完成 Run 绝不回退；精确匹配避免相同 null work 在其他非终态 checkpoint 中误重放。

### 7. 验证使用失败注入而不是实际平台副作用

测试矩阵使用可控 GitHub fetch 和 MergeRequestPort：

- 4xx 明确拒绝 → `not-applied` → Journal 回 `pushed` → 修正后下一次显式执行只创建一次。
- 5xx、连接断开、2xx invalid JSON → `unknown` → Journal `mr-unknown` → 重复恢复只观察。
- create 成功但 status 失败 → `unknown`；随后精确观察恢复为 `recovered`。
- terminal checkpoint + 旧 null-work selection → `done/terminal`。
- 打包 CLI/公开 status 投影与领域结果一致。

不在测试中创建真实 MR，也不把手工创建 MR 当作正常的 4xx 恢复办法。

## Module Boundaries

- `domains/delivery`：执行确定性 contract、发布错误类型、稳定 create-or-observe 规则和 Journal 转换。
- `platform/github`：从 HTTP/transport/parse 事实映射平台 code 与 effect certainty。
- `services/workflow-runs.ts`：只把真正 unknown 的副作用交给 Work Execution reconcile；确定未执行保持当前 Archive Work 可显式重试。
- `domains/change-lifecycle`：当前 checkpoint 的纯 continuation 投影与 terminal precedence。
- `app/cli` / telemetry mapping：消费有界领域分类，不重新推断。

## Invariants

- 没有 `not-applied` 证据就不再次执行 MR create。
- 相同 Publication Intent 的恢复不改变 operationId、publicationId 或期望 OID。
- Journal 转换先持久化，再允许外部调用；恢复转换使用 CAS。
- terminal checkpoint 不被 trajectory 历史覆盖。
- 展示层不写回领域状态。

## Verification

- Characterization tests 先证明 4xx 被错误锁进 unknown、terminal 被旧事件覆盖。
- 运行 GitHub adapter、stable publication、resumable publication、archive lifecycle、continuation 和 CLI 定向测试。
- 运行 strict OpenSpec、typecheck、lint、architecture/provenance/generated checks 和完整 `npm run verify`。
- 从干净安装/打包 CLI 执行无真实远端副作用的恢复验收，确认诊断与投影一致。

## Rollback

若无法从 Adapter 到 Journal 保留确定性，继续按 unknown fail closed，不能用自动重试代替。若 terminal 投影收紧影响合法恢复，回滚该投影改动并保留失败 fixture；不得恢复为由 UI 或 Agent 推断终态。
