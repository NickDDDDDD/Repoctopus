# Design

## Context

见 `proposal.md` 的 Why。当前五阶段 Change Run 已经统一了顶层生命周期，但 Archive 仍由几组历史边界拼接：`WorkflowRuns` 规划并发布 Business MR，`PostMergeActions` 在临时检出中验证和关闭规格，OpenSpec Provider 执行一次官方 `archive` 命令，Delivery 发布最终 Change MR，随后 `archive.completed` 以“规格已关闭且最终 MR ready”为触发进入终态。

这条路径已经具备精确 merge commit、Change 分支 OID fence、路径审计、create-or-recover 和 Windows 清理重试，却仍有四个结构性缺口：

1. 最终 MR 创建是发布事实，不是合入事实；当前 Run 会过早完成。
2. OpenSpec `archive` 会同时移动 change 和修改主规格，进程中断后活动目录可能已经消失，但 Closure Receipt 尚未形成。
3. preflight、Action attempt、CLI 参数解析和副作用执行顺序未统一，配置错误可能消耗 attempt，PID 还被当作 Runner identity。
4. `tasks.md` 曾把 Verify、Archive 和自举终态写成 checkbox，Runtime 又要求全部 checkbox 完成后才能离开 Build，形成只能提前勾选的循环依赖。

固定 Comet 0.5.0 `aeb1a6598034e28ce46b8422d4dbd8785e607bd7` 提供两组成熟证据：Classic 在 archive 前重读 phase、分支、HEAD、Evidence 和授权，并在副作用后核对唯一归档结果；Native 使用 `prepared → applying → rollback|committed` Journal、文件身份 CAS 和恢复探针，且不会把“change 已移动到 archive”解释为 delivery 已完成。Repoctopus 采用这些不变量，不采用 Comet 的单仓、本机状态根、Classic/Native 双产品外壳或直接 push/PR 终态。

## Goals / Non-Goals

**Goals:**

- 同一 Change Run 在任何进程边界都能准确回答 Archive 的当前 Work、外部副作用结果、等待条件和恢复动作。
- 最终 Change MR 精确版本经人合入后才生成 Change 完成事实。
- OpenSpec 关闭可在目录已移动、响应丢失和 Runner 更换后继续核对或安全回滚。
- 所有多仓 Business MR、精确 merge commit、Workspace Store 关闭结果和最终 MR 证明绑定到同一冻结输入。
- 配置错误在 Action Intent/attempt 前失败；未知副作用先 reconcile；用户无需手动管理 attempt。
- 保持 Cordis Service、纯领域 Engine、平台 Adapter 和 Specification Provider 的现有职责边界。
- 让本 Change 可以在旧 definition 上启动，并通过显式迁移切换到新 Archive 协议完成自举。

**Non-Goals:**

- 不新增第六个 Deliver 或 Post-merge phase。
- 不尝试提供跨多个 Git 仓和托管平台的原子事务；协议提供持久 Saga、幂等恢复和 fail-closed 栅栏。
- 不允许 Repoctopus 自动合入 Business MR 或最终 Change MR。
- 不承诺没有任何共享/恢复状态的全新 Runner 自动发现全部历史 Change；远端发现能力留给后续独立 change。
- 不复制 Comet 的 CLI、目录、产品命名或单仓状态模型。
- 不新增 ADR、implementation notes 或第五类 OpenSpec 规划工件。

## Decisions

### 1. Archive 是五阶段内部的显式 Work 协议

保持 `phase=archive`，把当前隐含步骤提升为固定且有序的 Work：

```text
archive.preflight
  → delivery.publish-business
  → delivery.await-business-merge
  → delivery.verify-merged
  → specification.close-candidate
  → delivery.publish-final
  → delivery.await-final-merge
  → archive.finalize
  → completed
```

每个 Work 仍由 lifecycle definition 固定能力、side-effect class、write scope、Skill/Method Profile、input digest、output contract 和 Validator。等待业务 MR 或最终 MR 合入使用 `archive/waiting`；配置缺失、输入漂移或非等价远端结果使用 `archive/blocked`；没有新 phase，也不让 Delivery aggregate 重新成为 lifecycle owner。

替代方案是保留一个 `specification.archive` 巨型 Work，在 Service 内继续顺序调用。它不能让投影、恢复和故障注入准确定位边界，也无法在最终 MR 等待期间表达合法状态，因此拒绝。

### 2. 使用单一 Archive Journal 管理持久 Saga

