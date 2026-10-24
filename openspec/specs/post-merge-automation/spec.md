# post-merge-automation Specification

## Purpose

定义 Repoctopus 在多仓业务 MR 合入后如何自动启动可恢复收尾 Run，基于精确合入代码生成证据、同步规格并更新 Change MR，同时控制机器修改范围。

## Requirements

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

### Requirement: 规格同步和关闭由当前 Provider 执行

Repoctopus MUST 只在合入后 Evidence Gate 满足后调用 Run 绑定的 Specification Provider，同步 delta 到主规格并关闭 change；关闭结果必须进入 Run 事实与收尾提交。

#### Scenario: 规格同步产生冲突

- **WHEN** delta 无法无歧义同步到当前主规格
- **THEN** Run 生成 Human Decision 并保持 change 活动，不自行选择或覆盖主规格内容

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

### Requirement: 多个 Runner 的远端结果安全收敛

Repoctopus MUST 允许多个 Runner 对同一 change 进行至少一次查询和验证，并以 Change 分支精确远端 OID、普通非强制 push 和发布后权威核对约束远端收尾；Runner identity 只用于执行审计，不代表 Change 所有权。

#### Scenario: 两个 Runner 同时收尾同一 Change

- **WHEN** 两个 Runner 从相同 Change 分支远端 OID 开始执行且其中一个先完成远端发布
- **THEN** 另一个 Runner 重新读取远端，等价关闭结果返回 no-op，不等价变化 fail-closed，且不得 force push 或覆盖胜出结果

#### Scenario: Runner 使用独立本地状态卷

- **WHEN** 两个 Runner 没有共享本地 Lease 或 Run Store 但发现了同一 change
- **THEN** 系统允许重复本地计算，并仍通过远端 Change 分支并发栅栏保证只有可核对的收尾结果生效

#### Scenario: 全新状态卷尚未发现历史 Change

- **WHEN** Runner 使用不含该 Delivery 的全新状态卷启动
- **THEN** 系统不得根据 MR 作者、分支作者或 Runner identity 猜测历史 Change，维护者必须先恢复或挂载持久 Delivery 状态

#### Scenario: 独立 Runner 产生不同目标同步 commit OID

- **WHEN** 两个 Runner 从相同 Change 与目标 OID 计算出 tree、双 parent、message 和 author 相同但 commit OID 不同的目标同步结果
- **THEN** 竞争失败者继续核对关闭 tree、message、author 和语义审计摘要，全部等价时收敛到远端结果，否则 fail-closed

#### Scenario: 两个 Runner 竞争创建最终 MR

- **WHEN** 两个 Runner 已收敛到同一远端关闭 OID，且创建前查询都尚未发现最终 MR
- **THEN** 平台只接受一个相同 head/base 的最终 MR，失败者通过全状态查询恢复相同 MR identity，零个或多个匹配时 fail-closed

### Requirement: 规格关闭发布后创建最终 Change MR

Repoctopus MUST 在受控收尾差异普通提交并推送到 Change 分支、远端 OID 核对成功后，创建或恢复唯一最终 Change MR；MR 身份和 head OID 必须进入 Receipt，MR 创建不得先于规格关闭发布。

#### Scenario: 收尾分支发布完成

- **WHEN** Change 分支包含经过路径审计的验证记录、主规格同步和归档结果，且远端 OID 精确等于本地收尾提交
- **THEN** Runtime 以该分支和登记目标分支创建最终 Change MR，并在发布后重新读取平台权威状态

#### Scenario: Change 分支发布失败

- **WHEN** 收尾 commit 尚未成功普通 push 或远端 OID 无法核对
- **THEN** Runtime 不创建最终 Change MR，并从可恢复发布边界重试

#### Scenario: 最终 Change MR 已存在

- **WHEN** 重试发现同一仓库、Change 分支和目标分支已经存在唯一开放 MR
- **THEN** Runtime 核对其 head OID 与目标分支后复用并更新该 MR，不创建替代 MR

### Requirement: 新项目配置只生成 v3 收尾发布策略

Repoctopus MUST 要求共享项目配置精确声明 `merge_target`、`commit`、`push` 和 `merge_request.create_or_recover`，并从 `finalChangeMergeRequest` 读取最终 MR 文案；旧 `changeMergeRequest`、`merge_request.update` 或 `update-existing` 不得进入新 Cordis 组合或被静默解释。

#### Scenario: 团队继续使用旧 update-existing 配置

- **WHEN** 配置包含旧 Change MR 字段或更新操作
- **THEN** 项目配置解析在 Runner 启动前失败，并返回包含新操作集合和 `finalChangeMergeRequest` 的迁移诊断

#### Scenario: 恢复迁移前已持久化的 v1 Journal

- **WHEN** 恢复入口显式加载与 schema-v1 Journal 绑定的旧发布策略
- **THEN** Runtime 可以继续既有恢复协议，但不得从当前共享项目配置合成该旧策略

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
