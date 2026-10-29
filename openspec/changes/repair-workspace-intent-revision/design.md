# Design

## Context

`ExecutionWorkspaceIntent` 在 Open 人工决策中创建，但当前 `WorkflowRuns.decideChange()` 先把 intent 写入 lifecycle，随后才记录 OpenSpec approval；它没有调用 `ExecutionWorkspaceService.bind()` 验证真实 checkout。Build Configure 首次绑定时才会发现问题，而该异常路径没有 lifecycle observation。

当前一个 Change 只有一个确定性 Run：`changeRunId({ workspaceId, changeId })`。因此“废弃旧 Run 再启动一个”既不符合身份模型，也会由 `startOrResume()` 恢复旧状态。正确修复必须留在同一 Run 的权威状态机内。

## Goals / Non-Goals

**Goals:**

- 初次 isolation 选择在任何 Open 权威写入前用真实 checkout facts 验证。
- Build Configure 对可修订 binding failure 返回 Open 人工决策，而不是永久抛错。
- isolation 修订保留同一 runId，清除所有依赖旧 intent 的下游状态，并重新经过 Design。
- current Work、checkEpoch 与 workExecution 在每次 transition 后保持一致。
- status/Dashboard 只读，重复 pull/decision 幂等且可审计。

**Non-Goals:**

- 跨过 Human Decision 自动把 `current` 改成 `worktree`。
- 把 remote identity、仓库集合或 project snapshot 漂移包装成 isolation 选择。
- 保留已批准 Build Configuration 或已发生实现/发布副作用后原地切换 isolation。

## Decisions

### 1. Execution Workspace binding 返回稳定分类

在 `services/execution-workspace` 深模块定义 `ExecutionWorkspaceBindingError`。它隐藏具体判定，并只向调用者暴露稳定的小接口：

```ts
class ExecutionWorkspaceBindingError extends Error {
  readonly code: ExecutionWorkspaceBindingErrorCode;
  readonly recovery: 'intent-revision' | 'binding-retry' | 'halt';
}
```

`code` 使用受限枚举，例如：

- `current-linked-worktree`；
- `current-checkout-mismatch`；
- `branch-mismatch`；
- `worktree-ownership-missing`；
- `remote-identity-drift`；
- `repository-topology-drift`。

恢复类别遵循“能否在保持批准 intent 的前提下修复”而不是简单按错误 code 分组：

- 注册 checkout 本身是 linked worktree但 intent 为 `current` 时，必须改变 intent，分类为 `intent-revision`；
- checkout path、branch 或 worktree ownership facts 只是 Runner binding 不正确时，分类为 `binding-retry`，保留原 intent；
- remote identity 与 repository topology 漂移分类为 `halt`。

`WorkflowRuns` 只判断 `recovery`，code 用于诊断与遥测，不维护第二份策略表。

### 2. Open decision 先验证，后写两个权威

`decideChange()` 从 Run trigger 读取冻结的 `executionCheckouts` 与 project snapshot，创建候选 intent 后先调用 `ExecutionWorkspaceService.bind()`。验证成功后才依次提交 lifecycle `open-workspace-intent-selected` 与 Specification approval decision；验证失败时两者都不变，用户可对同一 request 重试选择。

这保持现有 Open 决策界面，但消除“批准后才发现模式物理上不可用”的时间差。绝对路径仍只属于本地 binding，不进入 planning digest 或 OpenSpec 工件。

### 3. Build binding failure 使用显式 Build → Open wait

当 active Work 是未批准配置的 `build.configure`，且 binding error 的 `recovery` 为 `intent-revision` 时，Runtime 根据 `{runId, lifecycle revision, old intent digest, error code}` 生成稳定 request/proposal digest，并创建 `workspace-intent-revision-required` observation。领域 transition：

- phase 由 Build 回到 Open，status 为 waiting；
- current Work 清空并创建 `workspace-intent:*` Human Decision wait；
- 删除旧 `workspaceIntent`、Tasks、Build Protocol、planning digest、completion claim、Verification/Archive 输入与未完成 Closure；
- 保留 Change identity、Open planning artifacts 和历史 trajectory；
- 在 transition fact 记录旧 isolation、error code 与受控 evidence identity，不记录异常文本或路径。