新增版本化 `ArchiveJournal`，由 Archive 协调 Service 拥有并通过文件 Store 原子写入。Journal 绑定 `runId + changeId + generation + archiveInputDigest`，使用乐观版本/CAS 和同一 Run 的可恢复文件锁；它记录事实，不直接决定 phase。领域 reducer 只接受由 Validator 核对后的 observation。

Journal 的逻辑结构为：

```text
identity
preflight
businessPublication
businessMerge
postMergeEvidence
targetMerge
specificationClosure
finalPublication
finalMerge
finalization
managedResources
history
```

每个条目区分 `prepared`、`applying`、`awaiting_external`、`reconciling`、`blocked`、`committed` 或 `superseded`，并保存 Intent/Receipt 摘要、外部资源身份与后置条件。Journal snapshot 用于快速恢复，追加 history 用于审计；两者必须在一次受控写入中保持可核对的版本和摘要。

这不是分布式 ACID 事务。外部动作之前持久化 Intent，动作之后查询权威事实并持久化 Receipt；失败时按已确认边界继续，不宣称回滚已经公开的 Git/MR 动作。

### 3. Preflight 在 claim 和 attempt 之前运行

`archive.preflight` 是只读 Work，核对：

- Credential Provider 能否提供所需名称的值，但不读取到日志、状态或遥测；
- Git author name/email；
- OpenSpec Store registry、Provider/schema identity 和官方命令可用性；
- Verify 与 post-merge Evidence profile、依赖自举命令和所需 Adapter；
- Workspace、业务仓、Change 分支、目标分支和全部远端 OID；
- 平台 read/create-or-recover、全状态 MR discovery/adoption 和 final merge status 能力；
- 临时根、可用空间、允许路径和清理策略；
- Publication policy 与完整 Business MR 集合。

结果形成 `PreflightReceipt`，绑定当前 Archive input 和非敏感能力摘要。配置或环境缺失进入 `archive/blocked(configuration)`，不创建受保护 Action Intent、不领取副作用 Work、不递增 attempt。

CLI 也采用同一原则：命令树先识别 `--help`、版本、缺失必需参数和未知参数，再装配 Project composition。`run start --help` 只打印用法；不得执行启动前 reconcile 或默认 foundation workflow。

### 4. Runtime 原子分配 attempt，Runner identity 与 PID 分离

Work Dispatcher 增加 `claimNextAttempt(runId, workId, inputDigest, executor)`，在 Action Store 锁内读取已有 Intent/Receipt 和当前租约，原子选择“恢复已有 attempt”或“分配 max+1”。公共 CLI 不再要求 `--attempt N`；兼容参数只允许引用 Runtime 已存在的 attempt，不能创建更大的编号。

`executor.runnerId` 来自共享配置的 Runner identity或本机持久 instance registry。PID、进程启动时间和 lease deadline 作为 `executorSession` 保存，只用于活性判断和诊断。另一 Runner 可以在租约到期、显式释放或 reconcile 判定后接管同一稳定 Work；它不会因此成为 Change owner。

选择稳定 identity 而不是随机 UUID，是为了让运维审计能识别执行主体；选择 Runtime 分配 attempt 而不是 CLI 递增，是为了消除并发调用的竞态和用户猜数。

### 5. Business MR 集合按逐 MR 事实冻结

Archive input 保留默认一个、允许多个 Business MR 的规则，并为每一项冻结：repository identity、head/base branch、平台 MR identity、批准快照、发布 head、权威 merge commit 和核对时间。多个 MR 位于同一仓时仍保留每个 merge evidence，并由策略明确最后用于隔离检出的 commit。

Business 发布、响应丢失恢复和合入刷新继续通过平台无关 Adapter。任何 MR 增删、替换、目标分支改变或 merge commit 漂移都会 supersede 后续 Work input，并回到重新准备/验证边界；其他仓成功不能掩盖一个仓的漂移。

不做跨仓回滚。某些 MR 已发布后失败时，Journal 明确记录部分完成，恢复从首个未确认动作继续。

### 6. Specification close 产生经过后置验证的候选结果

OpenSpec Provider 继续使用官方 `archive --yes --json`，但执行前先写 `SpecificationClosureJournal`：

- 关闭计划、Provider/schema identity、merge facts digest、目标基线摘要；
- 活动 change、预期归档路径、受影响主规格和所有允许文件的 CAS identity；
- 预期后置条件和回滚边界。

执行后必须核对：

1. 活动 change 目录消失；
2. 相比 before manifest 恰好新增一个属于该 change 的归档目录；
3. Proposal 中的新 capability Purpose 已进入主规格；
4. 所有受影响主规格与整个 Store 严格校验通过；
5. diff 只包含关闭计划和 Guardrail 允许的规格/验证路径；
6. 当前文件身份仍与 Journal 可解释。

