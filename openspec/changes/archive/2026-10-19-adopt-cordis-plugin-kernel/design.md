# Design

## Context

当前 `app/cli/main.ts` 直接构造工作流、Evidence、Delivery、Git、文件存储和 OTel 对象，形成多个组合根。`RepoctopusRuntime` 实际只协调 Workflow Run 的持久化转换，`EvidenceRuntime` 实际组合 Evidence 生命周期；两者都不是通用应用 Runtime。Cordis 自身还把 `ctx.runtime` 保留为 Fiber 的插件运行时元数据，因此继续建立产品级 Runtime 既概念重复，也与固定内核接口冲突。

本次以“功能上参考 Comet，架构上拥抱 Cordis”为原则。Comet 提供 Engine、Run、Evidence、锁、Journal、Checkpoint、恢复、Retention 和 Action Adapter 的行为基线；Cordis 提供 App 的 Context、Service、依赖、Fiber、Effect、Loader 和重载语义；Repoctopus 保留多仓项目、团队交付、浏览器反馈和审计差异化能力。

## Goals / Non-Goals

**Goals:**

- 让 Cordis 成为唯一应用 Runtime，全部公共入口从同一插件树解析产品 Service。
- 保持 Engine 为纯领域状态转换器，让 Run 成为跨进程持久化 Aggregate。
- 把 Comet 的正确性闭包放进清晰的 RunStore、Evidence 和 Action 边界，不因插件化削弱恢复或门禁。
- 使用 Cordis 原生 Service、Inject、Fiber 与 Effect，不建立第二套容器、依赖图或生命周期。
- 先交付可运行、自举、中断恢复和验证的纵切，再迁移 Delivery、浏览器和其他水平能力。
- 让实际组合、Provider、Contributor 与代码来源可恢复、可审计、可导出。

**Non-Goals:**

- 不保留产品级 `RepoctopusRuntime`、`runtime-default` 或 Runtime Handoff。
- 不把纯 Engine、Run State、Evidence 事实或 Delivery Saga 合并成 Cordis 内存状态。
- 不开放任意 npm 插件在线安装，不把同进程插件描述成恶意代码安全沙箱。
- 不在 Run 锁内执行命令、远端请求、Agent 任务、浏览器操作或等待人工确认。
- 不自动同步 Cordis 或 Comet 上游，不复制完整 DSH 产品、Profile、Agent Loop 或 Web UI。

## Decisions

### 1. Cordis 与 Loader 以未修改源码快照进入 `third_party`

`third_party/cordis` 与 `third_party/cordis-plugin-loader` 分别保存官方发布包中的完整源码、构建产物、包元数据和 MIT 许可证。`third_party/cordis-upstream.json` 记录 DeepSeek Harness 固定提交、包版本、npm 完整性和逐文件摘要。`check:provenance` 拒绝任何未登记修改。

两个包作为内部 workspace package 使用，通用间接依赖通过根 lockfile 精确锁定。Repoctopus 扩展全部位于第三方目录之外。上游同步必须使用独立 OpenSpec change。

### 2. Cordis 是唯一应用 Runtime

```text
CLI / IDE / API Application Plugin
                 │
                 ▼
Repoctopus App Boot
  配置翻译 → 静态准入 → Context / Loader → ready / shutdown
                 │
                 ▼
Cordis Service 与 Contributor 插件树
```

App Boot 只负责配置翻译、静态插件准入、组合身份、Loader、就绪诊断和有界关闭。Host 不拥有 Workflow 阶段、Evidence Gate、Delivery 策略或项目探测规则。CLI、IDE 与 API 是 Application Plugin，不再直接构造产品服务。

不新增 `RepoctopusContext`、通用 Service Adapter、Fiber 包装器或自定义依赖注入。产品服务直接继承 Cordis `Service` 并通过模块增强进入 Context。

### 3. 代码按纯领域、Cordis 服务、插件实现和平台机制分层

```text
domains/   纯 Engine、Aggregate、事实与规则，不依赖 Cordis
services/  直接继承 Cordis Service 的产品契约与注册表
plugins/   Service Provider、Contributor 和 Application Plugin
platform/  文件、Git、进程、浏览器和 OTel 机制
app/       Boot 与外部 surface
```

