# change-lifecycle Specification

## Purpose

定义 Repoctopus 的权威 Change Run、固定五阶段状态机、阶段与执行状态的正交模型，以及 Work、转换守卫、恢复和兼容边界。

## Requirements

### Requirement: 每个活动 Change 使用唯一权威 Run

Repoctopus MUST 为一个 Workspace 中的一个 change 建立至多一个权威 Change Run，并由稳定 `runId` 和该 Run 的版本化事实唯一表达阶段、执行状态、当前工作、等待条件、阻塞原因和合法下一步；调用方不得提供 lifecycle generation 或选择替代 Run，Specification、Delivery、CLI、Dashboard 和 Telemetry 不得建立平行的 change 生命周期。

#### Scenario: 两个 Runner 同时启动同一 Change

- **WHEN** 两个 Runner 使用相同 Workspace 和 change 请求开始或恢复工作
- **THEN** RunStore 通过稳定 runId 和 CAS 只保留一个权威 Change Run，两个请求获得同一快照或明确的 revision conflict

#### Scenario: 重复启动携带不同语义输入

- **WHEN** 已有 Run 的固定 definition、Specification Root、仓库拓扑或目标分支与新的启动请求不同
- **THEN** Runtime 返回 `RUN_CONFLICT` 或 `migration_required`，不得创建第二个 generation 或静默替换原输入

#### Scenario: 展示端尝试推断阶段

- **WHEN** Dashboard 或 CLI 从目录、Git 分支或 MR 状态推断出与 Change Run 不同的阶段
- **THEN** 展示端只报告 Run 投影和可定位的数据新鲜度诊断，不把推断结果写回领域状态

### Requirement: Change 生命周期使用固定五阶段

内置 Change lifecycle MUST 按 `Open → Design → Build → Verify → Archive` 的顺序推进，并只允许定义声明的自循环或回退；分支发布、MR 创建和规格关闭 MUST 作为 Archive 工作表达，不得增加独立 Deliver、Post-merge 或 Consistency 阶段。MR 合入状态不得成为 Archive 等待条件或 Change Run 终态前置事实。

#### Scenario: Design 尚未批准

- **WHEN** 当前 Change 缺少有效规划批准且调用方请求开始 Build
- **THEN** Runtime 拒绝跨阶段并保持 Design，同时返回缺失的校验或人工决定

#### Scenario: Business MR 等待合入

- **WHEN** Archive 已关闭规格并取得覆盖全部业务仓和规格仓的有效 Publication Receipt，但 Business MR 仍待人工合入
- **THEN** Change Run 进入 `completed`，不等待任一 MR 合入且不创建 Deliver、Post-merge 或 Consistency 阶段

### Requirement: 阶段与执行状态正交表达

Change Run MUST 分别记录业务 `phase` 与执行 `status`；status 至少支持 `running`、`waiting`、`blocked`、`completed`、`failed` 和 `migration_required`，且等待人工决定、平台事件或重试不得要求进程、IDE 会话或 Fiber 持续存活。

#### Scenario: 等待规划批准

- **WHEN** 四类规划产物有效但可信用户尚未决定
- **THEN** Run 报告 `phase=design`、`status=waiting` 和稳定 Human Decision 条件

#### Scenario: 等待合入期间 Runner 重启

- **WHEN** `phase=archive`、`status=waiting` 的 Run 所在 Runner 退出后由另一个 Runner 唤醒
- **THEN** 新 Runner 从持久状态恢复相同 phase、status 和等待条件，不依赖旧进程内存

### Requirement: Lifecycle definition 在 Run 内不可变

Repoctopus MUST 在创建 Change Run 时验证并固定 lifecycle definition 的身份、版本和规范内容摘要；定义内容或核心转换变化不得在相同版本下静默改变活动 Run，项目扩展不得插入、删除、重排或绕过五个核心阶段。

#### Scenario: Definition 内容在恢复前发生变化

- **WHEN** 活动 Run 恢复时相同 id/version 的 definition 内容摘要与快照不同
- **THEN** Run 进入 `migration_required`，不使用新定义继续转换

#### Scenario: 扩展尝试绕过 Verify

- **WHEN** Lifecycle Extension 声明从 Build 直接进入 Archive
- **THEN** definition validation 拒绝组合并报告受保护转换

### Requirement: 下一项工作由 Runtime 固定

Runtime MUST 从 lifecycle definition 和已接受事实生成不可变 Work，绑定 phase、Work kind、Task identity、唯一 action Skill、有序 augmentation Skills、不可执行 Method Profile、能力、side-effect class、write scopes、input digest、output contract 和 Validator；调用方不得替换这些字段或以普通成功结果推进 Run。

#### Scenario: Agent 请求替换 Skill 组合

- **WHEN** 当前 Work 固定 OpenSpec action、`tdd` 等 augmentation 和 Method Profile，而 Agent 提交另一组合、原始行为参考或缺少任一必需 snapshot 的 Outcome
- **THEN** Runtime 拒绝 Outcome，保持当前 Work 并报告组合身份不匹配

#### Scenario: Method Profile 与 action Skill 争夺产物权威

- **WHEN** definition 中的方法规则或 augmentation 声称创建 OpenSpec action contract 之外的 spec、ticket 或 tracker 权威
- **THEN** definition validation 在 Work 创建前拒绝组合，不把 Prompt 优先级作为冲突解决机制

#### Scenario: Adapter 自述成功但没有验证事实

- **WHEN** Adapter 为当前 Work 返回成功 Receipt，但 required Validator 尚未产生满足事实
- **THEN** Runtime 保存尝试结果但不完成 Task 或转换 phase

### Requirement: Work Outcome 绑定领取与输入身份

每个可执行 Work MUST 通过稳定 claim 领取，Outcome MUST 绑定 Run、Work、attempt、claim token 和 input digest；过期领取、跨 Work 结果、输入漂移和未知外部副作用必须拒绝、协调或转入人工修复，不得猜测成功。

#### Scenario: 旧执行者晚到的 Outcome

- **WHEN** Work 已因输入变化生成新 attempt，旧执行者提交原 claim 的 Outcome
- **THEN** Runtime 将其记录为陈旧结果但不接受为当前转换事实

#### Scenario: 外部副作用结果未知

- **WHEN** Adapter 在保存 Receipt 前中断且平台可能已完成动作
- **THEN** Runtime 先按 Work 幂等身份执行 reconciliation，再决定复用、重试或请求人工处理

### Requirement: 生命周期回退保留审计历史

Design revision、规划语义漂移、Verify 失败、实现输入漂移和 Archive 前置验证失效 MUST 在同一 Run 中通过追加 invalidation、递增 `checkEpoch` 与定义声明的回退转换处理；Runtime MUST 按稳定身份依赖关系只失效不再授权当前输入的批准、Work、Build 节点与 Evidence，并保留仍匹配的 Task completion、Build Configuration、Plan、Package completion、Outcome、Evidence 和 Receipt。普通回退不得创建替代 Run；外部或规格关闭副作用开始后的 Archive 不得回滚，只能 reconcile。

#### Scenario: Verify 发现实现失败

- **WHEN** 完整 verification input 下的阻断 Gate 不满足
- **THEN** 同一 Run 记录失败 Evidence、递增 epoch 并回到 Build 或进入 Build blocked，旧 Gate 不可用于后续修复输入

#### Scenario: Build 中修改规划语义

- **WHEN** Tasks 文字、结构、需求映射或其他规划产物语义变化
- **THEN** Runtime 在原 Run 中使旧 Design approval 和受影响 Work 失效、递增 epoch 并返回 Design，同时保留仍由新语义授权的下游事实

#### Scenario: 局部变化不影响已完成工作包

- **WHEN** Runtime 能证明变化只影响当前 Plan 的一个 Work Package 及其依赖后继
- **THEN** invalidation 只退役该范围的 execution 与 Evidence，其他匹配当前稳定身份的 Package completion 继续有效

### Requirement: 旧状态迁移必须显式且可证明

Repoctopus MUST 将预发布 lifecycle generation、generic Run、旧 Delivery 和旧 Post-merge 状态视为只读历史，不得双读、双写、自动升级或继续执行；新协议只在稳定 Workspace/change 身份尚无当前 Run 时创建单一 Run。新协议 Run 的 definition、composition 或 Provider 不兼容时必须原地进入 `migration_required` 或经显式操作终结，旧事实和外部 Receipt 不得删除或伪造。

#### Scenario: 发现预发布 generation 文件

- **WHEN** 新 Runtime 扫描到旧 `.repoctopus` 中带 generation 的 Run、Publication 或 Journal
- **THEN** 当前 Change locator 忽略其执行资格并可报告只读 legacy 诊断，但不改写文件、不继续旧 Run且不要求调用方选择下一代次

#### Scenario: 当前 Run 的固定定义不兼容

- **WHEN** 唯一权威 Run 的 definition、composition 或 Provider 快照无法按声明兼容
- **THEN** 同一 Run 进入 `migration_required` 并保留精确差异，不创建替代 Run或重放外部副作用

#### Scenario: 活动 Post-merge 状态可唯一映射

- **WHEN** 旧状态具有唯一 change、完整 MR 集合、精确 merge facts、Provider 身份和下一收尾动作
- **THEN** 新 Runtime 只报告可核对的 legacy audit 投影，不创建新 Change Run、不继续旧副作用，并要求后续工作以普通新 Change 表达

#### Scenario: 两套状态给出不同下一动作

