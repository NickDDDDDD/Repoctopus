# Spec Delta

## MODIFIED Requirements

### Requirement: 自动 checkpoint commit 由策略控制

Repoctopus MUST 只在项目策略显式启用自动提交、当前分支不受保护、提交格式有效且匹配改动的快速检查通过时创建 checkpoint commit；每次 checkpoint 都必须把当前精确 HEAD 普通 push 到策略指定远端、建立 upstream 并在远端 OID 核对成功后才返回成功。创建与发布该 checkpoint 不需要人工批准。

#### Scenario: 功能分支满足自动提交条件

- **WHEN** 选定仓库位于允许的功能分支且提交信息与快速检查满足策略
- **THEN** Runtime 创建 commit、发布源分支、建立 upstream，并记录本地与远端相同的提交身份和检查结果

#### Scenario: 新功能分支还没有改动

- **WHEN** 选定仓库位于尚未发布的允许功能分支且工作树干净
- **THEN** Runtime 不创建空 commit，但立即发布当前 HEAD、建立 upstream，并把远端核对结果作为 checkpoint receipt 返回

#### Scenario: commit 后首次 push 失败

- **WHEN** Runtime 已创建 commit，但网络、权限或进程中断导致远端核对没有成功
- **THEN** checkpoint 不得报告成功；重试必须在不创建重复 commit 的情况下发布并核对现有 HEAD

#### Scenario: 当前分支受到保护

- **WHEN** 选定仓库当前分支匹配项目策略中的保护分支
- **THEN** Runtime 拒绝自动提交与发布且不修改 Git 历史

#### Scenario: 自动提交配置不完整

- **WHEN** 项目未启用自动提交、未配置提交格式或没有有效远端
- **THEN** Runtime 不创建 commit 并返回可操作的配置诊断

## ADDED Requirements

### Requirement: Delivery 声明协调 MR 与业务 MR 关系

Repoctopus MUST 在交付状态中记录一个 change 的 Change MR、全部 Business MR、各自仓库身份和目标分支，使平台事件能够确定性映射到唯一交付集合。Change MR MUST 位于配置显式登记的 Workspace Repository，并承载规格、验证与收尾；它与 Business MR MAY 位于同一仓库，但 MUST 使用不同的 MR 身份。同仓角色使用相同源分支与目标分支，或平台返回相同 `provider + repositoryId + number` 时，系统 MUST 在完成发布前 fail-closed。

#### Scenario: 协调与业务角色位于同一仓库

- **WHEN** 一个 change 在同一物理仓库声明协调 MR 与业务 MR
- **THEN** 两个角色使用可区分的分支拓扑和不同 MR 身份，系统分别跟踪其生命周期

#### Scenario: Change MR 不在 Workspace Repository

- **WHEN** Delivery Intent 把 Change MR 声明到其他已登记业务仓
- **THEN** 系统拒绝准备交付，并指出 Change MR repository ID 与 Workspace Repository 不一致

#### Scenario: 协调与业务角色解析为同一 MR

- **WHEN** Delivery Intent 使用相同的同仓源分支与目标分支，或平台为业务角色返回已经登记的协调 MR 身份
- **THEN** 系统拒绝准备或发布，不把一个 MR 同时登记为协调角色和业务角色

#### Scenario: 合入事件属于已登记业务 MR

- **WHEN** 平台事件携带的仓库与 MR 身份匹配一个活动 Delivery
- **THEN** 系统唤醒该 change 的协调流程并刷新完整 MR 集合

#### Scenario: 合入事件无法唯一映射

- **WHEN** 相同平台 MR 身份匹配零个或多个活动 Delivery
- **THEN** 系统不推进任何交付，并记录映射诊断

### Requirement: 合入后机器发布使用独立策略

Repoctopus MUST 让合入后 workspace 收尾动作使用明确的机器身份、允许路径、提交格式、远端和 MR 更新策略；该策略不得扩大原交付批准对业务仓库或 merge 动作的授权。

#### Scenario: 收尾策略缺少允许路径

- **WHEN** Post-merge Run 准备提交但项目没有有效收尾允许列表
- **THEN** 系统采取 fail-closed，不创建 commit 或远端动作

#### Scenario: 机器准备执行 merge

- **WHEN** 收尾动作计划包含 MR merge、force push、分支删除或目标分支变更
- **THEN** Delivery Guardrail 拒绝计划，即使合入后验证已经通过

### Requirement: 合入后状态由事件和主动核对共同推进

Repoctopus MUST 支持平台事件唤醒与显式刷新使用同一 Delivery 状态转换；两种入口都必须重新读取权威 MR 状态，并产生相同的合入证据。

#### Scenario: Webhook 不可用时人工刷新

- **WHEN** 平台未能投递 webhook 但用户或定时恢复任务执行刷新
- **THEN** 系统仍可根据平台权威事实发现全部 MR 已合入并启动同一后续流程

### Requirement: Change 协作不由 MR 作者独占

Repoctopus MUST 把 change 视为团队共享工作单元，允许不同成员或 Agent 继续实现、修复、验证与收尾；系统不得从协调 MR 作者、业务 MR 作者、Git 作者、Bot 身份或 Runner 身份推导独占 Change owner。动作身份只用于授权、审计和诊断。

#### Scenario: 成员代为提交协调 MR

- **WHEN** 一个成员提交规格或协调 MR，但业务特性由其他成员实现
- **THEN** 系统仍按 change 与 MR role 建立关系，不把协调 MR 提交者视为特性所有者或个人补偿筛选条件

#### Scenario: 其他成员修复已有 Change

- **WHEN** 另一成员在已经登记的 change 中修复 Bug、补测试或更新规格
- **THEN** Repoctopus 接受该成员产生的受审计动作，不因 change 最初由其他人创建而拒绝

### Requirement: 未决定的批准请求可由新快照安全取代

Repoctopus MUST 在尚无可信人工决定且未开始任何远端动作时，允许重新准备同一 change：语义相同的快照 MUST 幂等返回原请求；发生代码、报告、Evidence、策略或远端基线漂移时，系统 MUST 用新请求取代旧请求并在历史中记录被取代的请求与快照身份。旧请求的响应 MUST 被拒绝。已经批准、拒绝或开始远端动作的状态不得被重新准备静默覆盖。

#### Scenario: 相同快照重复准备

- **WHEN** Delivery 正等待批准，重新准备得到相同快照摘要
- **THEN** 系统返回原状态和请求身份，不追加重复事件

#### Scenario: 人工决定前报告发生变化

- **WHEN** Delivery 正等待批准、尚无人工决定和远端动作，重新验证后的报告生成不同快照
- **THEN** 系统生成新的 Human Decision 请求，记录旧请求被取代，并拒绝随后到达的旧请求响应

#### Scenario: 已经批准后尝试覆盖

- **WHEN** Delivery 已记录人工决定或已经开始远端动作
- **THEN** 系统拒绝用新的准备请求覆盖现有状态，继续使用显式漂移与重新验证流程
