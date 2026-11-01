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

Runtime MUST 根据持久化的有界失败分类和当前副作用边界选择 continuation；Host、Agent 与调用方不得直接指定目标 phase。普通实现失败、设计假设失效、规划语义漂移、验证行为失败、Evidence/基础设施失败、未知外部结果和 Archive 前置重验必须走 definition 声明的不同路径，并在同一 Run 中保留旧事实、失效不再适用的批准/claim/evidence并递增合法 transition 的 `checkEpoch`。

#### Scenario: Verify 发现实现行为失败

- **WHEN** Verify review 或 Gate 将失败分类为实现行为不满足当前批准规格
- **THEN** Runtime 记录失败 Evidence、重开有依据的 task revision、转换到 Build并创建真实 Repair Work，不只改变 phase 或等待旁路文件变化

#### Scenario: Verify 依赖暂时不可用

- **WHEN** 失败来自 Evidence Provider、命令环境或其他基础设施而未证明实现错误
- **THEN** Runtime 保持 Verify blocked/retry 或 reconcile，不重开 Build Task、不使 Design approval 失效

#### Scenario: Archive 前发现验证输入陈旧

- **WHEN** Archive 尚未开始规格关闭或外部 publication 副作用且当前 Verify identity 已失效
- **THEN** Runtime 回到 Verify并要求当前输入的新 Evidence；若副作用已经开始，则保持 Archive并从稳定 Journal reconcile而不回滚 phase

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

Build Configure MUST 生成并冻结版本化配置，且本版本仅允许 `executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard` 与 `isolation=current|branch|worktree`。Repoctopus MUST NOT 提供 Hotfix、Tweak、Direct execution、Executing Plans、review off/thorough 或运行中模式切换；`tddMode=direct` 只放宽 RED/GREEN 顺序，不得绕过相关测试、Build Check 或 Verify。

#### Scenario: 用户批准受支持的配置

- **WHEN** Runtime 根据仓库拓扑、任务依赖、Host 能力和用户选择提出合法 Build Configuration，且可信用户批准其语义摘要
- **THEN** Run 固定配置 identity 与 digest，后续 Plan、Work、Check 和遥测都必须引用该配置

#### Scenario: 实际隔离没有可信 binding

- **WHEN** Runner 或 Host 只声明 isolation 名称，但没有为受影响仓库提供可验证的 checkout、branch、head、worktree 与 Workspace ownership facts
- **THEN** Runtime 不接受 Build Configuration，不从本机路径或当前进程目录猜测 binding

#### Scenario: 请求 Hotfix profile

- **WHEN** 调用方请求 Hotfix、Tweak 或任一未声明 workflow profile
- **THEN** Runtime 拒绝请求并保持唯一完整 Change lifecycle，不把 profile 映射成隐藏的快捷路径

#### Scenario: 批准后请求切换执行模式

- **WHEN** 已批准配置为 autonomous，而 Agent 请求在当前 Run 中切换为 subagent-driven-development，或反向切换
- **THEN** Runtime 拒绝切换并建立 Human Decision 或要求以新的普通 Change 表达，不静默重写当前配置

#### Scenario: direct TDD 模式执行任务

- **WHEN** 配置选择 `tddMode=direct`
- **THEN** Work 可以不强制逐任务先红后绿，但仍必须声明相关测试、执行回归检查并通过 Build Check 与 Verify

### Requirement: Verify 失败通过 Build Plan revision 返工

当 Verify 接受实现缺陷时，Runtime MUST 在同一 Run 记录失败 Evidence、递增 `checkEpoch`、返回 Build Plan revision，并由修订计划产生普通 Execute Work 和新的 Check。Runtime MUST 保留仍有效的 OpenSpec Task completion 与 Work Evidence，只使受影响输入失效；不得重新打开 Task、创建 Repair lifecycle、特殊 `implementation.repair` Work kind 或并行修复权威。

#### Scenario: 缺陷只影响一个工作包

- **WHEN** Verify finding 可追溯到一个 Work Package 且不改变批准规格或 Task 语义
- **THEN** Plan revision 只替换受影响包及其依赖的 Evidence，并保留其他已接受 Task completion

#### Scenario: 缺陷改变设计语义

- **WHEN** Verify finding 证明批准设计或 Task 语义本身无效
- **THEN** Runtime 按既有语义漂移规则返回 Design，而不是把设计修改伪装成 Build repair

#### Scenario: 无法确定最小影响范围

- **WHEN** finding 缺少 requirement、Task 或 Work Package 关联，Runtime 无法安全计算返工范围
- **THEN** Runtime 建立 Human Decision 或使用 definition 声明的保守 plan invalidation，并记录依据

### Requirement: Archive 关闭前必须重验冻结输入

Repoctopus MUST 在执行 `specification.close` 或 publication 副作用前比较当前 Evidence 指纹与冻结的 Verification Input。若 close Work 冻结后指纹漂移且尚未产生 Closure 或 Publication Receipt，Runtime MUST 退役旧 close execution、清除 Archive input并在同一 Run 返回 Verify；若 Verify 发现 planning semantic digest 变化，MUST 再走既有 Verify→Design transition。副作用已经开始后 MUST 使用既有 journal/reconciliation，不得回滚或伪造重验。

#### Scenario: Close Work 冻结后源树漂移

- **WHEN** `specification.close` Work 已创建或验证，但当前 Evidence 指纹与冻结 Verification Input 不同
- **THEN** Runtime 在调用 Specification provider 前返回 Verify、创建新的 `evidence.verify` Work并退役旧 execution checkpoint

#### Scenario: 漂移同时改变规划语义

- **WHEN** Archive 返回 Verify 后发现 OpenSpec planning semantic digest 与已批准快照不同
- **THEN** Runtime 复用既有 Verify→Design transition，不在 Archive 直接建立第二套规划恢复路径

#### Scenario: Closure 已经产生

- **WHEN** Specification Closure 或 Publication Receipt 已存在
- **THEN** Runtime 不回退到 Verify，而继续既有 publication journal/reconciliation 流程

### Requirement: 规划授权失效必须原子恢复 Design checkpoint

当 Build、Verify 或尚未发生不可逆副作用的 Archive 观察到当前 Specification Provider 的规划语义或 trusted Design approval 不再授权 lifecycle 的 planning identity 时，Runtime MUST 通过带 `semantic | approval-authority` 分类的受保护 transition 原子回到 Design，并在同一次 Run 提交中设置新的 `specification.plan` Work、递增 `checkEpoch`、退役不匹配的 execution checkpoint，且按依赖关系保留或失效 Tasks、Build Configuration、Plan、Package completion、Verification、Archive 与 Closure 输入。Runtime MUST NOT 将 composition、执行进度或仅 publication provenance 的变化误分类为 planning invalidation，也不得留下无 current Work 的 Design 中间态、复用无效 approval、创建第二个 Run 或要求手改 Store。

#### Scenario: Verify 收尾提交改变规划语义

- **WHEN** Change 已进入 Archive，但 Verify 收尾提交改变 Proposal、Design、Delta Specs、Tasks 语义或 Change metadata
- **THEN** 下一个受保护 Runtime pull 在任何关闭或发布副作用前一次提交 Design phase、新 `specification.plan` Work、新 epoch 与精确下游失效事实

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
