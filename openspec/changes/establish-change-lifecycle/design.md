# Design

## Context

当前 `Run` 已是持久 Aggregate，但默认 workflow 只表达 inspect、execute、verify 等通用 checkpoint，没有 change phase、规划守卫或固定 Skill。规划批准由 Specification/Delivery 侧保存，Business MR 由 Delivery aggregate 跟踪，合入后又由平台事件创建一个 Post-merge Run。它们分别合理，却没有共同权威，因此形成四组会漂移的答案：规划是否批准、实施 Run 在哪一步、Delivery 是否可发布、Post-merge 是否已关闭。

这不是简单缺少一个枚举。若只给现有步骤加 `phase` 标签，调用方仍可选择 Skill、Manual Adapter 仍可提交普通成功、规划产物变化仍由分支 OID 粗粒度失效，Delivery 与 Post-merge 仍会独立推进。需要把 change 的语义状态、下一项工作、批准与验证统一到同一可恢复领域模型中。

上游 Comet 0.5.0 的可取之处是：固定 workflow definition、领域 transition handler、Action claim、proposal/approval hash、稳定 task revision、Validator/Evidence、同一 Run 内归档，以及只允许在安全 checkpoint 扩展。Repoctopus 不采用 Comet 的单仓产品假设、本地用户目录、Classic/Native 双状态或动态 workflow 生成器，而将这些原则适配到 Cordis、多仓 Workspace 和已有平台能力。

## Goals / Non-Goals

**Goals:**

- 任何时刻都能从一个 Change Run 回答 phase、status、当前 Work、等待原因、阻塞证据和合法下一步。
- Runtime 而不是 AGENTS.md 或 Agent 自觉来强制 OpenSpec 规划、Skill、写入范围、验证和归档顺序。
- 复用现有 Action/Receipt、Evidence、Delivery 和平台 Adapter，同时消除重复的 lifecycle owner。
- 在进程退出、Runner 更换、Webhook 丢失和并发恢复后继续同一 Run。
- 为现有持久状态提供可审计、fail-closed 的迁移边界。

**Non-Goals:**

- 不允许用户在本 change 中设计任意阶段图或动态生成产品 workflow。
- 不新增 Deliver phase；MR、push、merge 和规格归档属于 Archive。
- 不让 Desktop Dashboard、OTLP exporter、CLI 或 Cordis Host 成为状态权威。
- 不用一个巨型事务重写全部现有平台实现；迁移按可验证纵切推进。
- 不把具体 OpenSpec 路径或文件名写进 Engine；生命周期依赖 Specification Service 的领域契约。

## Decisions

### 1. 一个 Change 只有一个权威 Change Run

`ChangeRun` 延续现有 Run aggregate、store、journal、trajectory 和 immutable definition snapshot，不建立旁路 Store。它增加版本化 lifecycle state：

```text
ChangePhase = open | design | build | verify | archive
RunStatus   = running | waiting | blocked | completed | failed | migration_required

ChangeRun
  identity: workspace + change + runId
  definition: id + version + normalized digest
  phase: ChangePhase
  status: RunStatus
  work: current Work identity or null
  wait: durable wake condition or null
  inputs: specification, task, repository, composition digests
  facts: accepted decisions, evidence, receipts and platform facts
```

Phase 表达业务生命周期位置，status 表达执行条件。比如等待用户批准是 `design/waiting`，等待 MR 合入是 `archive/waiting`，验证失败等待修复是 `build/blocked`，而不是创造 `approval`、`delivery`、`post-merge` 等平行阶段。

Phase 是 Run 内的显式领域事实，但必须由 lifecycle transition handler 根据固定 definition、当前 Work 与已接受事实生成。CLI、Dashboard 和 exporter 只读取投影；不得从目录、Git 分支或 MR 状态反推并写回 phase。

一个 Workspace/change 同一 lifecycle generation 只允许一个未终结 Change Run。重试和不同 Runner 通过稳定 identity 恢复它。需要真正重新规划时显式 supersede 旧 generation，旧 Run 仍保留审计记录。

### 2. 固定五阶段与有证据的回退循环

首个内置 definition 固定如下：

