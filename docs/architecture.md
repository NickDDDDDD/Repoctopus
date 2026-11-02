# 插件内核架构

Repoctopus 使用 Cordis 作为唯一应用 Runtime。Cordis 管理 Context、Service、依赖、Fiber、Effect 与 Loader；Repoctopus 不再建立同层的产品 Runtime 或第二套依赖容器。确定性 Engine 保持纯函数，跨进程 Run、Evidence、Action 和 Delivery 事实保存在 `.repoctopus/`。

```text
CLI / IDE / API Application Plugin
                 │ versioned request / result
                 ▼
┌────────────────────────────────────────────────────────────┐
│ App Boot                                                   │
│ 领域配置 → 静态准入 → composition digest → Cordis Loader   │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Cordis Context / Service / Fiber / Effect                  │
│                                                            │
│ Project     CommandRouter     WorkflowRuns     RunStore     │
│ Evidence   Delivery   Specification   Consistency          │
│ Archive Publication   Human Decision   Telemetry            │
│       ▲ Provider               ▲ Contributor               │
└───────┼────────────────────────┼────────────────────────────┘
        │                        │
        ▼                        ▼
┌──────────────────┐   ┌─────────────────────────────────────┐
│ Pure domains     │   │ Platform mechanisms                 │
│ Engine / rules   │   │ file / Git / process / browser/OTel │
│ state / facts    │   │ lock / Journal / atomic write       │
└──────────────────┘   └─────────────────────────────────────┘
```

## 各层职责

- `domains/` 保存纯 Engine、Aggregate、事实类型和确定性规则，不读取 Cordis Context。
- `services/` 定义直接继承 Cordis `Service` 的产品契约与注册表。
- `plugins/` 提供 Service Provider、Contributor 和 Application Plugin。
- `platform/` 实现文件、Git、进程、浏览器与 OpenTelemetry 机制。
- `app/` 负责 App Boot 和外部协议，不拥有工作流状态转换规则。

一对一能力使用 Service Provider。一对多能力使用 Contributor，通过 `ctx.effect(() => registry.register(value))` 登记；所属 Fiber 卸载时登记自动撤销。依赖等待、激活顺序与级联卸载由 Cordis 处理，composition compiler 不复制这套状态机。

## Bootstrap 与 Project composition

`bootstrap` composition 不要求正式项目配置，只装载项目探测、配置接入、来源检查和浏览器诊断。`project` composition 在有效 `repoctopus.yaml` 存在时增加 Run、Action、Evidence、Delivery、Skill、Specification、Archive Publication、Consistency Reconciliation 与 Telemetry。每个公共命令都创建并关闭短生命周期 App；核心产品没有 Runner composition、监听端口、Webhook Route、Event Inbox 或后台轮询。

公共入口都必须经 App Boot。当前已切换的真实调用链为：

```text
run start/status/next/verify/record/resume/archive-*
CLI → App Boot → CommandRouter → run.* Contributor → WorkflowRuns Service

evidence plan/run/status/resume/inspect/clean
CLI → App Boot → CommandRouter → evidence.* Contributor → EvidenceCoordinator Service

delivery status/migration-plan（旧状态只读）
CLI → App Boot → CommandRouter → delivery.* Contributor → migration diagnostic / Delivery query

project detect/prepare/review 与 browser/provenance 维护
CLI → App Boot → CommandRouter → 对应 Contributor → ProjectOnboarding 或 BrowserMaintenance Service
                   detect → 显式 scan root → Git Project Provider

run archive-prepare / archive-publish
CLI → App Boot → WorkflowRuns → isolated Specification close
                                → Business Publication Journal
                                → Specification prepared/committed/pushed/completed Journal
                                → complete Publication Receipt

change reconcile / run start preflight
CLI → short-lived Project composition → completed Publication Receipts → authoritative platform facts
                                     → bounded impact review / optional follow-up Change
```

静态 Plugin Descriptor 只用于 import 前准入、来源、权限类别、状态兼容和审计。运行期依赖仍由插件自身的 Cordis `inject` 声明。内置插件的 `codeDigest` 由其登记的实际源码文件计算。

