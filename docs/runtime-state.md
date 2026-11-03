# 状态、轨迹与恢复

## Change Run 是唯一生命周期权威

一个 Workspace/change 只有一个由二者确定性派生的权威 Change Run。它按 `Open → Design → Build → Verify → Archive` 推进，`phase`、`status`、`checkEpoch`、当前 Work、Task progress、wait、blocker、Evidence 和 next actions 都来自同一条 accepted trajectory。Specification、Delivery、CLI、Desktop 与 OTLP 只能提交事实或读取 `ChangeRunProjection`，不能维护另一套阶段状态。

```powershell
node bin/repoctopus.js run status --workspace . --run <run-id> --json
```

文本和 JSON 输出使用同一投影。`freshness.stateVersion` 与 `freshness.trajectoryOffset` 表示投影对应的持久版本；看到等待或阻断时应处理投影给出的 next action，不能通过编辑 `.repoctopus/`、分支名或 MR 状态跳过转换。

每个 Run 都保存在 `.repoctopus/runs/<run-id>/`：

| 文件                    | 含义                                                     |
| ----------------------- | -------------------------------------------------------- |
| `workflow.json`         | 启动时冻结的 Workflow Package 与摘要                     |
| `project-snapshot.json` | 启动时冻结的多仓事实                                     |
| `run.json`              | 当前 Run State                                           |
| `trajectory.jsonl`      | 按顺序追加的领域事件                                     |
| `checkpoint.json`       | 当前状态版本、轨迹偏移、关键摘要和已接受 Evidence Bundle |
| `transition.json`       | 尚未完成转换的 Journal；正常完成后删除                   |
| `transition.lock`       | 跨进程转换锁；正常完成后删除                             |
| `telemetry-cursor.json` | 已成功发送的最后一个轨迹序号                             |

可选的 `agent-coordination.json` 只保存有界的 handoff/上下文压缩提示。它不进入 Run、Checkpoint 或 OpenSpec 四类工件，不能授权写入、声明 Task 完成或覆盖真实 execution checkpoint；缺失或 stale 只意味着 Runner 要重新核对事实。

## 身份分层与失效范围

Runtime 不再用一个聚合 planning snapshot 授权所有后续状态。Change Run v2 分别保存 planning semantic、validation observation、approval authority、composition、Build Configuration、Build Plan、execution checkpoint、verification input 和 publication provenance 身份。每个身份只有一个领域 owner；代码固定的依赖矩阵决定哪些后继事实依赖它。

`next`、`resume`、CLI JSON 和 Desktop 投影只读取已提交 checkpoint。它们不会扫描 OpenSpec、Git diff 或最新 packet 来猜下一步。相同 revision 的重复调用返回同一 Work、Wait 或 reconciliation；相同 idempotency key 携带不同 payload 时返回冲突。

Design 返工会把现有 Build Protocol 标记为 `suspended-for-design`。该候选保留 Configuration、Plan 和 package completion，但不可 claim 或 dispatch。新 Design 批准后，Runtime 从 Configuration 开始逐层重验；配置仍兼容时直接回到 Plan，新 Plan 只保留 package identity 和输入都匹配的 completion。无法证明精确范围时，Runtime 使用保守失效或 Human Decision，不静默采用旧 completion。

预发布旧 Run 保持只读并返回 `migration_required`。当前 Store 只验证当前 schema，不使用第二套 legacy reader 解释旧授权；审计工具可以保留和导出原始字节，但不能把它转换成当前执行权。Runtime 不提供 v1/v2 双读、自动转换、Store 修复命令或用当前内容重组旧 packet。

## 受管 Work 与 continuation

`run next` 每次只解析 Runtime 已选定的当前 Action，并返回 `execute | reobserve | ask | wait | reconcile | done`。完整 `WorkExecutionPacket` 按 Runtime contract、阶段 action Skill、Specification Provider protocol、augmentation Skills、Method Profile、change inputs 的固定顺序装配。claim 前，Runtime 先把深冻结 packet 以 create-or-verify 方式写入 `.repoctopus/runs/<runId>/packets/<packetDigest>.json`，再通过 Run CAS 绑定唯一 identity，最后才允许 Host 取得正文。Run、checkpoint、trajectory、日志和 OTLP 只保存 packet/context digest；私有 packet 文件是唯一正文恢复源。

`run status --json` 的 `result.continuation` 是版本化公共合同。它只投影已经提交的 checkpoint 和最新匹配的 `continuation.selected` 事实；状态查询不会读取 packet 正文、探测 Host、扫描 Git 或追加 trajectory。以下示例表示 Runtime 已提交一个尚未 claim 的 Build Work：

```json
{
  "schemaVersion": 2,
  "continuation": "execute",
  "workId": "build.execute:example",
  "attempt": null,
  "checkEpoch": 4,
  "reason": "work-unclaimed"
}
```