- **WHEN** 旧 Delivery 与 Post-merge 状态对同一 change 的 MR 集合或下一动作不一致
- **THEN** legacy audit 返回 `migration_required` 和精确差异，不启动新副作用、不创建替代 Run且不选择其中一套覆盖

### Requirement: Archive 终态绑定精确发布证明

Change Run MUST 只在 Archive 的隔离 OpenSpec 关闭候选通过后置验证，且全部预期业务发布项和最终规格发布项都具有 repository、base、head、published head OID 与唯一 MR identity 的完整 Publication Receipt 后进入 `completed`；规格发布必须已有 completed Publication Journal，MR 的 open、merged 或 closed 状态不得改变该判断。

#### Scenario: MR 已创建但尚未合入

- **WHEN** 全部发布项都精确匹配远端，Business MR 和最终 Change MR 仍处于 open
- **THEN** Runtime 接受 Publication Receipt 并完成同一 Change Run

#### Scenario: 发布项缺少精确远端身份

- **WHEN** 任一预期仓库没有可验证的 published head OID 或唯一匹配 MR
- **THEN** Runtime 保持 `phase=archive` 并阻断完成，返回缺失或歧义的发布项

#### Scenario: 已完成 Change 的 MR 后续变化

- **WHEN** 一致性审查发现业务 MR 的 head 或 state 在 Change Run 完成后变化
- **THEN** 系统保留原 Run 和 Publication Receipt，只创建独立审查事实或后续 Change，不重开或回退原 Run

#### Scenario: 业务发布完成但规格 Journal 未终结

- **WHEN** 全部 Business items 已有 Receipt，但最终规格项只到 prepared、committed 或 pushed
- **THEN** Runtime 保持 `phase=archive` 并从规格 Journal 的下一未确认动作恢复，不接受不完整 Publication Receipt

#### Scenario: 所有发布项完成且调用者未被修改

- **WHEN** Business 与 Specification items 都通过精确远端核对，规格 Journal completed，且调用者 branch/HEAD/index/worktree 与 Archive 前一致
- **THEN** Runtime 接受组合 Publication Receipt、进入 completed，并公开空 nextActions

### Requirement: Tracked Task 只表达 Build 阶段可完成工作

Repoctopus MUST 只把无需未来 Verify、Archive、MR 合入、发布或一致性审查事实即可证明完成的官方 Tasks checkbox 映射为 Build Work；跨阶段步骤必须由 lifecycle definition 的固定 Work、Validator 或非跟踪 Workflow follow-up 表达。

#### Scenario: Tasks 包含未来阶段 checkbox

- **WHEN** 规划清单把 Verify 报告、规格归档、MR 发布或后续一致性审查写成 tracked checkbox
- **THEN** Design 校验阻断批准并要求把该步骤改为生命周期 Work 或非跟踪说明

#### Scenario: Build 任务包含当前可执行验收

- **WHEN** checkbox 的实现与验收命令都能在 Build 阶段当前输入上完成
- **THEN** Runtime 将其映射为 Build Work，并由对应 Validator 决定是否完成

### Requirement: Completion Claim 与验证事实分离

Change lifecycle MUST 区分 pending Task、Runtime Work Outcome 形成的 completion claim 与可信用户在同一 Run 内批准的 `adopt-existing` completion claim；fresh 启动只接受当前 Run 的 Runtime Work completion，发现预先勾选且没有当前 Work Outcome 的 Task 时必须阻断并建立稳定 Human Decision，决定采用既有实现或恢复为 pending。任何 claim 都只允许结束或跳过 Build 调度，不得作为 Acceptance Evidence、Verify Gate 或 Archive 资格。

#### Scenario: 已实现 Change 首次进入 Runtime

- **WHEN** 用户为已获批且 Tasks 已勾选的 Change 启动唯一 Run，并批准采用既有实现边界
- **THEN** Runtime 在同一 Run 记录带来源摘要的 imported claims、避免重复派发 Build，并进入仍需完整 Acceptance Evidence 的 Verify

#### Scenario: Fresh Change 出现预先勾选任务

- **WHEN** fresh Run 读取到已勾选但没有当前 Run Work Outcome 的 Task
- **THEN** Runtime 保持 Build waiting 或 blocked，公开稳定采用决定或恢复任务状态的 continuation，不创建另一 Run

#### Scenario: Agent 只勾选全部 Tasks

- **WHEN** Agent 更新 checkbox 但没有产生当前 Work completion、可信采用决定和满足 Acceptance coverage plan 的 Receipt
- **THEN** Runtime 不得完成 fresh Build、越过 Verify 或进入 Archive

### Requirement: Verify 到 Archive 受 Acceptance Gate 保护

Change lifecycle MUST 只接受绑定当前 Verification Input、完整 Acceptance Set 和 coverage plan 的 satisfied Evidence Gate；Task revision 全部完成、Profile 节点总体成功或 Bundle identity 单独匹配均不足以触发 `Verify → Archive`。

#### Scenario: 弱 Profile 通过

- **WHEN** typecheck 与 architecture 节点通过但未覆盖当前 Change 的全部 Acceptance
- **THEN** Run 保持 Verify 并记录 incomplete Evidence，不创建 Archive Work

#### Scenario: Acceptance Trace 完整

- **WHEN** 当前 Bundle 的每条 Acceptance 都由允许的当前 Receipt 证明且 Gate 的 Run、Work、状态版本、composition 和指纹均匹配
- **THEN** Runtime 接受 Gate 并进入 Archive

### Requirement: 终结 Run 不公开执行型下一动作

Runtime、CLI、Dashboard 和 Telemetry MUST 在投影下一动作前先处理 Run 终态；`completed`、`failed` 和 `migration_required` 不得公开 `run next`、`archive.prepare` 或任何会产生副作用的执行建议。

#### Scenario: Archive 已完成

- **WHEN** Run 已接受 Publication Receipt 并处于 `phase=archive,status=completed`
- **THEN** 所有公共投影的 next actions 为空，历史 phase 仅作为终态上下文展示

#### Scenario: Run 正在等待可信决定

- **WHEN** Run 为非终态 waiting 且具有 Human Decision 条件
- **THEN** 投影只公开对应决定动作，不显示普通执行或重复 Archive 动作

### Requirement: Archive attempt 身份不可歧义

Archive CLI 和 Runtime MUST 分别命名 Verify Evidence attempt 与 Archive Work claim attempt，并在命令边界验证其类型；同一个 `--attempt` 参数不得根据子命令静默解释为 UUID 或整数。

#### Scenario: 准备 Archive 使用 Evidence attempt

- **WHEN** 调用方运行 `archive-prepare`
- **THEN** 命令只通过 `--evidence-attempt` 接受 Verify 产生的 attempt identity，并把它绑定到所选 Evidence Bundle

#### Scenario: 发布 Archive 使用 Work attempt

- **WHEN** 调用方运行或重试 `archive-publish`
- **THEN** 命令只通过 `--work-attempt` 接受 Git Work claim 序号；使用旧歧义参数时返回明确替代方式而不执行副作用

### Requirement: 每个核心阶段的声明 Work 都可从生产路径到达

内置 lifecycle definition 中的每个 Work kind MUST 具有由已接受事实触发的生产创建路径、唯一合法执行或决定方式、Validator 和后续转换；definition 不得声明只在测试或类型中存在的 Work，核心阶段也不得在没有 Work Outcome、Validator 事实或可信 Human Decision 时自动前进。

#### Scenario: 新 Change 进入 Open

- **WHEN** fresh Change Run 创建且尚无规划工件
- **THEN** Run 保持 `phase=open,status=running` 并公开可领取的 intake Work，不自动提交 `open-intake-ready`

#### Scenario: Open 中重复请求下一步

- **WHEN** `change.intake` 尚未产生被 Validator 接受的 Host Outcome，调用方一次或多次执行 `run next`
- **THEN** 每次都返回同一个 Open Work/attempt 或其当前 continuation，Run 不进入 Design，也不生成裸 `open-intake-ready` 事实

#### Scenario: 尝试伪造 Open 完成

- **WHEN** 调用方只提交 `open-intake-ready` observation、创建 change 目录/规划文件、伪造 Outcome 或直接请求 Design transition
- **THEN** Runtime 拒绝推进；只有绑定当前 Run、Work、attempt、claim、Receipt 和 `open.intake-ready` Validator identity 的接受事实才能进入 Design

#### Scenario: Design 工件尚不完整

- **WHEN** Open 已完成但 Proposal、Delta Specs、Design 或 Tasks 任一缺失或无效
- **THEN** Run 在 Design 创建 specification planning Work，由其 Validator 重新检查官方四类工件，不只返回无执行入口的 blocker

#### Scenario: Definition 声明不可达 Work

- **WHEN** 架构检查发现某个 Work kind 没有生产创建路径、Host/Contributor 或 Validator
- **THEN** builtin composition 验证失败并定位缺少的链路，测试 fixture 不能代替生产可达性

### Requirement: 生命周期验收必须捕获历史自动推进缺陷

Repoctopus MUST 将当前 `repoctopus-change@1.1.0` 第一次 `run next` 合成 `open-intake-ready` 并越过 Open 的行为保存为修复前必败回归；修复后的生产黑盒验收 MUST 对公共 continuation、中间 phase、追加式 trajectory 和实际受保护文件进行交叉核对，并证明重新引入自动 observation 时验收失败。仅证明最终 Run 到达目标 phase、只读取统一 projection 或从已进入 Build 的自举 Run 开始，不得作为五阶段执行正确性的证据。