项目配置只选择 Provider 身份和 Credential 变量名。composition digest 会绑定选择与非秘密配置，但不会读取或散列 Credential 值。普通命令按需创建并关闭短生命周期 App。帮助、版本、未知参数和缺失参数在 composition 前处理，因此不会读取项目、访问网络或创建 `.repoctopus/`。

## Run、Engine 与 RunStore

Run 是跨进程持久化 Aggregate，不对应一个长期 Fiber。每个命令可以创建新的 App 与 Service Fiber，再从 RunStore、Transition Journal、Checkpoint 和不可变 packet store 恢复。这个边界采用 Comet reserve/execute/commit 的思想：锁内确定并绑定意图，锁外调用 Host，锁内按原身份提交结果；Repoctopus 没有引入 Comet SDK 或第二套状态目录。

Engine 只根据 Workflow、Run State 和已经核对的事实计算下一状态。RunStore 负责同一 Run 的写锁、状态版本、Journal、原子提交、Trajectory、Checkpoint、幂等和崩溃重放。WorkflowRuns 负责应用用例与 Engine 调用，不得绕过 RunStore 写入状态。

Change Run 的 checkout 准备属于 Runner：Runner 先建立并公开 source branch 或 worktree，Project adapter 只观察 Git，Runtime 再以 `ChangeStartBinding` 校验 Workspace Repository、attached source branch、target branch、remote identity 和多仓 topology。该校验发生在 RunStore initialize、Skill/Work 记录和 Desktop activation 之前；Runtime 不执行 `git switch`、创建 branch 或创建 worktree。绑定身份刻意排除本机 path、HEAD、dirty/worktree digest 和观察时间，因此正常开发不会伪装成新 Run；source、target、remote 或 topology 漂移则 fail closed。

## 受管 Work Execution、Action Intent 与 Receipt

外部副作用不能占用 Run 锁。`run next` 是 Runner 发起的 pull-based 入口，Runtime 根据当前 lifecycle snapshot 选择 Work；Host 和 Agent 都不能指定目标 phase、Work 或 Skill。执行链路为：

1. ActionStore 先保存不可变 Intent，按 Run 隔离的 packet store 再原子保存完整且深冻结的 packet；Run CAS 最后把唯一 attempt 和 packet identity 绑定为权威 claim。CAS 前的孤立内容没有执行权。
2. WorkContextAssembler 只在首次 claim 装配 packet；恢复按 checkpoint identity 读取同一 packet，绝不从已变化的 Skill、Provider 或规划文件重组。Run 同步记录 `context-delivered`，正文不进入 Run、日志或遥测。
3. 唯一 `WorkExecutionHost` preflight 后取得短生命周期 session，通过 Guard 受保护的 repository/process/specification/Git/platform 操作执行当前 Action。
4. Outcome 必须匹配 invocation、Host、packet 和原 claim；Action Receipt 保存后仍须由当前 Work 的 Validator 接受，Agent 不能直接改 phase。
5. Runtime 在同一响应选择下一 continuation。`auto_transition` 只决定客户端是否继续拉取下一项，不改变 transition 合法性。

Build phase 在该执行链内固定使用 `Configure → Plan → Plan Evidence → Execute → Check`。Configure 冻结 Runner 提供的多仓 checkout binding、Host 能力、`autonomous|subagent-driven-development`、`tdd|direct` 和 standard review；Runtime 不创建 checkout。Plan 把 OpenSpec Tasks 投影为有界 Work Packages，但不建立第二套规格或 ticket 权威。Plan Evidence 可以按 definition 风险策略自动接受或建立 Human Decision。Execute 只处理当前 package；Check 汇总全部 completion、Task acceptance、测试、独立 review 和仓库事实后，Runtime 才能进入 Verify。