`SpecificationClosureResult` 继续表示“Provider 已在候选 checkout 中关闭规格”，保持现有 Service 契约兼容；它不再被任何调用方解释为 Change terminal。只有所有后置条件满足才写该 Result/Receipt。

进程在官方命令之后中断时，恢复不要求活动目录仍存在：Provider 比较归档目录、主规格 CAS 和预期 manifest，若结果完整则继续提交候选；若只完成部分且文件仍匹配 before/expected identity，则受控回滚或重新应用；若有人并发修改，进入人工修复而不是覆盖。回滚只作用于隔离 checkout，不触碰远端或开发者工作树。

### 7. 关闭候选只在隔离 checkout 中发布

Archive 先从冻结目标 OID 和 Change 分支 OID 构造隔离 checkout，生成可重现的 target merge，再在其中运行 post-merge Evidence、Specification close 和路径审计。候选关闭提交固定 tree、parents、message、author、closure audit digest 和 Evidence identity。

Runtime 发起发布时仍只允许：普通非强制 push 到已登记 Change 分支，以及同 repository/head/base 的最终 MR create-or-recover。人也可以手工 push 同一个经过验证的候选 head 并创建 MR；这类动作作为平台外部事实被采用，不伪造 Runtime Action Intent。无论来源如何，不同 Runner 只有在 tree、parents、message、author、head OID 和 audit 都等价时才收敛到远端结果；任一不等价则 fail-closed。

旧 Delivery v3 可继续提供 Business MR 发布/平台 Adapter，但最终关闭发布直接消费 Archive Journal 的冻结事实与 Receipt，不要求构造第二个 Delivery lifecycle 状态。

### 8. 最终 MR 可以由人创建，精确合入后才 finalize

`delivery.publish-final` 实际是 ensure/adopt Work：先按 repository、head、base 和精确 head OID 查询开放、关闭及已合入 MR；存在唯一匹配时直接采用，不存在时才在策略允许下 create-or-recover。它保存 `FinalPublicationReceipt` 并创建 `delivery.await-final-merge` Work。Receipt 绑定 repository、MR identity、base、冻结 head OID、关闭 plan/audit digest、候选提交和 `runner-created | recovered | human-created` provenance。

如果人已经完成 commit、普通 push、MR 创建甚至合入，Runner 后续仍走同一查询。平台必须能在源分支删除后返回 MR 记录中的 head OID、base、状态与 merge commit；因此 Adapter 查询不能只搜索 open MR。只要唯一匹配且远端候选通过相同路径审计和严格规格验证，就能事后采用。若 Runtime 在人工 push 前没有形成候选 Receipt，它会先把远端 head 当作待采用候选重新验证，而不是信任“人已经合入”这一声明。

刷新最终 MR 时：

- `open`：保持 `archive/waiting`；
- `closed_unmerged`：进入 `archive/blocked`，要求人处理；
- `merged` 且 head/base/merge commit 可证明匹配：无论 MR 由谁创建，都产生 `FinalMergeProof`；
- head 或 base 漂移：把旧 Publication Receipt 标为 `superseded`，重新获取候选、严格验证归档和允许 diff，再由 Runtime 分配新 attempt；
- 查询不到或匹配多个 MR：fail-closed。

`archive.finalize` 只读取已验证的 `FinalMergeProof`，再核对目标远端包含平台报告的 merge commit、冻结 head 与 closure/audit digest。它追加 `ArchiveCompletionReceipt`，随后领域 reducer 才执行 `archive.completed`。

Webhook 只是 wake signal；启动前 reconciliation 和显式 reconcile 使用相同平台查询与 observation。Runtime 永不执行 merge。

### 9. Tasks checkbox 与 phase Work 分权

Provider 在 Design gate 对官方 Tasks 做两层检查：

- 确定性规则拒绝 Workflow follow-up 下的 checkbox，以及验收依赖 `archive`、规格已归档、Business/最终 MR 已合入、Run completed 等未来生命周期事实的 tracked task；
- Design review 投影明确展示每项 task 的 `phaseScope=build`、验收命令和 Requirement mappings，由可信 Human Decision 审核语义上难以静态判断的边界。

Runtime 仍以 Validator 而不是 checkbox 文本推进 Task。Verify 报告、Archive、最终 MR 合入和清理只存在于 definition、Work、Validator、Evidence 与 Receipt；`tasks.md` 的 `Workflow follow-up` 可以用普通 bullet 告知人类，但不进入 task progress。

