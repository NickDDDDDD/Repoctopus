# delivery-governance Specification

## Purpose

定义 Repoctopus 如何在多仓开发中自动保存本地检查点、把验证结果绑定为可批准的交付快照，并以可恢复、可审计且不自动合入的方式发布代码和 MR。

## Requirements

### Requirement: Change 显式选择交付仓库

Repoctopus MUST 要求每个交付 change 显式列出受影响仓库、源分支、目标分支和期望远端动作，不得把扫描到的其他脏仓库自动加入交付集合。

#### Scenario: 未选择的仓库存在修改

- **WHEN** 项目快照发现未被 change 选择的仓库存在 staged、unstaged 或 untracked 修改
- **THEN** Runtime 报告警告并保持该仓库不在提交、验证和发布计划中

#### Scenario: 选择不存在的仓库

- **WHEN** change 引用的仓库不在当前项目快照中
- **THEN** Runtime 阻断交付准备并指出缺失的仓库身份

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

### Requirement: 验证报告先于交付快照提交

Repoctopus MUST 在请求批准前生成验证报告、通过项目验证要求并把报告与实现提交为本地 checkpoint，使交付集合中的每个仓库都具有可重复捕获的代码状态。

#### Scenario: 报告尚未提交

- **WHEN** 验证报告或属于本次 change 的实现仍未进入本地 commit
- **THEN** Runtime 不生成待批准快照并返回未完成项

#### Scenario: 验证失败

- **WHEN** 项目配置要求的验证命令存在失败结果
- **THEN** Runtime 保留失败证据且不创建 Human Decision 请求

### Requirement: 交付快照绑定全部批准事实

Repoctopus MUST 使用稳定摘要绑定 change、选定仓库代码树、源与目标分支、远端基线、验证报告、交付策略和远端动作计划；相同规范输入必须产生相同摘要。

#### Scenario: 多仓快照生成

- **WHEN** 所有选定仓库和验证结果满足交付准备条件
- **THEN** Runtime 生成包含逐仓事实与整体 `sha256` 摘要的不可变交付快照

#### Scenario: 快照规范输入相同

- **WHEN** Runtime 对键顺序或扫描顺序不同但语义相同的输入生成快照
- **THEN** 两次生成的整体摘要相同

### Requirement: 人工批准通过结构化决策交互完成

Repoctopus MUST 发布版本化 `HumanDecisionRequest` 并只接受由可信 Adapter 或交互式 CLI 返回的 `HumanDecisionResponse`；请求必须展示验证报告、仓库集合、目标分支和计划的远端动作。

#### Scenario: IDE 支持原生交互

- **WHEN** 当前 IDE Adapter 声明支持 Human Decision 交互
- **THEN** Adapter 展示批准、要求修改和拒绝选项并把用户选择映射为结构化响应

#### Scenario: IDE 不支持原生交互

- **WHEN** 当前 Adapter 不支持 Human Decision 交互但存在交互式终端
- **THEN** Runtime 保持待批准状态并提供 CLI 评审入口，不要求用户复制摘要命令

#### Scenario: 没有可信交互通道

- **WHEN** Runtime 无法确认响应来自可信用户交互上下文
- **THEN** Runtime 拒绝记录批准且 Agent 不得代替用户批准

### Requirement: 批准绑定快照并在漂移后失效

Repoctopus MUST 记录批准决定、可信主体、时间和快照摘要，并在代码树、验证报告、仓库选择、分支、远端基线、策略或动作计划变化后拒绝使用旧批准。

#### Scenario: 批准后没有漂移

- **WHEN** 发布前重新捕获的事实与已批准快照一致
- **THEN** Runtime 允许执行该快照的远端动作计划

#### Scenario: 任一仓库发生漂移

- **WHEN** 已批准交付集合中的任一仓库代码树或分支与快照不同
- **THEN** Runtime 把批准标记为失效并返回需要重新验证的差异

#### Scenario: 目标基线发生漂移

- **WHEN** 远端目标分支已不再指向快照绑定的基线
- **THEN** Runtime 阻断发布且不得静默变基或强推