`WorkflowRuns`、`RunStore`、`EvidenceCoordinator`、`ActionDispatcher`、`CommandRouter`、Project、Delivery 和 Telemetry 都是平级 Service。Provider 插件提供一对一 Service；Contributor 通过 `ctx.effect(() => registry.register(value))` 向一对多注册表贡献 Adapter。

### 4. 薄配置翻译器不复制 Cordis 依赖图

用户继续维护 `repoctopus.yaml` 和受限 `.repoctopus/local.yaml`，不维护 `cordis.yml`。薄翻译器完成：

- 领域 Schema 校验；
- bootstrap/project composition 选择；
- 静态 Plugin Descriptor 准入；
- 权威能力唯一性；
- 配置、插件与代码摘要规范化；
- 生成 Cordis Loader Entry。

Service 依赖、激活顺序、Provider 消失后的级联卸载、Fiber 状态与 Effect 清理由 Cordis `inject` 和 Loader 决定。翻译器不解析通用 `provides/requires` 图，也不建立第二套激活状态机。

bootstrap composition 只提供项目探测、配置接入、来源检查和浏览器诊断。project composition 在正式配置存在时增加 Run、Evidence、Action、Delivery 和 Telemetry。缺少配置的正式命令明确拒绝，不回退到隐藏构造路径。

### 5. Run 是持久化 Aggregate，Engine 是纯函数

Workflow Engine 只接收 Workflow、RunState 和已经核对的领域事实，返回新状态、Action Intent 或拒绝原因。它不读取 Context、文件、Git、时钟或网络，也不管理锁和生命周期。

Run 可以跨进程、跨机器持续数天，不对应长期 Fiber。`WorkflowRuns` 是 Profile 级 Service，每次写操作通过 `RunStore.transaction(runId)` 加载权威事实、调用 Engine 并提交。只读查询也从 Store 投影，不依赖旧进程对象。

### 6. RunStore 拥有 Comet 受保护转换闭包

`RunStore` Provider 负责：

- 同一 Run 的跨进程写锁；
- State、Workflow、Project Snapshot、Trajectory 与 Checkpoint 读取；
- Transition Journal 和崩溃重放；
- 状态版本比较与幂等事件检查；
- 原子文件替换和提交顺序；
- 损坏、陈旧锁与人工修复诊断。

`WorkflowRuns` 负责应用用例、Engine 调用、Evidence Gate 复核、组合兼容判断和版本化结果。上层不得手工协调多个状态文件，也不得绕过 `RunStore.transaction()` 写 Run。

### 7. Evidence 独立持久，Gate 在 Run 锁内重核

Evidence 保持 Attempt、Node Journal、Receipt、Artifact、Bundle 与 Gate Projection 的独立生命周期。Provider 和 Contributor 不写 RunState。受保护 Outcome 提交时，`WorkflowRuns` 在 Run 事务内要求 `EvidenceCoordinator` 重新核对 Run ID、Action ID、Step ID、State Version、Profile、多仓输入指纹、freshness、信任和必需结果，然后把接受的 Bundle ID 与状态转换一起提交。

### 8. 外部动作使用 Intent 与 Receipt，不占用 Run 锁

Engine 产生 Action 后，第一笔 Run 事务提交 `action.proposed` 并释放锁。`ActionDispatcher` 在独立执行 Journal 中保存 Intent 和幂等键，再由 Cordis Contributor Adapter 执行外部副作用并保存 Receipt。第二笔 Run 事务核对待处理 Action、Receipt 与 Evidence Gate后调用 Engine 记录 Outcome。

第一纵切只提供 Manual Adapter。后续 Agent Task、Command、Human Decision 和其他 Adapter 使用相同契约加入，不改变 Engine 或 Run 事务边界。

### 9. Cordis Effect 管资源，操作所有权补足异步方法生命周期

监听器、注册项、Timer、Watcher、浏览器、进程和其他插件期资源必须由 Cordis API 或 `ctx.effect()` 持有。Service 维护 DSH 风格的活动操作所有权：卸载开始后拒绝新操作；可取消操作接收 AbortSignal；已进入 Journal 提交区的操作完成到成功提交或明确的可恢复点；异步 disposer 等待已接纳操作有界排空。