```text
Open ──intake ready──────────────▶ Design
Design ──valid + approved────────▶ Build
Build ──all tasks validated──────▶ Verify
Verify ──gate satisfied──────────▶ Archive
Archive ──closed + final MR ready▶ Completed

Design ──revision requested──────▶ Design
Build ──semantic plan drift──────▶ Design
Verify ──failure/drift───────────▶ Build
Archive ──implementation drift───▶ Build
Archive ──spec conflict──────────▶ Archive/blocked
```

- **Open**：确认 Workspace、change identity、Specification Provider、目标分支和仓库集合，初始化 Proposal/intake，不实施业务代码。
- **Design**：形成 Provider 声明的 Proposal、Delta Specs、Design、Tasks，严格校验并取得绑定语义摘要的 Human Decision。
- **Build**：按稳定 Task identity 逐项产生受约束 Work；实现、测试与任务完成都由 Outcome 和 Validator 支撑。
- **Verify**：针对完整实现输入运行 Evidence Profile，生成正式验证报告；只接受相同输入摘要下满足的 Gate。
- **Archive**：准备并发布 Business MR、等待完整集合合入、在精确 merge commit 上验证、同步主规格、归档 change、发布最终 Change MR。

回退不回滚历史。Run 追加 invalidation 和 transition 事实，新的 Task revision、Evidence attempt 或交付计划 supersede 旧事实。已执行的外部副作用仍通过 Receipt 和 reconciliation 处理。

### 3. Lifecycle definition 固定版本和内容摘要

`ChangeLifecycleDefinition` 是经过校验、规范化并在 Run 创建时快照的领域输入，至少声明 phase、Work kind、transition、required validator 和 extension checkpoint。恢复时 Runtime 核对 definition id、version、digest；内容变化不能借用相同版本静默接管活动 Run。

首版只提供 Repoctopus 内置 definition。项目可以配置策略参数与启用已声明 extension，但不能插入、删除或重排五个核心 phase。未来若需要不同方法，应以新 definition/version 和独立 change 评审，而不是让 Agent 临时生成状态机。

### 4. Runtime 产生固定 Work，Agent 领取后才可执行

每项下一工作由 transition handler 产生不可变 `WorkDescriptor`：

```text
workId, phase, kind, taskId?
requiredSkill { name, provider, contentDigest }
capability, sideEffectClass, writeScopes
inputDigest, expectedArtifacts, validatorProfile
authorizationSource, checkpoint
```

`ActionDispatcher` 为 Work 创建 Intent；执行者必须以 Run version 和稳定 claim token 领取。Outcome 绑定 `runId + workId + attempt + claim + inputDigest`。陈旧 claim、跨 Work Outcome、未知副作用或调用方自行替换 Skill 一律拒绝。执行者报告“成功”只表示尝试结束；只有 Validator/Evidence 产生的事实才能让 transition handler 推进。

现有 Manual、Process、Git、MR、Specification 和 Evidence Adapter 继续执行外部动作。生命周期只规定它们在何时、以什么输入和验证条件运行，不把平台 I/O 放入 Engine 或 RunStore transaction。

### 5. Skill 与写入权限属于当前 Work

Work 固定规范 Skill 名称，Skill Service 解析唯一 Provider 并记录正文摘要。恢复时不兼容漂移进入 `migration_required`；调用者不能通过 `skill.get()` 参数换成更方便的 Skill。

Application Hook 在写文件、运行命令或调用平台 Adapter 前读取当前已领取 Action：

- 操作能力和 side-effect class 必须匹配 Work；
- 文件目标必须位于声明的 repository 和 write scope；
- terminal artifact 与已验证输入默认不可改写；
- 没有活动 claim 时只允许明确定义的只读操作；
- 所有拒绝产生结构化诊断，不以 Prompt 文本作为安全边界。

Hook 是应用边界授权器，不进入纯 Engine。Engine 只验证声明与已核对事实，Cordis Application Plugin 负责把受保护入口接到相同策略服务。

### 6. Design 批准绑定语义产物摘要

Specification Provider 返回规范化 planning manifest：change identity、Provider identity、四类产物、受影响能力、目标分支和各产物 semantic digest。Design approval 绑定该 manifest 的摘要与 decision identity。

Tasks 的 semantic digest 使用稳定 Task ID、文字、层级、依赖、验收标准和需求映射，但规范化 checkbox 完成状态。这样 `- [ ]` 变为 `- [x]` 不会要求重新批准；修改任务含义、增删任务或改变结构会失效。验证报告、Evidence、生成时间和纯格式化噪声不进入 planning digest。

