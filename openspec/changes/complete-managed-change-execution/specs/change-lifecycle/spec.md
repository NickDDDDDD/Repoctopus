# Spec Delta

## ADDED Requirements

### Requirement: 每个核心阶段的声明 Work 都可从生产路径到达

内置 lifecycle definition 中的每个 Work kind MUST 具有由已接受事实触发的生产创建路径、唯一合法执行或决定方式、Validator 和后续转换；definition 不得声明只在测试或类型中存在的 Work，核心阶段也不得在没有 Work Outcome、Validator 事实或可信 Human Decision 时自动前进。

#### Scenario: 新 Change 进入 Open

- **WHEN** fresh Change Run 创建且尚无规划工件
- **THEN** Run 保持 `phase=open,status=running` 并公开可领取的 intake Work，不自动提交 `open-intake-ready`

#### Scenario: Design 工件尚不完整

- **WHEN** Open 已完成但 Proposal、Delta Specs、Design 或 Tasks 任一缺失或无效
- **THEN** Run 在 Design 创建 specification planning Work，由其 Validator 重新检查官方四类工件，不只返回无执行入口的 blocker

#### Scenario: Definition 声明不可达 Work

- **WHEN** 架构检查发现某个 Work kind 没有生产创建路径、Host/Contributor 或 Validator
- **THEN** builtin composition 验证失败并定位缺少的链路，测试 fixture 不能代替生产可达性

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