普通插件替换使用 Loader 与 Fiber 级联重载。因为持久事实是权威，新 Provider 不接管旧内存对象。崩溃或关闭超时由下一次启动从 Journal 恢复，不建立 Runtime Handoff 状态机。

### 10. 组合身份与兼容性进入恢复闭包

静态 Plugin Descriptor 记录身份、版本、契约版本、来源、入口、配置 Schema、权限类别、代码摘要和状态兼容范围。它只用于导入前准入、供应链和审计；运行期依赖由 Cordis 管理。

规范化 composition digest 进入 Run、Checkpoint、Evidence、Action Receipt、Delivery Snapshot、Trajectory 与 OTel 允许列表。只读查询允许查看发生漂移的 Run。写转换前必须比较当前组合：完全一致直接继续；显式兼容的变化记录 `composition.changed`；Engine、RunStore、Evidence Gate 或 Action Adapter 不兼容时进入 `migration_required`。

同进程团队插件仍是可信代码。未来不可信扩展需要 Worker、子进程或容器边界，不能只增加权限字段。

### 11. 命令与外部 surface 也是插件

`CommandRouter` 是 Cordis Service。Project、Run、Evidence 与 Delivery 插件通过 Effect 注册命令；CLI Application Plugin 只解析 argv、调用 Router、渲染版本化 envelope 和设置退出码。IDE 与 API 调用同一版本化 Application Service，不模拟 CLI 文本。

### 12. 迁移保持每一步可运行

实施顺序为：

1. 固定现有行为基线并引入未修改 Cordis/Loader。
2. 建立 App Boot、薄 Descriptor、bootstrap/project composition、Service 契约与生命周期测试。
3. 建立 Project、Workflow、RunStore、WorkflowRuns、Manual Action 与 CLI 纵切。
4. 接入 Command Evidence、Gate、Checkpoint、恢复和 OTel，自举本 change。
5. 迁移 Delivery、浏览器、视觉、配置评审和其他命令，删除所有生产直接构造入口。
6. 收紧来源、架构、打包与文档验证。

切换期间允许从新插件内部复用经过重新审查的领域和平台函数，不允许把旧 `RepoctopusRuntime` 或 `EvidenceRuntime` 原样作为生产组合根保留。每个切换点只有一个公共生产入口。

### 13. 权威资料冲突仍是停止条件

实施中如果 OpenSpec、固定 Cordis 源码、Comet 行为基线、许可证、公共 CLI 契约或批准设计出现实质冲突，停止受影响实现并列出位置、选项与影响，等待用户决定。不得根据资料新旧或实现便利自行选择。

## Risks / Trade-offs

- [Cordis API 快速演进] → 固定源码与提交，禁止普通依赖更新替换；上游同步使用独立 change。
- [把旧类包成插件形成新单体] → 架构检查禁止公共入口和插件内部继续构造旧组合根；按 Service 契约迁移。
- [Cordis 不跟踪任意异步方法] → 建立小型 Operation Ownership，并用卸载期间操作测试验证排空与恢复。
- [外部副作用无法原子回滚] → 使用 Intent、Receipt、幂等键和补偿诊断，不宣称与 Run 文件形成分布式事务。
- [插件重载改变进行中 Run 语义] → 持久化组合身份，写前兼容检查，不兼容时进入迁移状态。
- [插件数量增加调试难度] → 就绪诊断、Fiber/Effect 检查、组合清单和 OTel 身份统一输出。

## Migration Plan

1. 先更新 change 产物与来源清单，保持旧公共入口可运行。
2. 建立新 Service 与插件纵切并运行旧行为回归。
3. 按命令组原子切换 CLI；每组切换后删除该组直接构造路径。
4. 自举验证通过后删除旧 `RepoctopusRuntime`、`EvidenceRuntime` 命名与未调用兼容代码。
5. 打包隔离验证通过后提交验证报告；不自动提交、推送或创建 MR。

## Open Questions

无。Cordis 唯一 Runtime、纯 Engine、持久化 Run、Service 拆分、操作排空、Action Intent/Receipt、Evidence Gate、组合兼容与第一纵切范围已经确认。
