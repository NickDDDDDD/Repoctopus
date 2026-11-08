# Windows 默认配置下的规格归档路径支持

## Why

真实多仓验收中，Build、Verify 与证据恢复均已通过，但 Archive 创建隔离 checkout 时因 Git for Windows 的默认路径限制失败，尚未产生规格关闭或发布结果。此前短目录验收没有覆盖这一边界；要求用户修改系统或 Git 持久配置会把产品内部路径开销转嫁给团队。

## What Changes

- 为 Runtime 管理的规格归档 Git 操作提供 Windows 进程级长路径支持，覆盖隔离 checkout 的创建、观察、清理以及规格变更检查、索引、提交和发布恢复。
- 保留用户的 Git 本地、全局、系统配置及 Windows 设置；不改变用户配置的检查命令。
- 保持现有冻结 OID、允许路径、调用者工作树隔离、Journal 和发布身份约束；失败保留原 Run 与已接受证据，通过公开入口恢复。
- 增加真实 Git 长路径回归和 Windows 默认设置下的多仓验收，分别证明 checkout 和归档后索引可以完成，并检查恢复不会重复发布。

当前垂直切片是打通受管规格 checkout 到规格发布的长路径链路。后续如发现其他受管 Git 流程有同类实证，再单独评估扩展。系统设置修改、任意外部工具的长路径支持、改变五阶段状态机、重新设计 Journal、迁移历史 Run 或更换归档目录布局均不在本次范围。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `delivery-governance`：规定 Windows 默认持久配置下受管规格归档 Git 的长路径行为、配置隔离及失败恢复边界。

## Impact

涉及 `platform/git/specification-checkout.ts`、`platform/delivery/specification-publication.ts`、局部共享的 Git 执行适配及对应测试；不新增公共配置字段或持久状态格式。Engine、Cordis Service 和领域发布协议继续使用现有端口。

借鉴固定 Comet 基线 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的平台 Git 执行边界；其 `platform/process/git.ts` 没有自动开启长路径，相关 `native-portable-archive` 测试显式设置 `core.longpaths`，因此不把上游测试视作本需求已经解决。使用 Git for Windows 官方能力，独立实现局部适配，本提案不引入或复制第三方源码，不新增依赖或许可证义务。
