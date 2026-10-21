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

Repoctopus MUST 在交付状态中记录一个 change 的协调 MR、全部业务 MR、各自仓库身份和目标分支，使平台事件能够确定性映射到唯一交付集合。协调 MR 是承载规格、验证与收尾的职责角色，不代表旧产品名称或必须独立存在的物理仓库；协调 MR 与业务 MR MAY 位于同一仓库。

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
