# Spec Delta

## ADDED Requirements

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

Repoctopus MUST 破坏性替换尚未正式发布的 Open 自动推进、不可达 Work 和旧 claim/attempt 协议，删除其生产分支与兼容 fixture；旧开发 Run MAY 保留只读审计和新 generation 迁移诊断，但不得通过双读、双写、fallback Adapter 或原 generation 重解释继续执行。

#### Scenario: 加载旧 G1 bootstrap Run

- **WHEN** 旧 Run 使用会自动越过 Open 或缺少受管 Work 执行事实的 definition/schema
- **THEN** Runtime 返回只读 `migration_required/new-generation-required` 诊断，新实现不执行旧路径；继续开发必须创建新 generation 并按新协议记录 adoption facts

### Requirement: 五阶段必须留下可核对的推进依据

Change Run MUST 为 Open、Design、Build、Verify 和 Archive 的每次前进记录对应 Work Outcome 与 Validator、Human Decision 或阶段专属确定性事实；仅观察到目标文件、checkbox、Git commit 或最终成功状态不得反推前一阶段已按流程执行。

#### Scenario: 最终仓库内容看似正确

- **WHEN** 仓库已有完整规划和实现，但 fresh Run 没有 Open、Design 或 Build 执行事实
- **THEN** Runtime 不得合成这些阶段的成功历史，并要求执行当前阶段 Work 或显式选择 adopt-existing

#### Scenario: 真实纵切完成

- **WHEN** 每个阶段的推进依据都属于相同 Run generation 和当前输入
- **THEN** projection 与 Trajectory 能按顺序定位 Work、决定、Validator 和 transition，不依赖事后目录推断

### Requirement: Change Run continuation 必须来自同一权威 checkpoint

Runtime、CLI、Dashboard 和 Telemetry MUST 从同一持久 Change Run checkpoint 投影当前 phase/status、Work attempt、Wait、blocker 和 `execute|ask|wait|reconcile|done` continuation；恢复方不得根据阶段名、OpenSpec目录、Git diff或历史对话另行推断下一动作。

#### Scenario: 新 Runner恢复活动 Change

- **WHEN** 原 Runner退出且另一个 Runner加载同一 Run
- **THEN** 新 Runner得到与 checkpoint一致的当前 Work/Wait 和 continuation，并在完成兼容性与多仓核对前不创建第二个 attempt

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

## MODIFIED Requirements

### Requirement: Completion Claim 与验证事实分离

Change lifecycle MUST 区分 pending Task、Runtime Work Outcome 形成的 completion claim 与显式 `adopt-existing` 模式从官方 Tasks 导入的 completion claim；fresh 模式只接受当前 Run 的 Runtime Work completion，发现预先勾选且没有当前 Work Outcome 的 Task 时必须阻断并要求选择采用或恢复为 pending。任何 claim 都只允许结束或跳过 Build 调度，不得作为 Acceptance Evidence、Verify Gate 或 Archive 资格。

#### Scenario: 已实现 Change 首次进入 Runtime

- **WHEN** 用户以 `adopt-existing` 启动已获批且 Tasks 全部勾选的 Change，并确认既有实现边界
- **THEN** Runtime 记录带启动模式和来源摘要的 imported claims、避免重复派发 Build，并进入仍需完整 Acceptance Evidence 的 Verify

#### Scenario: Fresh Change 出现预先勾选任务

- **WHEN** fresh Run 读取到已勾选但没有当前 Run Work Outcome 的 Task
- **THEN** Runtime 保持 Build blocked，提示显式 adopt-existing 或恢复任务状态，不静默创建 imported claim

#### Scenario: Agent 只勾选全部 Tasks

- **WHEN** Agent 更新 checkbox 但没有产生当前 Work completion 和满足 Acceptance coverage plan 的 Receipt
- **THEN** Runtime 不得完成 fresh Build、越过 Verify 或进入 Archive