#### Scenario: 在旧打包实现上建立 red baseline

- **WHEN** 历史回归从不存在 change 目录的 fresh Run 调用当前 `repoctopus-change@1.1.0` 的首次 `run next`
- **THEN** 测试捕获其错误的 Open → Design transition 并保持失败，直到生产实现删除自动 `open-intake-ready` 路径

#### Scenario: 重新引入 Open 自动推进

- **WHEN** 受控故障 fixture 在修复后的生产路径重新引入 `run next` 自动提交 Open 完成事实
- **THEN** 同一进程外黑盒 harness 必须因缺少 Host invocation、Validator identity 或错误的中间 phase 而失败，即使最终 projection 与文件看似正确

#### Scenario: 自举只从 Build 尾部开始

- **WHEN** 验证只提供 Build/Verify/Archive Receipt，未从 fresh Open 观察每个阶段的执行边界
- **THEN** 验证报告必须标记覆盖不完整，且不得宣称五阶段端到端通过

### Requirement: 预发布旧执行协议不得形成兼容债务

Repoctopus MUST 破坏性替换尚未正式发布的 generation、Open 自动推进、不可达 Work 和旧 claim/attempt 协议，删除其生产分支与兼容 fixture；旧开发 Run MAY 保留为只读审计文件，但新 Runtime 不提供 generation 参数、双读、双写、fallback Adapter 或旧 schema 执行路径。

#### Scenario: 加载旧 G1 bootstrap Run

- **WHEN** 旧 Run 的 identity 含 generation、会自动越过 Open 或缺少受管 Work 执行事实
- **THEN** Runtime 不把它解析为当前 Change，不执行旧路径，并允许新协议用稳定 Workspace/change 身份建立唯一 Run

### Requirement: 五阶段必须留下可核对的推进依据

Change Run MUST 为 Open、Design、Build、Verify 和 Archive 的每次前进记录对应 Work Outcome 与 Validator、Human Decision 或阶段专属确定性事实；仅观察到目标文件、checkbox、Git commit 或最终成功状态不得反推前一阶段已按流程执行。

#### Scenario: 最终仓库内容看似正确

- **WHEN** 仓库已有完整规划和实现，但 fresh Run 没有 Open、Design 或 Build 执行事实
- **THEN** Runtime 不得合成这些阶段的成功历史，并要求执行当前阶段 Work 或在同一 Run 提交可信 adopt-existing 决定

#### Scenario: 真实纵切完成

- **WHEN** 每个阶段的推进依据都属于相同 runId、对应 checkEpoch 和当前输入
- **THEN** projection 与 Trajectory 能按顺序定位 Work、决定、Validator 和 transition，不依赖事后目录推断

### Requirement: Change Run continuation 必须来自同一权威 checkpoint

Runtime、CLI、Dashboard 和 Telemetry MUST 从同一持久 Change Run checkpoint 投影当前 phase/status、Work attempt、packet identity、Wait、blocker 和 `execute|ask|wait|reconcile|done` continuation；恢复方不得根据阶段名、OpenSpec目录、Git diff、当前可变内容或历史对话另行推断下一动作。

#### Scenario: 新 Runner恢复活动 Change

- **WHEN** 原 Runner退出且另一个 Runner加载同一 Run
- **THEN** 新 Runner得到与 checkpoint一致的当前 Work/Wait 和 continuation，并在完成 packet、兼容性与多仓核对前不创建第二个 attempt

#### Scenario: 当前 Work 已改变规划文件

- **WHEN** 当前 Work 的 packet 已冻结且该 Work 在中断前按授权改变了 Change 规划文件
- **THEN** 新 Runner继续使用 checkpoint 引用的原 packet 与 attempt，不从已改变文件构造另一 continuation或执行包

### Requirement: `run next` 必须是 pull-based continuation 入口

Agent 或 Runner MAY 调用 `run next` 请求 Runtime 解析或调度当前 Action，但调用方不得提供目标 phase、替换当前 Work 或选择 Skill。Runtime MUST 只处理 definition 和当前 Run 已选定的 Action，并返回 `execute|ask|wait|reconcile|done`；`run next` 本身不得生成成功 Outcome、Validator acceptance 或 phase transition。每个完成写入的 Runtime/Host 命令 MUST 在同一响应返回新的 continuation，使 Agent 无需通过轮询猜测进度。

#### Scenario: Agent请求下一项工作

- **WHEN** 当前 Run 在 Open 且 `change.intake` 尚未完成，Agent 调用 `run next`
- **THEN** Runtime 解析或调度同一个 `change.intake` 及其固定 Skill/Host，返回 `execute` 或当前 wait/reconcile，不接受“进入 Design”或另一 Skill作为输入

#### Scenario: Outcome 验证后自动继续

- **WHEN** 当前 Action Outcome 通过 Validator 并由 Run CAS 合法推进到下一 phase
- **THEN** 同一响应返回下一 phase 的 continuation；`auto_transition=true` 可让客户端继续消费其 `execute`，`false` 只产生手动交接，不改变已提交 phase 或合法性判断

#### Scenario: 必须停止的 continuation

- **WHEN** continuation 为 Human Decision、原 Host running/unknown、failed、reconcile 或 manual handoff
- **THEN** Agent停止自动派发并处理对应决定、等待、核对或交接；重复 `run next` 不得创建第二个 Action、伪造结果或绕过停止条件

### Requirement: 阶段转换建立检查证据 epoch

Change Run MUST 维护从零开始且只由 Runtime 写入的 `checkEpoch`；每次接受 lifecycle transition 时必须与 phase/status 事实原子递增。阶段相关检查和验证结果必须绑定其启动 epoch，执行期间 epoch 改变或不可复用证据的 epoch 与当前值不一致时不得用于当前转换。

#### Scenario: 检查执行期间阶段改变

- **WHEN** 检查在 `checkEpoch=3` 启动，但完成前另一个合法转换把 Run 推进到 `checkEpoch=4`
- **THEN** Runtime 持久化该尝试及 `phase-changed` 失效原因，但不把结果接受为当前阶段证据

#### Scenario: Verify 失败回到 Build

- **WHEN** Verify Gate 失败并通过定义声明的转换回到 Build
- **THEN** 同一 `runId` 的 `checkEpoch` 递增，旧 Verify Evidence 保留审计但不能证明修复后的输入

#### Scenario: 可复用检查跨越阶段边界

- **WHEN** 检查被策略显式标记为 reusable，且命令、输入、环境、Provider 和证据摘要在新 epoch 下仍通过全部新鲜度校验
- **THEN** Runtime 可以记录复用事实；仅有 reusable 标记或旧成功结果不足以跨 epoch 接受证据

### Requirement: Open 与 Design 必须分别形成受审查边界

Change Run MUST 把 Open 和 Design 实现为两个独立的受管阶段。Open 必须在核对仓库、现有规格和输入事实后创建或修复 proposal、delta specs、design、tasks 四类 OpenSpec 工件协议，经 Provider 确认各类为 `ready` 或依据官方 schema 规则为 `skipped`，并在严格校验后建立绑定其语义摘要的 Human Decision；只有可信批准且批准后重新观察的摘要、Provider/schema identity 与 strict validation仍匹配才能进入 Design。Design 必须从已批准 Open 基线深化同一四类工件，经独立校验和第二个 Human Decision 批准后才能进入 Build。两个批准不得互相替代、合并或由 `auto_transition`、文件存在和 checkbox 状态推断。

#### Scenario: Open 四类工件通过严格校验

- **WHEN** Open Work交付当前 schema适用的官方工件，Provider对四类协议均报告已满足且 strict validation接受当前语义摘要
- **THEN** Runtime在 Open建立稳定 Human Decision并停止；在收到绑定该摘要的可信批准前不得创建 Design Work或转换 phase

#### Scenario: Open 官方跳过 Delta Specs

- **WHEN** Provider依据当前 schema与 Change元数据把 Delta Specs规范化为带稳定 identity的 `skipped`，其余适用工件为 `ready`
- **THEN** Runtime把四类工件协议视为已满足并继续严格校验，不自行读取元数据、查找第四个文件或把 `skipped` 改写为 `missing`

#### Scenario: Open 被拒绝或要求修订

- **WHEN** 用户拒绝 Open proposal或要求修订其中任一受控语义
- **THEN** Run保持 Open、使过期 proposal hash不可提交，并恢复或创建受管 Open Work，而不是进入 Design

#### Scenario: Design 深化同一 OpenSpec 工件

- **WHEN** 已批准 Open进入 Design并补足工程边界、决策、验证策略或可执行 Tasks
- **THEN** Design只更新同一 Change的四类 OpenSpec工件协议，严格校验后建立独立 Human Decision，不创建第五份 Design Doc、Build Plan、ADR或 implementation notes

#### Scenario: 只有 Open approval

- **WHEN** Open approval已接受但批准后重验、Design Work、Validator或 Design approval任一缺失
- **THEN** Runtime不得进入 Build，也不得把 Open approval解释为整个规划阶段已获批

### Requirement: 失败分类必须决定真实返工路径

Runtime MUST 根据当前权威身份、持久化失败事实、输入依赖和副作用边界计算一个恢复处置；Host、Agent 与调用方不得提交目标 phase 或恢复动作。处置只允许 `revise-design`、`revise-plan`、`continue-build`、`invalidate-evidence`、`retry-infrastructure`、`reconcile-external` 或 `halt`，并在同一 Run 保留历史事实、精确失效下游依赖并递增合法 transition 的 `checkEpoch`。

