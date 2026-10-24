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
│ Evidence   Delivery   Specification   PlatformEvents       │
│ HTTP Host  Event Runner  PostMergeCoordinator  Telemetry   │
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

`bootstrap` composition 不要求正式项目配置，只装载项目探测、配置接入、来源检查和浏览器诊断。`project` composition 在有效 `repoctopus.yaml` 存在时增加 Run、Action、Evidence、Delivery、Skill、Specification 与 Telemetry；配置 `postMerge` 时还增加一次性 Coordinator、受保护 Action Provider 和命令 Contributor，但不启动监听端口或后台轮询。`runner` composition 在相同项目配置之上增加 HTTP Host、Webhook Route、Event Inbox Runner 和 Application Plugin；只有 `runner start` 使用这条长驻组合。

公共入口都必须经 App Boot。当前已切换的真实调用链为：

```text
run start/status/next/record/resume
CLI → App Boot → CommandRouter → run.* Contributor → WorkflowRuns Service

evidence plan/run/status/resume/inspect/clean
CLI → App Boot → CommandRouter → evidence.* Contributor → EvidenceCoordinator Service

delivery checkpoint/prepare/status/decide/publish/refresh
CLI → App Boot → CommandRouter → delivery.* Contributor → Delivery Service

project detect/prepare/review 与 browser/provenance 维护
CLI → App Boot → CommandRouter → 对应 Contributor → ProjectOnboarding 或 BrowserMaintenance Service
                   detect → 显式 scan root → Git Project Provider

runner start
CLI → Runner Application → HTTP Host + Webhook Route → PlatformEvents → durable Inbox
                                                Inbox Runner → PostMergeCoordinator → WorkflowRuns

post-merge reconcile / run start preflight
CLI → short-lived Project composition → Delivery candidates → PostMergeCoordinator → WorkflowRuns
```

静态 Plugin Descriptor 只用于 import 前准入、来源、权限类别、状态兼容和审计。运行期依赖仍由插件自身的 Cordis `inject` 声明。内置插件的 `codeDigest` 由其登记的实际源码文件计算。

项目配置只选择 Provider 身份和 Credential 变量名。composition digest 会绑定选择与非秘密配置，但不会读取或散列 Credential 值。普通命令按需创建并关闭短生命周期 App；Runner 由进程管理器持有，收到终止信号后通过相同 Cordis 生命周期有界关闭。

## Run、Engine 与 RunStore

Run 是跨进程持久化 Aggregate，不对应一个长期 Fiber。每个命令可以创建新的 App 与 Service Fiber，再从 RunStore、Transition Journal 和 Checkpoint 恢复。

Engine 只根据 Workflow、Run State 和已经核对的事实计算下一状态。RunStore 负责同一 Run 的写锁、状态版本、Journal、原子提交、Trajectory、Checkpoint、幂等和崩溃重放。WorkflowRuns 负责应用用例与 Engine 调用，不得绕过 RunStore 写入状态。

## Action Intent 与 Receipt

外部副作用不能占用 Run 锁。WorkflowRuns 使用两个受保护转换连接动作执行：

1. 第一笔 Run 事务提交 `action.proposed`。
2. 释放 Run 锁后，ActionDispatcher 领取并保存 Intent；Intent 以 `runId + workId + attempt + claimToken + inputDigest` 形成 fencing identity 和幂等键。
3. Contributor Adapter 执行动作或等待人工结果；Outcome 必须回传相同的五元绑定，Dispatcher 拒绝旧 attempt、跨 Work 或输入漂移的结果，并保存带有同一绑定的 Receipt。
4. 第二笔 Run 事务核对当前待处理 Action、Receipt 和所需 Evidence，再提交 Outcome。

第一条纵切提供 Manual Action Contributor。Intent 与 Receipt 独立保存在 `.repoctopus/actions/`，Trajectory 的 `action.completed` 事件记录 Receipt ID。同一 claim 重放返回原 Intent；已保存 Receipt 的完成调用在响应丢失后返回原 Receipt，不重复执行 Adapter。副作用始终发生在 RunStore transaction 之外。

## Evidence 与 Gate

