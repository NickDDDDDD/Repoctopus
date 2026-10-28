# Design

## Context

参见 [proposal.md](./proposal.md) 的动机。现有 Runtime 已具备单一 Change Run、固定五阶段、不可变 Work Descriptor、Host 调用、Outcome 验证、`checkEpoch`、Trajectory 与 OTLP 投影，但 Build 仍由 `createInitialBuildWork()` 直接选择第一个就绪 OpenSpec Task，并固定生成 `task.implement + tdd`。这个模型缺少配置、计划、计划证据和汇总检查，导致三个结构性问题：

1. Task 同时承担规格任务、执行计划和调度单元，跨仓或需协调 Agent 的实现无法表达。
2. Skill 组合只能按 phase 静态决定，无法在不放弃 Runtime 权威的前提下表达 autonomous、subagent 和 TDD 方法差异。
3. Verify 缺陷被建模为 Task reopen 或特殊 Repair Work，形成与正常 Build 不同的第二条生命周期。

约束如下：

- OpenSpec 的 Proposal、Delta Specs、Design、Tasks 仍是唯一规格规划权威；BuildPlan 只能是 Runtime 执行状态。
- Engine/Domain 必须保持纯 TypeScript 领域逻辑，不依赖 Cordis、文件系统、Git、IDE、代码托管平台或 OTLP SDK。
- Cordis Service 负责组合与用例编排；平台适配器负责持久化、进程、Git 与遥测 I/O。
- 一个 Run 同时只推进一个权威 Action/Work claim。本版本允许协调 Host 在一个 Work Package 内委派多个受管子调用，但不引入多个并发 `currentWork`。
- 当前 `ProjectSnapshot` 同时包含稳定 repository identity 与本机 checkout 路径，不能直接表达同一仓库在 branch/worktree isolation 下的另一个执行 checkout；必须把稳定拓扑与本地执行 binding 分开。
- 固定 Matt 快照没有 `subagent-driven-development` Skill；Comet Classic 使用的是 Superpowers Skill 再叠加 Comet 协议。Repoctopus 本次不引入 Superpowers，执行策略必须由自己的 action contract 表达。
- 旧预发布 Run 不迁移、不继续执行，只能以 legacy audit 读取。

## Goals / Non-Goals

**Goals:**

- 把 Build 建模为可恢复的 Configure、Plan、Plan Evidence、Execute、Check 协议，同时不增加 lifecycle phase。
- 让 Runtime 选择 Action、固定配置、生成 Work，Host 只执行当前包并报告 Outcome。
- 支持 autonomous 与 subagent-driven-development 两种执行方法，保持相同的验证、证据和遥测合同。
- 让 Open 的 isolation 决定与 Build 使用的多仓 checkout binding 可验证关联，不用当前进程目录猜测。
- 将 Verify 返工统一为 BuildPlan revision 与普通 Execute/Check。
- 让本地 Dashboard 与远端 SigNoz 能从相同 OTLP 事实还原五阶段、Build Action、Skill 与返工链路。

**Non-Goals:**

- Hotfix、Tweak 或其他 workflow profile。
- Full Direct、Executing Plans、运行中切换 execution mode。
- 多个 Build Work 的并行 claim、跨 Runner 分布式调度。
- 自动创建、切换或清理 Git branch/worktree；本版由 Runner/Host 准备 checkout，Runtime 负责验证、绑定和拒绝漂移。
- 引入 Superpowers、复制 Comet Skill，或把不存在的 Skill 归属给 Matt Provider。
- 可配置 Review 强度；本版本固定 standard。
- 旧 Run 的数据迁移或双协议兼容层。

## Decisions

### 1. Build 是 phase 内部的显式协议，不是新的生命周期阶段

`ChangePhase` 保持 `open|design|build|verify|archive`。在 `build` snapshot 下新增 `BuildOrchestrationState`，记录当前 `BuildActionKind`：

```ts
type BuildActionKind =
  | 'build.configure'
  | 'build.plan'
  | 'build.plan-evidence'
  | 'build.execute'
  | 'build.check';
```