### Requirement: 多仓发布计划可恢复且幂等

Repoctopus MUST 为 Business Delivery 与最终 Specification publication 分别保存其职责范围内的稳定意图和结果，按稳定顺序执行普通 push 和 MR create-or-recover/create-or-adopt，并由最终 Publication Receipt 组合所有项；跨仓步骤部分完成后不得自动回滚已发布远端事实，对同一 Run 的显式重试 MUST 先查询远端并从第一个未确认项继续。规格候选 checkout 只能在其发布 Journal completed 后清理；计划完成不要求任一 MR 合入。

#### Scenario: 中途发布失败

- **WHEN** 一个仓库的远端动作失败且此前仓库已有动作成功
- **THEN** Runtime 保存部分 Publication Intent/Receipt、停止后续动作并明确说明不存在跨仓事务回滚

#### Scenario: 从失败点继续

- **WHEN** 失败原因解决后恢复同一交付计划
- **THEN** Runtime 核对已完成动作并从第一个未确认发布项继续

#### Scenario: 规格关闭与业务发布使用同一工作树

- **WHEN** Workspace 仓同时承载业务 source branch 与已验证的隔离 Specification Closure candidate
- **THEN** Delivery 要求业务 worktree 完全 clean，并只从隔离 checkout 发布规格项；不得把 Closure changedFiles 排除在业务清洁范围之外

#### Scenario: MR 创建响应丢失

- **WHEN** 托管平台已经创建 MR 但 Runtime 未持久化成功响应
- **THEN** Adapter 以仓库、源分支、目标分支和精确 head OID 查询并复用唯一 MR identity

#### Scenario: 业务 MR 已发布但规格 push 失败

- **WHEN** 一个或多个 Business Delivery 已有精确 Receipt，而 Specification publication 尚未完成
- **THEN** Run 保持 Archive 可重试；重试复用业务 Receipt 并从规格 Journal 继续，不重复创建业务 MR

### Requirement: MR 由平台端口管理但不自动合入

Repoctopus MUST 通过平台无关端口创建或采用 MR，并读取完成精确发布与后续一致性审查所需的 head、base、state 和 identity；Runtime 与任何 Adapter 都不得执行 merge、force-push、rebase 或删除远端分支。

#### Scenario: GitHub 仓库发布

- **WHEN** 已批准计划为 GitHub 仓库创建或采用 MR
- **THEN** GitHub Adapter 使用托管平台 API 完成动作并返回稳定 MR identity、base、head branch 和 head OID

#### Scenario: MR 已由人合入

- **WHEN** 人已经 push 经过验证的 head，并在 Runtime 恢复前创建甚至合入同 repository/base/head/head OID 的唯一 MR
- **THEN** Runtime 采用该 MR 并记录 `human-created` provenance，不要求 MR 由原 Agent 或 Runner 创建，也不把合入状态作为额外完成条件

#### Scenario: 请求自动合入

- **WHEN** 工作流或调用方要求 Repoctopus 执行 merge
- **THEN** Runtime 拒绝该动作并保持人工合入边界

### Requirement: 平台能力不足产生明确诊断

Repoctopus MUST 区分平台未配置、权限不足、套餐不支持和暂时故障；分支保护不可用时必须报告真实降级状态，不得把本地检查或 CI 失败伪装成服务端保护。

#### Scenario: 私有仓库套餐不支持分支保护

- **WHEN** 托管平台明确返回当前套餐不支持分支保护
- **THEN** Runtime 记录非阻断能力警告并把服务端保护状态标记为不可用

### Requirement: 交付状态不泄露凭据

Repoctopus MUST 从受控凭据提供器读取托管平台凭据，并禁止把 Token、Authorization Header、Cookie、完整远端 URL 凭据或环境变量值写入配置、快照、Journal、日志和遥测属性。

#### Scenario: 平台请求失败

- **WHEN** 包含认证信息的平台请求返回错误
- **THEN** Runtime 只记录脱敏错误类别、平台、仓库身份和请求关联身份

### Requirement: 合入后机器发布使用独立策略