Change 分支 remote OID 仍必须公开并记录为发布来源，但不再是规划语义摘要的一部分。分支上的规划文件语义变化由 manifest digest 捕获；非规划 commit 不会无条件使 Design approval 失效。若 Provider 无法给出完整 manifest，Design 不得退出。

批准、要求修改和拒绝均为 Human Decision。修改后重新校验产生新的 proposal hash，旧 approval hash 不可复用。

### 7. Build 以稳定 Task identity 驱动

Tasks Provider 把规划任务解析为稳定 `taskId` 和 `taskRevision`。checkbox 只代表基于有效 Outcome/Validator 的完成投影，不是推进命令。每个 Build Work 绑定 task revision、代码/规格输入和 required Skill。

- 完成 Task 时 Runtime 先接受 Validator/Evidence，再通过 Provider 更新 checkbox 或完成投影。
- 仅勾选文件、Agent 自述完成或普通成功 Receipt 不会完成 Task。
- 任务说明、依赖或验收变化产生新 revision，并根据语义影响使当前 Work invalidated 或退回 Design。
- Bug 修复可以由任何团队成员领取同一 change 的新 Work；执行身份用于授权和审计，不成为 change owner。

首版按显式任务依赖和稳定顺序选择一个 ready Task；并行 Build 留给后续 definition version，避免在核心不稳时引入调度复杂度。

### 8. Verify 是完整实现的独立 Gate

Build 的局部 Validator 不替代 Verify。进入 Verify 时冻结 verification input：完整 Task revision 集合、各仓库 commit/tree、配置、composition、Skill 和 Evidence Profile 摘要。Evidence Service 运行或复用只在相同输入下有效的 Attempt、Artifact 和 Gate。

Gate 不满足、Artifact 过期或代码输入变化时，Run 追加 invalidation 并回到 Build。通过后生成正式验证报告并将其 artifact identity 绑定到 Archive 输入。Archive 中 merge commit 验证是同一 lifecycle 的后置 Evidence，可因平台产生的新 commit 再次执行，但不能用目标分支当前 HEAD 替代权威 merge commit。

### 9. Delivery 和 Post-merge 降为 Archive 的执行能力

Archive 仍保留现有成熟能力：公开 Change 分支、默认一个且允许显式多个 Business MR、多仓发布计划、非强制 push、平台 MR create/recover、完整集合冻结、精确 merge commit、路径审计、规格同步和最终 Change MR。变化在于所有步骤都属于同一 Change Run：

```text
prepare delivery plan
→ publish business branches / create-or-recover Business MRs
→ wait(all merged)
→ verify exact merge commits
→ sync specs / archive change
→ commit and push allowed closure files
→ create-or-recover final Change MR
→ complete
```

Delivery 可以保留为计划、Intent/Receipt 和兼容读取模型，但不再拥有 `awaiting_approval` 等独立 lifecycle state，也不产生与 Design/Verify 重叠的批准。涉及远端副作用的危险动作仍可按策略需要额外 Human Decision；这是 Action authorization，不是第二套“交付阶段批准”。

Webhook、Inbox Runner、启动前补偿和人工 reconcile 只持久化/刷新平台事实，然后以稳定 wake key 恢复 `archive/waiting` 的原 Run。不得创建 Post-merge Run。不同 Runner 没有共享本地卷时仍使用远端 Change 分支和平台唯一性栅栏收敛；无法取得原 Change Run 的权威状态时只能报告恢复需求，不能猜测新 Run。

### 10. Cordis 扩展只能挂接安全 checkpoint

新增独立 Cordis Service/Contributor：

- Lifecycle Definition Provider：提供固定 definition 和兼容声明；
- Work Contributor：为声明的 Work kind 提供执行 Adapter；
- Validator Contributor：把 Outcome 转换为可接受 Evidence/fact；
- Lifecycle Extension：只在 definition 声明的 checkpoint 追加非权威 Work 或 validation。

扩展必须声明 identity、version、code/config digest、capability、side effect 和 checkpoint，并进入 composition snapshot。它可以在 Build 后追加许可证检查，不能跳过 Design approval、把失败 Gate 改为通过、提前同步规格或直接写 phase。核心 transition handler 不通过通用事件总线委托这些权威决定。

### 11. 迁移采用版本栅栏而不是静默推断

升级时先保持旧状态只读可查询，再按以下规则生成 migration plan：