`reobserve` 表示 Host Outcome 已知且保持不变，只需重试 Specification Provider/Store 观察；它保留原 Work、attempt、check epoch、invocation、Outcome、Receipt 与 Skill consumption，绝不调用 Host reconciliation。Open 的严格 Provider 校验成功后，Work 进入 `validated`，纯 continuation classifier 将其投影为 `reobserve/open-gate-pending`，下一次 `run next` 直接继续 planning gate。某次观测失败仍返回 `reobserve/open-observation-unavailable`，并以 `provider-validation | planning-gate` 标识失败位置。`reconcile` 只表示 Host 或外部副作用结果未知。`reconcile`、`awaiting-correction` 和 `ask` 同时产生有界 CLI diagnostic code；`reason` 只能取公开枚举，不能包含路径、Provider 正文或自由错误消息。真正的 `next` 或 `resume` 才执行 packet/Host 动态核验；Runtime 先把选择提交为 trajectory fact，再让 CLI、Desktop 与 OTLP 读取同一结果。

恢复时，Project Snapshot 差异分为 `same | content | identity`。仅 HEAD/worktree 变化属于 `content`：Runtime 完整报告差异，但由 Open、Design、Build、Verify 或 Archive 各自的 authority 精确重验依赖，不设置全局 `reconciliationRequired`。仓库增删、Project/root、path、remote、branch、拓扑、diagnostics 或无法分类的变化属于 `identity`，继续 fail closed 并要求全局 reconciliation。`changed` 仅供展示，不是阻断条件。

claim、context delivery、Host invocation、Outcome、Validator 与 lifecycle transition 都写入同一个 Run aggregate 和追加式 trajectory。ActionStore 和 packet store 是先写的不可变内容库，不拥有 attempt 或下一步；CAS 前的孤立内容没有执行权。恢复始终按 checkpoint identity 读取原 packet，不重新读取当前 Skill、Provider 指令或 OpenSpec 文件。恢复分类遵循以下边界：未调用可重交同一 attempt；活跃 Host 返回 `wait`；未知副作用返回 `reconcile`；可证明未执行才创建下一 attempt；已有 Outcome 从 Validator 继续；Human Decision 保留原 proposal hash。旧 checkpoint 或缺失/损坏 packet 明确进入 `migration-required` 或 `content-missing-or-corrupt`，不得用当前内容重组兼容。

进程外 Host 的 Outcome 必须同时匹配原 invocation ID、Host ID 和 packet digest。受保护操作还必须携带活动 session identity；跨 Run/Work、过期 session、越仓或越 scope 操作全部 fail closed。Repoctopus 不是 OS 沙箱，旁路文件变化只能成为 drift，不能形成受管 Receipt。

## Build 内部协议

Build phase 固定执行 `Configure → Plan → Plan Evidence → Execute → Check`。Runtime 选择当前 Action；Host 只能执行当前 Work 并返回结构化 Outcome。`auto_transition` 只决定 Runner 是否继续调用 `run next`，不允许 Host 跳过 Action 或直接进入 Verify。

| Action        | Runtime 接受的结果                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Configure     | Runner 提供的 checkout facts、Host 能力和 `current\|branch\|worktree` 隔离绑定                                                  |
| Plan          | OpenSpec Tasks 到有界 Work Packages 的执行投影，包括依赖、仓库、write scope 和验收引用                                          |
| Plan Evidence | Task/acceptance coverage、DAG、Strategy、Binding、Host、scope、composition 和报告 owner 校验；有界高风险计划建立 Human Decision |
| Execute       | 当前 package 的验收、测试、实现和可选受管子代理委派 Evidence                                                                    |
| Check         | 全部 package、Task acceptance、测试、独立 standard review 和仓库事实                                                            |

`BuildStrategy` 冻结经过 Design 批准的稳定语义：`autonomous|subagent-driven-development`、`tdd|direct`、standard review 与 `current|branch|worktree` 隔离意图。`ExecutionBinding` 只记录 Runtime 在 Configure 观察并验证的 Host capability、repository/branch/HEAD、ownership 和 opaque local overlay reference；绝对路径只保存在本机 overlay，不进入可移植状态或 OTLP。Configure 成功后自动进入 Plan，不建立第二次常规人工批准。

隔离意图不包含 delivery target branch，也不包含逐仓 branch map。前者属于 `ChangeStartBinding`/Delivery，后者属于可重建的 `ExecutionBinding`；否则协调仓功能分支、只读仓 `main` 和不同名称的业务功能分支会被错误要求同名。Open 只验证 topology、repository identity 和隔离形态。Plan 形成精确 write scopes 后才对可写仓执行 protected-branch 检查；只读仓可以继续停留在 target branch。

Runtime 本版不创建、切换或删除 checkout；Runner 先准备 checkout，再把当前事实交给 Configure。同一 Strategy 下兼容的 Host、能力、HEAD、checkout 或路径漂移会自动选择新的 Configure Work，建立新 Binding revision，并只失效依赖旧 Binding state 的 Plan/Evidence/未执行 Work。Strategy 不变时复用原 Design 决定；不兼容 Host、越界 ownership、错误 isolation 或不兼容 composition 仍然 fail closed。

