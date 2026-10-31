# Design

## Context

当前 Open 路径依次执行：

1. `change.intake` Host submission 被 Work execution 接受为成功 Outcome；
2. `run next` 调用 `validateOpenWork()` 重新观察 Specification Provider；
3. 四类工件、strict validation 或 lifecycle Validator 任一失败时提交 `open-gate/result=blocked`；
4. `open.invalid` 把 lifecycle 变成 `open/blocked/currentWork=null`；
5. Coordinator 因 lifecycle Work 改变而正确退役旧 execution；
6. projection 推断 `open.repair`，但 Service 没有把该动作映射成 observation、Work 或命令。

因此每个局部组件都在做看似保守的事，组合结果却永久丢失 continuation。问题不在 Dashboard，而在 Open 的执行成功、Evidence 接受和审批重验没有被建模为三个不同 checkpoint。

2026-11-01 核对固定 Comet 0.5.1：Classic SDK 的 `full.open → full.open.evidence → full.open.confirm → full.open.revalidate` 均是 Workflow 中的正式步骤。Evidence 无效时不推进；批准后的当前摘要与已批准 Evidence 不同则通过显式 transition 回到 `full.open`。Compat 恢复协议要求保留 `done` 工件、只补 `ready/blocked` 依赖，并在完整后重新经过最终 Open 审查。Repoctopus 采用这些不变量，但不用 Comet 的单仓状态文件或产品 Skill。

## Goals / Non-Goals

**Goals:**

- Open 的每个非终态结果都有真实、唯一且可调用的 continuation。
- 确定性产物错误派发新的冻结 Open Work；未知观察结果保留原 Outcome并重试观察。
- repair、旧 execution 退役和新 epoch 在同一 Run CAS 中发布。
- 人工批准只绑定被重新观察的当前摘要；批准后漂移不能直接进入 Design。
- 重启、重复 pull 和并发 Runner 保持幂等且可审计。

**Non-Goals:**

- 建立通用 Repair lifecycle 或任意 Action 重放接口。
- 把 Specification Provider Store 与 RunStore 放进一个物理事务。
- 兼容修复前已经持久化的死状态。

## Decisions

### 1. Open 使用三段式受管边界

Repoctopus 不新增公开 Evidence Work kind，而是在现有边界中明确三段事实：

- Host submission/Action Outcome：证明当前 `change.intake` invocation 已执行并产出候选；
- Provider Evidence acceptance：Runtime 重新观察四类工件、严格校验和 lifecycle Validator；
- Human Decision + post-approval revalidation：批准绑定 Evidence 摘要，进入 Design 前再次观察当前摘要。

Action Outcome 不再意味着 Open 已完成。只有后两段都成功，`open.approved` 才能转换 phase。

### 2. 确定性无效一次 CAS 返回新的 Open Work

新增领域 observation `open-repair-required`，必须携带：

- 当前 lifecycle `expectedRevision` 和 `checkEpoch`；
- 有界 `reasonCode` 与 Evidence identities；
- Runtime 按当前 definition、Project Snapshot、composition 和 Skill 组合物化的新 `change.intake` Work；
- 触发来源 `provider-artifacts | strict-validation | lifecycle-validator | approval-drift`。

领域 transition 保持 `phase=open,status=running`，递增 epoch、安装新 Work、清除 wait/blocker/open approval digest。Coordinator 复用已有通用 current execution 判定，在同一 Run CAS 中退役旧 checkpoint；历史 submission、Outcome、Receipt、Validator 和诊断仍在 trajectory。调用方不得先提交 `open.invalid` 再补 Work，避免暴露 `currentWork=null` 中间态。

### 3. 未知观察结果不派发 repair Work

Provider 调用抛错、Store/CAS 失败、Skill 解析失败或没有结构化 validation/manifest 的异常属于 `observation-unavailable`。Runtime 保留当前 lifecycle Work、已接受 Host Outcome和 execution checkpoint，返回 `reconcile`/可重试诊断；下一次 `run next` 重新观察同一结果。它不得把未知结果当成文档错误、递增 epoch或重新执行 Host。

只有以下事实可分类为确定性无效：Provider 成功返回且报告工件不满足/strict invalid、规范化 manifest 确定失败、lifecycle Validator 对当前 Evidence 明确拒绝，或批准后观察到与批准摘要不同的有效/无效 planning snapshot。