Runtime 把每个 Build step 表达为 Host Work、Evidence、Human Decision 或 Adapter check 中的一种：Configure proposal、Plan authoring、Execute 与 Check 的语义审查部分通过现有 intent → claim → packet → Host → Outcome → Validator → completion claim 链；Plan Evidence 和确定性检查由 Runtime Validator/Adapter 产生；人工决定形成可恢复 Wait。Runtime 只根据已接受事实选择下一 step；`auto_transition` 只决定是否立即物化下一 step，不改变合法性。

选择该方案是因为它保留五阶段对人和 Dashboard 的稳定心智模型，又让 Build 内部过程具备与 phase 相同的恢复和审计能力。替代方案是新增 Configure/Plan/Check phase；这会破坏已确认的五阶段、扩大回退矩阵并让团队视图失焦，因此拒绝。

### 2. Build Configuration 是人工批准后冻结的 Runtime 决定

领域层新增版本化配置：

```ts
interface BuildConfiguration {
  schemaVersion: 1;
  configurationId: string;
  revision: number;
  executionMode: 'autonomous' | 'subagent-driven-development';
  tddMode: 'tdd' | 'direct';
  reviewMode: 'standard';
  isolation: 'current' | 'branch' | 'worktree';
  requestedIsolationDigest: Sha256;
  planningDigest: Sha256;
  topologyDigest: Sha256;
  capabilityDigest: Sha256;
  semanticDigest: Sha256;
}
```

Open 在四类工件批准前记录 `ExecutionWorkspaceIntent`，至少包含 isolation、Workspace/change identity 与各仓目标分支语义。它属于 Run 决定而不是 OpenSpec 第五工件。Build Configure 通过本地 `ExecutionWorkspaceBinding` 复核实际 checkout、仓库拓扑与 Host 能力，再提出完整配置：

```ts
interface ExecutionRepositoryBinding {
  repositoryId: string;
  checkoutPath: string;
  branch: string;
  head: string;
  worktreeIdentity: string;
}

interface ExecutionWorkspaceBinding {
  schemaVersion: 1;
  isolation: 'current' | 'branch' | 'worktree';
  repositories: readonly ExecutionRepositoryBinding[];
  localDigest: Sha256;
  semanticDigest: Sha256;
}
```

`checkoutPath` 只存在本地 Run overlay 与平台 adapter，进入 Work input 的 `localDigest` 用于检测路径/checkout 漂移；Open approval、可移植配置和 OTLP 只使用不含绝对路径的 `semanticDigest`。`ProjectSnapshot` 保留 Run 启动时的稳定 topology baseline，Work guard 通过 binding resolver 把 repositoryId/write scope 解析到已验证 checkout，而不是改写 topology 或依赖 nearest root。

本版本不让 Runtime 创建或切换 branch/worktree。Runner/Host 可以使用 Codex worktree、Git 工具或其他平台能力准备 checkout；Runtime 只接受真实 Git facts。这样先建立一个小而深的验证 interface，避免把 IDE/平台特定生命周期塞进 Engine。以后若需要自动准备，可增加第二个真实 adapter 而不改变领域合同。

可信用户批准 Build Configuration 后绑定 `semanticDigest`。批准前可以拒绝并重新提案；批准后本 Run 不支持模式切换。能力或 binding 在恢复时漂移，Runtime 进入 blocked 或 `migration_required`，不静默降级。改变 isolation 模式需要回到 Open；同一模式下修复本地 checkout 可重新 Configure。

这里采用显式批准而不是从任务复杂度自动选择，因为 execution mode 和 isolation 会改变执行主体与副作用边界。Review 固定 standard，不保存一个实际上不可选择的自由配置；字段仍显式存在，便于合同和遥测稳定。

### 3. BuildPlan 是 Tasks 的受管执行投影

领域层新增 `BuildPlanCandidate`、`BuildPlan` 和 `WorkPackage`。Runtime 不替 Agent 编写计划：`build.plan` Work 向 Host 交付批准 Tasks、配置、拓扑、binding 和 action Skill，Host 返回有界结构化 candidate；Runtime 负责规范化、分配 plan identity/revision、验证并接受。这样“Runtime BuildPlan”表示由 Runtime 管理和验证，而不是确定性算法机械拆 Task。

