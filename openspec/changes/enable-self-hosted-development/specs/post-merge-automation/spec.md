# Spec Delta

## Purpose

定义 Repoctopus 在多仓业务 MR 合入后如何自动启动可恢复收尾 Run，基于精确合入代码生成证据、同步规格并更新协调 MR，同时控制机器修改范围。

## ADDED Requirements

### Requirement: 全部相关业务 MR 合入后才启动收尾

Repoctopus MUST 把 change 声明的业务仓库与 MR 作为完整交付集合；任一相关 MR 尚未合入、已关闭未合入或无法核对时，不得开始规格同步和关闭。

#### Scenario: 三个业务 MR 中只有两个已合入

- **WHEN** 任一合入事件唤醒 Coordinator 且交付集合仍有一个 MR 处于打开状态
- **THEN** 系统刷新合入事实并保持等待，不启动 Post-merge Run

#### Scenario: 最后一个业务 MR 合入

- **WHEN** 平台核对确认交付集合中全部业务 MR 已合入
- **THEN** 系统以 change 和合入事实摘要为幂等键创建或恢复唯一 Post-merge Run

### Requirement: 合入后验证绑定精确 merge commit

Repoctopus MUST 在隔离临时检出中使用每个业务 MR 的权威 merge commit 执行配置的 Evidence Profile，并把仓库集合、commit、配置和组合摘要绑定到结果。

#### Scenario: 目标分支在事件后继续前进

- **WHEN** Post-merge Run 开始时目标分支 HEAD 已包含其他提交
- **THEN** 系统仍按记录的业务 MR merge commit 验证本 change，除非项目策略显式要求验证最新目标分支

#### Scenario: 合入后验证失败

- **WHEN** 任一阻断 Evidence Node 失败或输入漂移
- **THEN** Run 保留失败证据并停止规格同步，不把 change 标记为关闭

### Requirement: 规格同步和关闭由当前 Provider 执行

Repoctopus MUST 只在合入后 Evidence Gate 满足后调用 Run 绑定的 Specification Provider，同步 delta 到主规格并关闭 change；关闭结果必须进入 Run 事实与收尾提交。

#### Scenario: 规格同步产生冲突

- **WHEN** delta 无法无歧义同步到当前主规格
- **THEN** Run 生成 Human Decision 并保持 change 活动，不自行选择或覆盖主规格内容

### Requirement: 机器收尾修改受路径和语义双重限制

Repoctopus MUST 只允许 Post-merge Run 修改项目配置允许的规格基线、change 归档、验证和关闭状态路径，并在提交前拒绝超出允许列表或含业务代码的差异。

#### Scenario: 规格工具修改业务源码

- **WHEN** 收尾工作树出现允许列表之外的业务源码变更
- **THEN** 系统停止提交、保存诊断并请求人工处理

#### Scenario: 收尾差异只含允许内容

- **WHEN** 变更只包含同步后的主规格、归档 change 和合入后验证记录
- **THEN** 系统可以使用配置的机器身份创建普通 commit 并推送协调分支

### Requirement: 收尾持续更新原协调 MR

Repoctopus MUST 把规划和最终收尾保存在同一个协调分支与 MR 上；机器可以在受控路径内提交、推送并更新该 MR，但不得执行 merge、force push、隐式 rebase、删除分支或改变目标分支。

#### Scenario: 协调 MR 在业务开发期间保持打开

- **WHEN** 业务 MR 全部合入且协调 MR 仍然打开
- **THEN** 系统把收尾 commit 推送到原源分支并更新原 MR 描述或状态

#### Scenario: 协调 MR 已关闭或源分支被改写

- **WHEN** 收尾前发现原 MR 不再可更新或远端源分支与记录基线冲突
- **THEN** 系统停止远端动作并请求人工决定，不创建未声明的新 MR

### Requirement: Post-merge Run 可以幂等恢复

Repoctopus MUST 为检出、Evidence、规格同步、文件核对、commit、push 和 MR 更新保存 Intent、Receipt 与 Checkpoint；中断后从最后一个可确认边界继续，不重复已完成副作用。

#### Scenario: Push 成功后响应丢失

- **WHEN** 远端已包含预期收尾 commit 但本地尚未保存成功 Receipt
- **THEN** 恢复流程先核对远端事实并复用既有 commit，不再次生成不同提交

### Requirement: 无需开发者返回本机执行收尾

Repoctopus MUST 支持由团队可达的 Runner 在代码平台事件后完成收尾，不要求原开发者 IDE、终端或本机工作区保持在线。

#### Scenario: 原开发者电脑离线

- **WHEN** 最后一个业务 MR 在原开发者离线时合入
- **THEN** 团队 Runner 仍可取得必要凭据、临时检出和持久状态并推进 Post-merge Run