该 transition 只允许在 Build Configure 尚未批准、没有 Build Plan/package completion/Verify/Archive 副作用时触发。

### 4. 新 intent 决策直接进入 Design Work

CLI 在 `workspace-intent:*` wait 中展示失败分类、旧 isolation 和三个模式，再要求可信用户选择。现有 `DecideChangeRunInput.isolation` 继续作为唯一输入，不建立第二套命令 DTO。Service 再次绑定验证候选 intent；成功后物化新的 `specification.plan` Work，并提交 `workspace-intent-revised` observation，在一次 transition 中：

- phase 设为 Design、status 为 running；
- 保存新 intent；
- 设置新 Design Work 与递增 checkEpoch；
- 结束 wait，Design 后续仍需普通 planning Human Decision。

拒绝决定进入 Open blocked；无效选择在任何 transition 前失败并保持原 wait，可用同一 request 重试。OpenSpec approval Store 不伪造新的规格决定，因为这里批准的是 execution intent；已批准且未变化的 Open planning digest 保留，重新进入 Design 后按普通规则刷新受 branch/plan snapshot 约束的 Design gate。

### 5. Runtime CAS 维护 current execution 不变量

`WorkflowRunCoordinator.acceptChangeObservation()` 在领域 transition 产生新 lifecycle 后调用纯函数 `executionMatchesLifecycle(currentWork, checkpoint)`。`workId/checkEpoch` 完全匹配才保留，否则在同一 Run CAS 中省略 checkpoint，并在同一个 `change.lifecycle.transitioned` event 写入 `executionRetirement` fact；claim、Outcome、Receipt 等历史事件不删除。该函数属于 Runtime state 投影，不新增 Adapter seam。

这是恢复旧 Build Configure Outcome并允许新 Design Work claim 的必要条件，也是所有 lifecycle transition 都应满足的通用不变量，而不是 isolation 专用清理。

### 6. 遥测使用有界事实

trajectory/OTLP 记录 binding error code、from/to phase、旧/新 isolation、旧/新 work kind、checkEpoch 与 execution 是否退役。Metric label 只允许 phase、work kind、binding error code、isolation 与 boolean；路径、branch、digest、run/work/change identity 和错误文本只可作为受控 trace correlation 或完全省略。

## 模块边界

- `services/execution-workspace`: binding 深模块与稳定错误分类。
- `domains/change-lifecycle`: intent revision observations、wait 与纯 transition 不变量。
- `domains/runtime`: lifecycle transition 与 execution retirement 的单 CAS 投影。
- `services/workflow-runs`: Open prevalidation、Build failure 编排和 Human Decision 后的 Design Work 物化。
- `app/cli`: 只负责收集可信 isolation 决策，不选择 phase 或直接写 Store。
- `platform/telemetry`: 从 trajectory facts 映射 OTLP，不解析异常消息。

## 验证

- 领域测试证明 Build Configure 只能在无副作用边界返回 Open，并清除依赖旧 intent 的全部下游状态。
- Service 测试证明 linked worktree + current 在 Open 决策前被拒绝且 approval/lifecycle 均未写入。
- E2E 复现已有坏 Run：Build Configure Outcome → `current-linked-worktree/intent-revision` → Open wait → 选择 worktree → Design Work；runId 不变且旧 checkpoint 不再是当前状态。
- 重复 `next`、重复错误观察和无效 isolation 决策不产生第二个 wait、Work 或 retirement event。
- OTLP 契约、strict OpenSpec、typecheck、lint、architecture/provenance/generated 检查和完整 `npm run verify` 全部通过。

## 回退

本 Change 不增加持久 schema generation。回退代码会重新造成无法修订的 Run，因此不支持保留旧行为；已进入 `workspace-intent:*` wait 的 Run 必须继续使用新代码完成决策。
