# Proposal

## Why

真实多仓验收中，Verify 已通过后仅提交 Runtime 生成的两个 Task 完成复选框，Archive 又要求重做 Verify。此前增量恢复 Change 已承诺分离规划语义与发布身份，但实际 Evidence 采集仍聚合原始 HEAD、tree 和 dirty 状态，依赖模型尚未接入生产链路；这使团队正常收尾持续触发无效返工。

## What Changes

- 统一当前规格中“无条件绑定 HEAD/tree”与“按实际依赖保留 Evidence”的矛盾，以检查声明的输入身份决定新鲜度，原始 Git 身份继续用于授权、发布与审计。
- 让实际输入采集、Receipt、Bundle、Gate 和 Verification Input 使用同一规范化依赖模型。由 Specification Provider 识别官方规划工件及语义，保持多仓和插件边界。
- 把已有依赖失效规则接入真正的 Verify 与 Archive 路径；等价收尾保留已接受证据，真实变化只失效依赖它的检查，规划与证据同时变化时由统一恢复权威选择最高受影响层。
- 借鉴固定 Comet 0.5.1 的逐文件输入、Task 语义归一化和显式 Git 依赖机制。保留产品未知文件、控制面、配置、工具、Adapter 和采集期间变化的保护。
- **BREAKING**：调整证据输入及依赖记录协议时显式拒绝不受支持的旧开发证据，不双读、自动升级或手改历史 Store。
- 用生产组合及实际安装后的多仓 CLI 证明完整路径，保存首次失败、转绿、命令调用次数和中断恢复结果。

本次交付是 Evidence 身份从采集到 Archive 的完整修复切片。Dashboard、发布功能、通用工作流扩展和旧状态兼容不在本次范围；后续产品功能继续单独规划。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `implementation-evidence`：实际依赖指纹、持久化依赖和有界失效闭包；修正原始 Git 身份与语义输入的边界。
- `change-lifecycle`：Archive 使用相同输入权威判断新鲜度，等价收尾不回退，真实漂移按最高受影响权威恢复。

## Impact

涉及 Evidence 领域模型、Git 输入采集、Specification Provider 的规划投影、共享 Profile 输入声明、EvidenceCoordinator、WorkflowRuns、持久化校验和相关 CLI 验收。沿用 Cordis composition、唯一 Change Run 和 OpenSpec 四类规划产物。

参考 Comet 固定提交 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的实现思路，不引入其 SDK 或新运行时依赖；若采用源码，按已有来源清单与许可证规则登记。
