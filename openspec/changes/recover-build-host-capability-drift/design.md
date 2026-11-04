---
comet_change: recover-build-host-capability-drift
role: technical-design
canonical_spec: openspec
status: draft
---

# Design

## Bottom Line

Repoctopus 必须使用一套能力权威：Work 描述所声明的 required capabilities。`ExecutionBinding` 不再把 Configure invocation 的完整 capability digest 当作所有后续 Work 的身份。Runtime 在 claim 前验证当前 Work，在 Outcome 时验证原 claim，在外部结果未知时恢复原 claim；只有 Workspace、Host coordination identity 或 repository binding 真正变化时才重建 Binding。

## Context

当前实现同时维护三种能力判断：

1. `createExecutionBinding()` 要求 Configure Host 同时具备 execution mode、`process.execute`、`repository.read`、`repository.write` 和 `specification.read`；
2. `claimExternal()` 只验证本次 Host 声明覆盖当前 Work capabilities；
3. Plan、Execute 和 Check 在处理已提交 Outcome 时，用本次 invocation capabilities 重建 Execution Binding并比较 Configure 时的 capability digest。

`stabilize-external-host-capabilities` 正确修复了第 2 条，但没有更新第 1、3 条。结果是 Plan claim 可以合法建立，Plan submission 也可以持久化；`executionBindingDrift()` 随后把只读 Plan invocation 传给要求完整 Build 能力的 `createExecutionBinding()`，在它返回 `capability` 分类之前先抛异常。

`repair-build-plan-validation-retry` 无法覆盖该路径。它只在 Work result validator 判断 candidate 可纠正时记录 rejected submission；当前异常发生在 validator 之前。`separate-build-strategy-and-execution-binding` 的自动 revalidation 也无法覆盖，因为 classifier 本身依赖会抛异常的 Binding constructor。

## Comet Boundary

固定 Comet 0.5.1 不持久化一份跨 Action 的完整 executor capability digest：

- 每个 Runtime Action 声明 `requiredCapabilities`；
- claim 先计算候选状态并执行 capability/executor preflight，成功后才写入 Run；
- claim 保存 executor、session 和 token，Outcome 以 Action、attempt、input hash 和 token 返回；
- executor 抛错或返回结果未知时，Runtime 保留原 Action ownership并要求 reconcile；
- 后续 Action 重新执行自己的 capability preflight，不用前一 Action 的能力集合判定漂移。

Repoctopus 需要额外保留多仓 `ExecutionBinding`，但该差异不要求把 capability snapshot 放进 Binding 语义。Binding 负责“在哪里、以哪个协调身份工作”，Work 负责“当前动作需要什么能力”。

## Goals

1. 让 claim、Host invocation、Outcome acceptance 和 recovery 使用同一个 Work capability contract。
2. 保留 Build Strategy 与多仓 Execution Binding，但删除跨 Work 的全局 capability identity。
3. 保留 claim、packet、invocation、submission 和未知执行事实，不用 Configure 回退掩盖合法 claim。
4. 用真实外部 Host 纵向测试证明 Configure、Plan、Execute 和 Check 的入口对称。
5. 在预发布阶段破坏性切换错误 schema，不留下双读、兼容 adapter 或隐式 fallback。

## Non-Goals

- 不改变 Build Strategy 的 execution/TDD/review/isolation 语义。
- 不允许能力不足的 Host 领取 Work或执行工具副作用。
- 不让 Plan Host 静默更新 Workspace Binding或协调 Host identity。
- 不保证任意时刻都存在能够领取下一 Work 的 Host；无兼容 Host 是合法 blocked 状态。
- 不在本 Change 中实现 Host 调度市场或后台 daemon。

## Decisions

### 1. Work capability contract 是唯一能力权威

每个不可变 `WorkDescriptor` 继续声明完整的 `capabilities`。Runtime 必须在创建 authoritative claim 前比较 Host 明确声明的能力与当前 Work requirements：

- 完整覆盖：持久化 claim、packet 和 invocation；
- 缺失能力：不持久化 claim或 invocation，返回 `executor-required`/`capability-required` continuation；
- 重复请求：对同一 current Work 和同一 claim identity 幂等；
- 调用方不得通过省略 `hostCapabilities` 让 Runtime从 Work requirements 推断 Host 实际能力。

Configure、Plan、Execute 和 Check 使用同一个 preflight helper。任何入口绕过该 helper 都是架构测试失败。

### 2. ExecutionBinding 不拥有 capability snapshot

`ExecutionBinding` 的下一 schema 保存：

```ts
interface ExecutionBinding {
  schemaVersion: 3;
  bindingId: string;
  revision: number;
  strategyDigest: string;
  coordinatorHostId: string;
  repositories: ExecutionBindingRepository[];
  semanticDigest: string;
  stateDigest: string;
  localOverlayRef: string;
}
```

`semanticDigest` 和 `stateDigest` 不包含 invocation capability list或其 digest。Configure 可以记录一次有界的 capability preflight Evidence，用于证明 Configure Work 本身合法，但该 Evidence 不是 Binding identity，也不能使未来 Work claim 自动合法或失效。

`coordinatorHostId` 只在当前 execution mode 需要同一协调 Host 持续拥有 Build 时约束 Host identity。若未来支持 Action 级不同 executor，必须通过独立 Change 修改 coordination policy，不能把 capability digest重新塞回 Binding。

