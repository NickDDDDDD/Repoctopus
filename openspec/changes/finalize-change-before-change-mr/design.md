# Design

## Context

参见 [proposal.md](proposal.md) 的 Why。当前 `DeliveryIntent`、`DeliverySnapshot` 和 `DeliveryState` 都以一个已经存在的 `changeMergeRequest` 为前置事实；Post-merge 发布策略固定为 `commit + push + merge_request.update`，恢复与多 Runner 收敛也以原 Change MR 的 head OID 为栅栏。

新模型保留两个已经成立的边界：Runtime 不执行 merge，机器收尾只能修改允许的规格与验证路径。变化仅在于把实施期间的远端权威从开放 MR 下沉为公开 Change 分支，并把最终 MR 创建移动到规格关闭发布之后。

## Goals / Non-Goals

**Goals:**

- 让 MR 恢复“完整、可评审、可合入交付”的单一语义。
- 默认一个 Business MR，同时让多仓或必要分阶段交付能够显式使用有限多个 Business MR。
- 在没有提前创建 Change MR 的情况下，继续支持团队协作、开发者离线收尾、丢失 webhook 补偿、幂等恢复和多个 Runner 安全收敛。
- 让旧 Delivery 有明确迁移与失败诊断，不通过隐式历史改写伪装兼容。

**Non-Goals:**

- 不改变 Runtime 不自动合入 MR 的人工边界。
- 不根据 Tasks 自动拆 Business MR，也不把多个 MR 作为大 Change 的默认补救手段。
- 不在本 Change 中修复或归档既有业务 Change；历史 Change 通过迁移策略单独处理。
- 不引入新的规格产物、ADR 或 implementation notes。

## Decisions

### 1. 公开 Change 分支是实施期间的远端权威

新增 `ChangeBranchReference`，至少包含 Workspace Repository、规范化远端身份、源分支、目标分支和核对得到的远端 OID。规划阶段先普通 push 分支并建立 upstream；任何批准、恢复和发布计划都绑定精确 OID。

分支只承载当前 Provider 声明的四类规划产物及后续允许的关闭结果。没有 MR 身份不影响它成为团队共享 Change：Change 身份来自规格 Provider 与 Delivery 状态，不来自分支作者、MR 作者或 Runner。

备选方案是继续提前建立 Draft MR并禁止合入。它能直接利用代码平台评审，但仍把未完成 Change 暴露成 MR，并维持“MR 既是工作区又是交付物”的双重语义，因此不采用。

### 2. 规划批准使用独立不可变快照

增加 `specification-approval` Human Decision 类型。`PlanningSnapshot` 绑定：

- change 和 Specification Provider 身份、版本；
- Proposal、Design、Delta Specs、Tasks 的规范摘要；
- 受影响能力与严格校验结果；
- Change 分支、目标分支和远端 OID；
- composition 与项目配置摘要。

批准只允许进入实施，不授权 Business MR 发布、最终 MR 创建或 merge。上述任一事实改变都使批准失效；Agent 不能代替可信用户批准。

备选方案是复用 `delivery-approval`。该请求绑定实现仓库、验证报告和 MR 动作，生命周期晚于规划批准，复用会混淆授权范围，因此保留两个明确的 decision type，并共享可信交互 Adapter。

### 3. Delivery Intent v3 用稳定交付单元表达 1..N 个 Business MR

`DeliveryIntent` 升级为 v3，移除 `changeMergeRequest`，加入：

```text
changeBranch
  repositoryId, remoteIdentity, sourceBranch, targetBranch
businessDeliveries[]
  deliveryId, repositoryId, sourceBranch, targetBranch,
  commitMessage, actions
businessSplitReason?
  kind, summary
```

`businessDeliveries` 非空，默认生成一个成员。成员使用 `deliveryId` 而不是 `repositoryId` 作为集合主键，因此既支持多仓，也支持同仓必要补充 MR。超过一个成员时必须提供结构化拆分理由；集合以稳定顺序进入 intent digest、批准快照和 Post-merge Run 身份。

同仓多个成员必须使用不同源分支并指向同一个目标分支。Post-merge Trigger 将完整 MR 集合与仓库检出视为两个层次：`mergeEvidence` 保留每个已批准 MR 的权威 merge commit，`repositories` 则为每个仓库保留一次最终检出；同仓场景选择最后合入的 commit 作为包含较早合入结果的目标分支状态。这样不会因为 Project Snapshot 的仓库唯一性丢失 MR 证据，也不会为同一仓库创建两个互相冲突的检出。

