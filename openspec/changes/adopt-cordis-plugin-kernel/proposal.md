# Proposal

## Why

Repoctopus 当前由 CLI 直接构造 `RepoctopusRuntime`、`EvidenceRuntime`、Delivery、Git、文件存储和遥测实现。它已经拥有来自 Comet 评估的确定性 Engine、受保护转换、Evidence、Journal、Checkpoint 和恢复能力，但这些能力仍被多个手工组合根连接，生命周期和依赖关系会随着浏览器、IDE、团队插件和审计能力增加而继续耦合。

Cordis 已经提供 Context、Service、Fiber、Inject、Effect 与 Loader。Repoctopus 不应在 Cordis 之上再建立一个产品级 Runtime，也不应把现有 `RepoctopusRuntime` 原样包进 `runtime-default` 插件。现在需要让 Cordis 成为唯一应用 Runtime，以 Cordis Service 重新组织产品能力，同时保留并补全 Comet 已验证的功能闭包。

## What Changes

- **BREAKING**：以完整 Cordis Core 与 Cordis Plugin Loader 源码快照作为唯一应用 Runtime 和插件生命周期内核；删除公共入口中的手工组合根，不兼容当前内部构造函数、模块路径和直接实例化方式。
- **BREAKING**：删除产品层 `RepoctopusRuntime`、`EvidenceRuntime`、`runtime-default` 和唯一 Runtime Provider 概念。确定性 Workflow Engine 保持纯领域函数；Run 由 `WorkflowRuns` Cordis Service 协调，Evidence 由 `EvidenceCoordinator` 协调。
- 新增直接继承 Cordis `Service` 的产品服务契约，以及文件、Git、命令、Evidence、Action、Delivery 与 OTel Provider 插件。Contributor 通过 Effect 向注册表贡献 Adapter，卸载时自动撤销。
- 新增 Repoctopus App Boot，把 `repoctopus.yaml` 的领域配置翻译为 Cordis Loader Entry，完成静态插件准入、组合摘要、启动诊断和受控关闭。依赖解析、激活顺序、级联卸载和资源回收由 Cordis 管理；用户不直接维护 `cordis.yml`。
- 保留 bootstrap composition 与 project composition。缺少正式项目配置时只加载项目接入、来源检查和浏览器诊断能力，不加载虚假的 Run 服务。
- Run 保持跨进程持久化 Aggregate。`RunStore` 拥有跨进程锁、Transition Journal、原子提交、Trajectory、Checkpoint、幂等与恢复闭包；Cordis Fiber 只承载当前进程的服务和活动操作。
- 采用 Comet 的 Action Adapter 功能边界，并以 Cordis `ActionDispatcher` 与 Contributor 插件实现。外部副作用在 Run 锁外执行，使用 Intent、Receipt 和幂等键连接两次受保护转换。
- Evidence 保持独立的 Attempt、Node Journal、Receipt、Artifact、Bundle 与 Gate 生命周期。Run 只在锁内重新核对并接受稳定 Gate，不允许 Evidence 自行写 Run 状态。
- 插件卸载时停止接纳新操作；可取消操作接收 AbortSignal；已进入 Journal 提交区的操作完成到安全点或留下可恢复状态。普通插件重载使用 Cordis Fiber 生命周期，不建立产品级 Runtime Handoff。
- 进行中的 Run 绑定影响语义的插件组合。写转换前检查组合兼容性；兼容变化记录显式事件，不兼容变化进入 `migration_required`，不得静默继续。
- 静态 Plugin Descriptor 只用于导入前准入、供应链、状态兼容和审计，不参与运行期依赖注入。第一阶段只接纳内置插件和共享配置显式登记的团队插件，同进程插件不视为安全沙箱。
- 将 `@deepseek-ai/cordis` 4.0.4 与 `@deepseek-ai/cordis-plugin-loader` 1.0.5 的上游源码各保存一份，保留 MIT 许可证、固定提交、原路径和内容摘要；产品代码不得修改第三方快照。
- 第一条可运行纵切交付 App Boot、多仓探测、WorkflowRuns、RunStore、纯 Engine、Manual Action Adapter、Command Evidence、Gate、Checkpoint、恢复、OTel 组合身份、普通插件重载与隔离安装。Delivery、Managed Browser、视觉反馈和其他能力随后接入同一服务树。

## Capabilities

### New Capabilities

- `plugin-composition`: 定义 Cordis 唯一应用 Runtime、App Boot、产品 Service、Provider/Contributor、静态插件准入、组合追溯和 Effect 生命周期。

### Modified Capabilities

- `runtime-foundation`: 将产品层 Runtime 重构为纯 Engine、持久化 Run Aggregate、WorkflowRuns Service、RunStore 事务与 Action 执行边界。
- `project-configuration`: 将共享领域配置翻译为 bootstrap/project Cordis composition，并限制本机覆盖与团队插件准入。
- `implementation-evidence`: 将 Evidence 组织为 Cordis Coordinator 与 Contributor，同时保持独立事实生命周期和 Run 锁内 Gate 复核。
- `development-telemetry`: 将组合身份、Service Provider 和 Contributor 身份加入允许列表遥测，同时保持本地事实先于导出。

## Impact

- 影响 `app`、`domains`、`platform`、`scripts`、`test`、`workflows`、构建和发行配置，并新增 `services`、`plugins` 与 Cordis 第三方源码目录。
- CLI 命令名称与版本化 JSON envelope 保持公共兼容；内部启动路径、TypeScript 导入、类名和构造方式属于破坏性变更。
- `.repoctopus` 中的 Run、Evidence 与 Delivery 继续是恢复事实。本次不承诺已有开发快照跨新状态 Schema 原地迁移，测试状态可以清理后重新生成。
- Comet 继续作为功能语义和来源基线；Cordis 管理应用组合与生命周期。采用或改写的第三方代码继续进入机器可检查来源清单。
- 验证增加第三方快照摘要、配置翻译确定性、Service 就绪、Effect 清理、操作排空、普通插件重载、组合漂移、受保护转换、Action Intent/Receipt、自举中断恢复和打包安装检查。