```ts
interface BuildPlanCandidate {
  packages: readonly WorkPackageCandidate[];
}

interface BuildPlan {
  schemaVersion: 1;
  planId: string;
  revision: number;
  configurationDigest: Sha256;
  planningDigest: Sha256;
  taskSetDigest: Sha256;
  packages: readonly WorkPackage[];
  semanticDigest: Sha256;
}

interface WorkPackage {
  packageId: string;
  taskRefs: readonly TaskRef[];
  repositoryIds: readonly string[];
  dependsOn: readonly string[];
  writeScopes: readonly WriteScope[];
  acceptanceRefs: readonly string[];
  expectedOutcomes: readonly string[];
  validatorProfile: ValidatorProfileSnapshot;
}
```

`WorkExecutionHostOutcome` 增加由当前 Work output contract 约束的 discriminated result；Plan Work 只接受 `kind=build-plan-candidate`，其他 Work 不能提交该结果。Plan 作为有上限的规范化对象直接保存在 RunStore 的版本化 Build state；Trajectory 只记录 plan identity、revision、digest 和变更分类，不复制正文。第一版限制 package、dependency、Task reference、scope 和文本字段数量/长度，超过上限时在 Plan Validator 阻断。现有 Run 已直接保存完整 TaskSet，因此不为这一份同量级执行投影新增 ArtifactStore seam。

Plan 不写入 `openspec/changes/<change>`，不包含 checkbox。一个 Task 可以映射多个包，一个包也可引用多个强耦合 Task；Task 首次完成时，只有全部 required package completion 和 acceptance Evidence 有效，才通过 Specification Provider 的既有接口更新 checkbox。Task completion claim 此后保持单调：Verify 返工不会取消历史 checkbox，而是使当前 Plan revision 的 package/Check Evidence 失效并创建引用同一 Task 的后续包。当前实现是否可进入 Verify由最新 Plan/Check Evidence 决定，不能仅凭 `[x]`。

Plan revision 只允许改变执行分组、依赖、仓库绑定、write scope、Validator 与执行顺序。若需要改变 Task 的范围、依赖、验收或 requirement mapping，Plan Validator 返回 Design，而不是在 Build 中掩盖规格漂移。

替代方案是让 `tasks.md` 同时表达执行包。它会把运行时拓扑、隔离与 Host 能力写进团队规格，且每次返工都造成规划语义漂移，因此拒绝。

### 4. Plan Evidence 是执行前的独立验证边界

Plan Outcome Validator 先验证 candidate schema、Task references 和边界，接受后才形成 BuildPlan revision。随后独立 Plan Evidence Validator 对以下输入生成 `PlanEvidence`：配置摘要、TaskSet 摘要、仓库拓扑、依赖无环性、write scope、Host capabilities、isolation binding、Skill identities 和 acceptance coverage。Evidence 使用与其他验证事实相同的 input digest、Validator profile 和失效规则；Agent 自评“计划可行”不能替代它。

风险策略是 definition 中的有界规则，不由 Agent 自由文本决定。低风险且完整的计划自动接受；命中高风险副作用、跨仓不可逆顺序等规则时建立 Human Decision。该暂停是 Action 结果，不是新的 phase。

### 5. Work Descriptor 从当前 Plan revision 派生

现有 `task.implement` 被新的 Action Work kinds 替代。Configure、Plan、Plan Evidence、Execute、Check 都在 lifecycle definition 中拥有独立 action Skill、capability、side-effect class、output contract 和 Validator。Execute Work 额外绑定 `configurationDigest`、`planId/revision`、`packageId` 与多个 `taskRefs`。

`materializeLifecycleWorkBinding()` 继续负责 definition 层不可变字段；新的 Build materializer 负责把当前配置与计划事实加入 input digest。任何配置、Plan revision、TaskSet、仓库 snapshot、Skill snapshot 或 isolation binding 变化都会使旧 claim 失效。

选择扩展现有 Work Descriptor，而不是新建另一套 Build executor，可复用已经验证的 Host、claim、恢复、Outcome 和受保护工具边界。

### 6. 两种 execution mode 共享同一 Runtime 合同

两种模式共享同一个 Repoctopus-owned `repoctopus-build-execute` action Skill，只改变冻结 action input 与 Host requirement；不会解析名为 `subagent-driven-development` 的外部 augmentation：

- `autonomous`：选择具有 `work.execute.autonomous` capability 的 Host；Host 在当前 Work Package 内自主安排实现，但不能领取其他包、修改 Plan 或推进 Action。
- `subagent-driven-development`：选择具有 `work.coordinate.subagents` 和 `subagent.dispatch.attested` capability 的协调 Host。Repoctopus action 内容定义协调协议；协调 Host可以在当前包内委派实现/检查调用，但必须返回结构化 delegation receipts，绑定子 execution identity、角色、包、write scope、Outcome 和父 invocation。

