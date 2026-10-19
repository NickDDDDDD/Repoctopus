# 实施记录

## 重构前基线

- 基线提交：`c1b818c`。
- 验证命令：`npm run verify`。
- 结果：47 个测试文件通过，145 个测试通过，1 个跳过；类型检查、Lint、确定性构建、品牌、架构、Comet 来源和严格 OpenSpec 校验全部通过。

## Cordis 来源决定

- DeepSeek Harness 当前 `master` 已升级到 Cordis 4.0.5 与 Loader 1.0.6，因此没有用当前分支替换已评审版本。
- 固定采用 release commit `d0dca04e22f09fe04967090b2ee70587ecdad6cc` 对应的 Cordis 4.0.4 与 Loader 1.0.5。
- Git monorepo 的包元数据使用 `workspace:~`；实际内嵌内容采用同版本官方 npm 发布包，以保留可独立安装的正式依赖元数据。`src` 与固定提交对应，源码未作产品修改。

## 架构纠偏记录

- 首轮实验曾计划让一个 `runtime-default` 插件提供产品级 `runtime` 服务，并让 Profile Compiler 检查唯一 Runtime Provider。
- 实验发现 Cordis 已把 `ctx.runtime` 定义为 Fiber 所属插件运行时的访问器；调用 `ctx.provide('runtime', ...)` 会失败并提示该属性已经声明为 accessor。
- 这个冲突暴露了更深的问题：`RepoctopusRuntime` 与 `EvidenceRuntime` 是业务协调类，不应与 Cordis 的应用 Runtime 形成同名、同层的第二套生命周期。
- 经需求复核后决定：Cordis 是唯一应用 Runtime；Engine 保持纯函数；Run 是跨进程持久化 Aggregate；WorkflowRuns、RunStore、EvidenceCoordinator、ActionDispatcher 等成为平级 Cordis Service。
- Profile Compiler 收敛为薄领域配置翻译器，不再复制 Cordis 的通用依赖图、激活顺序或 Fiber 状态机。Provider 和 Contributor 由 Cordis Inject、Fiber 与 Effect 管理。
- 已生成的实验性 App Boot 只作为失败探针，后续直接重写，不保留产品 Runtime、Runtime Handoff 或通用 Service Adapter 兼容层。

## 实施完成后的能力闭包

- App Boot 只创建 Cordis Context、根级 CompositionIdentity 与 LifecycleDiagnostics，再由 Loader 激活 bootstrap 或 project composition。关闭时先把 Loader composition 更新为空并等待子 Fiber disposer，随后释放根 Context。
- WorkflowRuns、EvidenceCoordinator 与 Delivery 都通过 OperationOwnership 跟踪已接纳操作。安全操作响应 AbortSignal；已经写入 Journal 或持久上下文的操作不会被关闭流程描述成回滚。超过关闭期限时记录 `OPERATION_DRAIN_TIMEOUT` 与恢复分类。
- Evidence 的 command、service、browser 与 visual 适配器已改为 Contributor，通过 Effect 加入 EvidenceAdapters 注册表；公共入口不再直接构造 Evidence Runtime 或平台适配器集合。
- Delivery 准备会同时核对 Bundle 结果与 composition digest。旧 composition 的 Delivery 快照保持可读，但批准、发布和刷新采取 fail-closed。
- Run、Checkpoint、Trajectory、Action Intent/Receipt、Evidence Attempt/Receipt/Bundle/Gate、Delivery Snapshot 和 OTel 都带 composition 身份。兼容变化记录 `composition.changed`，受保护能力变化返回 `migration_required`。

## 团队插件接纳

- 共享 `repoctopus.yaml` 可以在 `composition.plugins` 声明团队插件；本机配置不能声明插件。
- App Boot 在动态导入前解析静态 Descriptor，并核对登记 ID、契约版本、来源和模块代码摘要。带模块求值副作用的错误摘要 fixture 证明拒绝发生在 import 前。
- 共享、本机和最终有效配置摘要分别进入 composition 与 Evidence 指纹。团队不维护 `cordis.yml`，领域配置由薄 compiler 翻译为 Loader Entry。

## 自举验收

- 仓库根目录提交了 `repoctopus.yaml`，`verify` Profile 执行类型检查与架构检查，`recovery-probe` 专用于中断恢复验收。
- 最终自举 Run `self-adopt-cordis-release-20261019` 完成三步 Workflow；受保护的 `verify` 步骤接受 Bundle `257baf538049ea764394d872da597247e07807ec65f98b2c9cbd08545b289407`，composition 为 `sha256:55f3d08c0b5b495ddb1c4c27dd361c23fb0ca64f4f91ee5ad0a071dfe38a2322`。
- Evidence Attempt `self-interrupted-evidence` 在持久上下文建立后被强制终止；`evidence resume` 将其恢复为 `incomplete` Bundle 和 blocked Gate，没有把未完成命令伪装为成功。
- `test/self-bootstrap.test.ts` 从仓库正式配置启动 project composition，通过 Loader 重载 command Evidence Contributor，并在重载后再次解析 `verify` Profile。
