# Design

## Context

见 [proposal.md](proposal.md) 的 Why。当前实现已经拥有一个权威 `RunState`、CAS `stateVersion`、追加式 Trajectory、Work claim/attempt、可恢复文件事务和固定五阶段 definition，但又在 `ChangeRunIdentity`、runId、CLI、Trigger、Publication、Journal、Consistency 和 Telemetry 中加入了 lifecycle `generation`。结果是调用方承担了分配代次的职责，而 Runtime 没有可靠 lineage/supersede 协议；同一 Change 可以留下多个都自称 current 的 Run。

固定上游 Comet `0.5.0` 的成熟边界是：调用方可提供稳定 runId；相同 runId 与相同固定输入幂等恢复，不同输入返回 `RUN_CONFLICT`；Run 通过 CAS `revision` 防并发覆盖，Action 使用 `attempt`，Trajectory 使用 `sequence`。Comet Classic 另外以 machine-owned `checkEpoch` 在每次状态转换时递增，将命令检查绑定到阶段有效期，执行期间 epoch 变化或不可复用证据跨 epoch 时拒绝结果。

Repoctopus 还需要保留自己的团队 Workspace、多仓 Project Snapshot、OpenSpec Store、Matt Method Profile、Cordis composition、Publication Receipt 和统一 OTLP 边界。这些是适配层差异，不需要生命周期 generation。

当前阶段合同还存在独立缺口：Open Work 只要求 proposal，校验后自动创建 Design Work；Design 才一次性生成四类 OpenSpec 工件并承担唯一规划批准；Build 固定加载 `tdd + codebase-design`；Verify 失败只把 phase 改回 Build 并展示 repair next action，却没有创建受管 Repair Work。这让阶段名称与真正的人工边界、Skill 装填和可恢复执行不一致。既然本 Change 会破坏性替换旧 Run 协议，就必须同时修正这些边界，不能把旧行为搬进稳定 Run。

## Goals / Non-Goals

**Goals:**

- 一个 Workspace/change 只有一个可执行权威 Run，所有正常回退、重试、恢复和 Archive 发布都留在该 Run。
- 让 Open 和 Design 成为两个可观察、可恢复且各自需要人工批准的阶段，并让四类 OpenSpec 工件始终是唯一规划权威。
- 让每条回退都落到真实的 Work、Human Decision、retry 或 reconcile continuation，而不是只改变 phase 或等待旁路文件变化。
- 采用 Comet 的职责分离，避免 `stateVersion`、`checkEpoch`、Work `attempt` 和事件 `sequence` 相互代偿。
- 让重复 `run start --change` 在工作树已经变化后仍能解析并恢复同一 Run，同时对真正的固定输入冲突 fail closed。
- 让 Work、Evidence、Publication、Consistency、Dashboard 和 OTLP 都以 runId 为关联根。
- 破坏性移除预发布 generation 协议，不保留运行时双轨和自动迁移债务。

**Non-Goals:**

- 不直接嵌入 Comet SDK、Classic CLI、Dashboard 或单仓目录布局。
- 不复制 Comet Classic 的 Superpowers Design Doc 或 Build Plan；不新增 ADR、implementation notes 或其他第五类规划工件。
- 不把装填 `grilling` 等同于强迫用户回答问题；已由仓库事实和输入完整解决的设计树可以零问题通过。
- 不为已经发布给外部用户的数据提供 generation 到新 schema 的自动转换工具。
- 不实现跨机器共享 RunStore；团队仍需共享工作目录、备份或后续 Store Provider。
- 不改变固定五阶段、OpenSpec 四类权威工件和 Archive 不等待 MR 合入的产品决策；本次只纠正各阶段对这些工件和方法的职责分配。

## Decisions

### 0. 阶段合同由 Runtime 固定，Host 只执行当前 Work

Runtime 为每个 phase 选择唯一合法的 Action、解析真实 Skill 正文并验证 Outcome；Host 不得提交 `targetPhase`、伪造批准或直接修改 lifecycle。`auto_transition` 只决定批准后是否立即返回下一 continuation，不降低 transition 前置条件。

