# change-lifecycle Specification

## Purpose
定义 Repoctopus 的权威 Change Run、固定五阶段状态机、阶段与执行状态的正交模型，以及 Work、转换守卫、恢复和兼容边界。

## Requirements

### Requirement: 每个活动 Change 使用唯一权威 Run

Repoctopus MUST 为一个 Workspace、change 和 lifecycle generation 建立至多一个未终结 Change Run，并由该 Run 的版本化事实唯一表达阶段、执行状态、当前工作、等待条件、阻塞原因和合法下一步；Specification、Delivery、平台事件、CLI、Dashboard 和 Telemetry 不得建立或写入平行的 change 生命周期。

#### Scenario: 两个 Runner 同时启动同一 Change

- **WHEN** 两个 Runner 使用相同 Workspace、change 和 generation 请求开始或恢复工作
- **THEN** RunStore 只保留一个活动 Change Run，两个请求获得相同权威身份或明确的并发结果

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

Design revision、规划语义漂移、Verify 失败、实现输入漂移和 Archive 后置验证失败 MUST 通过追加 invalidation 与声明的回退转换处理；旧批准、Task Outcome、Evidence 和 Receipt 必须保留但不得用于不匹配的新输入。

#### Scenario: Verify 发现实现失败

- **WHEN** 完整 verification input 下的阻断 Gate 不满足
- **THEN** Run 记录失败 Evidence 并回到 Build 或进入 Build blocked，旧 Gate 不可用于后续修复输入

#### Scenario: Build 中修改规划语义

- **WHEN** Tasks 文字、结构、需求映射或其他规划产物语义变化
- **THEN** Runtime 使旧 Design approval 和受影响 Work 失效并返回 Design

### Requirement: 旧状态迁移必须显式且可证明

Repoctopus MUST 对已有 generic Run、planning approval、Delivery 和 Post-merge 状态先生成只读迁移计划，只在 change identity、语义输入、外部事实和下一动作可唯一映射时创建新 Change Run；歧义或冲突状态必须进入 `migration_required`，旧事实和外部 Receipt 不得删除或伪造。

#### Scenario: 活动 Post-merge 状态可唯一映射

- **WHEN** 旧状态具有唯一 change、完整 MR 集合、精确 merge facts、Provider 身份和下一收尾动作
- **THEN** 迁移可以建立 Archive 状态并保留旧 identity 与审计链接

#### Scenario: 两套状态给出不同下一动作

- **WHEN** 旧 Delivery 与 Post-merge 状态对同一 change 的 MR 集合或下一动作不一致
- **THEN** 迁移返回 `migration_required` 和差异，不启动新副作用或选择其中一套覆盖

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

Change lifecycle MUST 区分 pending Task、Runtime Work Outcome 形成的 completion claim 与从官方 Tasks 导入的 completion claim；全部 claim 只允许结束或跳过 Build 调度，不得作为 Acceptance Evidence、Verify Gate 或 Archive 资格。

#### Scenario: 已实现 Change 首次进入 Runtime

- **WHEN** 获批 Tasks 全部已勾选但当前 Run 没有对应 Work Outcome
- **THEN** Runtime 记录 imported claims、避免重复派发 Build，并进入仍需完整 Acceptance Evidence 的 Verify

#### Scenario: Agent 只勾选全部 Tasks

- **WHEN** Agent 更新 checkbox 但没有产生满足 Acceptance coverage plan 的 Receipt
- **THEN** Runtime 不得越过 Verify 或进入 Archive

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