#### Scenario: Verify 发现实现行为失败

- **WHEN** Verify review 或 Gate 证明实现不满足当前批准规格，但规格、设计和 Task 语义仍有效
- **THEN** Runtime 选择 `revise-plan` 返回 Build，由修订计划产生普通 Execute Work，不返回 Design或创建特殊 Repair lifecycle

#### Scenario: Verify 依赖暂时不可用

- **WHEN** 失败来自 Evidence Provider、命令环境或其他基础设施，且没有事实证明实现、计划或批准设计错误
- **THEN** Runtime 选择 `retry-infrastructure` 并保持 Verify blocked/retry，不重开 Build Task、不使 Design approval 失效

#### Scenario: Archive 前发现验证输入陈旧

- **WHEN** Archive 尚未开始规格关闭或外部 publication 副作用，且当前 Verify identity 仅因已声明 Evidence 输入变化而失效
- **THEN** Runtime 选择 `invalidate-evidence` 返回 Verify 并只重采受影响 Evidence；若副作用已经开始则选择 `reconcile-external` 并保持 Archive

#### Scenario: 批准规划语义已经改变

- **WHEN** Runtime 观察到当前 Proposal、Delta Specs、Design、Tasks 或 Change metadata 的规范化语义身份不再等于可信批准身份
- **THEN** Runtime 选择 `revise-design`，原子建立新的 Design Work并精确失效依赖旧规划的事实

#### Scenario: 当前 Build Work 输入仍有效

- **WHEN** Build Work 失败、中断或被校验拒绝，但其规划、计划、Binding、Work input 与副作用边界仍可安全续行
- **THEN** Runtime 选择 `continue-build` 并恢复同一 Work 的合法下一 attempt，不重建 Design、Build Strategy或 Build Plan

### Requirement: 兼容 definition 升级必须显式恢复 Work

受保护 composition 的原地兼容升级 MUST 同时精确声明旧 Plugin implementation identity 与旧 lifecycle definition digest；若先前 Runtime 已因该 definition drift 进入 `migration_required` 并清空 current Work，升级后 MUST 保留聚合事实并在递增的 checkEpoch 创建新 Work，不得恢复旧 composition 的 Work packet 或手工改写 phase。

#### Scenario: 精确声明的 Archive definition 补丁恢复

- **WHEN** 未开始远端 publication 的 Archive 因 definition drift 停止，当前 Plugin 与 definition 都精确声明该旧实现兼容
- **THEN** Runtime 在同一 runId 恢复 Archive 聚合，保留 Evidence、Archive input 和 closure，并在新 checkEpoch 建立新的 delivery publication Work
- **AND** 若新旧 Work 的稳定 `workId` 相同，Runtime 使用更高 attempt 并以新 `checkEpoch` 建立独立执行身份；因崩溃留下未绑定 Run checkpoint 的孤儿 Action Intent MAY 形成安全的 attempt 间隙

#### Scenario: 缺少任一精确兼容声明

- **WHEN** Plugin code/descriptor 或 lifecycle definition digest 没有被当前实现精确列为兼容，或者 authority、state schema、effective config 已变化
- **THEN** Run 保持 `migration_required`，Runtime 不重建 Work且不执行任何外部副作用

### Requirement: Open 在规划批准前固定执行隔离意图

Repoctopus MUST 在接受 Open approval 前验证可信用户选择的 `current|branch|worktree` 与冻结的 project snapshot、repository topology 和 checkout facts 兼容，再把 `ExecutionWorkspaceIntent` 固定到同一 Run；无效选择不得写入 lifecycle 或 Specification approval Store，本机绝对路径不得进入可移植语义。Build Configure MUST 由 binding 权威把失败分类为 `intent-revision | binding-retry | halt`，调用方不得解析错误文本或静默降级。只有未批准 Build Configuration 的 `intent-revision` 可以在同一 Run 返回 Open；新意图获批前必须清除依赖旧意图的下游状态，随后创建新的 Design Work。

#### Scenario: Open 尚未选择隔离方式

- **WHEN** 四类 OpenSpec 工件已有效但当前 Run 没有可信 isolation 决定
- **THEN** Runtime 保持 `phase=open,status=waiting` 并展示三个模式的实际影响，不创建 Design Work

#### Scenario: Open 选择与 checkout facts 不兼容

- **WHEN** 当前注册 checkout 是 linked worktree而用户在 Open 决策中选择 `current`
- **THEN** Runtime 在写入 lifecycle intent 或 Specification approval 之前拒绝该选择并保持同一 Human Decision request 可重试

#### Scenario: Build 发现 binding 与 Open 意图不一致

- **WHEN** 未批准 Build Configuration 的 Configure Work 发现 Open intent 与真实 checkout 的 isolation/ownership facts 不兼容
- **THEN** Runtime 在同一 runId 受保护地返回 Open wait，清除旧 intent、Tasks、Build Protocol 与 Verify/Archive 输入；可信用户选择的新 intent 再次绑定成功后进入新的 Design Work

#### Scenario: Intent 修订 wait 被重复 pull

- **WHEN** Run 正在 Open 的 `workspace-intent:*` Human Decision wait 中且调用方重复执行 `run next`
- **THEN** Runtime 原样返回同一 waitId 与 checkEpoch，不创建或替换为普通 `open-approval:*` wait；只有匹配 request 的可信 isolation 决定可以推进到新的 Design Work

#### Scenario: Binding failure 不是 isolation 问题

- **WHEN** Build Configure 发现 remote repository identity 或 repository topology 与冻结 project snapshot 不一致
- **THEN** Runtime fail closed并报告不可通过 isolation 修订解决的诊断，不提供自动降级或误导性的模式选择

#### Scenario: Binding 可在原 intent 下修复

- **WHEN** intent 本身合法但 Runner 提供了错误 checkout path、branch 或缺少 worktree ownership facts
- **THEN** binding 权威返回 `binding-retry`，Runtime 保持 Build 和原 intent并要求修复 binding，不返回 Open要求用户改变模式

#### Scenario: 同一 Change 被再次启动

- **WHEN** 调用方试图通过再次 `run start` 绕过错误的 intent
- **THEN** Runtime 恢复由 Workspace/change identity 确定的原 Run，要求走正式 intent 修订 transition，不创建第二个 Run

### Requirement: Build 使用固定的受管内部协议

Repoctopus MUST 在唯一的 Build phase 内按 `Configure → Plan → Plan Evidence → Execute → Check` 推进受管工作，并仅在 Check 接受当前输入后请求进入 Verify。上述步骤 MUST 是 Runtime definition 中可恢复、可审计的 Action，而不是新增 lifecycle phase；调用方与 Host 不得跳步、选择下一步或用最终代码状态补写缺失步骤。

#### Scenario: 首次进入 Build

- **WHEN** Design approval 有效且 Runtime 准备开始实现
- **THEN** 下一 Action 是 Build Configure；Runtime 在配置获得可信批准前不得创建可执行实现 Work

#### Scenario: 调用方请求跳过计划

- **WHEN** Agent 或 Runner 请求从 Build Configure 直接执行代码，或从 Execute 直接进入 Verify
- **THEN** Runtime 拒绝请求并返回固定协议中尚未满足的 Action、Validator 或 Evidence

#### Scenario: Build Check 发现实现失败

- **WHEN** 当前计划的实现 Work 已完成但 Build Check 不接受结果
- **THEN** Runtime 在同一 Build phase 中使相关 Check 失效并回到 Plan revision 或 Execute，不创建新 phase 或替代 Run

### Requirement: Build Configuration 只允许受支持的固定策略

Repoctopus MUST把Build的稳定人类/团队语义建模为版本化`BuildStrategy`，仅允许`executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard`和`isolationIntent=current|branch|worktree`。Design Human Decision MUST绑定完整Strategy semantic digest；Build Configure MUST只解析和验证独立ExecutionBinding。Runtime不得因合法Work间required capabilities不同、当前Work暂无兼容Host、进程恢复或同摘要返工而重建Binding或重复请求批准。只有Strategy语义、coordinator Host identity或Binding-owned Workspace facts变化时才能按对应权威失效。

#### Scenario: 兼容Host执行不同Build Action

- **WHEN** 同一coordinator Host依次为Configure、Plan、Execute和Check声明各自Work所需能力，Strategy和Workspace Binding未改变
- **THEN** Runtime保持同一Strategy和ExecutionBinding，逐Work完成claim preflight，不创建额外Human Decision或Configure Work

#### Scenario: 用户批准受支持的配置

- **WHEN** Runtime根据已批准Open、仓库拓扑、Tasks和用户选择提出合法BuildStrategy，当前composition兼容该策略，且可信用户批准Design语义摘要
- **THEN** Run固定Strategy identity/digest，后续Configure、Plan、Work、Check和遥测都引用该Strategy，不再创建常规Build Configuration approval

#### Scenario: 兼容 Host 或 checkout 变化

- **WHEN** 恢复时coordinator Host identity或本地checkout变化，但isolation intent、repository ownership和全部Strategy语义仍满足
- **THEN** Runtime重新验证并冻结新的ExecutionBinding，使依赖旧Binding-owned输入的Plan/Evidence失效，但复用已批准Strategy且不建立新Human Decision

