# Design

## Context

Repoctopus 当前以 Cordis 作为唯一应用 Runtime，`WorkflowRuns`、Evidence、Delivery 与平台适配器已经通过 Service、Provider 和 Contributor 组合。Delivery 能主动读取 MR 状态，但没有代码平台事件入口、持久投递队列或合入后 Run；Skill 与规格体系也没有产品级能力边界。详见 `proposal.md`。

本设计以固定 DSH `dsh-v0.2.1-rc.2` / commit `687f282e8625c6b8d11ff58211a90524be2e4317` 和 Comet `0.4.5` / commit `575ab0d172e8105257b3c9172b8c8a9b628960ca` 为实施基线，并每天核对默认分支以识别演进方向。上游事实、Repoctopus 推断和产品决定必须分开记录：

| 类型            | 结论                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DSH 上游事实    | `dsh-skill` 提供 `ctx.skills`、Provider 注册、作用域层、优先级、失效和按需正文加载；`dsh-skill-filesystem` 提供本地目录发现与 Watcher。                                                     |
| DSH 上游事实    | Webhook GitHub Adapter 在解析前验证 HMAC、限制请求体并生成带 Source 与 Delivery ID 的已验证投递；`WebhookRuntime.dispatch()` 是进程内 fire-and-forget，Delivery ID 明确不作为内建去重状态。 |
| Repoctopus 推断 | Skill Service Definition 可以直接承担产品能力缝，不需要再设计一个通用 Skill Host；DSH 的 Agent Tool Consumer 与 Session 动作不适合外部 IDE Agent 和可恢复多仓收尾。                         |
| Repoctopus 决定 | 采用 DSH Skill 注册表的完整行为闭包；采用 Webhook 的可信接入语义；用 Repoctopus Event Inbox、Run、Evidence、Delivery 和 Action Receipt 替代 fire-and-forget Session 动作。                  |

## Goals / Non-Goals

**Goals:**

- 交付一个可以用来开发 Repoctopus 自身的真实纵向闭环，而不是继续增加不可独立使用的水平模块。
- 让 Skill、规格权威、代码平台事件和合入后协调遵循现有 Cordis 能力缝。
- 让 MR 合入后的验证、规格同步和 change 关闭不依赖原开发者本机在线。
- 允许多个开发者、Agent 或 CI Runner 处理同一团队 change，不建立独占 Change owner，也不把协调 MR 提交者误当成功能责任人。
- 保持所有远端副作用可恢复、幂等、可审计，并继续禁止 Repoctopus 自动 merge。
- 以来源清单和行为测试约束从 DSH 与 Matt Skills 采用的能力。

**Non-Goals:**

- 不引入 DSH Agent Loop、Session、Workspace、模型工具或完整 WebhookRuntime 依赖闭包。
- 不建立通用 Capability Resolver、第二套插件容器或第二个 Runtime。
- 不在第一纵切实现 Skill 市场、管理 UI、远程 Provider、多规格权威合并或 CodeHub Adapter。
- 不让 Runner 自动修改业务代码、自动解决规格冲突或自动合入协调 MR。
- 不把个人学习目录、Skill 正文或 webhook 原始载荷导出到 SigNoz。

## Decisions

### 1. 纵向闭环由一个 Workflow 连接已有服务

```text
外部 Agent / IDE
  │ Skill Catalog + Specification + Command API
  ▼
Cordis project composition
  ├─ Skills ── Provider(Matt / project / user) ── IDE Projection
  ├─ Specification ── OpenSpec Provider
  ├─ WorkflowRuns ── Engine / RunStore / ActionDispatcher
  ├─ EvidenceCoordinator
  ├─ Delivery ── Git / MR Adapter
  └─ PlatformEvents ── GitHub Ingress ── Event Inbox
                                      │
                                      ▼
                              PostMergeCoordinator
                                      │ wake/start
                                      ▼
                         recoverable Post-merge Run
```