受管子代理不会创建并列 Run 或并行 `currentWork`。具有 `subagent.dispatch.attested` 的协调 Host 在父 invocation 下返回 package-bound delegation receipts；Runtime 校验 execution identity、role、结果和父调用，再把它们写入同一 Trajectory。Autonomous Host 返回 delegation receipt 会被拒绝。

Intent 与 Receipt 独立保存在 `.repoctopus/actions/`，但 `RunState.workExecution` 是 claim、attempt、Host、Outcome、Validator 和 continuation 的唯一权威。同一 claim 重放返回原 packet identity；已保存 Outcome/Receipt 在响应丢失后由单一纯 continuation classifier 从 Validator 或 transition 边界继续，不重复 Host。Open Work 已 `validated` 但 planning gate 尚未完成时固定为 `reobserve/open-gate-pending`；Specification Provider 暂时不可观察时使用 `reobserve/open-observation-unavailable` 重读原 Outcome 对应事实，不调用 Host。只有未知外部执行结果才保持 `reconcile`，且只有 Host 能证明 `not-executed` 才允许新 attempt。

Project Snapshot reconciliation 区分内容变化和身份变化。HEAD/worktree 内容变化只触发阶段 authority 的精确失效与重验；仓库集合、Project/root、path、remote、branch、拓扑或 diagnostics 等身份变化才设置全局 reconciliation blocker。这样正常提交不会把同一 Change 误判为换了项目，同时真正的执行边界漂移仍然 fail closed。

## Evidence 与 Gate

Evidence 保持 Attempt、Node Journal、Receipt、Artifact、Bundle 与 Gate Projection 的独立生命周期。Evidence Provider 不能写 Run。WorkflowRuns 在持有 RunStore 转换锁时重新核对 Gate 的 `runId`、`actionId`、`stepId`、`stateVersion`、Profile、多仓输入指纹、freshness 和 trust，然后把接受的 Bundle 与下一状态一同提交。

命令、服务、浏览器和视觉采集由 Contributor 通过 Effect 登记到 EvidenceAdapters。EvidenceCoordinator 每次执行按当前 composition 创建适配器集合；Contributor 卸载会撤销登记，不存在旁路组合根。公共 Run 入口只通过 Cordis Service 访问 Gate。

Repository 输入所有权也使用一对多 Contributor。`RepositoryInputPolicies` 在 composition
激活时编译确定性的、内容寻址的策略；EvidenceCoordinator 只消费编译结果，不硬编码
Codex 或其他 Host 路径。Git Adapter 负责把 product dirty 输入与 control-plane manifest
分开采集，并在采集前后重复核对选择集和文件内容。策略没有认领的输入默认属于产品；
只有插件层明确登记的未跟踪 Host 文件才进入控制面。这样 Host 文件可以原位参与执行，
同时仍受 Evidence freshness 约束，而不会被误当成待交付源码。

## 生命周期与长任务

Cordis Effect 持有监听器、注册项、Timer、Watcher、进程和浏览器。WorkflowRuns、EvidenceCoordinator 与 Delivery 各自持有已经接纳的操作。Service 卸载时停止接纳新操作；安全操作通过 AbortSignal 取消；已经越过 Journal 边界的操作完成到可恢复点。异步 disposer 只进行有界排空，超时把 `OPERATION_DRAIN_TIMEOUT` 写入 App 生命周期诊断，并保留持久事实供下次启动恢复。

App Boot 关闭时先把 Loader composition 更新为空并等待子 Fiber 的异步 disposer，再释放根 Context。关闭返回意味着插件资源已经释放，或已经产生明确的可恢复超时诊断。

普通插件重载使用 Cordis Loader 和 Fiber，不建立产品级 Runtime Handoff。长任务的权威状态在 Store、Journal 与 Checkpoint，不在旧 Fiber 内存。

## Composition 身份

规范化 composition digest、共享配置摘要、本机覆盖摘要，以及影响语义的 Provider、Contributor 身份会绑定到 Run、Checkpoint、Evidence、Action Intent/Receipt、Delivery Snapshot、Trajectory 与允许列表遥测。恢复或写入时：