Repoctopus MUST 让合入后 workspace 收尾动作使用明确的机器身份、允许路径、提交格式、远端和 MR 更新策略；该策略不得扩大原交付批准对业务仓库或 merge 动作的授权。

#### Scenario: 收尾策略缺少允许路径

- **WHEN** Post-merge Run 准备提交但项目没有有效收尾允许列表
- **THEN** 系统采取 fail-closed，不创建 commit 或远端动作

#### Scenario: 机器准备执行 merge

- **WHEN** 收尾动作计划包含 MR merge、force push、分支删除或目标分支变更
- **THEN** Delivery Guardrail 拒绝计划，即使合入后验证已经通过

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

### Requirement: Delivery 以公开 Change 分支承载规划和收尾

Repoctopus MUST 在 Design approval 前登记 Workspace Repository 中已发布的 Change 分支、目标分支、远端和精确远端 OID，并把该分支作为规划产物、规格关闭结果和远端并发控制的载体；此阶段不得要求或创建 Change MR。Change 分支 OID 是 publication provenance 和远端并发栅栏，不得替代 Specification Provider 的规划语义摘要。

#### Scenario: 规划分支已公开但尚无 Change MR

- **WHEN** 四类规划产物通过 Provider 校验且 Change 分支已普通 push 并核对远端 OID
- **THEN** Change Run 可以请求 Design approval，且远端动作计划不包含 Change MR 创建

#### Scenario: Change 分支尚未公开

- **WHEN** Change 只有本地分支或远端 OID 无法核对
- **THEN** Runtime 阻断 Design approval 和后续 Archive 发布，并返回需要发布 Change 分支的诊断

#### Scenario: Change 分支远端发生漂移

- **WHEN** Archive Action 读取到的远端 Change 分支 OID 不等于该 Action 锁定的发布输入
- **THEN** Runtime 使相关 Action authorization 或发布计划失效，不执行隐式 rebase、force push 或覆盖；Design approval 仅在规划语义同时变化时失效

### Requirement: Business MR 默认一个并允许显式完整集合

Repoctopus MUST 默认把一个 Change 规划为一个 Business MR；需要多个时，Delivery MUST 记录非空拆分理由和有限、完整的 Business MR 集合，并把集合身份、仓库、源分支、目标分支与远端动作绑定到批准快照。

#### Scenario: 单仓 Change 使用默认交付

- **WHEN** Change 没有声明多仓或分阶段拆分理由
- **THEN** Runtime 生成只包含一个 Business MR 的交付计划

#### Scenario: Change 显式使用多个 Business MR

- **WHEN** Change 因多仓、独立可验证的有序交付或必要补充修复声明多个 Business MR，并给出拆分理由和完整集合
- **THEN** Runtime 接受该集合并分别跟踪每个 MR，不把任务列表自动拆成多个 MR

#### Scenario: 多 MR 计划缺少拆分理由

- **WHEN** Delivery 声明多个 Business MR 但没有非空拆分理由
- **THEN** Runtime 拒绝准备批准快照并要求确认是否缩减为默认单 MR

#### Scenario: 批准后追加 Business MR

- **WHEN** 已批准交付快照的 Business MR 集合新增、删除或替换成员
- **THEN** Runtime 使旧批准失效并要求对新的完整集合重新验证和批准

### Requirement: 最终 Change MR 只在规格关闭后创建

Repoctopus MUST 在同一 Change Run 的 Archive 阶段确认 Verify Evidence 有效、主规格同步且 Change 已归档后，通过平台端口创建或幂等采用一个最终 Change MR；该 MR 只承载允许的规格、验证和关闭结果，创建后不等待合入。

#### Scenario: Change 仍在实施

- **WHEN** 当前实现没有满足 Verify Gate 或规格关闭后置条件
- **THEN** Runtime 保持当前 Build、Verify 或 Archive 状态且不创建最终 Change MR

#### Scenario: Change 已完成规格关闭

- **WHEN** Archive Work 取得有效规格关闭结果且业务发布项已准备
- **THEN** Runtime 发布登记的 Change 分支、创建或采用最终 Change MR，并把精确 item 写入 Publication Receipt

