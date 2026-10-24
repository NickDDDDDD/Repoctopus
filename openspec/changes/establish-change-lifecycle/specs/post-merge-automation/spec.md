# post-merge-automation Specification

## MODIFIED Requirements

### Requirement: 全部相关业务 MR 合入后才启动收尾

Repoctopus MUST 把 Change Run 已固定的完整 Business MR 集合作为交付边界；集合默认包含一个 MR，显式多 MR 交付中的任一 MR 尚未合入、已关闭未合入或无法核对时，不得开始规格同步和关闭。平台事件和主动核对只能更新事实并唤醒同一个 `archive/waiting` Change Run，不得创建独立 Post-merge Run。

#### Scenario: 三个业务 MR 中只有两个已合入

- **WHEN** 任一合入事件唤醒 Runner 且冻结交付集合仍有一个 MR 处于打开状态
- **THEN** 系统刷新合入事实并保持同一 Change Run 为 `archive/waiting`

#### Scenario: 最后一个业务 MR 合入

- **WHEN** 平台核对确认冻结集合中全部 Business MR 已合入
- **THEN** 系统以 change、完整 MR 集合和合入事实摘要为幂等 wake key 恢复同一 Change Run 并产生后置验证 Work

### Requirement: 合入后验证绑定精确 merge commit

Repoctopus MUST 在同一 Change Run 的 Archive 阶段，于隔离临时检出中使用每个业务 MR 的权威 merge commit 执行配置的 Evidence Profile，并把仓库集合、commit、配置、composition 和 Work input digest 绑定到结果。

#### Scenario: 目标分支在事件后继续前进

- **WHEN** Archive 后置验证开始时目标分支 HEAD 已包含其他提交
- **THEN** 系统仍按记录的业务 MR merge commit 验证本 change，除非项目策略显式要求验证最新目标分支

#### Scenario: 合入后验证失败

- **WHEN** 任一阻断 Evidence Node 失败或输入漂移
- **THEN** Run 保留失败证据并停止规格同步，进入声明的 Build/Archive 修复状态且不把 change 标记为关闭

### Requirement: 机器收尾修改受路径和语义双重限制

Repoctopus MUST 只允许当前 Archive Work 修改项目配置允许的规格基线、change 归档、验证和关闭状态路径，并在提交前拒绝超出 Work write scope、允许列表或含业务代码的差异。

#### Scenario: 规格工具修改业务源码

- **WHEN** 收尾工作树出现允许列表之外的业务源码变更
- **THEN** 系统停止提交、保存诊断并请求人工处理

#### Scenario: 收尾差异只含允许内容

- **WHEN** 变更只包含同步后的主规格、归档 change 和合入后验证记录
- **THEN** 系统可以使用配置的机器身份创建普通 commit，并由当前 Archive Action 推送已登记 Change 分支

### Requirement: Post-merge Run 可以幂等恢复

Repoctopus MUST 在同一 Change Run 中为检出、Evidence、规格同步、文件核对、commit、Change 分支 push 和最终 MR 创建保存 Intent、Receipt 与 Checkpoint；中断后从最后一个可确认边界继续，不重复已完成副作用，也不创建独立 Post-merge Run。

#### Scenario: Push 成功后响应丢失

- **WHEN** 远端 Change 分支已包含预期收尾 commit 但本地尚未保存成功 Receipt
- **THEN** 恢复流程先核对远端事实并复用既有 commit，不再次生成不同提交

#### Scenario: 最终 MR 创建成功后响应丢失

- **WHEN** 平台已存在符合已发布 Change 分支和目标分支的最终 MR，但本地尚未保存成功 Receipt
- **THEN** 恢复流程查询并复用该 MR，核对平台状态后把 Receipt 追加到原 Change Run

### Requirement: 无需开发者返回本机执行收尾

Repoctopus MUST 支持由团队可达的 Runner 在代码平台事件后恢复同一 Change Run 并完成 Archive，不要求原开发者 IDE、终端或本机工作区保持在线，也不得把执行者身份解释为 Change owner。

#### Scenario: 原开发者电脑离线

- **WHEN** 最后一个业务 MR 在原开发者离线时合入
- **THEN** 团队 Runner 仍可取得必要凭据、临时检出和持久 Run 状态并推进原 Change Run 的 Archive Work

### Requirement: 开发 Run 启动前执行一次性补偿

Repoctopus MUST 在启动新的日常开发 Run 前检查当前 Workspace 已登记且处于可唤醒 Archive 等待的 Change Run，并允许维护者显式执行相同的一次性补偿；候选发现不得按 MR 作者或独占 Change owner 过滤，命令结束后不得留下 HTTP Listener 或后台轮询。

#### Scenario: Webhook 在 Runner 离线期间丢失

- **WHEN** 业务 MR 已全部合入、没有 Inbox 事件且任一成员随后启动新的开发 Run
- **THEN** Repoctopus 通过平台权威状态发现该 change 并恢复同一个 `archive/waiting` Run 完成或继续收尾

#### Scenario: 未完成业务 MR 仍然打开

- **WHEN** 一次性补偿检查到 change 的部分业务 MR 仍然打开
- **THEN** 系统报告等待结果且不执行规格关闭，不把 MR 作者作为跳过或处理依据

### Requirement: 已登记 Business MR 集合在收尾期间冻结

Repoctopus MUST 在 Change Run 的 Archive input digest 中绑定已批准的完整 Business MR 集合；Archive 开始后集合发生增删、替换或 merge commit 漂移时，Run 必须停止并要求重新准备和验证交付输入，不得基于部分集合关闭 Change。

#### Scenario: 收尾发现未登记的补充 MR

- **WHEN** 维护者把补充实现加入当前 Change，但它不在已固定 Business MR 集合中
- **THEN** Runtime 使当前 Archive Work 失效，并要求把补充 MR 加入新的完整集合后重新验证和取得所需授权

#### Scenario: 完整集合保持不变

- **WHEN** 所有已登记 Business MR 身份与权威 merge commit 均和 Archive input 一致
- **THEN** 同一 Change Run 可以继续执行 Evidence、规格关闭和最终 Change MR 发布

#### Scenario: 同一仓库包含多个已批准 Business MR

- **WHEN** 同一仓库的多个 Business MR 指向同一目标分支且全部取得权威 merge commit
- **THEN** Change Run 保留每个 MR 的 merge evidence，并以最后合入的 commit 作为该仓库唯一的最终检出状态