#### Scenario: 实际隔离没有可信 binding

- **WHEN** Runner或Host只声明isolation名称，但没有为受影响仓库提供可验证checkout、branch、head、worktree ownership与Workspace facts
- **THEN** Build Configure阻断并报告ExecutionBinding诊断，不从路径或当前进程目录猜测，也不要求用户批准无法验证的机器事实

#### Scenario: 请求 Hotfix profile

- **WHEN** 调用方请求Hotfix、Tweak或任一未声明workflow profile
- **THEN** Runtime拒绝请求并保持唯一完整Change lifecycle，不把profile映射成隐藏快捷路径

#### Scenario: 批准后请求切换执行模式

- **WHEN** 已批准Strategy的execution/TDD/isolation语义被显式改变
- **THEN** Runtime使旧Strategy approval失效并建立绑定新语义摘要的Human Decision，不静默重写或把机器Binding重验冒充策略批准

#### Scenario: direct TDD 模式执行任务

- **WHEN** Strategy选择`tddMode=direct`
- **THEN** Work可以不强制逐任务先红后绿，但仍必须声明相关测试、执行回归检查并通过Build Check与Verify

#### Scenario: 当前Work缺少兼容Host

- **WHEN** Strategy和ExecutionBinding仍有效，但没有Host声明当前Work的完整capabilities
- **THEN** Runtime保持当前phase、Work和checkEpoch并返回结构化blocked continuation；它不得把Host availability误分类为Strategy或Binding变化

#### Scenario: 协调Host或Workspace事实变化

- **WHEN** coordinator Host identity、repository topology、branch/worktree ownership、isolation或local overlay与当前Binding不一致
- **THEN** Runtime派发唯一Build Configure revalidation并精确失效依赖旧Binding的后继事实，不重放旧Host Outcome

### Requirement: Verify 失败通过 Build Plan revision 返工

当 Verify 接受实现缺陷时，Runtime MUST 在同一 Run 保留失败 Evidence、递增 `checkEpoch` 并返回 Build Plan 复核及安排修复；只有计划内容实际变化时才形成对应 Plan revision。Runtime MUST 基于可核对的影响范围及实际输入依赖保留仍有效的 Task completion 和 Package completion；修复通过普通 Execute Work、新 Build Check 和 Verify 完成。单纯进入返工不得声明原计划发生漂移，不得重开全部 Task、创建 Repair lifecycle、特殊 Work kind 或并行修复权威。

#### Scenario: 缺陷只影响一个工作包

- **WHEN** Verify 的失败证据与当前已接受计划可证明缺陷只影响一个 Work Package，且批准规格和 Task 语义未改变
- **THEN** Runtime 仅使该包及受影响下游包的完成凭证失效，保留其他当前有效的完成凭证，通过 Plan 安排普通 Execute Work 修复并重新 Check 和 Verify
- **AND** 进入 Plan 时不得仅因阶段回退而把全部包进度归零；原计划内容未变时保留原计划语义身份

#### Scenario: 缺陷改变设计语义

- **WHEN** Verify finding 证明批准设计或 Task 语义本身无效
- **THEN** Runtime 按既有语义漂移规则返回 Design，不把设计修改伪装成普通实现修复，并按真实变化重新核对后继事实

#### Scenario: 无法确定最小影响范围

- **WHEN** 已持久化的失败证据、当前计划及依赖事实不足以安全界定修复范围
- **THEN** Runtime 返回可操作的阻断或 Human Decision，或使用 definition 显式声明的保守扩大策略并记录依据；不得仅因范围未知而静默失效所有包，也不得伪造最小范围并继续复用不可信凭证

#### Scenario: 真实全局失效

- **WHEN** 可核对的规划或依赖变化证明全部包均受影响
- **THEN** Runtime 可以使全部相关完成凭证失效，并记录全局影响依据，不能把保留进度优先于正确性

#### Scenario: 修复期间新进程恢复

- **WHEN** 在失败已持久化、修复计划已接受、修复包已完成或新 Check 已接受的边界退出，随后由新进程调用 resume 或 next
- **THEN** 同一 Run 恢复原失败证据、当前修复范围和仍有效的完成凭证，不重复审批有效配置、不重放已接受修复，也不再次扩大失效范围

### Requirement: Archive 关闭前必须重验冻结输入

Repoctopus MUST 在执行 `specification.close` 或 publication 副作用前，使用与 Verify 相同的输入依赖权威比较当前事实与冻结 Verification Input。等价收尾 MUST 保留有效验证证据，发布坐标仍由独立 preflight 核对。声明的证据依赖确实漂移且尚无 Closure 或 Publication Receipt 时，Runtime MUST 退役失效 close execution、清除相应 Archive input 并返回 Verify，只重采受影响证据；规划授权同时失效时 MUST 按既有最高受影响权威规则直接恢复 Design。副作用已经开始后 MUST 使用既有 journal/reconciliation，不得回滚或伪造重验。

#### Scenario: Close Work 冻结后源树漂移

- **WHEN** `specification.close` Work 已创建或验证，当前事实使冻结 Verification Input 声明的产品内容依赖失效，且尚未开始关闭或发布副作用
- **THEN** Runtime 在调用 Specification provider 前返回 Verify、创建新的 `evidence.verify` Work 并退役旧 execution checkpoint，只要求重采受影响的检查

#### Scenario: 漂移同时改变规划语义

- **WHEN** Archive 的同一次受保护观察同时发现批准的规划语义失效与其下游 Evidence 依赖漂移
- **THEN** Runtime 复用既有最高受影响权威判定，只建立一次 Design 恢复及下游失效事实，不先退回 Verify 再因相同根因退回 Design

#### Scenario: Closure 已经产生

- **WHEN** Specification Closure 或 Publication Receipt 已存在
- **THEN** Runtime 不回退到 Verify，而继续既有 publication journal/reconciliation 流程

#### Scenario: Verify 后只提交完成复选框

- **WHEN** 当前 Run 已合法完成 Task 并通过 Verify，随后 Workspace 仅暂存和提交相同完成状态，Provider 证明规划语义未变，检查也未声明消费该 Git 身份或 checkbox
- **THEN** 新进程的恢复和 Archive preflight 保留已接受的有效 Gate、Bundle 和完成事实，不创建额外的 Verify Work或重跑检查；发布坐标未变时保持当前 Archive Work，首次准备或合法更新发布 checkpoint 的正常 transition 仍可递增 epoch

#### Scenario: 等价收尾改变已冻结发布坐标

- **WHEN** 验证依赖仍有效，但实际发布提交与已冻结 Archive input 不同，且关闭或发布副作用尚未开始
- **THEN** Runtime 阻断使用旧发布输入，重新执行受保护 preflight，核对批准的分支、远端、提交范围、当前发布坐标及验证证据；只有重验通过才建立匹配的发布 checkpoint，不因发布来源变化使有效 Verify Evidence 失效

#### Scenario: 收尾提交影响显式 Git 依赖

- **WHEN** 相同收尾提交改变了某个检查明确声明消费的 Git 身份，而规划语义仍有效
- **THEN** Runtime 只使该检查及其证据后继失效，返回合法 Verify checkpoint，不以等价规划语义跳过该项重验

#### Scenario: 重验期间输入来源暂时不可用

- **WHEN** Archive preflight 无法读取 Provider 或实际依赖，尚不能证明有效或失效
- **THEN** Runtime 保留当前证据、Work 和副作用边界并返回受限重试或 reconciliation，不把不可用误判为实现失败或规划返工

### Requirement: 规划授权失效必须原子恢复 Design checkpoint

当 Build、Verify 或尚未发生不可逆副作用的 Archive 观察到当前 Specification Provider 的规划语义或 trusted Design approval 不再授权 lifecycle 的 planning identity 时，Runtime MUST 通过带 `semantic | approval-authority` 分类的受保护 transition 原子回到 Design。Runtime MUST 在同一次 Run 提交中设置新的 `specification.plan` Work、递增 `checkEpoch`、退役不匹配的 execution checkpoint，并按依赖关系保留或失效 Tasks、Build Configuration、Plan、Package completion、Verification、Archive 与 Closure 输入。

#### Scenario: Verify 收尾提交改变规划语义

- **WHEN** Change 已进入 Archive，但 Verify 收尾提交改变 Proposal、Design、Delta Specs、Tasks 语义或 Change metadata
- **THEN** 下一个受保护 Runtime pull 在任何关闭或发布副作用前一次提交 Design phase、新 `specification.plan` Work、新 epoch 与精确下游失效事实

### Requirement: 非规划权威变化不得触发 Design 恢复

Runtime MUST NOT 将 composition、执行进度或仅 publication provenance 的变化误分类为 planning invalidation。规划授权失效的恢复不得留下无 current Work 的 Design 中间态、复用无效 approval、创建第二个 Run或要求手改 Store。

#### Scenario: Publication provenance 单独变化

- **WHEN** 当前规格语义和 trusted Design approval 仍有效，但 source commit 或其他 publication provenance 发生变化
- **THEN** Runtime 保留当前 planning authority，不回到 Design，也不创建新的规划批准请求

#### Scenario: 当前 approval 不再有效但语义摘要相同

- **WHEN** Archive preflight 能读取相同 planning semantic digest，但无法证明与该 Run 绑定的 trusted Design approval 仍有效
- **THEN** Runtime fail closed 并回到新的 Design approval Work，不把 lifecycle 中的 planning identity 单独视为发布授权

