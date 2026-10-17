# 交付治理与失败恢复

Repoctopus 将本地开发保存与团队共享发布分开。功能分支上的 checkpoint commit 可由策略自动创建；push 和 MR 创建或更新需要一份绑定全部受影响仓库的验证报告获得人工批准。merge 始终由人执行。

## 配置边界

共享策略位于 `repoctopus.yaml` 的 `delivery` 段，示例见 [examples/repoctopus.yaml](examples/repoctopus.yaml)。自动 checkpoint 只有在以下条件全部成立时执行：

- `checkpoint.automatic` 为 `true`；
- 当前分支不匹配 `protectedBranches`；
- commit message 匹配 `commitMessagePattern`；
- 全局和当前仓库的快速检查全部通过。

缺少任何必需配置时采取 fail-closed。凭据不写入 YAML；GitHub Adapter 从受控 Credential Provider 读取 `GITHUB_TOKEN`。

每个 change 通过 Delivery Intent 显式选择仓库，示例见 [examples/delivery-intent.yaml](examples/delivery-intent.yaml)。扫描到但没有选择的脏仓库只产生警告，不会被自动提交或发布。

## 批准快照

`delivery prepare` 只接受已经提交验证报告且工作树干净的选定仓库。报告文件必须位于 Delivery Intent 显式选择的某个仓库中，并已被 Git 跟踪；把报告放在未选择或非 Git 目录中会阻断准备。快照摘要绑定：

- change 和仓库选择；
- 每仓源分支、HEAD tree、目标分支及远端基线；
- 验证报告、交付策略和动作计划摘要。

IDE Adapter 应显示 `HumanDecisionRequest`。CLI 降级使用 `approval review`，要求交互式终端。批准以后，任何代码树、报告、策略、分支、仓库选择或目标基线变化都会让批准失效。

## 部分发布与恢复

多仓远端不提供跨仓事务。Repoctopus 按稳定顺序执行动作，每个动作成功后立刻写入 Journal：

1. 核对本地 HEAD、远端源分支和目标基线。
2. 普通 push 功能分支，不执行 force push。
3. 按源分支和目标分支查找已有 MR；存在则更新，不存在才创建。
4. 持久化远端 OID 或 MR identity，再执行下一动作。

中途失败后，修复网络、权限或配置，再用原参数运行 `delivery resume`。Runtime 会复核已经成功的动作，从第一个未完成动作继续。它不会自动删除已推分支、关闭已建 MR 或回滚其他仓库。

如果已完成动作对应的远端事实发生无法解释的变化，应停止自动恢复并人工检查托管平台。恢复过程中不得用 force push 掩盖差异。

## 平台能力降级

GitHub Adapter 区分认证失败、权限不足、套餐功能不可用、配置错误、限流和暂时故障。私有仓库因套餐不支持服务端分支保护时，Repoctopus 记录非阻断警告；本地检查或 CI 不能被描述成服务端保护。
