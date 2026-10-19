# Spec Delta

## ADDED Requirements

### Requirement: Delivery 声明 workspace MR 与业务 MR 关系

Repoctopus MUST 在交付状态中记录一个 change 的 workspace MR、全部业务 MR、各自仓库身份和目标分支，使平台事件能够确定性映射到唯一交付集合。

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