Workflow 只编排领域动作；Engine 仍是纯函数。Skill、Specification、PlatformEvents 和 PostMergeCoordinator 是平级 Cordis Service，不进入一个新的“开发 Runtime”。等待用户、等待 MR 与等待重试都持久化为 Run 或 Inbox 状态，不用长生命周期 Fiber 表示业务进度。

第一条自举 Workflow 覆盖：澄清与规格校验、实施、Evidence、用户交付批准、Delivery 发布、等待合入、平台事件唤醒、合入后 Evidence、规格关闭和协调 MR 更新。各阶段调用已有 Service 或新增 Service 的稳定方法，不能在 Workflow YAML 中嵌入 shell、OpenSpec 路径或 GitHub JSON 解析。

### 2. Skill 采用 DSH Service Definition，消费者改为 Repoctopus 协议

从固定 DSH 提交采用 Skill Registry 的 Provider 接口、候选排序、作用域覆盖、目录快照、失效、取消和 Effect 撤销语义。实施先计算完整依赖闭包：能以未修改内部包引入的源码放入 `third_party/`；只与 DSH Agent/LLM 类型耦合且 Repoctopus 不需要的部分，在产品目录中做来源登记的最小适配。不得重新手写一个行为较弱的注册表。

`Skills` Service 继续暴露 `list/snapshot/get/registerProvider` 语义。Repoctopus 增加两个消费者：

1. `SkillCatalog` Command/API 返回版本化、调用无关的目录和按需正文。
2. IDE Projection Contributor 把解析后的 Skill 投影为目标 IDE 支持的项目级文件，生成清单含 Provider 与正文摘要，重复执行只更新受管文件。

外部 IDE 不需要 Hook 才能看到 Skill。动态协议可用时 Adapter 直接读取目录；只能读文件时使用投影。第一纵切至少验证 Codex 与 OpenCode 的输出契约，并为 CodeBuddy、CodeArts 保留同一 Adapter 接口；不会声称尚未验证的 IDE Hook 已工作。

Matt Skills 以固定 commit 的 MIT 源码快照作为内置 Provider 内容，首批入口选择自举 Workflow 实际使用的 `grill-with-docs`、`tdd`、`diagnosing-bugs`、`code-review` 与 `teach`。快照同时包含 `grill-with-docs` 明确调用的 `grilling` 与 `domain-modeling`，避免发布一个缺少运行依赖的入口。Provider 提供上游名称、描述、调用策略、资源基底和内容摘要。项目或用户 Provider 可以用相同规范名替换，例如 `tdd`，Workflow 不感知来源。

Run 不复制全部 Skill 目录，只在首次加载时追加 `SkillUsageSnapshot`：名称、Provider、版本、调用策略、内容摘要和资源清单摘要。正文继续由 Provider 管理；恢复时摘要不一致走 composition compatibility/Human Decision，而不是静默换方法。

### 3. Teach 的状态属于用户，不属于团队仓库

`teach` Skill 定义由内置 Provider 或项目 Provider 共享。它创建的 `MISSION.md`、`RESOURCES.md`、课程、参考资料、学习记录和笔记统一写到 `.repoctopus/learning/<topic>/`。初始化确保 `.repoctopus/learning/` 被 Git 忽略，Evidence 默认选择器与 OTel 允许列表同时排除该路径。

成员要把结论升级为团队资产时，必须显式走项目文档、知识库或 Specification Provider 的普通评审路径。系统不把整个个人目录“发布”为知识，避免把个人草稿和隐私带进共享历史。

### 4. Specification 是单一权威 Service，OpenSpec 是首个 Provider

定义 `Specification` Cordis Service，首个接口覆盖：

- `inspectChange(changeId)`：返回规范化状态和产物引用；
- `validate(changeId, level)`：返回结构化诊断与 Evidence 输入；
- `prepareClosure(changeId, mergeFacts)`：计算允许的同步与关闭计划；
- `close(changeId, expectedPlan)`：幂等执行并返回文件结果和关闭身份。