### 3. Configure 只绑定当前可验证事实

`build.configure` Work 声明它真正需要的能力：读取 Strategy、Specification和 Workspace facts，并具备对应 execution mode 的协调能力。它不再因为未来 Execute 可能写仓库而要求当前 Configure claim 声明 `repository.write` 或 `process.execute`。

Configure Validator 验证：

1. Strategy digest 与当前 Design approval；
2. coordinator Host identity；
3. repository topology、branch/worktree ownership、isolation和本地 overlay；
4. 当前 Configure Work capability preflight；
5. 当前 composition compatibility。

未来 Execute/Check 的能力由各自 Work 在 claim 时验证。Configure 不预测 Host availability，也不产生虚假的长期能力保证。

### 4. Outcome acceptance 只验证原 claim identity

Plan、Execute 和 Check submission 必须匹配原始 `runId + workId + attempt + checkEpoch + claimToken + packetDigest + invocationId + submissionId`。Runtime 不再用 invocation capability list重建 Binding，也不比较 Configure invocation capability digest。

合法的只读 Plan submission直接进入 Plan candidate validator。它不会返回 Configure，也不会生成新的 Plan Work。Execute 或 Check submission同样按自己的 claim合同验收；若 Host在 claim 后能力发生外部变化，Runtime只能根据受保护工具失败、Host Outcome或未知执行事实处理，不能事后改写 claim历史。

### 5. Binding revalidation 只处理 Binding-owned facts

以下变化可以派发 `build.configure` revalidation：

- coordinator Host identity改变；
- repository identity、topology、branch/worktree ownership或isolation改变；
- local overlay/path binding改变；
- Strategy或composition compatibility要求重新绑定。

当前 Work capability list与Configure invocation不同，不是 Binding drift。下一 Work暂时没有兼容 Host也不是 Binding drift；Runtime保持 Work pending并返回结构化 blocked continuation。

### 6. 未知执行恢复原 Work

Host invocation已持久化但结果未知时，Runtime保留原 claim、packet和invocation：

- Host具有 reconcile能力：查询原 invocation并提交原 Outcome；
- 权威证据证明未执行：原 Work可以按受控 retry规则建立下一 attempt；
- 无法判定：保持 unknown/blocked，不派发Configure、不建立新Work、不重放副作用。

candidate校验拒绝继续使用现有correction协议：保留同一claim/attempt/invocation，使用新的submission identity提交修正版。它与unknown execution是两个不同恢复状态。

### 7. 破坏性 schema切换

本项目仍处于预发布阶段。实现删除 `ExecutionBinding.host.capabilityDigest`、`hostCapabilityDigest` Plan Evidence输入以及相应capability drift分支，不保留双写或从旧字段猜测新Binding。

检测到旧Binding schema的活动Run返回结构化 `migration_required`。round4 Run保留原Store与trajectory作为回归fixture；修复验证使用相同仓库拓扑和Change重新启动，不编辑旧Store。

### 8. 测试必须跨越所有合同边界

同一fixture必须执行以下生产序列：

1. 外部Host以Configure最小能力领取并建立Binding；
2. 相同coordinator Host ID以Plan最小只读能力领取并提交candidate；
3. Runtime接受Plan并派发Execute；
4. 缺少写能力的Host无法claim Execute，且Run保持未claim；
5. 兼容Host领取Execute并提交completion；
6. Check使用自己的最小能力完成；
7. 进程在claim、invocation、submission和unknown边界重启后仍恢复相同事实。

测试必须使用公共CLI/service协议，不能直接写Store。嵌入式Host超集能力测试保留，但不能代替外部Host最小能力矩阵。

## Module Boundaries

- `domains/change-lifecycle/build-protocol.ts`：Strategy、Binding schema和Binding-owned identity；不保存Work capability snapshot。
- `domains/change-lifecycle/build-work.ts`：每个Build Work的完整required capabilities。
- `services/work-dispatcher.ts`：唯一pre-claim capability validator。
- `services/managed-work-executor.ts`：外部Host明确能力、claim和invocation边界。
- `services/workflow-runs.ts`：Outcome validator和Binding-owned revalidation，不重新解释claim能力。
- `services/work-execution-authority.ts`：claim、submission、unknown和retry的CAS/trajectory事实。
- `platform/telemetry`：投影claim rejection、blocked、unknown/reconcile和真正Binding drift。

## Verification

- RED必须同时证明：当前代码接受Plan claim/submission，但`run next`在validator前抛出完整Binding能力异常。
- GREEN必须证明：同一Plan submission被正常验证和接受，不创建Configure Work或第二个Plan Work。
- 负例必须证明：能力不足在claim前失败，claim/invocation计数保持零；unknown外部结果不被重放。
- 入口对称测试必须覆盖Plan、Execute和Check，不允许三个分支保留独立能力顺序。
- 架构搜索必须证明生产代码不再读取`ExecutionBinding.host.capabilityDigest`或Plan Evidence的`hostCapabilityDigest`。
- 运行strict OpenSpec、类型检查、lint、相关Vitest、打包产品E2E和完整`npm run verify`。

## Rollback

若实现需要重新引入全局capability digest、让能力不足Host先claim后失败、丢失原claim/unknown事实，或通过Configure重放已提交Work，则停止合入。不得用CLI补齐虚假能力、捕获异常后忽略或Store手术作为回退。