#### Scenario: 最终 MR 创建响应丢失

- **WHEN** 平台已经创建最终 Change MR 但 Runtime 没有持久化成功响应
- **THEN** Adapter 按仓库、源分支、目标分支和精确 head OID查询并复用唯一匹配 MR，不创建重复 MR

#### Scenario: 最终 MR 差异包含业务代码

- **WHEN** 最终 Change MR 相对目标分支包含允许规格、验证和关闭路径之外的修改
- **THEN** Archive Guardrail 拒绝发布并保留可定位的越权路径诊断

### Requirement: Change 协作不由动作身份独占

Repoctopus MUST 把 change 视为团队共享工作单元，允许不同成员或 Agent 继续实现、修复、验证与收尾；系统不得从 Change 分支作者、Business MR 作者、最终 Change MR 作者、Git 作者、Bot 身份或 Runner 身份推导独占 Change owner。动作身份只用于授权、审计和诊断。

#### Scenario: 成员代为发布 Change 分支

- **WHEN** 一个成员提交规划产物并发布 Change 分支，但业务特性由其他成员实现
- **THEN** 系统仍按 change 与交付角色建立关系，不把分支发布者视为特性所有者或个人补偿筛选条件

#### Scenario: 其他成员修复已有 Change

- **WHEN** 另一成员在已经登记的 change 中修复 Bug、补测试或更新规格
- **THEN** Repoctopus 接受该成员产生的受审计动作，不因 change 最初由其他人创建而拒绝

#### Scenario: 配置尝试按动作身份独占 Change

- **WHEN** 团队配置声明 `changeOwner`、`mrAuthor`、`branchAuthor`、`runnerOwner` 或等价候选过滤字段
- **THEN** 配置校验拒绝未知所有权字段，不把动作身份升级为 Change 发现或执行权限

#### Scenario: 团队替换 Runner identity

- **WHEN** 团队替换部署中的 Runner identity，且新 Runner 读取同一持久 Delivery 与平台权威事实
- **THEN** Repoctopus 允许新 Runner 继续查询和恢复，不因执行身份变化转移或丢失 Change 所有权

### Requirement: 旧 Delivery 只能生成显式只读迁移计划

Repoctopus MUST 允许查询 v2 Delivery 状态和权威旧 Change MR 事实，但 MUST NOT 复用旧批准、Evidence Bundle 或平台副作用直接写成 v3 状态；Built-in Provider 必须拒绝 v2 的决定、刷新、协调、发布和 Post-merge 写操作。

#### Scenario: 尚未尝试远端交付动作

- **WHEN** v2 Delivery 仍处于发布前状态且全部动作尝试次数为零
- **THEN** Runtime 返回 `reprepare_required` 计划，列出 v3 草案缺失字段和新的规划、验证与交付批准，不修改 Delivery Store 或平台 MR

#### Scenario: 旧 Change MR 仍开放

- **WHEN** v2 Delivery 已产生远端交付事实且权威查询确认旧 Change MR 仍开放
- **THEN** Runtime 返回 `manual_decision_required`，要求人决定保留旧流程还是人工关闭后迁移，不自动关闭、更新或替换该 MR

#### Scenario: 旧 Change MR 已关闭、已合入或映射漂移

- **WHEN** 权威查询发现旧 Change MR 已关闭、已合入、head 无法核对或源目标分支不匹配
- **THEN** Runtime 返回 `repair_required`，保留旧 Change 分支、Business MR identity 和目标 OID 供人工修复，不生成可直接执行的 v3 Intent

### Requirement: Delivery 作为 Archive 执行能力而非生命周期权威

Repoctopus MUST 把 Delivery plan、Git/MR Intent、Receipt、平台事实和并发栅栏作为 Change Run Archive Work 的输入与执行结果；Delivery 不得拥有与 Change Run 平行的 phase、实施准入、规划批准、验证完成或规格关闭状态。策略要求的危险远端动作批准只能授权对应 Action，不能替代 Design approval 或 Verify Gate。

#### Scenario: Delivery 已准备但 Design 未批准

