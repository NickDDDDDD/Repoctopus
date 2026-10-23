# change-lifecycle Specification

## ADDED Requirements

### Requirement: 每个活动 Change 使用唯一权威 Run

Repoctopus MUST 为一个 Workspace、change 和 lifecycle generation 建立至多一个未终结 Change Run，并由该 Run 的版本化事实唯一表达阶段、执行状态、当前工作、等待条件、阻塞原因和合法下一步；Specification、Delivery、平台事件、CLI、Dashboard 和 Telemetry 不得建立或写入平行的 change 生命周期。

#### Scenario: 两个 Runner 同时启动同一 Change

- **WHEN** 两个 Runner 使用相同 Workspace、change 和 generation 请求开始或恢复工作
- **THEN** RunStore 只保留一个活动 Change Run，两个请求获得相同权威身份或明确的并发结果

#### Scenario: 展示端尝试推断阶段

- **WHEN** Dashboard 或 CLI 从目录、Git 分支或 MR 状态推断出与 Change Run 不同的阶段
- **THEN** 展示端只报告 Run 投影和可定位的数据新鲜度诊断，不把推断结果写回领域状态

### Requirement: Change 生命周期使用固定五阶段

内置 Change lifecycle MUST 按 `Open → Design → Build → Verify → Archive` 的顺序推进，并只允许定义声明的自循环或回退；push、MR、合入等待、规格同步和关闭 MUST 作为 Archive 工作表达，不得增加独立 Deliver 或 Post-merge 阶段。

#### Scenario: Design 尚未批准

- **WHEN** 当前 Change 缺少有效规划批准且调用方请求开始 Build
- **THEN** Runtime 拒绝跨阶段并保持 Design，同时返回缺失的校验或人工决定

#### Scenario: Business MR 等待合入

- **WHEN** Archive 已发布完整 Business MR 集合但其中任一 MR 尚未合入
- **THEN** Change 保持 Archive 阶段并进入持久等待，不创建 Deliver 或 Post-merge 阶段

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

Runtime MUST 从 lifecycle definition 和已接受事实生成不可变 Work，绑定 phase、Work kind、Task identity、有角色且有序的 Skill bindings、能力、side-effect class、write scopes、input digest、期望产物和 Validator；调用方不得替换这些字段或以普通成功结果推进 Run。

#### Scenario: Agent 请求替换 Skill 组合

- **WHEN** 当前 Work 固定 OpenSpec action 与 `tdd` 等 augmentation，而 Agent 提交另一组合或缺少任一必需 binding 的 Outcome
- **THEN** Runtime 拒绝 Outcome，保持当前 Work 并报告组合身份不匹配

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