仅依赖关键词会误报，完全依赖 Agent 又无法强制，因此采用“可确定规则 fail-closed + 人工批准显示语义 + Runtime 不接受未来 Receipt”的组合。

### 10. 受管资源清理是独立可恢复尾声

所有临时 checkout、锁文件、浏览器/子进程资源和 scratch 目录在创建时写入 `managedResources`，包含精确规范化路径、owner run/work、创建 Receipt 和 lease。主 Work 的 `finally` 尝试清理；Windows 共享冲突使用有界指数退避。

清理仍失败时写 `cleanup_pending`，但不抹掉已经证明的 Evidence、发布或合入结果。Runner 启动和显式 reconcile 执行精确 GC，只处理 registry 中且租约过期的路径；不扫描模糊目录，不递归删除 Workspace、仓库根或未登记路径。清理成功追加 Receipt。

Archive Completion Receipt 可以在存在非关键 `cleanup_pending` 时形成，但投影和遥测持续显示维护警告；影响数据完整性或仍持有发布锁的资源属于关键清理，finalize 前必须解决。

### 11. 组件职责保持单向

- **Change lifecycle domain/Engine**：定义 Work 顺序、合法 observation、phase/status 和终态守卫；不做文件、Git 或平台 I/O。
- **WorkflowRuns / Archive Coordinator Cordis Service**：生成 input、调用 Dispatcher/Provider、把经过验证的 Receipt 转成 observation；不自行改 Run JSON。
- **Action Dispatcher / Store**：attempt 分配、claim lease、Intent/Outcome/Receipt 身份和未知结果协调。
- **Specification Service / OpenSpec Provider**：官方 schema 生命周期、关闭事务和规格后置验证；不知道 MR 是否已合入。
- **Delivery / Platform Adapter**：Git push、MR create-or-recover、全状态 MR discovery/adoption、状态读取和 merge facts；不决定 Change 完成，也不要求 Agent 是 MR 作者。
- **RunStore / ArchiveJournalStore**：CAS、原子持久化、历史与恢复，不调用外部系统。
- **CLI / Runner / Dashboard / OTel**：调用公共命令和读取投影，不拥有 transition。

架构检查继续拒绝 Service 直接写 Run、Adapter 产生 transition、CLI 自选 attempt/Skill、Provider 宣称 Change terminal 或出现独立 Post-merge Run。

### 12. Definition 升级和自举使用显式迁移

新 definition 发布为下一版本，不在原版本下静默修改 digest。迁移计划按当前 phase 处理：

- Open/Design：重新校验规划并取得当前批准；
- Build/Verify：若 planning/task/verification input 唯一且没有 Archive 副作用，可保留有效事实并切换 definition；
- Archive 未发布：重建 preflight 与 Journal；
- Archive 已有外部动作：只有 Intent、Receipt、MR 集合和下一边界可唯一映射时迁移，否则 `migration_required`；
- 已 completed：保持历史只读，并运行完整性审计，不倒退或伪造新终态。

本 Change 在旧 definition 上创建，因此实施新版本后必须先对自身 Run 生成并应用显式迁移，再用新 `await-final-merge → finalize` 路径完成自举。迁移前后 Run identity、旧 definition snapshot 和审计链接都保留。

已发现的历史“旧 Run Receipt head 与最终实际合入 head 不一致”使用追加式 integrity finding 记录，状态为 confirmed、resolved 或 accepted-risk；不编辑旧 Receipt。该迁移能力只处理已有已知记录，不把全仓历史取证扩展成本 Change 的无限范围。

### 13. Telemetry 和投影描述同一协议

`ChangeRunProjection` 增加 Archive Work、attempt、Journal version、等待的 MR identity、final head、blocker、cleanup pending 与 freshness；不暴露绝对临时路径、凭据名称的值或规格正文。

accepted trajectory 产生相同 OTLP event：phase/status、work kind、attempt、reconciliation outcome、MR 状态类别、cleanup state 和关联 Receipt ID。Desktop Dashboard 与 SigNoz 继续消费同一 OTLP 事件；任何显示端都不能通过轮询本地目录建立另一答案。

### 14. Comet 采用边界显式登记

| Comet 成熟机制 | Repoctopus 采用 | 明确排除 |
| --- | --- | --- |
| Classic archive preflight 重新核对 phase、branch、HEAD、Evidence、授权 | 扩展为多仓、Store、平台能力和发布策略 preflight | 单仓工作区和 Classic 命令外壳 |
| Archive 后验证唯一归档与活动 change 消失 | 加入主规格全局严格校验、Purpose 和允许 diff | 只看目录移动即成功 |
| Native prepared/applying/rollback/committed Journal 与 CAS | 重建为 Archive/Specification Journal 和文件身份恢复 | Comet Native 数据模型与用户目录 |
| Resume probe 不把 archived 当 delivery complete | 最终 MR 精确合入后才 finalize | 本地 push/PR ready 作为终态 |
| Portable archive 先 delivery 再暴露 terminal | 映射到 Business MR、最终 Change MR 和平台 merge proof | 自动 merge 与单平台耦合 |