### 4. 批准后必须重验，漂移回到 Open Work

当 lifecycle 正在等待 Open Human Decision，可信批准写入后，Runtime 不直接创建 Design Work。它重新观察当前 Provider snapshot：

- 摘要、Provider/schema identity 和 strict validation 与批准请求一致：允许 `open.approved`；
- 摘要变化或校验失效：旧批准保留为历史但不可推进，提交 `open-repair-required`；
- 观察结果未知：保留原 wait/decision边界并返回 reconciliation，不创建新批准请求。

这对应 Comet 的 `full.open.revalidate → full.open` 回环。新的 Open Work完成并通过 Evidence 后，Specification Planning 才为新摘要建立新的 Human Decision。

`open-repair-required` 还会持久化 `openApprovalInvalidated=true`。即使修复后工件恰好恢复成旧摘要，Planning 也必须用由 Run/revision 派生的确定性 request id 创建一次新请求；若 Approval Store 已写入而 Run CAS 尚未完成，重试复用同一请求，不能产生 request storm。新请求进入 lifecycle wait 后清除此标志。

批准后重验使用已批准 snapshot 中冻结的 `changeBranch` 作为发布身份，而不先要求当前 checkout clean；否则本地规格漂移会被错误分类成 Provider unavailable。只有重验确认摘要未变、准备真正推进 Design 时，常规 planning assessment 才重新读取 live branch facts并执行洁净度约束。

### 5. Runtime projection 只展示权威动作

`lifecycleNextActions()` 不再从 `open/blocked/currentWork=null` 推断 `open.repair`。Open 有 current Work 时展示该 Work；等待决定时展示 review；观察未知时 continuation 来自现存 execution/reconcile。没有持久化 Work、Wait 或 reconciliation 的状态不得显示可点击 repair 动作。

### 6. Telemetry 使用有界恢复事实

Trajectory/OTLP 记录：失败来源、是否为确定性无效、旧/新 Work kind、旧/新 epoch、是否退役 execution、是否发生批准后漂移和恢复结果。Trace 可关联 run/work identity；Metric labels 仅使用 phase、source、result、retired boolean 等有界枚举，不包含 digest、路径、诊断正文、changeId、runId 或个人身份。

## 模块边界

- `domains/change-lifecycle`: Open repair observation、transition 与不可变式。
- `domains/runtime`: 同 CAS lifecycle/execution replacement、权威 next-action projection。
- `services/specification-planning`: 区分有效、确定性无效与 observation unavailable，提供批准后只读重验结果。
- `services/workflow-runs`: 物化 repair Work并编排 Provider Evidence，不解释 Provider 私有结构。
- `services/work-execution-authority`: 继续负责 current checkpoint、恢复和 continuation，不新增 Open 专用 Store。
- `platform/telemetry`: 从 trajectory 事实生成标准 OTLP，不反推文件状态。
- `plugins/builtin-catalog`: 仅为本次活动 Run 登记 `lifecycle-definition-builtin` 的精确直接前驱 implementation pair，使同版本的新增 Open transition 可通过正式 composition compatibility 路径自举；不保留更早前驱或通配兼容。

## 验证

- 用本次自举故障建立红测：缺少 Task Acceptance 时 Open 不再进入无 Work blocker。
- 覆盖四类确定性拒绝、Provider 抛错、批准后有效摘要漂移、批准后 strict invalid、并发 revision 冲突和重启恢复。
- 证明 repair transition 与旧 execution 退役同一 CAS，新 Work packet 包含正确 Action Skill/augmentation 内容。
- 证明重复 `run next/resume` 不增加 Work、epoch、批准请求或 Host invocation。
- 证明新 lifecycle contributor 只接受当前活动 Run 冻结的唯一直接前驱 `{codeDigest, descriptorDigest}`，其他受保护实现仍为 `migration_required`。
- 验证 Dashboard/OTLP 只消费权威 trajectory，完整运行严格 OpenSpec、类型、Lint、架构检查和 `npm run verify`。

## 回退

本 Change 不增加持久 schema generation。回退会重新产生 `open/blocked/currentWork=null` 死状态，因此不支持兼容回退；应保留新实现或为受影响的未发布 Run给出明确重新开始提示。