项目组合只能激活一个 Provider；这比先造多权威 Registry 更简单，也符合当前单一 SSOT 需求。以后出现真实的多个规格体系并存需求时，再在 Service 后增加复合 Provider，而不改变 Workflow Consumer。

OpenSpec Provider 使用官方 CLI 和状态模型，平台层负责进程执行和输出解析。领域契约中不出现 `openspec/changes` 路径、命令参数或归档文件名。`prepareClosure` 先执行严格校验并计算预期修改范围；`close` 重核当前 change、主规格、合入事实和计划摘要。重复关闭返回同一归档身份。

### 5. Webhook 采用可信接入语义，不采用 DSH Session 动作

采用 DSH GitHub Handler 已验证的边界：仅 POST、严格 JSON Content-Type、原始请求体字节上限、唯一 Header、Credential Provider、HMAC 验证后解析、无损 JSON 快照、Source/Delivery ID/接收时间。平台 Adapter 输出 `VerifiedPlatformDelivery`，不直接触碰 Run 或 Delivery。

不直接使用 DSH `WebhookRuntime`，原因不是依赖数量，而是其业务语义不同：它把投递 fire-and-forget 地映射为 Agent Session，没有持久队列、去重、重试、完成 Receipt 或跨进程恢复。引入 Agent、Session、Workspace 全闭包仍不能满足 Repoctopus 合入后可靠执行，因此保留接入算法并连接 Repoctopus 持久边界。

HTTP Host 是独立 Service，Route Contributor 通过 Effect 注册。验签与事件解析是平台 Contributor。后续 CodeHub Adapter 只替换这两层与平台 API，不改变 Inbox 和 Coordinator。

### 6. Event Inbox 是投递事实的唯一持久入口

`PlatformEvents` Service 在 HTTP Handler 返回 202 前，通过 `EventInboxStore.transaction()` 原子写入 Envelope。主键是 `provider/source/deliveryId`；状态包含 `pending/leased/retry_wait/completed/dead_letter`、尝试次数、租约、下次时间、结果 Receipt 和最后诊断。

Runner 使用可恢复 Lease 领取工作，处理后比较状态版本提交。进程崩溃后租约过期可重领；重复 Delivery 返回既有记录；乱序事件只起唤醒作用。Webhook 载荷不得直接更新 Delivery 状态，Coordinator 必须调用 `MergeRequestPort.status()` 重新读取权威事实。

第一版文件 Store 复用现有原子写、进程身份、可恢复锁和 Journal；状态放在 `.repoctopus/events/`。同一状态卷上的并发 Runner 通过租约避免重复领取；使用各自本地状态卷的 Runner 不把本地 Lease 当成分布式锁，最终远端副作用由第 17 节的协调分支 OID 栅栏收敛。接口保持存储无关，生产部署可换数据库 Provider。

### 7. PostMergeCoordinator 只唤醒或恢复一个收尾 Run

Coordinator 根据标准化仓库与 MR 身份查找活动 Delivery，调用现有 `Delivery.refresh()` 的领域能力刷新完整交付集合。只有全部业务 MR 都具有权威 merge commit 时，才用 `changeId + mergeFactsDigest` 创建稳定 Post-merge Run 身份。同一状态卷恢复同一个 Run；不同状态卷可以重复计算同一稳定身份，但只能通过远端并发栅栏产生一个有效收尾结果。零匹配、多匹配、关闭未合入、权限不足和平台暂时失败都产生不同诊断。

Post-merge Workflow 使用 Action Intent/Receipt 完成：

1. 为每个仓库创建隔离临时检出并定位精确 merge commit；
2. 执行配置的 Evidence Profile；
3. 调用 `Specification.prepareClosure()` 并核对路径计划；
4. 调用 `Specification.close()`；
5. 重新扫描 Git diff，执行路径与内容类型双重允许检查；
6. 创建普通收尾 commit，推送原协调分支并更新原 MR；
7. 保存远端核对 Receipt 并进入等待人工 merge 状态。