| Phase   | 固定 Work / 方法                               | 权威产出与退出条件                                                                                                                                                                   |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open    | `repoctopus-open-change` + `grilling`          | 先核对仓库、现有规格与输入事实，再创建或修复 proposal、delta specs、design、tasks；严格 Provider 校验后建立绑定四类工件语义摘要的 Human Decision。拒绝留在 Open，批准才进入 Design。 |
| Design  | `repoctopus-design-change` + `codebase-design` | 从已批准 Open 基线继续深化同一四类工件，主要补足工程边界、决策、验证策略与可执行 Task；严格校验后建立新的 Human Decision。拒绝留在 Design，批准才进入 Build。                        |
| Build   | `repoctopus-build-task` + `tdd`                | 一次执行一个当前 task revision，测试先行并形成 completion claim；不固定加载 `codebase-design`，也不重复注入 `design.public-test-seams`。设计级阻塞只能作为结构化发现交回 Runtime。   |
| Verify  | 现有 review/evidence Work                      | 对冻结的完整输入执行 review、Evidence 和 Gate；失败必须分类为实现失败、规划语义漂移或证据/基础设施失败。                                                                             |
| Archive | 现有 specification closure / publication Work  | 在副作用前核对 Verify 新鲜度，完成规格关闭和轻量 publication；不等待业务 MR 合入。                                                                                                   |

Open 装填的 `grilling` 采用它自己的决策树规则：Agent 先验证环境事实，只把仍会改变设计的未决选择交给用户；如果 frontier 为空，允许零问题完成。Cordis composition 必须为规范 Skill 名 `grilling` 解析恰好一个可审计 Provider，并冻结正文、资源和 provenance；不能静默依赖某台开发机的全局安装。

Open approval 与 Design approval 是两个不同 proposal hash。任一阶段的受控工件语义变化都会使相应批准失效；checkbox、格式或其他被规范化为非语义的变化不得制造虚假失效。Design 只更新 OpenSpec 的既有路径，不产生 Superpowers Design Doc、Build Plan、ADR 或 implementation notes。

### 1. 以确定性 runId 取代 lifecycle generation

`changeRunId` 只接收规范化 `workspaceId + changeId`，生成：

```text
change-<workspace-change-label>-<sha256(workspaceId NUL changeId)[0..16]>
```

`mode` 和 generation 都不参与身份。`run start --change` 删除 `--generation`；调用方不能指定 Change Run id。FileRuntimeStore 继续以 runId 作为目录和事务锁键，因此并发初始化自然收敛到一个目录，失败者读取并核对现有 Run。

选择确定性身份而不是新增 current-run registry，是因为前者没有需要原子维护的第二份索引，也与 Comet“相同 runId + 相同输入恢复、不同输入冲突”的语义一致。普通 generic Workflow Run 仍可使用调用方 runId，不受此 Change 影响。

### 2. 冻结拓扑身份，不冻结会随 Build 变化的仓库状态

当前 `startOrResume` 比较完整 `projectSnapshot.digest`，其中包含 HEAD、tree 和 dirty 状态；这会让同一 Change 在正常 Build 后无法通过 `run start` 恢复。Change Run 启动改为固定 `ChangeRunStartIdentity`：

- Workspace、Specification Root 和 Provider identity；
- 排序后的 repository logical IDs 与 Workspace Repository ID；
- Project configuration digest；
- target repository、remote identity、target branch 和首次观察的 target base OID；
- lifecycle definition、workflow 和 composition identity。

Project Snapshot 仍作为启动审计和本机路径解析输入保存，但重复启动只比较稳定拓扑投影，不比较业务分支 HEAD/tree/dirty。代码状态、tree 和 dirty digest 在每个 Work input、Verification Input 与 Delivery snapshot 处重新冻结。这样既不会把 Build 变化误判成新 Run，也不会放松多仓、目标分支或 Provider 漂移。

### 3. 四种递增量各自只有一个职责