- **WHEN** 调用方准备了仓库和 MR 草案但 Change Run 仍处于未批准 Design
- **THEN** Runtime 可以返回只读计划诊断，但不得发布分支、创建 Business MR 或把 Delivery 状态解释为实施准入

#### Scenario: 远端发布动作需要人工确认

- **WHEN** 项目策略要求用户确认一个已验证 Archive 发布计划
- **THEN** Human Decision 只绑定该 Action 的输入和副作用，确认后仍由同一 Archive Work 推进，不建立独立 Delivery lifecycle

### Requirement: Publication Receipt 证明交付完成

Delivery MUST 为每个业务仓和 Workspace 规格仓生成版本化 Publication item，并以顺序无关摘要组成唯一 Publication Receipt；Receipt MUST 绑定 Change、权威 runId、Delivery snapshot、Verify evidence、规格关闭摘要、repository、remote、base、head branch、published head OID、MR identity 和 provenance，且不得包含 lifecycle generation、凭据、MR body、完整 diff 或绝对路径。

#### Scenario: 所有发布项精确匹配

- **WHEN** 每个预期分支的远端 OID 和唯一 MR 的 head/base 都匹配已批准输入与同一 runId
- **THEN** Delivery 签发完整 Publication Receipt 供 Archive terminal Validator 使用

#### Scenario: 同一仓库包含多个业务 MR

- **WHEN** 已批准 Delivery snapshot 为同一 repository 登记多个有明确拆分理由的 MR
- **THEN** Receipt 保留每个 MR 的独立 item，且 canonical digest 不受查询返回顺序影响

#### Scenario: Receipt 来自另一 Run

- **WHEN** Archive Validator 收到 changeId 相同但 runId 不匹配的 Publication Receipt
- **THEN** Runtime 拒绝完成当前 Run并报告身份差异，不按文件时间、generation 或 MR 状态选择替代 Receipt

### Requirement: 外部发布动作以稳定身份恢复

每个 push 和 MR create-or-recover/create-or-adopt MUST 具有由 runId、Change、repository、base、head 与精确 head OID 组成的稳定身份；Publication 与 Specification Closure Journal 必须按 runId 和逻辑 publication item 定位。结果未知时必须先观察远端再决定复用、创建或阻断，不得盲重试或通过递增 generation 重发。

#### Scenario: 恢复查询发现唯一等价结果

- **WHEN** 另一短生命周期执行者从同一 runId Journal 发现唯一 MR 的 repository/base/head/head OID 与稳定身份一致
- **THEN** 它复用远端结果并补写同一逻辑 Receipt，无需原开发者或 Runner identity 在线

#### Scenario: 恢复查询发现歧义或不等价结果

- **WHEN** 查询得到多个候选，或唯一候选的 runId、base、head OID 不匹配
- **THEN** Runtime fail-closed 并报告差异，不覆盖远端、不自动分配替代发布或新 generation

### Requirement: 规格发布与调用者工作树隔离

Repoctopus MUST 只在 Closure Receipt 指定的隔离 candidate checkout 中为最终规格项创建 commit，并使用独立 archive source branch 发布；同一物理仓中的 Business Delivery MUST 继续从已验证实现 branch/OID 和完全 clean 的对应 worktree 发布，不得把 Closure changedFiles 作为调用者工作树的临时脏路径例外。

#### Scenario: Workspace 仓同时承载业务实现与规格

- **WHEN** Business Delivery 与 Specification publication 使用同一 repositoryId 和物理 Git 仓
- **THEN** 业务项从验证过的 source branch/OID 发布，规格项从 detached candidate commit 发布，两者不会改变对方的 branch、HEAD 或 index

#### Scenario: 调用者工作树已有额外修改

- **WHEN** Business source worktree 在 Archive 时包含任何 staged、unstaged 或 untracked 修改
- **THEN** Business Delivery 仍因不 clean 而阻断，不因路径与 Closure Receipt 重合而放行

### Requirement: 规格发布使用可恢复完成 Journal