Evidence 保持 Attempt、Node Journal、Receipt、Artifact、Bundle 与 Gate Projection 的独立生命周期。Evidence Provider 不能写 Run。WorkflowRuns 在持有 RunStore 转换锁时重新核对 Gate 的 `runId`、`actionId`、`stepId`、`stateVersion`、Profile、多仓输入指纹、freshness 和 trust，然后把接受的 Bundle 与下一状态一同提交。

命令、服务、浏览器和视觉采集由 Contributor 通过 Effect 登记到 EvidenceAdapters。EvidenceCoordinator 每次执行按当前 composition 创建适配器集合；Contributor 卸载会撤销登记，不存在旁路组合根。公共 Run 入口只通过 Cordis Service 访问 Gate。

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
- `.repoctopus/` 是工作区本机的持久权威，包含 Run、Journal、Evidence、Action、Delivery、Inbox 和规格关闭 Receipt；其中 Inbox payload 与租约状态属于敏感数据，应限制访问、备份并按保留策略清理。
- Change 是团队共享工作单元，不由 MR author、Git author、Bot 或 Runner identity 独占。不同 Runner 可以重复计算；公开 Change 分支的精确远端 OID、非强制 push 和发布后核对是跨本地状态卷的最终副作用栅栏。
- 业务仓只由受保护 Adapter 在已核对的精确提交和允许路径上读取或写入。PostMergeCoordinator 不直接写 RunStore、Evidence Store、规格文件或 Git。
- OpenSpec Provider 是唯一执行规格工具关闭命令的边界；Delivery Action Adapter 是唯一执行 commit、push 与 MR 创建/更新的边界。
- 遥测只导出允许列表中的稳定身份和低基数结果；秘密、原始 Header、payload、绝对路径、自由文本与规格正文不进入 OTel。

这些约束同时由 composition authority、路径限定的架构检查和违规 fixture 保护。部署与目录权限建议见[自举与 Runner 部署](self-hosting.md)。

## 触手、吸盘、神经与眼睛

- **触手**连接并探测多个独立 Git 仓库，保存逻辑 identity。
- **吸盘**收集 Git、命令、测试、CI、浏览器画面和运行日志等证据。
- **神经**是 IDE Adapter、Hook、版本化协议、Cordis Service 与事件。
- **眼睛**提供 Browser Journey、截图 Artifact 和结构化视觉检查。

## 与上游来源的关系

Cordis Core 4.0.5 与 Plugin Loader 1.0.6 的未修改发布快照位于 `third_party/`，固定在 DSH `dsh-v0.2.1-rc.3` 对应提交。DSH 的 Skill Registry 作为精确版本依赖使用，Filesystem Skill 与 GitHub Webhook 边界按来源登记后适配；DSH Agent、Session、Workspace 和 fire-and-forget Webhook Runtime 不进入产品运行时。默认分支审计身份与发布依赖身份分开固定，未发布的 Cordis/Loader 源码不会伪装成 npm 发布快照。

Comet `0.5.0` / 固定 `master` 提交是 Engine、受保护转换、文件安全、Evidence、Journal、Checkpoint、恢复、Receipt 和 Change 生命周期的源码或行为来源，不是 Repoctopus 的运行时父应用。Repoctopus 按团队 Workspace、多仓、持久 Inbox 和 Cordis 组合边界选择采用、改写或原生实现。OpenSpec 是可替换 Specification Provider 的当前实现；Matt Skills 是固定内容来源。机器身份、逐文件摘要和采用方式分别记录在 `third_party/cordis-upstream.json`、`third_party/dsh-adoption.json`、`third_party/comet/source-manifest.json` 与 Matt Skills manifest；0.5.0 增量判断见[Comet 审计](../third_party/comet/0.5.0-audit.md)，跨上游能力判断见[上游对齐审计](../third_party/upstream-alignment-audit.md)。

Change lifecycle 的扩展面使用四类有类型的 Cordis 契约：Lifecycle Definition、Work Contributor、Validator Contributor 和 Lifecycle Extension。它们分别注册、卸载并进入 composition/Run 身份快照；Extension 只能声明 definition 已开放的 checkpoint，不能取得核心 transition 权限。这里没有另建通用 Capability Resolver，也没有把 Comet Workflow Application shell 搬进产品；DSH 仅使用已固定发布包和已登记的 Cordis 发布快照，不引用未发布的 Agent、Session 或应用源码。