| 字段                              | 所有者                   | 递增时机                      | 用途                               |
| --------------------------------- | ------------------------ | ----------------------------- | ---------------------------------- |
| `RunState.stateVersion`           | RunStore                 | 每次成功 CAS 提交             | 并发写入与 checkpoint 新鲜度       |
| `ChangeLifecycleState.checkEpoch` | lifecycle reducer        | 每次接受 lifecycle transition | 阶段相关 Work/检查/Evidence 有效期 |
| Work `attempt`                    | Work execution authority | 同一 Work 的声明重试          | claim、Host 调用与幂等副作用       |
| Trajectory `sequence`             | RunStore                 | 每个追加事件                  | 审计顺序与 OTLP cursor             |

`ChangeLifecycleState` 升为 schema 2，初始 `checkEpoch=0`。`applyChangeLifecycleTransition` 在同一个纯函数结果里校验非负安全整数并递增一次；transition fact 同时记录 `from.checkEpoch` 与 `to.checkEpoch`。没有 transition 的普通 Run CAS（例如保存 telemetry continuation）只增加 `stateVersion`，不增加 epoch。

选择 epoch 而不是继续用 `stateVersion` 约束 Verify，是因为 telemetry、Skill binding、coordination checkpoint 等非阶段写入也会增加 stateVersion。把这些写入误认为验证输入失效会造成无意义重跑；epoch 精确表达“阶段/生命周期边界已经改变”。

### 4. Work 与 Evidence 在同一 Run 中绑定 epoch

ActionIntent、ActionReceipt、ClaimedActionOutcome、WorkExecutionPacket/Checkpoint/Session 和执行事件升级 schema 并携带 `checkEpoch`。领取时从当前 lifecycle snapshot 读取 epoch；提交 Outcome、Validator 或恢复 continuation 时同时核对 runId、workId、attempt、claim、inputDigest 和 epoch。旧 epoch 结果保留在内容寻址 Store/Trajectory，但不能写入当前 checkpoint。

Verification Input、Evidence workflow binding、Attempt context 和 Gate Projection携带 checkEpoch。Evidence 启动和结束都读取当前 lifecycle epoch：

- epoch 改变时 Attempt 进入 superseded 或 Gate blocked，原因使用有界 `phase-changed`/`stale-epoch`；
- 不再用任意 `stateVersion` 变化判定阶段证据陈旧；stateVersion 仍记录为 observed revision 供 CAS/诊断；
- reusable 只适用于通过现有命令、输入、环境、Provider、fingerprint 和 policy 全部复核的 Receipt，不能绕过 epoch 与当前 Work identity。

这采用 Comet Classic 的检查 fence 思想，但复用 Repoctopus 已有 Evidence Service、Acceptance Trace 和多仓 Fingerprint，而不是复制 Classic 命令存储。

### 5. `adopt-existing` 是同一 Run 的受审计决定，不是 Run 类型

从 Change identity 和 trigger 固定输入删除 `mode`。当 Build 首次观察到预勾选 Tasks 且没有本 Run completion claims 时，Runtime 建立 `adopt-existing` Human Decision Wait，选择仅有：

- 接受当前 task revision 集合为 imported claims；
- 拒绝采用并要求把 Tasks 恢复为 pending。

决定绑定 planning digest、task revisions、repository fingerprint 和 proposal digest。批准后在原 Run 追加 adoption fact并继续 Verify；拒绝后保持 Build blocked。CLI 可以保留 `--mode adopt-existing` 作为首次启动的显式便捷输入，但它只能转换为同一 Human Decision 的可信请求，不能改变 runId、trigger identity 或直接伪造 completion。为避免两套入口，本 Change优先删除 `--mode` 并使用现有 `run decide` 投影的决定类型。

### 6. 不兼容漂移终结或冻结原 Run，不产生 successor generation

Definition、composition、Skill、Method Profile 或 Specification Provider 的兼容声明决定恢复路径：

- 声明兼容且尚未领取的后续 Work可以在同一 Run 更新 contributor snapshot；
- 已领取 Work 的正文/执行包漂移使当前 Work 失效并按 definition 回到安全 checkpoint；
- 无法证明兼容时，同一 Run 进入 `migration_required`，保留 blocker 和差异；
- 若未来需要真正替换一个不可恢复 Run，应增加显式 cancel/replace 产品能力并建立独立规格，而不是恢复数字 generation。

当前 `change-lifecycle-migration` transaction/service/store/plugin 只为创建目标 generation 服务，全部删除。Delivery v2 的只读 `delivery migration-plan` 属于另一数据域，继续保留。

