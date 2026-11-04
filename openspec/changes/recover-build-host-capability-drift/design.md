# Design

## Context

Execution Binding 冻结了 Host ID、完整 capability digest 和多仓 checkout identity。Build Plan Work 自身只需要 `build.autonomous`、`repository.read` 与 `specification.read`，因此同一 Runner 可以合法领取 Plan packet，即使本次 claim 只声明了这个窄能力集合。现有 `claimExternal()` 只核对 Host ID 与当前 Work 能力，Plan submission 得以持久化。

恢复时，`workflow-runs.ts` 的 Plan/Execute/Check 分支先调用 `assertBuildHostCapabilities()`，再调用 `executionBindingDrift()`。窄能力集合因此在漂移分类前抛错；同时 `executionBindingDrift()` 内部先构造新 Binding，而 `createExecutionBinding()` 对缺能力同样抛错。Runtime 无法到达已有的 `dispatchExecutionBindingRevalidation()`，留下不可覆盖的权威 claim/submission。

## Goals / Non-Goals

**Goals:**

- 把 capability 缺失和 capability digest 变化变成有界 `capability` drift，而不是未处理异常。
- 对 Plan、Execute、Check 使用同一先分类、后断言顺序。
- 在同一 Run 保留旧 claim、packet、invocation 和 submission，并派发唯一 Configure revalidation Work。
- 重绑定后精确失效旧 Plan/Evidence/未完成 Work，保留 Design approval、Build Strategy、OpenSpec Tasks 和审计历史。
- 证明重复 pull、进程重启和 composition 重建不会重复接受 submission 或执行副作用。

**Non-Goals:**

- 让 capability 不足的 Host 执行 repository/process 副作用。
- 把新能力集合静默写入既有 Binding。
- 通过 CLI 默认能力掩盖 Runtime 身份错误。
- 为当前预发布状态增加旧 schema 双读或长期迁移层。

## Decisions

### 1. 漂移分类必须是 total function

`executionBindingDrift()` 在构造候选 Binding 前依次比较：

1. Host ID；
2. 当前 Strategy 所需能力是否完整；
3. 完整 capability digest 是否等于冻结 Binding；
4. checkout、path/local overlay 与其余 Binding identity。

Host 能力不完整或 digest 不同都返回 `capability`，不得让 `createExecutionBinding()` 的前置条件异常逃逸。只有已证明 Host 满足 Binding 基本能力后，才构造候选 Binding 比较其余身份。

### 2. Outcome 接受边界先恢复 Binding，再验证完整 Build Host

Build Plan、Execute 和 Check 的 processing 分支统一执行：

1. 核对 Outcome 来自持久 invocation；
2. 调用 total drift classifier；
3. 若有 drift，调用既有 `dispatchExecutionBindingRevalidation()`；
4. 若无 drift，再执行 `assertBuildHostCapabilities()` 作为防御性不变量；
5. 最后才解析 candidate、接受 Outcome 或推进 package/check。

这样当前 Plan Host 可以报告一个只读 candidate，但 Runtime 不会把它绑定到已漂移的 Execution Binding。Execute/Check 仍由 Work capability preflight 阻止能力不足 Host 取得副作用权限；若历史或并发状态仍产生 Outcome，同一恢复边界继续 fail closed。

### 3. Capability drift 复用既有 Configure revalidation

不新增 repair phase、特殊 Work 或第二套恢复状态。命中后复用现有 `build.binding-revalidation-required` lifecycle observation：提升 check epoch、退役不再匹配的 current execution、保留历史事实，并创建一个 `build.configure` Work。Configure 用实际 Host 完整 capability 集合建立新 Binding；随后 Runtime 重新派发 Plan。

若新 Host 本身不满足批准 Strategy，Configure validator 保持当前 Build 并返回结构化诊断，不静默降级 execution/TDD/review/isolation。

### 4. claim 门禁只验证当前 Work，不冒充 Binding 接受

`claimExternal()` 继续要求 Host 满足当前 Work capabilities，并要求 Build 中非 Configure Work 使用同一 Host ID。它不把窄 Plan capability 集合视为新 Binding，也不在 claim 前修改 lifecycle。Binding 的接受权仍属于 Configure，capability drift 的恢复权属于 Runtime outcome/checkpoint processing。

这一区分避免两种错误：过早拒绝只读 Plan Work导致 Runtime没有可观察漂移证据；以及在 claim 时静默更新 Binding 绕过 Configure。

### 5. 回归使用真实卡死形态

测试必须构造完整生产序列：完整能力 Host 完成 Configure → 相同 Host ID 以 Plan 最小能力领取并提交 candidate → `run next`。RED 结果应是当前未处理异常；GREEN 结果必须是同一 Run 进入唯一 Configure revalidation，旧 submission 保留且没有 Plan Evidence/Execute Work。

还要覆盖：

- 相同完整 capability digest 正常接受 Plan；
- 不同 Host ID 继续 fail closed；
- capability superset、subset 和同元素不同顺序的规范化；
- Execute/Check 三个处理分支共享顺序；
- 重复 `next`、进程重启和并发 pull 的幂等；
- Configure 后新 Plan revision 使用新 Binding，旧 candidate 不被自动重放。

## Module Boundaries

- `domains/change-lifecycle/build-protocol.ts`：Strategy 所需能力与稳定 capability identity 的纯规则。
- `services/workflow-runs.ts`：收集 invocation/Binding/project facts，统一漂移优先顺序并派发 revalidation。
- `services/managed-work-executor.ts`：当前 Work claim/Host invocation 边界，不拥有 lifecycle transition。
- `domains/runtime`：current execution 退役和同一 Run CAS，不解析 CLI 参数。
- `test/**`：领域、服务和生产协议恢复矩阵。

## Verification

- 先用现有失败序列写 RED：Plan submission 后 `run next` 抛出缺少 `process.execute`、`repository.write`。
- GREEN：同一输入产生 `build.configure` revalidation，保留 claim/submission，未接受 Plan Evidence。
- 定向运行 Build protocol、managed executor、workflow runs、managed Change E2E 和 runtime invalidation 测试。
- 运行 TypeScript、Lint、生产构建、strict OpenSpec、architecture/provenance/generated 检查与完整 `npm run verify`。
- 用修复产品恢复 round4 Run；恢复成功后继续两包纵向 TDD，恢复不兼容时保留诊断并重启同场景。

## Rollback

若修复使 capability 不足 Host 获得副作用权限、丢失旧 submission、重复创建 Configure Work，或让 Host capability 变化静默覆盖 Binding，则停止合入。不得回退为捕获错误后忽略、Store 手改或 CLI 伪造完整能力。