#### Scenario: 重复观察相同失效

- **WHEN** 进程在恢复提交后退出，另一个 Runner 对同一 revision 再次观察相同规划失效
- **THEN** Runtime 返回已经存在的 Design checkpoint 或明确 revision conflict，不创建第二个 Work、第二次 invalidation 或重复副作用

#### Scenario: 陈旧 Runner 提交失效观察

- **WHEN** planning invalidation observation 的 `expectedRevision/fromPhase` 不再匹配 CAS 内读取的当前 Run
- **THEN** Runtime 拒绝该陈旧观察并要求调用方重读当前 Action，不覆盖较新的 phase、Work 或批准结果

#### Scenario: composition 变化但规划语义不变

- **WHEN** 当前 composition identity 与 Run 记录不同，但 Specification Provider 返回相同 planning semantic identity
- **THEN** Runtime 先走 composition compatibility 或 migration 判定，不刷新 Design approval，也不清空 Build Protocol

#### Scenario: 仅 publication provenance 改变

- **WHEN** source branch 的规范化 remote identity 或已发布 OID 改变，但规划语义、目标分支与批准 proposal 均未改变
- **THEN** Runtime 只刷新 publication provenance 或 Archive 输入，不返回 Design

### Requirement: Open 校验失败必须形成可执行恢复回环

Runtime MUST 把 Open Host Outcome、Provider Evidence acceptance和 Human Decision建模为不同事实。当前 Provider成功证明工件、strict validation、manifest或 lifecycle Validator确定性无效时，Runtime MUST 在一次 revision-bound Run CAS中保留 `phase=open`、安装新的 `change.intake` Work、递增 `checkEpoch`并退役旧 execution checkpoint；不得产生 `currentWork=null` 的 repair中间态、无生产入口的 next-action标签或新的 Run。Provider观察结果未知时 MUST 保留原 Work/Outcome并进入 reconciliation，不得盲目重新执行 Host。

#### Scenario: Open Outcome 后 strict validation 失败

- **WHEN** 当前 `change.intake`已有成功 Host Outcome，但 Provider成功返回 strict invalid和可定位诊断
- **THEN** Runtime原子发布新的 Open repair Work与 epoch，旧 execution只保留为历史，`run next`可领取新 Work

#### Scenario: Provider 观察不可用

- **WHEN** Provider、Store或未分类程序错误使 Runtime无法判断当前工件有效或无效
- **THEN** Runtime保持原 Work、Outcome、attempt和 invocation，返回 reconciliation并在下一次受保护 pull重新观察，不派发 repair Work

#### Scenario: 批准后摘要漂移

- **WHEN** 用户批准的 Open摘要在进入 Design前被重新观察为不同摘要或 strict invalid
- **THEN** 旧批准不得推进，Runtime在同一 Run返回新的 Open Work；新摘要通过 Evidence后必须建立新的 Human Decision

#### Scenario: 重复恢复 Open repair

- **WHEN** 多个 Runner或重复 `run next/resume`观察到同一确定性 Open失效
- **THEN** 只有一个 revision-bound transition安装唯一 repair Work，其他调用重读相同 Work/epoch且不重复调用 Host

### Requirement: Runtime 失效必须使用稳定身份依赖图

Change Run MUST 分别记录 planning semantics、approval authority、composition、Build Configuration、Build Plan、Work Package、execution checkpoint、verification input 与 publication provenance 的稳定身份及依赖；变化只能失效直接依赖该身份且无法证明兼容的事实，禁止用单一聚合摘要触发无差别重建。

#### Scenario: Build Plan 局部修订

- **WHEN** 新 Plan revision 保留某个 Work Package 的稳定 identity、依赖、输入和 Validator profile
- **THEN** Runtime 保留该 Package completion 及其匹配 Evidence，只为变化包及依赖后继创建新 Work

#### Scenario: 无法证明兼容范围

- **WHEN** Runtime 缺少计算安全最小失效范围所需的身份或依赖事实
- **THEN** Runtime fail closed 为受限 Human Decision、reconcile 或 definition 声明的保守失效，并记录未能保留的原因

### Requirement: 等价输入的 continuation 必须幂等

相同 Run revision、current Work、attempt、`checkEpoch` 与输入身份上的重复 `next`、`resume`、批准提交、Outcome 重放或恢复 MUST 返回同一逻辑 continuation 或明确的 revision conflict；Runtime 不得重建 Work、Build Configuration proposal、Build Plan、Human Decision request、invalidation 或外部副作用。

#### Scenario: 相同配置重复进入 Build Configure

- **WHEN** Runner 在 Build Configuration proposal 已提交后断开并以相同 checkpoint 恢复
- **THEN** Runtime 返回原 proposal 与待处理 continuation，不建立第二次配置批准

#### Scenario: 提交成功后响应丢失

- **WHEN** Run CAS 已接受 transition，但调用方未收到响应并重放相同命令
- **THEN** Runtime 从已提交 checkpoint 返回该 transition 之后的 continuation，不重复写入事实或执行副作用

### Requirement: Build 策略只在语义改变时请求人工决定

Repoctopus MUST 以 `decisionKind + semanticDigest` 判定 Human Decision 的创建、复用和失效。正常 Change 固定保留 Open 与 Design 两个审查边界；Design approval 绑定 BuildStrategy，但实际 Skill composition identity 只能由独立 compatibility authority 处理。相同摘要的重试、re-entry、恢复、兼容 composition adoption 和机器事实变化 MUST NOT 产生重复待处理请求。

#### Scenario: 同摘要返工重新进入 Build

- **WHEN** Verify finding 返回 Build，Strategy 摘要未改变且当前 composition 与既有 checkpoint 兼容
- **THEN** Runtime 复用原批准并从 Plan revision/ExecutionBinding 验证继续，不创建新的配置确认

### Requirement: Change Run 创建前固定合法的工作区启动绑定

Runtime MUST 在持久化 Change Run、Work、Skill binding、Desktop activation 或成功遥测事实之前，从可信 Workspace Repository inspection 形成启动绑定，并验证 checkout 已附着到 source branch、source 与 target 不同、repository identity 和拓扑与本次 project snapshot 一致。Runner 负责准备 checkout；Runtime 不创建、切换或修复 Git branch/worktree。

#### Scenario: 从目标分支启动 Change

- **WHEN** Runner 请求以当前 checkout 的 `main` 作为 source，并以 `main` 作为 target 启动新 Change
- **THEN** Runtime 返回结构化 `workspace-binding-invalid`，且 Run Store、Work execution、Desktop activation 和 lifecycle trajectory 均不存在该 Change 的新成功事实

#### Scenario: 从已准备的功能分支启动 Change

- **WHEN** Runner 已准备 attached source branch，source 与 target 不同，且所有 Workspace Repository facts 与 project snapshot 匹配
- **THEN** Runtime 创建唯一 Change Run，并把规范化的 source、target 与 repository identity 作为稳定启动身份的一部分

#### Scenario: detached HEAD 启动 Change

- **WHEN** Workspace Repository inspection 返回 detached HEAD 或无法证明当前 source branch
- **THEN** Runtime 在创建 Run 前拒绝请求并返回可定位的 binding 诊断，不把错误延迟到 Specification Provider 或 Archive

### Requirement: 稳定启动只能幂等恢复同一绑定

相同 Workspace/change 的重复启动 MUST 先比较已冻结的 workflow、trigger、project snapshot 和 workspace binding identity。完全等价时返回原 Run 和当前 continuation；任一绑定事实不同时返回结构化 conflict，保持原 checkpoint 不变，不构造或记录候选 Work，不通过再次启动重绑活动 Run。

#### Scenario: 等价启动请求重放

- **WHEN** Runner 因响应丢失而以相同 trigger、project snapshot、source、target 和 repository identity 重放 `run start`
- **THEN** Runtime 返回原 Run、原 current Work/attempt 和逻辑等价 continuation，不新增 `work.created`、Human Decision 或 Host invocation

#### Scenario: 启动后切换分支再重试

- **WHEN** 已有 Run 绑定了一个 source branch，而调用方切换 checkout 后再次启动相同 Workspace/change
- **THEN** Runtime 返回 `workspace-binding-conflict` 和原 Run identity，不以新 project snapshot 创建 Work，也不把新 binding 写入旧 Run

### Requirement: Open 观察错误按可判定性分类

Runtime MUST 将创建前工作区输入无效、Provider 明确返回的规格无效、Provider 暂时不可用和外部执行结果未知分为不同事实。只有无法判定原外部执行结果时进入 Host reconciliation；已接受 Open Outcome 后的暂时 Provider 故障只重新观察原 checkpoint。Open Outcome validation 与 planning gate observation MUST 是可恢复的顺序 checkpoint：第一层已通过时，后续 pull MUST 从持久化 `validated` checkpoint 继续第二层 observation，不得回退、重放 Host或从 phase/current Work标签猜测执行入口。

#### Scenario: Provider 暂时不可用后恢复

- **WHEN** Open Host Outcome 已接受，任一只读 Provider/planning observation 因暂时基础设施错误无法返回有效或无效结论，随后同一 observation authority恢复
- **THEN** Runtime 保留原 Work、Outcome、attempt、checkEpoch和 invocation，在下一次受保护 pull从最近已接受 checkpoint重新观察并继续原 gate，不重放 Host或创建 repair Work

#### Scenario: strict validation 之后 planning observation 暂时不可用