### 6.1 回退按失败类型创建受管 continuation

Runtime 只接受 Host 的结构化发现，例如 `implementation_failure`、`design_assumption_invalid`、`planning_semantics_changed`、`evidence_unavailable` 或 `external_result_unknown`；Host 不得指定目标 phase。Runtime 根据 definition、当前 checkpoint 和副作用边界选择 continuation：

| 发现 / 失败                                        | Runtime continuation                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build 普通实现失败                                 | 保持 Build，以有界 retry policy 为同一逻辑 Work 创建下一 attempt；达到上限后进入明确 blocked/Human Decision，不得无限重派。                                                                  |
| Build 发现设计假设无效                             | 保持当前 Run 并建立 Human Decision；批准修订后使旧 Design approval、受影响 task claims 和 Evidence 失效，递增 epoch 回到 Design。                                                            |
| Verify 发现实现行为失败                            | 记录失败 Evidence，重开受影响 OpenSpec task revision，递增 epoch 回到 Build，并创建真实 `repair` Build Work；该 Work 仍需 claim、Skill packet、Host Outcome、Validator 和 completion claim。 |
| Verify 发现规划语义漂移                            | 使批准和受影响 Work 失效，递增 epoch 回到 Design，而不是把设计问题伪装成代码修复。                                                                                                           |
| Verify 的 Evidence/Provider/基础设施暂时不可用     | 留在 Verify blocked/retry 或 reconcile，不得回到 Build。                                                                                                                                     |
| Archive 在规格关闭或外部副作用前发现 Verify 已陈旧 | 递增 epoch 回到 Verify 并重新建立 Evidence；已经开始 closure/publication 副作用后不得回滚 phase，只能从 Journal reconcile 或人工修复。                                                       |
| Host 或外部结果未知                                | 保留原 attempt 和稳定 identity，返回 wait/reconcile；观察到唯一等价结果后接受，歧义时 fail closed。                                                                                          |

同一个 Run 中每次合法 transition 只递增一次 `checkEpoch`。文件 fingerprint 变化、Agent 声称“已修复”或全部 checkbox 被勾选都不能代替 Repair Work；只有当前 task revision 的受管 Outcome 和 Validator 能再次形成 completion claim。

### 7. Publication 和 Consistency 以 runId 为唯一生命周期关联

Publication Receipt 与两个 Journal 升级预发布 schema：

```text
PublicationReceipt:
  changeId
  runId
  verificationInputDigest
  specificationClosure
  items[]

PublicationJournal key:
  runId

SpecificationPublicationJournal key:
  runId
```

`publicationId` 使用 `specification:<runId>`；业务 item idempotency key 使用 `runId + repository + base + head + exact OID`。文件名由经过现有 runId 安全校验的 runId 派生，不再使用 `<change>.g<n>.json`。Archive terminal Validator 只比较 changeId、runId、验证输入和 closure identity。

Consistency Review 从 Receipt 获取 runId，Store 以 Receipt/runId identity 定位；它仍可创建后续普通 OpenSpec Change，但绝不重开原 Run。

### 7.1 Archive 发布前校验与同 Run 输入纠正

Archive 必须在建立 `specification.close` Work 前以只读方式验证 Design planning approval、当前远端 Change branch identity 和 publication policy；校验失败不能产生规格关闭或远端副作用。`delivery.publish` 在执行任何 push/MR 前再次执行同一只读校验，形成明确的 side-effect fence。

Design approval 绑定 repository、remote identity、source branch 与 target branch，但不把 Design 时的 `remoteOid` 当成 Build 后实现 OID；Archive 的最终 OID 由实时远端 source branch 与 isolated closure candidate 共同证明。为恢复旧实现已经关闭规格、但尚未进入任何远端 publication 的精确窗口，Runtime 只允许一种有界纠正：审批中的 branch coordinates 与冻结输入一致，实时远端 OID 等于 isolated closure candidate 的 `baseOid`，且冻结输入仅 `remoteOid` 错误；业务交付、Evidence、policy、closure 和 Run identity 全部不变。Runtime 在同一 Run 中递增 `checkEpoch`、保留旧 Work/输入审计事实并创建新的 `delivery.publish` Work；Host 不能请求该转换，也不能借它修改 branch、target 或业务交付。

