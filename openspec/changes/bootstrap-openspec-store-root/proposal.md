# Proposal

## Why

真实公司项目首次接入暴露了一个确定性阻断：用户批准项目配置后，Repoctopus 直接执行 `openspec store register`，但 OpenSpec Store 只允许登记已经健康的 OpenSpec Root；全新 Workspace 尚无 `openspec/`，因此接入停在 `store_register_root_unhealthy`。当前单元测试把 `store register` 伪造为成功，未覆盖官方 OpenSpec CLI 的真实前置条件，所以同类问题也没有被多仓验收发现。

固定 Comet 0.5.1 已有成熟的初始化事务语义：先声明初始化所有权，调用官方 OpenSpec 初始化入口，重新验证根健康，再发布项目配置；外部进程结果未知时通过 checkpoint 重新观察，且不得盲删既有内容。Repoctopus 应采用这些不变量，同时保留自己的 Store registry、业务仓 pointer 与多仓 Workspace 权威模型。

## What Changes

- 在项目探测与人工确认中显式区分 `already-registered`、`healthy-unregistered`、`missing-root`、`partial-or-unhealthy` 和 `conflicting-registration`，让批准内容冻结本次允许执行的 Root/Store 变更。
- 对获批的 `missing-root` 使用固定 OpenSpec 1.14.3 官方 CLI 创建最小健康根，再登记 Store；不得用只适合新空目录的 `store setup`，也不得手工拼装 OpenSpec 私有文件。
- 把 Root bootstrap、Store registration、业务仓 pointer 和共享 `repoctopus.yaml` 按 Intent/Receipt 顺序发布；共享配置始终最后写入。
- 为外部命令超时、崩溃、未知结果和中途重启增加重新观察与幂等 continuation；只恢复本事务明确拥有且身份未漂移的初始化，不覆盖既有或并发写入的 `openspec/`。
- 让真实 OpenSpec CLI 的 Windows 集成测试覆盖全新非空 Git 仓、健康未登记根、部分根、登记冲突和中断恢复，替代仅凭 FakeProcess 成功的错误信心。
- 更新项目接入与规格权威文档，说明首次接入的 Root bootstrap、Store 地址本机性和故障恢复边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-configuration`: 获批项目接入必须以可恢复、配置最后发布的事务创建缺失的 OpenSpec Root并安装多仓绑定。
- `specification-authority`: Workspace Store 登记必须先证明 Specification Root 健康，并安全处理缺失、部分和冲突根状态。

## Impact

- 主要影响项目探测/候选、`domains/project-configuration` 的 Store binding 合约、`platform/project-configuration/onboarding.ts`、`platform/specification/openspec-store-registration.ts`、真实 CLI 集成测试和接入文档。
- 不引入 Comet SDK、Comet 状态文件、后台 daemon、第二个规格仓、第五类 OpenSpec 工件或 OpenSpec 内部模板副本。
- 行为参考固定 `@rpamis/comet@0.5.1` 的 project activation、OpenSpec integration 和 classic initialization checkpoint；实现使用 Repoctopus 原有领域类型、进程端口与 onboarding journal，不复制上游源码，因此不新增许可证义务。

## 非目标

- 自动修复接入前已经存在的残缺或不健康 `openspec/`；它必须以可操作诊断阻断并由用户显式处理。
- 自动迁移已有本地规格根、合并两个规格权威或覆盖指向其他 checkout 的 Store registry。
- 为 OpenSpec 之外的 Specification Provider 建立通用安装器。
- 改变 OpenSpec Store 的字段名、registry 位置或团队 Dashboard 配置。