每一步都经过既有 RunStore 两阶段 Action 模型。网络、Git、OpenSpec CLI 和测试不在 Run 锁内执行。Push 响应丢失时先按 commit/tree/远端分支核对；归档响应丢失时按 Provider 的关闭身份核对。

进程可能在 Delivery 已持久化 `merged`、但 Post-merge Run 尚未建立或尚未完成时退出，因此 `merged` Delivery 仍属于可由 MR 事件定位的恢复集合；重复唤醒依靠 `changeId + mergeFactsDigest` 恢复同一个 Run。Run Trigger 只绑定 MR 身份、merge commit、mergedAt 等权威合入事实，不绑定每次轮询产生的 `observedAt`；Delivery 对相同合入事实也保留首次观察时间，避免观测元数据制造身份漂移。

临时检出的逻辑所有权仍由完整 Run ID 与 merge facts marker 约束，但物理目录名使用固定长度摘要。这样既保留碰撞时 fail-closed 的所有权核对，也避免 Windows 上 Git object/pack 深层路径超过宿主路径限制。重启后的 Runner 可以清理或复用受管目录，不能复用或删除缺少正确 marker 的用户目录。

### 8. 收尾权限按用途隔离

`repoctopus.yaml` 增加 `postMerge` 配置：Runner 身份引用、临时检出根、Evidence Profile、允许修改的 workspace 路径、提交格式、远端和原协调 MR 策略。允许路径至少具体到主规格、活动 change/归档和验证记录，不能使用项目根通配。

机器可以自动 commit、push 和更新原协调 MR，因为这些动作的输入由已合入事实、满足的 Evidence Gate 和确定的关闭计划约束。它仍不能 merge、force push、rebase、删除分支、换目标分支、创建未声明 MR 或修改业务仓代码。协调 MR 最终合入保留给代码平台与团队策略。

### 9. Runner 是可部署 Application Plugin，实例不是 Change 所有者

本机 IDE 不是可靠 webhook 目标。第一纵切提供 `repoctopus runner start` Application Plugin，可作为长期服务或 CI/容器进程运行，使用一个持久 workspace 状态卷和临时 Git 检出目录。GitHub demo 提供最小部署示例和本地签名事件 E2E；不把 GitHub Actions 作为唯一运行方式，以便公司 CodeHub 复用同一 Runner。

Runner 启动 App Boot project composition，等待 HTTP 和后台领取 Fiber；关闭时停止接收新请求、停止领取、让已越过 Journal 边界的动作到达可恢复点并由 Cordis Effect 清理资源。团队可以运行多个 Runner；Runner 身份只用于租约、审计和诊断，不表示 Change 归属，也不限制其他成员修改同一 change 或业务代码。

### 10. 自举验收必须穿过生产入口

本 change 的规划文件先位于当前分支。实现后用新 Skill Catalog 读取至少一个 Matt Skill，用 OpenSpec Provider 严格校验本 change，用 Repoctopus Evidence 验证源码，再通过 Delivery 创建或更新协调 MR。测试中模拟签名 GitHub 合入事件和多仓状态，真实 MR 合入后由 Runner 的主动恢复或 webhook 触发 Post-merge Run，最终同步主规格并归档 change。

如果当前托管环境不能向本地 Runner 投递公网 webhook，真实自举可以由平台事件回放命令把已经验证或通过 API 主动获取的事件写入同一 Inbox；回放不是直接调用 Coordinator 的旁路。

### 11. 来源与架构治理同步扩展

第三方采用遵循现有来源规则：固定 repository、commit、license、原路径、目标、逐文件摘要和 `unmodified/source-modified/behavior-adopted` 方式。DSH Skill、Webhook 与 Matt Skills 分开登记。未修改快照禁止产品补丁；适配代码必须位于产品目录并列明删除或替换的上游耦合。