如果实时远端 branch 已经前进，旧 approval 与 isolated closure 都不再代表待发布实现。只要发布前校验尚未放行任何远端动作，Runtime 会保留失效事实、丢弃该本地 candidate 的权威资格并回到 Design，重新批准、Build claim、Verify 与 closure；它不会在旧 candidate 上改 base，也不会把新提交悄悄塞进已经验证的 publication。

受保护 Plugin 的原地修复只能通过当前 descriptor 对旧 `codeDigest + descriptorDigest` 精确二元组的兼容声明；lifecycle definition 还必须单独列出精确旧 definition digest。authority、state schema、effective config 或未声明 definition 变化仍然进入 `migration_required`。若旧 Runtime 已先把该精确漂移停为 `migration_required`，兼容升级只恢复聚合事实并由 Runtime 在新 epoch 重建下一 Work，绝不复用被清空或旧 composition 的 Work packet。同一种语义 Work 在新 epoch 重建时保留稳定 `workId` 以关联审计历史，但必须使用更高 attempt；执行权威以 `workId + checkEpoch` 区分新旧实例，并允许跳过已经持久化 Action Intent、却尚未绑定 Run checkpoint 的孤儿 attempt。这使本次自举 Run 可以应用已验证的无 schema 修复，同时不会把任意受保护代码漂移放宽为兼容。

### 8. 旧 generation 文件保持不可变且不参与新定位

产品尚未正式发布，因此不实现 schema adapter。新代码不扫描带 `-g<n>-` 的旧 Run 作为 current，也不读取 `*.g<n>.json` Journal 继续副作用；文件保留用于人工审计和可选清理。测试 fixture 使用专用临时目录证明新 locator 忽略 legacy 数据，不修改仓库中的自举历史。

本 Change 的自举是唯一切换边界：现有 G1 Run完成规划批准后成为 legacy 只读；新代码构建完成后，用相同 Workspace/change 派生无 generation 的稳定 Run。新 Run 必须真实执行 Open Work、Open approval、Design Work 和 Design approval；已经由旧流程完成的代码任务可以在 Build 通过 `adopt-existing` Human Decision 导入 completion claims，再执行完整 Verify/Archive。它不是 G2，也不建立 lineage；验证报告必须明确展示旧 legacy identity、两个独立批准和唯一新协议 Run，不能把旧规划事实伪造成新 Run 的执行历史。

### 9. Telemetry 和 Dashboard 不再暴露 generation

`run.started`、lifecycle transition、Work/Skill/tool/Validator/wait/reconcile 事件统一包含 runId；lifecycle 事件增加 checkEpoch，Work 事件增加 attempt/epoch。Open 与 Design 的 Work、Skill delivery/consumption、Validator、approval requested/accepted/rejected，以及 Build retry、repair、task reopen 和 reverify 都必须留下可复算事件。OTLP 允许列表删除 generation；Trace 仍以稳定 runId 关联跨进程执行。`checkEpoch` 数值只作为 Trace/Event 关联属性，不进入 Metric labels；Metrics 只使用 `phase-changed`、`stale-epoch`、`implementation-failure`、`planning-drift` 等有界分类。

Desktop receiver 继续消费相同 OTLP payload，不查询 RunStore。删除 generation 后，同一 Change 不再出现多个并列 current cards；历史 legacy Run 若由旧数据导入，只能标为 legacy audit，不进入当前进度聚合。

## Risks / Trade-offs