若实施阶段决定复制新的 Comet 源文件，必须先更新 source manifest、目标摘要、许可证覆盖和依赖闭包审计；默认只重建行为，不新增运行时依赖。

## Migration Plan

1. 先加入 Journal/Receipt vNext、preflight、attempt allocator、CLI parse fence 和 contract tests，旧 Archive 写路径保持可读但不双写终态。
2. 加入新 lifecycle definition 与显式 migration planner；对非 Archive 活动 Run 验证无损迁移，对歧义 fixture 保持 `migration_required`。
3. 把 Business 发布/等待/后置验证接到新 Archive Work，确认多仓和跨 Runner 行为后 fence 旧聚合写入口。
4. 把 OpenSpec close 改为 prepared Journal + 候选后置验证，并保留旧 Closure Result 的兼容读取。
5. 接入最终发布、`await-final-merge`、精确 merge proof 与 finalize；旧“MR ready 即 completed”只保留在历史 definition 中。
6. 运行历史完整性审计并追加 finding；不得修改旧 Receipt。
7. 迁移当前自举 Run，完成 Business MR、最终 Change MR 人工合入和新终态证明。

回滚时停止新 Work 领取，保留 Journal 与外部 Receipt，恢复上一版本做只读诊断；已经发布的分支/MR 不回滚，由 reconciliation 继续收敛或交给人工处理。未产生外部副作用的候选 checkout 可以按受管资源清单清理。

## Testing Strategy

- 纯领域测试覆盖完整 Work 序列、非法越级、最终 MR open/closed/merged、head 漂移和 terminal invariant。
- Action contract tests 覆盖 Runtime attempt 分配、租约接管、陈旧 Outcome、PID 变化、响应丢失和未知副作用先 reconcile。
- CLI 进程外测试证明 `--help`、版本、未知/缺失参数为零 composition、零 reconcile、零 Run 写入。
- Provider 故障注入在 OpenSpec archive 前、目录移动后、Purpose 补全后、严格校验前后和 Receipt 写入前中断，验证继续、回滚或人工修复。
- 多仓 E2E 覆盖多个业务仓、同仓多个 MR、目标分支前进、merge commit 漂移和不同 Runner 恢复。
- 最终发布测试覆盖 push 响应丢失、MR 创建响应丢失、人工创建后采用、人工创建并合入后首次发现、源分支删除、开放等待、head 漂移、关闭未合入、精确合入和 merge proof 不匹配。
- 新 clone/no `node_modules` 的 public CLI + production composition 测试验证 Evidence 自举、Store 显式选择和无测试旁路。
- Windows 测试注入共享冲突/`EBUSY`，验证有界重试、`cleanup_pending` 和精确 GC。
- 自举测试证明 future-phase checkbox 在 Design 被拒绝，且当前 Change 迁移后只能在最终 Change MR 合入时完成。

## Risks / Trade-offs

- **Journal 状态更多，理解成本上升** → 对外仍只展示五阶段和当前 Work；内部状态使用单一 schema、状态图、contract test 和迁移工具。
- **最终 MR 合入前 Run 会长期等待** → 这是正确业务事实；等待不占用进程，由 webhook、启动补偿或显式 reconcile 唤醒。
- **隔离 checkout 回滚无法处理并发人工改动** → CAS 不匹配时停止并保留现场，绝不覆盖；远端副作用本来就不承诺回滚。
- **确定性 task 阶段检查无法理解全部自然语言** → 结合静态拒绝、Design 投影和可信人工批准，且 Runtime 永不接受未来 phase Receipt 作为 Build 完成事实。
- **历史 definition 与新 definition 并存增加维护成本** → 旧版本只用于恢复/迁移 fixture，默认创建始终使用最新版本，达到保留期后通过独立 change 退役。
- **不共享状态的全新 Runner 仍不能发现所有历史 Change** → 本 Change 保证已取得权威 Run/Journal 后的跨 Runner 恢复；全局远端索引另立 change，避免混入 Archive 正确性修复。
- **preflight 可能因暂时平台故障过度阻断** → 区分配置缺失、能力不支持和暂时故障；只有确定配置问题不消耗 attempt，暂时故障保留可重试诊断。
