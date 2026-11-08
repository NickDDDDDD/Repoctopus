# Windows 归档路径与跨实现恢复

## Why

真实多仓验收中，Build、Verify 与证据恢复均已通过，但 Archive 创建隔离 checkout 时因 Git for Windows 的默认路径限制失败，尚未产生规格关闭或发布结果。此前短目录验收没有覆盖这一边界；要求用户修改系统或 Git 持久配置会把产品内部路径开销转嫁给团队。

Design 复核又发现，恢复层接受兼容实现后，发布层仍要求当前组合严格等于 Archive 冻结的旧摘要，违反已有的组合兼容性与规划审批分离契约。用户已选择在同一 Change 修复两者，并用修复包完成原失败 Run，不能以另建验收 Run 替代。

## What Changes

- 为 Runtime 管理的规格归档 Git 操作提供 Windows 进程级长路径支持，覆盖隔离 checkout 的创建、观察、清理以及规格变更检查、索引、提交和发布恢复。
- 保留用户的 Git 本地、全局、系统配置及 Windows 设置；不改变用户配置的检查命令。
- 保持现有冻结 OID、允许路径、调用者工作树隔离、Journal 和发布身份约束；失败保留原 Run 与已接受证据，通过公开入口恢复。
- 让恢复与 Archive 副作用入口共同消费现有组合兼容性权威：冻结交付来源继续保留，当前执行实现经精确采纳及受保护入口核验后接续；不把旧来源摘要作为当前执行器的等值条件。
- 补齐真实 Cordis 生产入口的跨实现归档回归，不 mock 掉规划审批或发布校验；覆盖不兼容实现、执行前再次漂移和部分副作用恢复的拒绝与幂等行为。
- 增加真实 Git 长路径回归和 Windows 默认设置下的多仓验收，分别证明 checkout 和归档后索引可以完成，并检查恢复不会重复发布。

当前垂直切片是由修复包从原失败 Archive checkpoint 完成长路径规格关闭与多仓发布。后续如发现其他受管 Git 流程有同类实证，再单独评估扩展。系统设置修改、任意外部工具的长路径支持、改变五阶段状态机、重新设计 Journal、通用旧版兼容或历史数据迁移、更换归档目录布局均不在本次范围。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `delivery-governance`：规定 Windows 默认配置下的归档路径行为，以及原冻结交付来源与获准执行实现分离后的 Archive 恢复边界；组合兼容性判定继续遵守已有 `plugin-composition` 契约。

## Impact

涉及平台 Git 适配、`domains/runtime/workflow-runs.ts` 的受保护执行入口、WorkflowRuns 与 Delivery Service 内部执行上下文、`plugins/delivery/file-delivery-provider.ts`、内置实现身份登记及对应测试。内部端口区分执行上下文和冻结来源；不新增 CLI/共享配置字段、持久状态格式或第二套 adoption 协议。

借鉴固定 Comet 基线 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的平台 Git 执行边界；其 `platform/process/git.ts` 没有自动开启长路径，相关 `native-portable-archive` 测试显式设置 `core.longpaths`，因此不把上游测试视作本需求已经解决。使用 Git for Windows 官方能力，独立实现局部适配，本提案不引入或复制第三方源码，不新增依赖或许可证义务。

恢复部分借鉴同一 Comet 基线对 Action 原输入、attempt、审批及真实证据分别核验的方式；Comet Classic 没有本项目的 Cordis 组合摘要等值门槛。本次修复本项目适配契约，不宣称直接移植一个上游已有的 Cordis 升级功能。
