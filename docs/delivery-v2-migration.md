# 将 Delivery v2 状态迁移到 v3

本指南帮助维护者把一个可读取但不可继续发布的 Delivery v2 状态转换成新的 v3 Intent。先生成只读迁移计划，再补齐缺失事实并重新取得批准；Repoctopus 不会在迁移检查中修改 Git、平台 MR 或 Delivery Store。

## 准备迁移输入

在原 Workspace 中执行迁移，因为 `.repoctopus/deliveries/` 保存待检查的 v2 状态。准备 change ID 和当前 Delivery policy 文件：

```powershell
$workspace = Resolve-Path .
$changeId = '<change-id>'
$policyFile = Join-Path $workspace 'delivery-policy.yaml'
```

如果你使用的是新 clone，先从团队备份或原工作目录恢复 `.repoctopus/`。不要通过复制部分 JSON、修改 `state.json` 或伪造 MR identity 重建状态。

## 生成只读迁移计划

运行 `delivery migration-plan`，并保存完整 JSON 供人工审查：

```powershell
node bin/repoctopus.js delivery migration-plan --workspace $workspace --change $changeId --policy $policyFile --json
```

命令只读取 v2 状态和必要的平台事实。成功响应中的 `platformMutations` 必须为空，`reuseLegacyApproval` 与 `reuseLegacyEvidenceBundles` 必须为 `false`。

## 按计划状态处理

根据 `result.status` 选择恢复路径。不要只复制 `draft` 后跳过 `requiredActions`。

| 状态                       | 含义                                                      | 你需要做什么                                                                                                           |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `reprepare_required`       | 尚未发生远端发布，或旧状态可以安全转换成不完整的 v3 草案  | 补齐 `missingFields`，公开并核对 Change 分支，然后重新执行规格校验、规划批准、Evidence 和 Delivery approval。          |
| `manual_decision_required` | 旧 Change MR 仍开放，而且已有远端动作                     | 人工决定保留旧流程，或关闭旧 MR 后迁移。Repoctopus 不自动关闭 MR，也不把旧 MR 当作最终 Change MR。                     |
| `repair_required`          | 旧 Change MR 已关闭或合入、分支映射漂移，或权威事实不完整 | 核对旧 MR、Change 分支和目标基线；修复事实后重新生成计划。不要用 force-push、rebase 或直接编辑 Delivery 状态消除差异。 |

## 建立新的 v3 Intent

如果计划包含 `draft`，把它作为人工填写的起点，而不是可直接发布的 Intent。

1. 填写每个 `businessDeliveries.<deliveryId>.commitMessage`。
2. 核对每个业务交付的仓库、源分支、目标分支和动作。
3. 如果有多个业务交付，填写具体的 `businessSplitReason.summary`。
4. 使用远端当前事实填写 `changeBranch.remoteOid`，不要沿用无法核对的旧 OID。
5. 删除计划中的只读辅助字段，例如 `recordedHead`、`recordedTargetOid` 和 `legacyMergeRequest`。
6. 按 [Delivery Intent schema](schemas/delivery-intent.schema.json)验证最终文件。

旧 Change MR、业务 MR 或 Git commit 的作者都不拥有这个 Change。团队中的其他成员或 Agent 可以完成迁移，但必须基于同一个 change ID、公开 Change 分支、权威 MR 事实和新的人工批准。

## 重新取得授权

v3 Intent 完成后，重新执行规格严格校验并取得新的 planning approval。随后重新生成 Evidence 和 Delivery snapshot，再取得新的 delivery approval。

不要复用 v2 的 request ID、批准响应、Evidence Bundle 或 Action Receipt。它们绑定旧字段和旧生命周期，不能授权 v3 发布。

## 验证迁移结果

在执行任何发布前，确认以下条件：

- v2 状态仍可查询，但所有写操作保持只读拒绝；
- 新 Intent 使用 `schemaVersion: 3`、`changeBranch` 和稳定的 `businessDeliveries[].deliveryId`；
- 公开 Change 分支的远端 OID 与 planning approval 一致；
- 旧 Change MR 的处理决定已经由人完成并留下平台事实；
- 新 planning approval、Evidence 和 delivery approval 都已生成。

## 后续步骤

迁移计划完成后，继续阅读与当前阶段对应的指南：

- [交付治理与失败恢复](delivery.md)：理解 v3 Intent、批准快照和发布边界。
- [短生命周期自举](self-hosting.md)：运行 Archive publication 与按需 reconcile。