架构检查增加以下约束：

- `ctx.skills` 只有一个 Service Definition，Provider 只能通过其注册；
- Specification 只有一个活动 Provider；
- 平台 Adapter 不得调用 WorkflowRuns 或直接写 Run；
- PostMergeCoordinator 不得直接写 Run、Evidence、Delivery 或规格文件；
- 只有 Specification Provider 可以执行规格关闭；
- 只有受保护 Action Adapter 可以 commit、push 或更新 MR；
- 生产代码不得重新引入旧 `oh-my-workflow`、IDE Hook 状态机或项目专有路径。

这里的“唯一容器”约束服务定义和注册根，而不是把 Provider 实现写死为一个：多个 Skill 或 Specification Provider 可以同时存在于 catalog，项目 composition 只选择其中一个规格权威；静态检查拒绝第二个 `SkillRegistry` 注册或 `Specification` Service 根，启动期 authority 检查再拒绝同一 composition 中的多个活动权威。其余副作用边界以路径限定的机器规则登记，并由逐条违规 fixture 验证，避免仅靠代码评审约定。

### 12. OpenTelemetry 只输出关联事实

新增事件覆盖 Skill 选择、目录投影、规格校验、Webhook 接收、Inbox 去重、领取、重试、死信、MR 核对、Post-merge 阶段和规格关闭。允许属性使用现有 change/run/composition/bundle/receipt 标识，加 Provider、Source、Delivery ID、Skill 名称与摘要。

原始 webhook payload、Header、签名、Token、Skill 正文、规格正文、Git diff、个人学习路径与内容不进入 Span/Event 属性。需要排障的完整载荷保留在受权限控制的本地 Inbox Artifact，并应用既有 retention。

### 13. 权威资料冲突是停止条件

如果实施中 OpenSpec、固定 DSH 源码、Matt Skill 行为、代码平台契约、设计图或现有公共 CLI 出现实质冲突，停止受影响任务，列出来源位置、两个选项和影响并请求用户决定。不以较新时间、实现便利或某份资料看起来更权威为由自行选择。

### 14. 开发 checkpoint 以远端精确 OID 为完成边界

本地 commit 不是可靠备份。Repoctopus 管理的功能分支一经进入 `delivery checkpoint`，无论本次是否产生新 commit，都必须用策略指定 remote 普通 push 当前 HEAD、建立 upstream，并通过 `ls-remote` 核对远端分支精确 OID。只有核对成功，checkpoint 才能返回成功；MR 创建、更新与 merge 的 Human Decision 边界保持不变。

Git 无法把本地 commit 与网络 push 做成一个原子事务，因此恢复语义比伪原子更重要：如果 commit 已成功但 push、响应或进程失败，工作树已经干净；再次执行相同 checkpoint 时不得创建空 commit，而是重推并核对同一个 HEAD。普通 push 的非快进保护负责 fail-closed，系统不得以 force push、rebase 或删除远端分支修复漂移。直接绕过 Repoctopus 执行的 Git commit 不在 Runtime 可强制控制范围内；团队 Agent 与 IDE 必须把 checkpoint 命令作为分支创建和每次提交的完成步骤。

### 15. 架构决定由 Specification change 的 Design 记录

OpenSpec change 只把 Proposal、Delta Specs、Design 和 Tasks 作为规划权威。当前 change 内的普通设计决定、实施约束和偏差直接写入本文件；测试过程、结果与恢复事实进入 Evidence 和任务 7.3 的正式验证报告。项目不创建或识别 `implementation-notes.md`。

跨越单个 change、长期约束多个组件、回退需要迁移或跨团队协调，或者影响公共契约、持久数据、安全与信任边界的架构变更，应为该工作单独建立一个普通 change，而不是引入特殊的“架构 change”类型。该 change 的 Design 记录上下文、备选方案、选择理由、取舍、迁移与回退方式，并通过正常评审取得确认。纯内部架构调整没有改变可观察行为时，OpenSpec 使用 `skip_specs: true`；行为契约改变时才同时提供 delta specs。归档后的 change 保留决策历史。`docs/architecture.md` 只描述当前架构，需要时与实现 change 一起更新，不建立第二套独立决策台账。