- **WHEN** Open Host Outcome 已接受，artifacts inspection、strict validation 与 Outcome validator 已通过并持久化 `validated`，随后 published branch 或 planning approval observation 因暂时基础设施错误不可用
- **THEN** Runtime 返回绑定原 Work、attempt、checkEpoch、Outcome、receipt 和 invocation 的 `reobserve`，不创建 repair Work、不递增执行身份、不调用 Host reconciliation

#### Scenario: planning observation 恢复

- **WHEN** 上述 Run 在 Provider 恢复后执行下一次受保护 `run next`
- **THEN** Runtime 将持久状态投影为 `reobserve/open-gate-pending`，直接从 `validated` checkpoint重试 planning gate，成功后进入唯一 Open Human Decision或已批准的 Design continuation，Host invocation 与 Skill consumption计数不变

#### Scenario: planning observation 连续不可用

- **WHEN** 相同 Run 被重复 pull且 planning observation 仍暂时不可用
- **THEN** Runtime 幂等返回同一逻辑 `reobserve`，不回退到 `execute`、不新增 attempt/checkEpoch/approval request，也不把只读观察失败升级为未知 Host 结果

#### Scenario: Provider 明确返回 strict invalid

- **WHEN** Provider 成功返回当前四类规划工件 strict invalid 和可定位诊断
- **THEN** Runtime 通过单次 revision-bound transition 安装唯一 Open repair Work并退役旧 execution，不进入 Host reconciliation

#### Scenario: 分支约束错误在 Open inspection 中被发现

- **WHEN** 遗留或并发状态使 Provider inspection 发现 source 与 target 相同等确定性启动输入错误
- **THEN** Runtime 返回受限 binding/input conflict并保持原 checkpoint，不把该错误标记为 Provider unavailable，也不调用只适用于未知 Host 结果的 reconciliation

### Requirement: Change Run 必须冻结 Build source branch 授权策略

Change Run MUST 把规范化 protected branch patterns 与已解析 target branch 作为稳定触发输入冻结。Build、恢复和重放 MUST 使用冻结事实，不得在 Plan 或 Execute 时从可变配置文件重新猜测授权策略。配置或 target branch 与已冻结输入不兼容时 MUST fail closed并通过正式 Runtime identity/Binding 修订处理。

#### Scenario: 启动时冻结团队策略

- **WHEN** Runner 使用包含 `main`、`master` 和 `release/*` 的有效项目配置启动 Change
- **THEN** Runtime 把规范化模式和本次 target branch 纳入 trigger identity，后续 Plan 校验使用同一事实

#### Scenario: 执行前配置文件被修改

- **WHEN** Run 启动后本地 YAML 的 protected branch patterns 发生变化，但 Run 尚未按正式入口修订
- **THEN** Runtime 不静默采用可变文件绕过或扩大旧授权，并返回配置身份不兼容或正式恢复入口

### Requirement: Package Completion 必须原子推进 Build workspace checkpoint

Repoctopus MUST 在接受 Execute Outcome 时，把 Outcome validation、Runtime Git observation、Package Completion、Specification Task receipt、BuildWorkspaceCheckpoint 和下一 Runtime-selected Work 作为单一可恢复转换处理。任何一步失败 MUST 不得留下已完成 Task、半更新 checkpoint 或无 Plan 的 Configure 状态。

#### Scenario: 首个多仓 Package 完成

- **WHEN** 三个有序 package 的首包通过验证并合法推进其写集仓库 HEAD
- **THEN** Run 保留原 Plan/Plan Evidence，记录 1 个 completion 与新 checkpoint，并直接派发第二个 ready Execute Work

#### Scenario: Completion 验证失败

- **WHEN** Evidence、write scope、repository ancestry 或当前 Work identity 任一验证失败
- **THEN** Runtime 保留当前 Work 与最后接受的 checkpoint，不完成 Task、不创建下一 Work且不回退整个 Build Protocol

### Requirement: Build Check 必须验证最终 workspace checkpoint

Repoctopus MUST 让 Build Check 绑定全部 Package Completion 后的最终 BuildWorkspaceCheckpoint。Check Outcome 接受前 live workspace MUST 与该 checkpoint 精确一致；review 期间需要代码修改时 MUST 返回 finding 并由 Runtime 派发后续 Build repair，而不是静默推进 Verify。

#### Scenario: Check 观察到额外 commit

- **WHEN** Build Check 执行期间任一登记仓库 HEAD 超出冻结 checkpoint
- **THEN** Runtime 拒绝 Check Evidence、保留 Build 状态并要求明确 repair/replan，不把额外 commit 自动纳入已验证结果

### Requirement: Workspace progress 恢复必须 fail closed

Repoctopus MUST 只从持久 Binding、BuildWorkspaceCheckpoint、Package Completion 和 Git observation 恢复 Build 进度。精确直接前驱只有在能够从 Configure 重新建立 checkpoint 时才可 adoption；其他旧状态 MUST 进入 migration required，不能猜测 revision 或修改 Store。

#### Scenario: 从旧 head-revalidation checkpoint 恢复

- **WHEN** 旧 Run 已由错误逻辑回到 Configure，当前 branch/ownership/Host 可重新验证且没有已接受 completion
- **THEN** Runtime 可以接受新 Binding 并从当前 HEAD 建立初始 checkpoint，重新产生 Plan，而不沿用旧错误 Plan Evidence

### Requirement: 执行隔离意图必须与交付目标分支分离

Repoctopus MUST 将可信用户批准的 `current|branch|worktree` 隔离意图、逐仓 Execution Binding 与 Change Delivery source/target coordinates 建模为独立权威事实。`ExecutionWorkspaceIntent` MUST NOT 把 delivery target branch 解释为一个由全部执行仓共享的 branch；`ExecutionWorkspaceBinding` MUST 逐仓记录真实 attached branch、HEAD 与 worktree ownership。Runtime MUST 在 Open 批准前验证 topology、repository identity 和所选隔离形态，但只有 Build Plan 的精确 write scopes 可以决定哪些仓必须离开 protected branch。

#### Scenario: 多仓 branch 隔离不要求同名分支

- **WHEN** Workspace 位于冻结的 Change source branch，若干业务仓仍位于 `main`，另一个业务仓位于不同名称的功能分支，且所有 checkout 的 topology、remote identity 与 branch facts 合法
- **THEN** Open 的 branch isolation 预检成功，Runtime 持久化隔离 Intent并让逐仓 Binding保留各自 branch，不把 delivery target branch 或 Workspace 的 source branch 应用到其他仓

#### Scenario: Delivery target 不参与执行 branch 比较

- **WHEN** ChangeStartBinding 冻结 `sourceBranch=codex/change` 与 `targetBranch=main`，用户批准 branch isolation
- **THEN** Runtime 使用 `main` 作为启动、protected policy 与 Delivery target 事实，但不得要求 Workspace 或任一业务仓的执行 checkout 位于 `main`

#### Scenario: 只读仓在 Open 保持 target branch

- **WHEN** Open 阶段尚未形成 Build Plan write scopes，业务仓绑定在受保护的 target branch
- **THEN** Runtime 不因该 branch 单独拒绝 Open；Plan 后若该仓为只读则继续允许，若成为可写仓则由既有 protected branch validation 在 Execute 前拒绝

#### Scenario: Runner 在 Plan finding 后准备写仓分支

- **WHEN** Plan 因可写仓仍位于 protected branch 被拒绝，Runner 为该仓准备并公开合法 source branch
- **THEN** Runtime 通过 Execution Binding revalidation 精确失效依赖旧 Binding 的 Plan并重新 Configure/Plan，不要求用户重做未变化的 Open isolation approval

#### Scenario: 执行 checkout 身份漂移

- **WHEN** checkout 的 repository identity、topology、isolation ownership 或已接受 Binding branch 与恢复事实不一致
- **THEN** Runtime fail closed并使用既有 binding recovery 分类处理，不得回退为 delivery target branch、猜测统一 branch 或静默重绑定

### Requirement: terminal Run 的 continuation 必须由当前 checkpoint 绝对决定

当权威 Change Run checkpoint 已进入 completed terminal status 时，Repoctopus MUST 在完整状态查询、`run resume` 与 `run next` 中一致投影 `done/terminal` continuation、空 current Work/attempt 和空 next actions；历史 `continuation.selected`、全局 reconciliation 标志、Trajectory 顺序、目录状态、Git/MR 状态或展示端推断 MUST NOT 把该终态覆盖为 execute、wait、ask、reconcile 或 transition-pending。该投影 MUST 为只读，并由 Runtime status、CLI、Desktop 和遥测共同消费；恢复 MUST 保留既有完成事实，不重新执行已完成工作或外部副作用。

#### Scenario: completed checkpoint 存在旧 null-work selection

- **WHEN** 当前 checkpoint 为 completed 且 current Work 为 null，但 Trajectory 中存在旧的 `workId=null` `continuation.selected` 等待事件
- **THEN** 所有读取面返回 `done/terminal`、null work/attempt、当前 check epoch 和空 next actions，不重放旧等待事件

#### Scenario: completed checkpoint 存在旧活动 Work selection

- **WHEN** 当前 checkpoint 为 completed，但历史记录包含同一 Run 较早 epoch 或 revision 的 execute/reconcile selection
- **THEN** Runtime 忽略历史活动 Work continuation；除读取和验证必要持久事实外，不为确定后继而触发 Host、packet、平台或活动项目文件观察

