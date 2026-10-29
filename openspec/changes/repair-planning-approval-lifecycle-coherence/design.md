# Design

## Context

Repoctopus 已有正确的五阶段领域转换，也能在 Build/Verify 发现 `planning-semantic-drift` 后回到 Design；缺口在组合边界：

- `SpecificationPlanning.assess()` 同时观察 Provider 并写 approval Store。`WorkflowRuns.next()` 在 Build/Verify 也先调用它，可能先使 approval 失效，再在另一次 Run CAS 中修改 lifecycle。
- Archive preflight 直接读取 approval Store；发现失效只抛错，不提交 lifecycle observation。
- `WorkflowRunCoordinator.acceptChangeObservation()` 只替换 `changeLifecycle`，不会在 current Work/epoch 变化时同时退役 `state.workExecution`。
- `WorkExecutionAuthority.recovery()` 优先读取任何现存 `workExecution`，没有先证明它仍匹配 lifecycle current Work。

因此 approval Store、lifecycle 和 execution projection 会短暂或永久表达不同的“当前状态”。把三个存储放进一个物理事务既不符合 Provider 可替换边界，也无法覆盖进程在外部观察后崩溃的情况。

## Goals / Non-Goals

**Goals:**

- Change Run 始终是 phase、current Work、checkEpoch 与 continuation 的唯一权威。
- later phase 的规划检查只读，不在 lifecycle transition 之前刷新 approval Store。
- phase 回退、替代 Work 与当前 execution 退役在同一次 Run CAS 中完成。
- Archive 在任何规格关闭或发布副作用前幂等收敛到 Design。
- status 保持只读，冷启动和重复 pull 得到同一 checkpoint。

**Non-Goals:**

- 跨 RunStore 与任意 Specification Provider Store 建立分布式事务。
- 自动批准更新后的规格或复用旧 approval hash。
- 从 Git、目录或 Dashboard 投影反推 phase。

## Decisions

### 1. Later phase 使用只读 Planning Authority Observation

新增内部观察结果，组合：

- Provider `planningManifest.semanticDigest`；
- strict validation 状态与 evidence digests；
- 当前 Design approval 的 decision/proposal/snapshot 身份；
- lifecycle 已批准的 `planningDigest`。

Build、Verify 和 Archive 不再通过 `SpecificationPlanning.assess()` 刷新 proposal。它们先只读比较 Provider 语义与 lifecycle planning digest；Archive 还必须证明当前 approval 仍是有效 trusted decision。只有回到 Design 后，正式 Design gate 才调用 `assess()` 创建或刷新批准请求。

这避免“先改 approval Store、后改 Run”的人为撕裂。若进程在只读观察后退出，任何权威状态都未改变；若在 Run CAS 后退出，Run 已经包含完整 Design continuation。

### 2. 一个 observation 携带替代 Design Work

`planning-semantic-drift` 扩展为必须携带 Runtime 创建的 `specification.plan` Work。领域转换验证 Work 的 phase、kind、definition、输入身份和新 epoch，并在一次 transition 中：

- phase 设为 Design；
- current Work 设为新的 `specification.plan`；
- 清除 wait/blocker、Tasks、Build Protocol、planning digest、Verification Input/Invalidation、Archive input 和未完成 Closure；
- 记录 superseded planning/work/task evidence。

不再先产生 `design/currentWork=null`，再依赖下一次 pull 补 Work。Comet 0.5.1 的 revision-bound command + same-CAS next Action 是这一决定的上游参考。

### 3. Run CAS 同时退役不匹配的 execution checkpoint

`WorkflowRunCoordinator.acceptChangeObservation()` 在领域 transition 产出新 lifecycle 后比较旧 `workExecution`：

- 若新 current Work 的 `workId` 和 `checkEpoch` 都与 checkpoint 相同，则保留；
- 否则从当前 Run state 移除 `workExecution`，并在 transition trajectory 中记录 superseded execution identity；
- 历史 claim、submission、Outcome、Receipt 和 Validator 事件不删除，仍可审计。

该规则适用于所有 lifecycle transitions，而不是只修 planning drift。它消除了“phase 已变、旧 checkpoint 仍当前”的结构性可能，也让新 Work claim 不需要依靠“旧 epoch 更小”来覆盖陈旧投影。

### 4. Recovery 对遗留撕裂 fail closed 并投影当前 lifecycle

为尚未经过新 CAS 规则的持久状态保留读取防线：`recovery()` 首先证明 checkpoint 与 lifecycle current Work/epoch 完全匹配。若不匹配：

- 有 current Work 时返回该 Work 的 `execute/work-unclaimed`；
- 无 current Work时返回 `wait/transition-pending`；
- 记录低基数 `checkpoint-superseded` 诊断，但不得加载旧 intent 或返回旧 validator-pending。

下一次实际 lifecycle transition 会原子清理旧 checkpoint；status 查询本身不写 Store。

### 5. Archive preflight 返回显式恢复结果

`prepareArchiveDelivery()` 在 Evidence 检查之后、创建 Archive Work 之前执行 Planning Authority Observation。若 planning digest、strict validation 或 approval authority 不再有效：

1. 创建新的 Design Work；
2. 提交 planning invalidation observation；
3. 返回 `planning-revision-required` 与新的 Run projection；
4. 不创建 Closure candidate、不调用 Git push/MR，也不修改业务仓。

已经存在 Archive side effect 的恢复继续使用现有窄范围 Journal 和 `archive-planning-drift` 边界，本 Change 不扩大远端补偿协议。

### 6. Telemetry 记录事实而不是错误文本

trajectory/OTLP 记录：失效来源 `semantic | approval-authority`、from/to phase、旧/新 work kind、旧/新 checkEpoch、是否退役 execution。run/work identity 只用于 trace correlation；reason 文本、digest 和绝对路径不进入 Metric label。Dashboard 从同一 Run trajectory 展示恢复，不独立推断。

## 模块边界

- `domains/change-lifecycle`: planning invalidation observation 与纯 transition 不变量。
- `domains/runtime`: lifecycle 与 current execution 的原子 Run state 投影。
- `domains/work-execution`: recovery reason 与 current-checkpoint 判定。
- `services/workflow-runs`: 只读 Planning Authority Observation、Design Work 物化和受保护命令编排。
- `services/work-execution-authority`: legacy read defense 与 continuation 投影。
- `platform/telemetry`: 消费 trajectory 事实，不解析异常消息。

## 验证

- 先增加失败回归，分别复现 Archive approval/lifecycle 撕裂和 Design/old Build continuation 撕裂。
- 领域测试证明 drift transition 一次得到 Design + Work + 新 epoch，并清除所有下游输入。
- Coordinator 测试证明 transition 与 execution 退役同一 CAS，trajectory 保留旧事实。
- Service/E2E 测试证明 Archive 在副作用前返回 `planning-revision-required`，重复 pull 幂等，重新批准后可继续。
- 冷启动测试证明旧 torn checkpoint 不会投影成当前 continuation。
- OTLP 契约、严格 OpenSpec、typecheck、lint、相关 Vitest 与完整 `npm run verify` 全部通过。

## 回退

本 Change 不引入持久 schema generation。若回退代码，旧实现可能再次把历史 `workExecution` 当作当前 checkpoint，因此不支持向旧行为兼容回退；应保留新代码或从 trajectory 重新投影当前 Run。