- 未开始外部动作且 identity/input 唯一的 generic Run 可映射到相应 phase；
- 已批准 planning manifest 可在重新计算 semantic digest 并人工确认后迁入 Design decision；
- 活动 Delivery/Post-merge 只有在 Change、MR 集合、merge facts、Specification Provider 和下一动作唯一时才可映射到 Archive；
- 已完成旧状态作为历史 audit link，不重放副作用；
- 任一冲突、缺失或多义状态进入 `migration_required`，列出缺失事实和人工选择。

迁移工具不得删除旧 Store、伪造 Evidence 或把分支/MR 作者当 owner。完成迁移前旧写入口被 fence，防止同一 change 被两套 coordinator 同时推进。回退时可恢复旧版本只读诊断，但已由新 lifecycle 执行的副作用只通过 Receipt/reconciliation 处理。

### 12. CLI、Dashboard 与遥测共享只读投影

`ChangeRunProjection` 是公共应用查询契约，包含 phase、status、current Work、Task progress、wait condition、blocker、Evidence summary、next actions 和 freshness。CLI 文本/JSON、Desktop OTLP envelope 和后续 IDE 都消费此投影或其持久事件，不读取内部 Store 猜测。

Telemetry 对每次 accepted transition 输出稳定 event identity、phase before/after、status、work/task、validator、wait reason 和关联 Receipt/Artifact；不输出 Skill 正文、规格正文、命令输出或凭据。Dashboard 仅展示上报事实，不能通过 UI 修改 phase。

## Implementation Strategy

采用纵切而不是一次性横向重写：

1. 先加入 versioned lifecycle domain、ChangeRun projection 和 start/Design guard，在真实 CLI 路径证明未批准规划不能进入 Build。
2. 接入 semantic planning digest、Human Decision 和稳定 Task revision，替换分支 OID 对规划语义的粗粒度绑定。
3. 接入固定 Work/Skill、claim、Hook 写入范围和 Build Task Validator，证明 Agent 无法绕过。
4. 接入 Verify input/Gate 与回退循环，让完整实现证据成为 Archive 前置。
5. 把 Delivery 与 Post-merge 的既有 Adapter/Receipt 逐步挂到 Archive；当纵切通过后 fence 旧 coordinator 写入口。
6. 完成迁移工具、CLI/OTLP projection、文档与自举验证，再移除已无调用的重复状态转换代码。

每个切片都先通过 production composition 和公共入口运行，不建立仅供测试的捷径。旧 API 在替换期间只做明确的兼容投影或返回迁移诊断，不能双写新旧权威状态。

## Testing Strategy

- 纯领域属性测试覆盖所有合法/非法 transition、phase/status 正交组合、rejection/revision/verify 回退和重复事件幂等。
- contract tests 验证 definition digest、Work claim、Outcome identity、Skill 漂移、write scope 和 extension checkpoint。
- golden tests 验证 planning semantic digest：checkbox/格式变化稳定，文字/结构/需求映射变化失效。
- process tests 覆盖进程退出、Receipt 丢失、Webhook 重放、多个 Runner、MR 响应丢失和精确 merge commit 恢复。
- migration fixtures 覆盖旧 generic Run、planning approval、Delivery v2/v3、Post-merge active/completed 和不可唯一映射状态。
- architecture checks 拒绝新的 phase owner、直接 Run 写入、独立 Post-merge Run、caller-selected Skill 和 UI/exporter 状态推断。
- 自举测试用该 lifecycle 完成 Repoctopus 自身 change，并从同一 projection 验证 CLI 与桌面遥测一致。

## Risks and Mitigations

- **范围过大**：先交付最小 Open→Design→Build 纵切，再替换 Archive；每一步都有单一权威和兼容栅栏。
- **迁移误判**：只迁移可证明唯一的状态，其余 fail closed；旧事实永不删除。
- **过度借鉴 Comet**：所有采用都映射到 Repoctopus 现有领域契约并记录排除项，不复制产品 shell 或用户目录假设。
- **Hook 变成第二个 Engine**：Hook 只执行当前 Work 已声明策略；转换仍由纯领域 handler 决定。
- **等待状态占用 Runner**：wait condition 持久化，事件和 reconciliation 只唤醒 Run，不保持 daemon/Fiber。
- **Dashboard 与 Runtime 不一致**：投影从 accepted Run facts 产生，OTLP 只传输该投影对应事件，不反向成为权威。