`tasks.md` 是需求分解与完成 claim 的语义权威。`BuildPlan` 是 Run 内的执行投影，可以把一个 Task 拆成多个 package，或把多个强耦合 Task 合为一个 package；它不会写回 OpenSpec，也不是第五类规划工件。Plan revision 只使受影响 package 的 Evidence 失效，保留摘要仍匹配的 completion。Task checkbox 一旦完成就保持完成；最新 Plan 和 Check Evidence 决定当前实现是否仍有效。

## 转换协议

1. 原子取得 `transition.lock`；仍存活的持有者使竞争写入等待，进程已经退出的陈旧锁可以回收。
2. 重新读取锁内 Run 和 Workflow，校验事件属于当前 Run，并对比普通存储 CAS `stateVersion`。生命周期推进另由 machine-owned `checkEpoch` 建立证据 fence；Work、Action、Outcome、Validator 与 Evidence 必须绑定当前 epoch，普通遥测写入造成的 CAS 变化不会使验证证据失效。
3. 原子写入 `transition.json` 并刷盘。
4. 写入完整且以换行结束的 `trajectory.jsonl`。
5. 原子写入 `run.json`。
6. 原子写入 `checkpoint.json`，包括本次状态已经接受的 Evidence Bundle ID。
7. 删除 Journal 并释放转换锁。

重启后只要 Journal 存在，Runtime 会检查已经完成的步骤并继续执行缺失步骤。相同事件不会重复追加。轨迹缺少最终换行、包含无效 JSON、序号断裂或重复事件 ID 时，Runtime 返回损坏诊断，不会静默截断证据。

## Composition 兼容

Run、Checkpoint 和 Trajectory 保存完整 composition 身份。写转换前，WorkflowRuns 只比较当前 checkpoint dependency closure 中实际使用的 Provider、Contributor、definition、code 和 config identity：摘要相同则继续；catalog 精确声明唯一直接前驱且 checkpoint 范围匹配时记录一次 adoption；无法证明兼容时返回 `migration_required`。未进入 closure 的 Contributor 变化不影响 continuation，已经 claim 的 Work 始终使用原 packet。`migration_required` 仍允许 `status` 和 `doctor` 读取，不允许 `next`、`record` 或 `resume` 写入。

普通插件重载由 Cordis Loader 先卸载旧 Fiber，再激活新 Fiber。Run 不依赖旧 Fiber 的内存对象，恢复依据始终是 Store、Journal 与 Checkpoint。

Change Run 还冻结 Lifecycle Definition、Work Contributor、Validator、Extension、`EffectiveSkillComposition` 与 Specification Provider 身份。团队 guidance/replacement 的角色、顺序、binding/slot、Provider 内容和资源摘要随 Run 固定；当前 Work packet 只装入该 Work 的冻结层。恢复时摘要相同才继续，活动 Provider 内容或合同漂移会在 claim 前 fail closed。核心 transition、Validator 或写入范围不兼容时进入只读 `migration_required`。预发布旧 lifecycle 状态不会被扫描或原地升级，也没有 successor Run。

## 恢复时的多仓核对

`run resume` 会重新执行只读 Project Probe，将远端身份、路径、分支、HEAD 和工作树摘要与启动快照比较。没有变化时 Run 可继续；出现任何变化时 Run State 永久标记 `reconciliationRequired`，Engine 直接拒绝产生新动作。

第一阶段没有提供“忽略变化继续”的命令。使用者需要恢复原仓库状态；同一活动 change 不会通过创建并列 Run 绕过旧决策。

## 诊断

`doctor` 只读检查 Run、Checkpoint、Trajectory、来源清单和遥测 Cursor 的一致性。发现未完成 Journal 时只报告并提示使用 `run resume`，不会完成转换、删除损坏轨迹或猜测正确状态。

## 交付状态

每个 change 的交付状态位于 `.repoctopus/deliveries/<change-id>/`：

| 文件              | 含义                                     |
| ----------------- | ---------------------------------------- |
| `state.json`      | 当前交付快照、批准、逐动作结果和合入证据 |
| `history.jsonl`   | 追加式交付事件                           |
| `transition.json` | 尚未完成的交付状态转换 Journal           |
| `transition.lock` | 跨进程交付锁；进程退出后的陈旧锁可回收   |

旧 Delivery 状态仍可只读诊断和迁移，但新写入已经并入同一 Change Run 的 Archive phase。Archive 关闭规格，发布全部 Business MR 与最终 Change MR，并核对完整 `PublicationReceipt`；Receipt 被同一 Run 接受后立即进入 `completed`，不等待 MR 合入。所有 MR 都由人或托管平台合入，Runtime 不执行 merge。

Publication Receipt 是完成证明，不是第二套状态机。后续审查、流水线或人工修改造成的远端 head/state 变化由 `change reconcile` 或下一次 `run start` 有界拉取。Reconciler 不修改已完成 Run；需要规格补偿时创建普通后续 Change。