Repoctopus MUST 在创建规格 commit 前持久化稳定 Publication intent，并以 canonical CAS Journal 单调记录 `prepared`、`committed`、`pushed` 和 `completed`；每次重试 MUST 先观察 candidate commit、remote branch OID 和精确 MR identity，等价则采纳、缺失才执行、漂移或歧义则 fail-closed。

#### Scenario: commit 成功后进程中断

- **WHEN** candidate checkout 已产生精确 archive commit，但 Journal 仍为 prepared
- **THEN** 重试核对单一 parent、changedFiles 和 commit message 后采纳该 OID，不创建第二个 commit

#### Scenario: push 响应丢失

- **WHEN** archive remote branch 已指向 Journal commit，但本地尚未记录 pushed
- **THEN** 重试通过 `ls-remote` 采纳相同 OID，不重复或 force push

#### Scenario: MR 创建响应丢失

- **WHEN** 平台已有唯一 repository/head/base/head OID 完全匹配的 MR，但 Journal 尚未 completed
- **THEN** 重试采纳该 MR 并记录 recovered provenance；零个才创建，多个或任一身份漂移均阻断

#### Scenario: completed Journal 重放

- **WHEN** checkout 已清理但 Journal、remote branch 和 MR 仍精确匹配
- **THEN** 重试返回 Journal 保存的同一 Publication item，不生成新 commit、分支、MR 或不稳定 Receipt 字段

### Requirement: Archive 在副作用前验证审批身份

Runtime MUST 在创建 specification closure Work 前验证有效 Design planning approval 的 repository/remote/source/target coordinates 与实时远端 Change branch，并在执行任何 push 或 MR 前重复同一只读校验。Design approval 的 OID 表示 Design 边界，不得被误当作 Build 后实现 OID；Archive 的最终 OID MUST 同时匹配实时远端 source branch 与 isolated closure candidate baseOid。若旧兼容实现已经产生 isolated closure 但尚未开始远端 publication，Runtime MAY 在同一 Run 中将冻结的错误 `remoteOid` 纠正为该共同证明的值；除该 OID 外的任何输入变化 MUST 被拒绝，且纠正后 MUST 创建新 epoch 的受管 publication Work。

#### Scenario: 错误 OID 在规格关闭前被拒绝

- **WHEN** Archive intent 的 Change branch OID 与有效 Design approval 或实时远端 source branch 不一致
- **THEN** Runtime 在创建 specification closure Work 前拒绝 preflight，且不产生 closure、push 或 MR 副作用

#### Scenario: 已关闭规格但尚未发布时纠正 OID

- **WHEN** 兼容升级恢复一个已有 isolated closure、没有 Publication Receipt 的 Archive，且 Design approval 的 branch coordinates 一致、实时远端 OID 等于 closure candidate baseOid，冻结输入仅该 OID 错误
- **THEN** Runtime 保持 runId 与 closure 不变，递增 checkEpoch并建立新的 delivery publication Work；业务交付、Evidence、policy、branch 名或 target 的变化均被拒绝

#### Scenario: 实时远端已越过本地 closure baseline

- **WHEN** publication 前只读校验发现实时 Change branch 已前进，旧 approval 与 isolated closure candidate 都不再匹配待发布实现，且尚未放行任何远端 publication 动作
- **THEN** Runtime 在同一 runId 内使旧 approval、Evidence、Archive input 与本地 closure candidate 失效，递增 checkEpoch回到 Design并要求重新批准和验证

### Requirement: 开发授权与交付检查必须共用受保护分支语义

Build Plan 的 source branch 授权与 Delivery checkpoint 的 protected branch 检查 MUST 使用同一纯领域模式匹配语义。精确名称、`*` 和 `?` pattern 在两个边界 MUST 返回相同结果，不得由平台 Adapter 与 Runtime Service 各自维护实现。

#### Scenario: release 通配模式

- **WHEN** 团队策略包含 `release/*` 且 branch 为 `release/2026.11`
- **THEN** Build Plan 写授权与 Delivery checkpoint 均把该 branch 判定为受保护

#### Scenario: 合法功能分支

- **WHEN** branch 为 `codex/change-a` 且不匹配任何 protected pattern
- **THEN** 两个边界均不因 protected branch policy 拒绝该 branch