业务 MR 集合不是开放列表。批准后增删、替换成员或改变分支映射都使批准失效；Post-merge 开始后发现集合漂移则 fail-closed。

备选方案是继续让 `repositories[]` 一项等于一个 MR。这无法表达同仓多个独立源分支，并把仓库身份错误地当成交付单元身份，因此不采用。

### 4. 分离业务合入、规格关闭和最终 Change MR 状态

Delivery State v3 不再用一个 `merged` 同时暗示所有生命周期完成，而是分别持久化：

- `businessMergeRequests`：已批准完整集合及逐项状态；
- `mergeEvidence`：每项权威 merge commit 与观测时间；
- `closure`：Evidence、规格同步、归档、路径审计和 Change 分支发布状态；
- `finalChangeMergeRequest`：`null`、创建中、开放、合入或失败。

Coordinator 只有在完整 Business MR 集合都返回权威 merge commit 时才创建稳定 Post-merge Run。最终 Change MR 合入仍由人执行；平台事件或显式刷新只记录结果。

### 5. 收尾先受控同步目标分支，再执行 Provider 关闭

Change 分支从规划开始长期不进入目标分支，而业务 MR 会推进目标分支。OpenSpec 归档必须基于包含业务实现和最新主规格的精确目标基线，因此 Post-merge 临时工作树按以下顺序执行：

1. 核对 Change 分支远端 OID 和全部 Business MR merge commit；
2. 获取并锁定目标分支精确 OID；
3. 在 Change 分支上执行受控普通 merge，把该目标 OID 合入 Change 分支；
4. 冲突时停止并生成 Human Decision，不自动选择内容；
5. 调用 Run 绑定的 Specification Provider 校验、同步和归档；
6. 审计差异仅包含允许路径；
7. 创建普通收尾 commit，以显式非强制 refspec 推送并核对远端 OID；
8. 创建或恢复最终 Change MR。

目标同步 merge commit 及其两个 parent 进入 Closure Journal。禁止 rebase、squash、force push 和复制活动 Change 目录到新分支，因为这些做法会破坏规划历史或并发比较。

备选方案是从最新目标分支建立新的收尾分支再复制规格文件。它需要替换已经公开的 Change 分支，削弱团队可追溯性，也无法用普通 push 保持同一远端栅栏，因此不采用。

### 6. Post-merge 发布策略改为 create-after-closure

发布操作集合从：

```text
commit, push, merge_request.update
```

改为：

```text
merge_target, commit, push, merge_request.create_or_recover
```

MR Adapter 必须先按 `provider + repository + sourceBranch + targetBranch` 查询。如果存在唯一开放 MR，则核对 head OID 后复用；不存在才创建；多个匹配、分支映射漂移或已存在不等价关闭 MR 时 fail-closed。平台以相同 head/base 的唯一开放 MR 约束串行化并发创建；创建返回错误或响应丢失时，调用方重新执行全状态查询，只有恰好得到一个可核对 MR 才按恢复成功处理。

机器可以创建或更新最终 MR 的标题和正文，但不能 merge、改变 head/base、删除分支或强推。

共享项目配置同步切换到这一个语义：`postMerge.publication.operations` 必须精确包含四个 v3 操作，最终 MR 文案放在 `finalChangeMergeRequest`，不再保留与操作集合重复的 mode 字段。出现旧 `changeMergeRequest`、`merge_request.update` 或 `update-existing` 时，解析器在 Cordis 组合启动前返回迁移诊断，不得把旧字段静默映射为最终 MR 创建。已持久化的 schema-v1 Closure Journal 仍可由显式旧策略恢复，但当前项目配置不能再生成该策略；这把历史恢复兼容与新运行入口分开。

### 7. 多 Runner 以 Change 分支 compare-and-push 收敛

每个 Runner 从同一远端 Change OID、目标 OID、Business MR 集合和关闭计划摘要开始。提交前再次读取远端：

- OID 未变：允许普通 push；
- 已出现语义等价的目标同步与关闭提交：核对 tree、parent、message、author 和审计摘要后返回 no-op；
- 任何不等价变化：fail-closed 并请求重新协调。

两个 Runner 的目标同步 merge commit 可能因为 Git 时间戳不同而具有不同 OID，因此恢复不能把临时 merge OID 相等误当成语义相等。恢复路径分别核对两个目标同步提交都具有锁定的 Change/目标 parent，并比较其 tree、message 与 author；随后核对关闭提交只有一个语义等价的目标同步 parent，且 tree、message 与 author 相同。