这条规则属于稳定的 Specification 领域语义，不依赖 OpenSpec 文件路径。OpenSpec Provider 当前把它映射到 `design.md`；未来替换 Provider 时，由新 Provider 声明等价的设计产物和生命周期，Workflow Consumer 不需要理解其专有目录或文件名。

### 16. Change 是团队共享工作单元，动作身份只用于审计

Repoctopus 不建立独占 Change owner。任一成员或 Agent 都可以在同一 change 中继续实现、修复 Bug、补充测试、更新规格或完成评审。系统分别记录业务改动、审批、规格关闭和发布动作的实际 actor；MR author、Git author、Bot Token 对应账号、Runner identity 和临时 Session 都不是 Change 所有权来源。

协调 MR 与业务 MR 的 `role` 决定它们在工作流中的用途，而不是人员归属。协调 MR 的提交者即使不是特性实现者，也不会因此被选为补偿责任人；一次性补偿按项目中 Repoctopus 已登记的未完成 Delivery 发现候选项，不按人员过滤。

两个角色可以位于同一物理仓库，但不能复用同一个 MR。原因是业务 MR 合入后必须关闭，而协调 MR 需要继续保持开放以接收合入后 Evidence、主规格同步和 change 归档。Delivery 在准备快照时拒绝同一远端上的相同源/目标分支拓扑，并在平台返回 MR 后再次按 `provider + repositoryId + number` 核对；前者尽早阻止必然复用，后者保护 Adapter 边界。URL 不是稳定身份的一部分，不能用 URL 表面差异绕过角色隔离。

### 17. 多 Runner 以远端协调分支 OID 作为最终并发栅栏

多个 Runner MAY 同时读取同一 change、查询平台事实并执行无远端副作用的验证。Post-merge 发布前，每个 Runner 必须绑定协调 MR 当前源分支的精确 head OID 和审计后的 workspace 基线；普通非强制 push 只有在该远端基线未变化时才能成功。

若竞争 Runner 已推进远端分支，失败者必须重新读取原协调 MR：远端已经包含相同 change 的等价规格关闭结果时返回稳定 no-op；远端内容、分支映射或关闭身份不等价时 fail-closed 并保留诊断。系统不得以 force push、隐式 rebase、删除分支或“最后写入者获胜”解决竞争。测试、检出和本地 Run 可以至少执行一次，远端结果必须最终收敛一次。

当前文件 Store 只为单个状态卷提供原子状态转换，不伪装成跨机器锁。未来加入共享数据库 Store 时可以减少重复计算，但不得改变远端 OID 栅栏和结果核对语义，因为外部副作用仍需要自己的幂等边界。

### 18. 开发 Run 启动前执行项目级一次性补偿

普通 project composition 在配置 `postMerge` 时装配 Coordinator 与受保护 Action Provider，但不启动 HTTP Host、Webhook Route 或后台轮询。`post-merge reconcile` 枚举当前持久边界中已登记且可能等待合入或收尾的 Delivery，通过任一已登记业务 MR 唤醒同一个 `PostMergeCoordinator`。候选发现不读取 MR author，也不创建 Change owner。

`run start` 在创建新的日常开发 Run 之前调用同一补偿入口。业务 MR 仍打开时只记录等待结果；全部合入时同步完成或恢复 Post-merge Run；关闭未合入、权限错误、远端竞争和验证失败返回结构化诊断，不得被新 Run 静默覆盖。维护者可以显式执行一次 `post-merge reconcile --workspace <path>`，命令完成后退出，不留下 HTTP Listener 或 Timer。