Runtime 仍只有一个当前 Work claim。子调用不是新的 Change Run，也不获得 phase/Action 决策权。平台或 Host 实现负责实际启动子 Agent；领域层只验证由已选择 Host attested、绑定父 invocation 的 receipts 和 Outcome。自由文本 Agent 名称、同一 execution 自报不同角色或缺少 Host capability 均不构成独立身份。

本版本不实现 autonomous 与 subagent 的运行中升级。Comet 的成熟点在于 Runtime-authoritative Action 和 Host-mediated execution，而不是要求 Repoctopus 依赖其 SDK 或复制全部策略矩阵；因此这里只借鉴行为边界。

### 7. TDD、Review 与 Isolation 分别属于方法、检查和副作用边界

- `tddMode=tdd`：Execute Work 装填 `tdd`，Validator 要求可追溯 RED/GREEN/回归 Evidence。
- `tddMode=direct`：不装填 `tdd`，但 action contract 仍要求相关测试、缺陷回归和可验证结果。
- `reviewMode=standard`：Build Check 固定装填 `code-review` 并要求独立 reviewer execution；review execution identity 不得等于被审查 package 的 implementation execution identity。Verify 继续执行 Change 级规格核对与终局 review，二者范围不同。无法提供独立 identity 时 blocked，不降级为自评。
- `isolation`：Open 捕获意图，Configure 验证实际 binding，后续 Work 的 repository/write scope 都绑定该 digest。

`codebase-design` 只属于 Design。若 Build 发现设计假设错误，Runtime 返回 Design；不会在 Build 临时装填该 Skill 并修改设计。

### 8. Verify 失败修订计划，不重开 Task

Verify finding 必须包含有界 classification 与 requirement/Task/package references。Runtime 追加失败 Evidence、递增 `checkEpoch`、使受影响的 Plan Evidence、package completion 和 Check Evidence 失效，然后回到 `build.plan` 创建新 revision。OpenSpec Task checkbox 是历史 completion claim，保持单调；新计划可为已勾选 Task 创建后续 package，直到当前 Check 重新证明有效。仍满足当前输入的 package completion 与 Work Evidence 保留。

如果 finding 改变规划语义，则沿现有 fallback 返回 Design。如果无法证明最小范围，Runtime 建立 Human Decision 或使用 definition 的保守失效集合。系统不再创建 `implementation.repair`、`verify.repair`、Repair lifecycle 或自动 Task reopen。

该设计让首次开发与返工走同一条协议，减少专用状态和恢复分支。代价是每次返工都要重新经过 Plan Evidence 与 Build Check；这是为了保持可证明性而接受的开销。

### 9. Run 状态采用版本化快照与追加事实

`ChangeLifecycleSnapshot` 和相关事件 schema 升级一个预发布主版本，并在 Build phase 下加入：

- Open 已批准的 `ExecutionWorkspaceIntent` 与本地 `ExecutionWorkspaceBinding`；
- 已批准 Configuration 或待决 proposal/decision；
- 全部有界 Plan revision 与当前 revision；
- 当前 Build Action、attempt 与 Plan Evidence；
- package completion、Task completion projection 与 Check Evidence；
- invalidation/finding references。

Evidence 大型正文继续使用既有内容寻址 artifact reference；BuildPlan 本身有界并随快照保存，事件只保存 identity/digest。所有状态修改经过 RunStore CAS；崩溃后从已提交 checkpoint 恢复，未知 Host/子调用先 reconcile。旧 schema 只进入现有 legacy audit，不加入生产 reducer 的兼容分支。

### 10. 模块边界按领域、服务和适配器分离

