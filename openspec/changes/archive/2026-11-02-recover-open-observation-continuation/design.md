---
comet_change: recover-open-observation-continuation
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-02-recover-open-observation-continuation
status: final
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

### 3. Project reconciliation 显式区分 content 与 identity

扩展 `ProjectReconciliation` 为可穷尽分类，保留 `changed` 供展示，同时新增等价字段：

```ts
changeClass: 'same' | 'content' | 'identity';
requiresReconciliation: boolean;
```

分类规则：

- `same`：稳定摘要与逐仓字段均相同。
- `content`：只变化 `head`、`worktree` 或 captured content facts；`requiresReconciliation=false`。
- `identity`：repository add/remove、project/root identity、path、remote identity、branch、拓扑或无法安全分类的 diagnostics 变化；`requiresReconciliation=true`。

内容变化仍完整报告 `changedRepositories`，不被静默忽略。区别只在于通用 Runtime 不再把它提升为全局阻塞；Open planning、Design snapshot、Build Binding/Plan Evidence、Verify Evidence 与 Archive closure 各自重新观察其依赖摘要，并按现有精确失效规则决定保留或返工。

这比“判断提交是不是 Agent 自己产生的”更稳健：Git commit author、进程或机器身份不能证明语义所有权；真正安全的边界是当前 gate 能否重新验证其依赖。内容变化无论来自当前 Agent、同事还是 CI，都必须走相同的依赖重验；只有 repository identity/ownership 变化需要全局停止。

### 4. Resume 恢复状态，不夺取 phase authority

`run resume` 继续完成 Journal recovery、composition/Skill/Specification compatibility 检查并重新探测 Project snapshot，但行为调整为：

- identity drift：记录 `recovery.reconciled`，设置 `reconciliationRequired`，返回 `reconcile/project-drift`。
- content drift：记录 `run.resumed` 和 `changeClass=content`，不设置全局 blocker，保留 Work execution 的 `reobserve|execute|wait` continuation，并返回 `run next` 等合法下一步。
- same：保持现有幂等 resume。

resume 本身不调用 `advanceOpenGate`。这样中断恢复与业务推进职责仍分离；Runner恢复后显式 pull，Runtime 再执行当前阶段 gate。

### 5. 遥测只增加有界分类，不导出仓库内容

复用现有 `run.resumed`、`recovery.reconciled`、`continuation.selected` 与 specification observation 事实，增加低基数 `project_change_class=none|content|identity`（具体公共命名以 telemetry catalog 为准）和 Open observation stage `provider-validation|planning-gate`。Metric label 不包含 branch、path、remote、OID、digest、错误正文或 changeId；精确 identity 只留在允许的 Event/Trace 关联中。

同一逻辑 reobserve 不增加 Host invocation、Skill consumed 或 workflow failure 计数。Provider unavailable 与恢复可由相同 run/work/attempt/checkEpoch 关联，Dashboard 能区分第一层 validation 与第二层 planning gate。

### 6. 验证覆盖旧测试遗漏的真实顺序

测试采用三层：

- 领域：Project reconciliation 分类表；Open resolver 对所有 execution status 穷尽。
- Service/Coordinator：先让 strict validation 与 `markValidated` 成功，再让 `project.changeBranch` 或 `specificationPlanning.assess` 失败；第二次 pull 恢复并进入 waiting。
- 生产边界：Windows CLI + production composition + 临时 Git remote/可控 adapter，完成一次真实 Open Host Outcome并提交 artifacts，注入一次 target branch observation timeout，执行 `run resume` 和 `run next`，证明内容变化不全局阻断且 Host 未重放。

回归必须同时证明真实 branch/remote/topology drift仍被阻断，避免用放宽 resume 掩盖身份冲突。

## Risks / Trade-offs

- [Risk] 把意外外部提交归为 content 后继续运行可能使用过期决定 → 不自动接受内容变化；每个 phase authority 必须重新验证自身依赖，测试覆盖 Open planning、Build binding/Evidence 与 Verify freshness 的既有门禁。
- [Risk] `ProjectReconciliation` 类型变化影响 CLI、telemetry 与测试 → 预发布阶段一次性迁移所有调用点，不保留双布尔兼容层；用编译器穷尽检查防止调用方继续只读 `changed` 作阻塞判断。
- [Risk] 重复 planning observation 可能创建多张审批卡 → 复用既有 deterministic request/proposal identity 与 Store CAS，增加并发重复 pull 测试。
- [Risk] observation 事件重试造成指标膨胀 → 以相同 run/work/attempt/checkEpoch/stage/result 派生稳定事件身份，逻辑计数按 receipt 去重。
- [Trade-off] 不迁移当前卡住 Run → 该 Run 保留最真实的回归证据；修复后用新 Change identity 验收，避免手改 Store掩盖问题。

## Migration Plan

Repoctopus 尚未正式发布，本次采用破坏性修正，不支持旧 `ProjectReconciliation` 消费方或卡住 Run migration：

1. 一次性迁移类型、Coordinator、Service、CLI、telemetry 与全部测试调用点。
2. 用当前验收 Run 的事件序列建立回归 fixture，但不复制或改写其 Store。
3. 合入后重新创建全新模拟多仓 Change，至少跑通 Open → Human Decision → Design，并继续后续小任务验收。
4. 若任何实现必须把 `validated` 回退为 `outcome`、重放 Host、通过错误文本分类、忽略真实 identity drift或修改旧 Store，停止 Build并返回 Design 评审。
