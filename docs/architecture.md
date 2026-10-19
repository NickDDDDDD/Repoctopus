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
│ ActionDispatcher  EvidenceCoordinator  Delivery  Telemetry │
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

`bootstrap` composition 不要求正式项目配置，只装载项目探测、配置接入、来源检查和浏览器诊断。`project` composition 在有效 `repoctopus.yaml` 存在时增加 Run、Action、Evidence、Delivery 与 Telemetry。

公共入口都必须经 App Boot。当前已切换的真实调用链为：

```text
project probe
CLI → App Boot → CommandRouter → project.probe Contributor → Git Project Provider

run start/status/next/record/resume
CLI → App Boot → CommandRouter → run.* Contributor → WorkflowRuns Service

evidence plan/run/status/resume/inspect/clean
CLI → App Boot → CommandRouter → evidence.* Contributor → EvidenceCoordinator Service

delivery checkpoint/prepare/status/decide/publish/refresh
CLI → App Boot → CommandRouter → delivery.* Contributor → Delivery Service

project detect/prepare/review 与 browser/provenance 维护
CLI → App Boot → CommandRouter → 对应 Contributor → ProjectOnboarding 或 BrowserMaintenance Service
```

静态 Plugin Descriptor 只用于 import 前准入、来源、权限类别、状态兼容和审计。运行期依赖仍由插件自身的 Cordis `inject` 声明。内置插件的 `codeDigest` 由其登记的实际源码文件计算。

## Run、Engine 与 RunStore

Run 是跨进程持久化 Aggregate，不对应一个长期 Fiber。每个命令可以创建新的 App 与 Service Fiber，再从 RunStore、Transition Journal 和 Checkpoint 恢复。

Engine 只根据 Workflow、Run State 和已经核对的事实计算下一状态。RunStore 负责同一 Run 的写锁、状态版本、Journal、原子提交、Trajectory、Checkpoint、幂等和崩溃重放。WorkflowRuns 负责应用用例与 Engine 调用，不得绕过 RunStore 写入状态。

## Action Intent 与 Receipt

外部副作用不能占用 Run 锁。WorkflowRuns 使用两个受保护转换连接动作执行：

1. 第一笔 Run 事务提交 `action.proposed`。
2. 释放 Run 锁后，ActionDispatcher 保存 Intent 和幂等键。
3. Contributor Adapter 执行动作或等待人工结果，并保存 Receipt。
4. 第二笔 Run 事务核对当前待处理 Action、Receipt 和所需 Evidence，再提交 Outcome。

第一条纵切提供 Manual Action Contributor。Intent 与 Receipt 独立保存在 `.repoctopus/actions/`，Trajectory 的 `action.completed` 事件记录 Receipt ID。

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

## 触手、吸盘、神经与眼睛

- **触手**连接并探测多个独立 Git 仓库，保存逻辑 identity。
- **吸盘**收集 Git、命令、测试、CI、浏览器画面和运行日志等证据。
- **神经**是 IDE Adapter、Hook、版本化协议、Cordis Service 与事件。
- **眼睛**提供 Browser Journey、截图 Artifact 和结构化视觉检查。

## 与上游来源的关系

Cordis Core 4.0.4 与 Plugin Loader 1.0.5 的未修改快照位于 `third_party/`，来源检查固定许可证、上游提交和逐文件摘要。Comet 是 Engine、受保护转换、Evidence、Journal、Checkpoint、恢复和 Receipt 等功能语义的参考；Repoctopus 按多仓与团队交付需求决定采用、改写或重构，来源关系由机器清单与架构治理记录。