- `domains/change-lifecycle`：以小接口的 Build protocol reducer 隐藏 Configuration、Plan、step transition、invalidation 与恢复规则，并提供 plan/check validators 和 Work materializer；纯函数、无 I/O。`WorkflowRuns` 不得再次手写一套 Build switch。
- `domains/work-execution`：扩展 packet/outcome/delegation receipt 的稳定合同，不决定 lifecycle。
- `services/workflow-runs`：读取 Specification/Topology/Capabilities，调用领域 reducer，持久化 CAS 和建立 Human Decision。
- `services/managed-work-executor`：选择兼容 Host、交付完整 Skill 内容、记录父子调用并接受 Outcome；不选择下一 Action。
- `services/execution-workspace`：验证 Runner/Host 提供的 isolation binding，并向 Work guard 提供 repositoryId 到本地 checkout 的唯一解析；不创建或切换 Git 工作区。
- `plugins/lifecycle` 与 `plugins/skill`：贡献固定 definition、Validator 和 action/augmentation Skill；不得直接改 Run。
- `platform/git`：读取 checkout、branch、head、worktree ownership facts，作为 execution-workspace 的本地 adapter。
- `platform/runtime`：持久化新 schema、本地 binding overlay、锁、恢复和 legacy audit。
- `platform/telemetry`：从已提交 Trajectory 映射 OTLP，不读取目录推断 Action。
- CLI/Desktop：只消费统一 Run/OTLP projection，不写回推断状态。

### 11. 遥测以同一事实支持实时状态与流程改进

Trajectory 为 Configure、Plan、Plan Evidence、Execute、Check、configuration approval、plan revision、delegation、Skill delivery/consumption、Validator 和 invalidation 建立独立事件。OTLP Trace 使用父子 Span 表达 Run → phase → Build Action → Work/Host → tool/validator；Event 保存稳定 identity 与摘要；Metric 只使用 phase、Action kind、mode、TDD、review、isolation、result、finding classification 等有界枚举。

runId、Task ID、package ID、repository ID 和 digest 不作为 Metric label。Desktop receiver 与 SigNoz receiver 接收同一版本化 OTLP；Dashboard 不轮询本地状态，也不自行合成缺失 Action。

## Risks / Trade-offs

- **[风险] Build 状态模型明显增大，恢复组合更多** → 使用单一 `BuildActionKind` reducer、CAS、不可变 revision 和 crash-boundary 参数化测试，禁止服务层手工改 phase/action。
- **[风险] Runtime BuildPlan 被误用为第二套任务权威** → 不写入 OpenSpec 目录、不含 checkbox，Plan Validator 强制稳定 Task refs 和 planning digest；语义变化一律返回 Design。
- **[风险] subagent Host 内部委派成为不可观测黑盒** → 只允许声明 `subagent.dispatch.attested` 的 Host，要求 delegation receipts、父子 invocation identity、受保护工具 session 与 Skill consumption Evidence；无法证明时 Outcome 不接受。
- **[风险] Runner 准备的 branch/worktree 与 Runtime Store 不在同一 checkout** → RunStore 始终锚定 Workspace root，执行 binding 单独映射稳定 repositoryId 到本地 checkout；绝对路径不进入可移植语义或遥测。
- **[风险] 固定配置无法在执行中应对环境变化** → 本版本明确 blocked/migration_required，并由新的普通 Change 处理策略变化；换取更简单、可恢复的协议。
- **[风险] standard Review 在 Build Check 与 Verify 看似重复** → Build Check 审查 package/实现完整性，Verify 审查整个 Change 的规格符合性和最终 Evidence；遥测分别记录以评估重叠成本。
- **[风险] 破坏性 schema 让开发中的旧 Run 无法继续** → 分支公开且现有状态保留只读；不双读双写，必要工作以新 Run 重新开始。

## Migration Plan

1. 先合入领域模型、definition 校验和纯 reducer，保留产品构建可运行但不提供旧 Build 执行入口。
2. 接入 RunStore、本地 execution workspace binding、workflow service、Host packet 与 Skill contributors；用新 schema 创建全新测试 Run。
3. 删除旧 `createInitialBuildWork`、Task reopen、Repair Work 与相关 CLI continuation 分支，不留兼容别名。
4. 接入 Trajectory/OTLP 并更新 CLI 投影；Desktop Dashboard change 在本 Change 合入后单独适配新事件。
5. 通过 domain、service、process black-box、crash-boundary、多仓、Skill consumption 和 telemetry replay 验证，再用新协议完成一次自举 Change。

回退只允许回退尚未发布的代码提交；已经由新 schema 创建的 Run 不尝试降级给旧 Runtime。若发布后发现阻断缺陷，停止新 Run、保留事实并以新的普通 Change 修复。