#### Scenario: 非终态重放精确 continuation

- **WHEN** 当前 Run 尚未完成，最近的 `continuation.selected` 精确匹配当前 run、checkpoint revision/epoch、Work identity 和 attempt
- **THEN** Runtime 可以重放该选择；缺少或不匹配当前身份时回退到当前 checkpoint 的纯分类，不猜测历史事件仍有效

#### Scenario: 完成事实与历史 reconciliation 标志同时存在

- **WHEN** 已验证的 completed checkpoint 与同一 Run 中已有的全局 reconciliation 标志同时存在
- **THEN** 完整状态、继续指令和 next actions 仍显示 `done/terminal` 与无待执行工作；原诊断事实可以保留，但不能成为活动恢复要求，读取也不得篡改 Store 来清除历史标志或重新写入完成事实

#### Scenario: 两种新进程恢复顺序保持终态

- **WHEN** 实际完成规格关闭和全部发布后，分别从新进程执行 `resume → next` 与 `next → resume`
- **THEN** 每一步的权威 status、公共 continuation、execution recovery 和 next actions 一致表示完成；Closure、PublicationReceipt、已接受 Bundle、工作包完成身份、check epoch 和 Work/Host/Skill/验证/发布执行次数保持不变

#### Scenario: 活动 Run 的未授权 checkout 仍被拦截

- **WHEN** Run 尚未完成，某个已绑定业务仓的 branch、path、remote 或 ownership 发生未授权变化
- **THEN** `resume` 与 `next` 继续按当前活动阶段的恢复规则阻断执行并保留最后有效 checkpoint，不把终态优先规则应用于活动 Run

### Requirement: 恢复分类只选择最高受影响权威

Runtime MUST 按“规格与设计语义、Build Plan、实现执行、Evidence”的固定优先级比较当前身份与已接受 checkpoint，并为一次观察选择唯一恢复处置。高层身份变化 MUST 使其依赖的低层事实精确失效；同一变化不得先触发低层重验，再以相同根因触发更高层回退。

#### Scenario: 规划与 Evidence 同时变化

- **WHEN** 一次观察同时发现 planning semantic digest 与 Verification Input 不匹配
- **THEN** Runtime 只选择 `revise-design`，并把 Evidence 失效作为该处置的下游结果，不先返回 Verify再返回 Design

#### Scenario: Plan 变化但批准语义相同

- **WHEN** Work Package 边界、依赖、测试切面或检查命令需要调整，但 OpenSpec 规划语义和 Design approval仍有效
- **THEN** Runtime 选择 `revise-plan` 并保持 Build phase，不建立新的 Design Human Decision

#### Scenario: 只有 Evidence 输入变化

- **WHEN** 规划、Plan 和实现 checkpoint均有效，只有一个检查声明的输入面发生变化
- **THEN** Runtime 选择 `invalidate-evidence` 并只退役依赖该输入面的 Receipt、Bundle、Gate或 Check Evidence

### Requirement: 恢复重放必须收敛到同一 checkpoint

每个恢复处置 MUST 绑定原 observation、权威身份、受影响依赖集合、from revision 与 `checkEpoch`。重复 pull、进程重启或相同 observation 重放 MUST 返回既有恢复 checkpoint或 revision conflict，不得重复创建 Work、Wait、Plan revision、失效记录或人工批准。

#### Scenario: 同一 Plan finding 被重复提交

- **WHEN** 两个 Runner 对相同 Run revision、Plan identity和 finding identity提交恢复观察
- **THEN** 只有一个 `revise-plan` checkpoint被接受，另一个返回既有 checkpoint或明确冲突

#### Scenario: Archive 恢复后进程退出

- **WHEN** Runtime 已为输入漂移建立 `invalidate-evidence` checkpoint，但响应返回前进程退出
- **THEN** 下一次 pull 从该 checkpoint继续，不重新建立 Archive、Verify或 Design 回退链

### Requirement: Verify 返工原因必须与真实受影响权威一致

Verify 恢复记录 MUST 区分实现缺陷、真实计划变化、规划授权变化、证据漂移和基础设施不可用。重新进入 Plan 本身 MUST NOT 作为 Build Plan 身份改变的证据；实现缺陷恢复 MUST 关联实际失败 Evidence 与影响范围，保留既有失败记录，供 CLI、Trajectory 和遥测一致解释。

#### Scenario: 实现失败但计划未变

- **WHEN** Verify 检查发现实现缺陷，且当前批准规划与已接受 Plan 的语义身份仍然有效
- **THEN** 恢复记录说明实现修复原因，不把 `plan-constraint-changed` 或 `changedIdentities: build-plan` 作为无事实依据的固定标签

#### Scenario: 只有证据或环境问题

- **WHEN** 检查输入漂移或 Evidence Provider 暂时不可用，且没有证据证明实现或计划本身失败
- **THEN** Runtime 沿已有证据失效或基础设施重试路径处理，保留仍有效的 Build 完成事实，不通过包归零掩盖证据问题

### Requirement: 生命周期人工决定通过宿主交互闭环提交

Repoctopus MUST 为当前生命周期 Human Decision 提供只读交互材料和公开的 Host-mediated 提交路径。Host MUST 优先使用可用的原生结构化提问工具收集真实用户选择；工具不可用时在对话中展示选项并等待答复。Runtime MUST 沿既有请求、提案与权限校验处理该选择并决定后续 Action，不以非交互提交命令本身推断用户授权。

#### Scenario: 宿主具有原生提问工具

- **WHEN** 当前 Run 等待人工决定，且 Host 能在当前会话中使用结构化提问工具
- **THEN** Host 展示当前提案、决定影响和有效选项，等待用户选择后通过公开入口回传；用户无需离开对话手工运行终端命令

#### Scenario: 宿主只有对话交互

- **WHEN** Host 没有原生结构化提问工具，但可以取得当前用户的明确对话答复
- **THEN** Host 在对话中给出明确选项并等待真实答复，再通过同一正式决定路径提交，不把工具缺失解释为批准

#### Scenario: 尚未得到用户选择

- **WHEN** Host 已展示问题但没有有效用户答复或覆盖该提案的明确授权
- **THEN** Run 保持等待，Host 不提交推测的选择，不因默认值、推荐、超时或 Work Outcome 推进阶段

#### Scenario: 没有可用宿主交互上下文

- **WHEN** 当前调用无法收集真实用户选择且存在交互式终端
- **THEN** 系统保留当前请求并提供原有终端评审入口；普通终端调用仍能完成同一决定

#### Scenario: 同一入口的其他生命周期决定

- **WHEN** 当前待处理请求是执行意图修订或 Build Plan 风险审批
- **THEN** Host 读取其真实类型、必需选项和影响，通过相同交互与提交约束处理，不把它伪装成 Open 或 Design 批准

### Requirement: 宿主人工决定恢复保留原请求及已接受结果

Repoctopus MUST 让宿主以当前请求身份和提案身份核对等待状态及已有决定。重复读取或进程恢复 MUST 保留原有效请求；重复回传已经接受的相同决定不得创建第二次阶段转换。过期、冲突或归属不匹配的响应 MUST 保留可定位诊断，不得改变当前决定或授权未审查的内容。

#### Scenario: 展示问题后进程中断

- **WHEN** Host 展示待批准问题后中断，并由新进程恢复同一 Run
- **THEN** 系统返回当前仍有效的请求或其已接受结果，Host 核对后继续，不仅因恢复而创建新审批或重复要求用户批准

#### Scenario: 决定已接受但返回结果丢失

- **WHEN** 决定已经提交成功，但 Host 未收到成功响应
- **THEN** 后续核对可以确定该请求的已接受决定；相同决定的重试不会重复推进，后继 Work、完成事实和 checkEpoch 保持正确

#### Scenario: 相同请求出现冲突决定

- **WHEN** 同一请求已经接受一个决定，随后收到不同选择
- **THEN** 系统报告决定冲突并保留原接受事实，不覆盖历史决定或回退后继阶段

#### Scenario: 请求不属于当前审批边界

- **WHEN** 响应的 Run、请求、提案身份或有效审批边界与 Runtime 当前事实不一致
- **THEN** 系统拒绝该响应并保留当前等待状态或已接受结果，不将旧答复应用到新提案

### Requirement: 首次配置 Verify Profile 可从原 Run 继续

Runtime MUST 允许最小 Workspace 的 Change 通过原有 Open、Design 和 Build 门禁。选定 Verify Profile 尚未配置时，Runtime MUST 在需要正式验证的边界保留原 Run 并返回可执行的配置指引。批准配置后 MUST 从同一 Run 继续验证，按真实依赖保留仍有效的批准、Plan 和 Build 完成事实。进入 Archive MUST 具有当前有效 Acceptance Gate。

#### Scenario: 未配置 Verify Profile 时完成 Build

- **WHEN** 最小 Workspace 的 Change 已满足 Build Check，选定 Verify Profile 缺席
- **THEN** Runtime 返回可恢复的待配置状态
- **AND** 不创建假 Evidence、不进入 Archive、不重置有效 Build 成果

#### Scenario: 从新进程恢复同一 Run

- **WHEN** 用户批准添加选定 Profile，正常提交配置，然后从新进程恢复
- **THEN** Runtime 从原 checkpoint 冻结当前真实 Verification Input 并执行验证
- **AND** 有效工作包保持完成，真实仓库、规划或实现漂移仍按正常规则处理