最终关闭 commit 增加 `Repoctopus-Closure-Audit` trailer。该摘要绑定关闭计划、关闭身份、排序后的变更路径及内容摘要，但排除包含临时 merge OID 的 baseline digest，使独立 Runner 对相同关闭语义得到同一摘要，而文件相同但计划或关闭身份不同的结果仍然 fail-closed。此 trailer 只用于竞争恢复证明，不取代完整 Closure Audit 与 Receipt。

最终 MR 创建使用 Adapter 的 create-or-recover 语义，因此独立状态卷允许重复计算。竞争创建失败或创建响应丢失时重新查询同一 head/base tuple；只有唯一且 head OID 可核对的 MR 会被恢复，多个或零个匹配继续 fail-closed。

协作恢复不增加个人 owner 配置。共享配置继续严格拒绝 `changeOwner`、`mrAuthor`、`branchAuthor`、`runnerOwner` 等候选过滤字段；`runnerIdentity` 只连接同一 composition 的 Lease 与执行审计，可以随部署替换。第一版候选发现仍依赖本地或挂载的 Delivery Store：独立状态卷只有在都已发现同一 Delivery 后才能安全竞争，全新状态卷不得根据 Git 或 MR 作者猜测历史 Change。

### 8. 旧状态只读迁移，禁止静默改变既有 MR

v2 Delivery 读取后分三类：

- 尚未产生远端动作：可生成 v3 迁移草案，需重新校验和批准；
- 已有开放 Change MR：默认继续旧状态只读诊断，必须由用户决定保留旧流程还是关闭旧 MR 后迁移；
- Change MR 已关闭或合入但 Change 未关闭：标记 `repair_required`，输出 Change 分支、业务集合和目标基线的显式修复计划。

迁移查询返回 `DeliveryV2MigrationPlan`，不直接生成可执行 `DeliveryIntentV3`。v2 快照没有持久化业务 commit message，且旧批准、Evidence Bundle 和平台状态都不能成为新授权；因此计划只提供 Change 分支事实、旧 Business MR identity、已记录目标 OID、待补字段与人工动作。Built-in File Provider 对 v2 只保留 `status` 和 `migration-plan` 查询，不再执行 decide、refresh、reconciliation、publish 或 Post-merge 发布。

新写入只产生 v3。迁移不得自动关闭、重开或替换 MR，不复用旧批准，也不执行 force push。

## Risks / Trade-offs

- [没有提前 MR 会失去代码平台内联规划评论入口] → 规划批准由结构化 Human Decision 承担；团队仍可检查公开分支。若未来需要专门的规格评审 UI，应作为 Adapter 能力加入，而不是恢复双重语义 MR。
- [Change 分支与目标分支长期分叉会产生归档前冲突] → 收尾显式合入锁定目标 OID，冲突生成 Human Decision，并将 merge parent 纳入证据。
- [Business MR 集合允许多个可能鼓励过度拆分] → 默认严格生成一个；多个必须有拆分理由并在批准界面突出显示。若拆分理由实质上是范围过大，应创建多个 Change。
- [Delivery v3 影响状态、schema、CLI 和插件边界] → 使用版本化解析、旧状态只读迁移和契约测试，不原地解释 v2 字段。
- [最终 MR 创建成为新的可恢复副作用] → 在平台调用前保存 Intent，调用后权威查询，Receipt 同时绑定 MR identity 与 head OID。

## Migration Plan

1. 增加 v3 类型、schema、规范化和纯领域验证，保持 v2 reader 与迁移诊断。
2. 增加 Planning Snapshot 与 `specification-approval` Human Decision，不修改现有 delivery approval 的授权范围。
3. 将 Business MR 映射、事件匹配和 Reconciliation 改为稳定 `deliveryId` 集合。
4. 增加 Change 分支核对与目标分支受控 merge 端口，扩展 Closure Journal、Intent 和 Receipt。
5. 将 Post-merge 发布切换为 final MR create-or-recover，保留禁止自动 merge 的 Guardrail。
6. 更新 project config、示例、文档和 E2E，以一次单 MR 自举和一次显式多 MR fixture 验证完整流程。
7. 默认启用 v3；发现阻断问题时停止新 v3 发布，保留已写 Journal 和远端分支，不回滚或重写已推送提交。

回退只关闭新的交付准备入口，不删除 v3 状态、不关闭平台 MR、不强推分支。修复后从持久 Intent、Receipt 和远端权威事实继续。