第一版候选枚举使用当前 coordination workspace 的 Delivery Store；全新 clone 没有该持久状态时不能声称已经发现全部历史 change。跨无共享状态卷的自动发现需要后续引入受验证的远端索引或共享 Store，但不同 Runner 在已经发现同一 change 后的远端收敛属于本次范围。

### 19. 未决定的批准请求是可替换指针，决定与动作事实不可覆盖

`awaiting_approval` 表示系统已经提出请求，但人尚未作出可信决定。此时若报告措辞、Evidence、代码或远端基线变化，强迫人先拒绝一个已知过期请求只会制造无意义操作；Delivery 允许重新准备，并用新快照和新 `requestId` 原子取代旧请求。`delivery.prepared` 历史保留被取代的请求和快照摘要，迟到的旧响应因身份不匹配被拒绝。对相同快照的重复准备直接返回既有状态，不增加版本或事件。

一旦存在人工决定，或任何发布动作不再是零次尝试的 `pending`，重新准备不得覆盖状态。批准后的漂移继续进入 `verification_required`，部分发布继续使用原计划恢复。这样把“尚未形成事实的请求”与“已经形成的决定或副作用”分开，避免为了方便重试而破坏审计历史。

## Risks / Trade-offs

- [DSH Skill 完整依赖闭包可能引入 Agent 专有类型] → 先以固定 commit 生成依赖与源码采用报告；保留 Registry 行为闭包，只在来源登记的产品适配层移除无运行价值的 Agent Consumer 耦合。
- [文件 Store 不能为不同机器提供全局 Lease] → 明确允许重复计算，以协调分支精确 OID、非强制 push 和发布后权威核对收敛远端结果；共享数据库只作为后续调度优化，不能替代副作用幂等。
- [Webhook 已返回 202 但后台随后失败] → 202 只表示持久收件成功；处理状态、重试与死信通过查询命令和遥测暴露。
- [机器收尾修改范围过宽] → 配置具体允许路径，提交前同时比较关闭计划和实际 Git diff，任何额外文件 fail-closed。
- [Skill 正文变化影响可重复性] → 首次使用时绑定正文摘要，恢复比较，发布包与来源清单固定内置集合。
- [OpenSpec CLI 行为变化] → 固定兼容版本并通过 Provider 契约测试隔离；升级走独立变更。
- [真实 webhook 无法到达开发机] → Runner 面向团队可达环境；本地仅用于签名 E2E和事件回放，不把本机在线作为生产前提。
- [决策历史与当前架构说明可能漂移] → change 的 Design 保留原因与取舍，`docs/architecture.md` 只描述当前状态；架构 change 在需要时同时更新两者，不建立第二套决策台账。

## Migration Plan

1. 保存当前主线验证基线，完成 DSH Skill/Webhook 与 Matt Skills 的固定源码闭包和许可证报告。
2. 接入 Skills Service、首个 Provider、目录命令与 IDE Projection，并用 Repoctopus 自身加载 Skill。
3. 接入 Specification Service 与 OpenSpec Provider，用其校验本 change。
4. 接入 HTTP Host、GitHub Adapter、Event Inbox 与 Runner，使用签名 fixture 验证持久化、去重和恢复。
5. 接入 PostMergeCoordinator 与 Post-merge Workflow，使用临时 Git remote 和 mock 平台完成全链路 E2E。
6. 在真实 Repoctopus change 上执行自举交付；用户批准验证报告后发布协调 MR。
7. MR 合入后由新路径完成主规格同步和归档，验证完成前保留显式 `delivery refresh` 作为恢复入口。
8. 增加一次性 `post-merge reconcile` 与 `run start` 前置补偿，使用两个独立 Runner 竞争同一协调分支的故障注入测试验证一个发布成功、另一个等价收敛或安全停止。

回滚通过普通 revert MR 完成。已经持久化的 Inbox、Run、Evidence 和 Receipt 保持只读可诊断；回滚版本不得把未知新状态伪装为成功，必要时返回 `migration_required`。