- **[稳定 runId 遇到真正不可恢复的 Run]** → 本次明确 fail closed 为 `migration_required`；不提前设计 replacement lineage。等真实需求出现时用独立 Change定义 cancel/replace，而不是保留 generation 后门。
- **[每个 transition 都递增 epoch 导致过度失效]** → 只把 lifecycle reducer 接受的 transition 视为 epoch 边界；普通 CAS、Telemetry cursor 和 coordination 更新不递增。测试覆盖 self/fallback/complete transition 和非 transition 写入。
- **[Evidence 从 stateVersion 改用 epoch 后放松过度]** → Gate 仍严格绑定 runId、Work、attempt、Verification Input digest、Acceptance Set、composition、profile 和多仓 fingerprint；仅移除与阶段语义无关的 stateVersion 等值要求。
- **[旧 generation 数据与新文件并存造成运维困惑]** → CLI/文档明确 `legacy audit`，新 locator 与 Store 文件名完全不同，负向架构测试禁止生产代码重新读取 generation。不会自动删除用户历史。
- **[adopt-existing Human Decision 增加 reducer 分支]** → 复用现有稳定 proposal/response、wait 和 trajectory 边界；不增加 phase，不增加第二套 approval Store。
- **[Open 与 Design 双批准增加交互成本]** → 两次批准保护不同边界：Open 确认需求与四件套基线，Design 确认工程深化；两者使用独立 digest 且可在无变化时快速确认，不合并为含糊的单次批准。
- **[`grilling` Provider 在不同机器不可用或重名]** → composition 明确声明依赖并要求唯一解析，领取 Open Work 前冻结 provenance；缺失或歧义 fail closed，不回退成无 GrillMe 的 Open。
- **[Verify 无法可靠映射受影响 Task]** → 不猜测最小集合；优先使用 review finding 的 requirement/task links，无法证明时建立 Human Decision 或重开保守集合，并在 Trajectory 记录依据。
- **[Archive 回退可能重放发布副作用]** → 只允许在 closure/publication 副作用开始前回到 Verify；开始后固定 phase，通过稳定 Journal observe/reconcile。
- **[错误 Change branch OID 在规格关闭后才被发现]** → 在 closure 前和远端 publication 前执行同一只读审批校验；仅在已关闭规格但尚未发布的兼容升级窗口，允许把 OID 纠正为审批与 closure candidate 共同证明的值并创建新 Work。
- **[Publication schema 破坏现有未完成 Archive]** → 当前产品为预发布；旧 Journal只读，不尝试继续未知副作用。新 Run 在发布前重新观察远端并按稳定 OID create-or-recover。

## Migration Plan

1. 保存 generation 和错误阶段合同的必败回归：公共 CLI 接受 `--generation`、同 Change 可创建 G1/G2、Open 自动推进、Design 才生成四件套、Build 重复装填设计方法、Verify 回 Build 却没有 Repair Work、旧 Receipt/Journal 依赖 generation、stateVersion 非阶段变化误伤 Evidence。
2. 先修正 definition、Skill composition、Open/Design 双 Human Decision 和 typed rework reducer，再落地稳定 runId、schema 2 lifecycle 与 checkEpoch 纯领域模型；用 Comet 对等测试验证 Runtime-authoritative transition、CAS、transition 递增和 stale evidence fence。
3. 贯穿 Work/Action/Evidence 的 epoch identity，建立 Build repair/task reopen 与 Archive reverify continuation，并把 Verify 新鲜度从 stateVersion 等值迁移到 epoch + 完整输入 identity。
4. 改造 Publication/Specification Journal、Receipt、Consistency 和 Archive Validator，完成单仓、多仓、响应丢失、人工 MR 和副作用边界恢复矩阵。
5. 删除 CLI generation、mode identity、lifecycle migration 插件和全部生产 generation 引用；保留 archived specs 与 `.repoctopus` 历史文件不动。
6. 更新 OTLP/Desktop projection、文档、来源采用报告与架构禁用规则，执行双批准、返工、完整单元、E2E、package、tracer、OpenSpec strict 和 provenance 验证。
7. 使用新稳定 Run 对本 Change真实执行 Open、Open approval、Design 和 Design approval；在 Build 通过 adopt-existing 接管已完成代码，再完成 Verify/Archive。若该纵切无法通过，停止发布并修复当前 Change，不恢复 generation或手工伪造阶段事实。

回退仅允许回退尚未发布的分支提交；一旦新 schema 的 Publication 开始执行，不得切回 generation Runtime继续同一外部副作用。应从新 Journal观察远端并恢复，或进入人工修复。

## Open Questions

无。任何要求保留 generation 兼容、创建 successor Run或自动转换旧外部副作用的需求都会改变本 Design 和规格，必须另行评审，不能在实现中临时加入 fallback。