- 摘要相同，继续执行。
- 变化被状态契约明确声明为兼容，记录 `composition.changed`。
- Engine、RunStore、Evidence Gate 或 Action Adapter 不兼容，Run 进入 `migration_required`；只读查询仍可使用。

## 数据与副作用边界

- `repoctopus.yaml` 是可提交的团队配置，只保存仓库逻辑身份、Provider 选择、策略和环境变量名，不保存 Token、Webhook secret 或机器作者身份。
- `.repoctopus/` 是工作区本机的持久权威，包含 Run、Journal、Evidence、Action、Delivery、Publication Receipt、一致性审查和规格关闭 Receipt；应限制访问、备份并按保留策略清理。
- Change 是团队共享工作单元，不由 MR author、Git author、Bot 或某台机器独占。公开 Change 分支的精确远端 OID、非强制 push、Publication Journal 和发布后核对是最终副作用栅栏。
- 业务仓只由受保护 Adapter 在已核对的精确提交和允许路径上读取或写入。Consistency Reconciler 只按已完成 Receipt 查询平台事实，不回退原 Run，也不直接写 RunStore、Evidence Store、规格文件或 Git。
- OpenSpec Provider 是唯一执行规格工具关闭命令的边界；Delivery Action Adapter 是唯一执行 commit、push 与 MR 创建/更新的边界。
- 遥测只导出允许列表中的稳定身份和低基数结果；秘密、原始 Header、payload、绝对路径、自由文本与规格正文不进入 OTel。

这些约束同时由 composition authority、路径限定的架构检查和违规 fixture 保护。配置与目录权限建议见[短生命周期自举](self-hosting.md)。

## 触手、吸盘、神经与眼睛

- **触手**连接并探测多个独立 Git 仓库，保存逻辑 identity。
- **吸盘**收集 Git、命令、测试、CI、浏览器画面和运行日志等证据。
- **神经**是 IDE Adapter、Hook、版本化协议、Cordis Service 与事件。
- **眼睛**提供 Browser Journey、截图 Artifact 和结构化视觉检查。

## 与上游来源的关系

Cordis Core 4.0.5 与 Plugin Loader 1.0.6 的未修改发布快照位于 `third_party/`，固定在 DSH `dsh-v0.2.1-rc.5` 对应提交。DSH 的 Skill Registry 作为精确版本依赖使用；DSH Agent、Session、Workspace 和 fire-and-forget Webhook Runtime 不进入产品运行时。默认分支审计身份与发布依赖身份分开固定，未发布的 Cordis/Loader 源码不会伪装成 npm 发布快照。

Comet `0.5.1` / 独立审计的 `master` 提交是 Engine、受保护转换、文件安全、Evidence、Journal、Checkpoint、恢复、Receipt 和 Change 生命周期的源码或行为来源，不是 Repoctopus 的运行时父应用。Repoctopus 按团队 Workspace、多仓、Publication Receipt 和 Cordis 组合边界选择采用、改写或原生实现。OpenSpec 是可替换 Specification Provider 的当前实现；Matt Skills 是固定内容来源。机器身份、逐文件摘要和采用方式分别记录在 `third_party/cordis-upstream.json`、`third_party/dsh-adoption.json`、`third_party/comet/source-manifest.json` 与 Matt Skills manifest；0.5.1 增量判断见[Comet 审计](../third_party/comet/0.5.1-audit.md)，跨上游能力判断见[上游对齐审计](../third_party/upstream-alignment-audit.md)。

Change lifecycle 的扩展面使用四类有类型的 Cordis 契约：Lifecycle Definition、Work Contributor、Validator Contributor 和 Lifecycle Extension。它们分别注册、卸载并进入 composition/Run 身份快照；Extension 只能声明 definition 已开放的 checkpoint，不能取得核心 transition 权限。这里没有另建通用 Capability Resolver，也没有把 Comet Workflow Application shell 搬进产品；DSH 仅使用已固定发布包和已登记的 Cordis 发布快照，不引用未发布的 Agent、Session 或应用源码。
