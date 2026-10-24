# 交付治理与失败恢复

Repoctopus 把功能分支 checkpoint 视为远端备份边界：策略允许的 commit 必须立即普通 push、建立 upstream，并在远端 OID 核对成功后才算完成。创建或更新 Business MR 前，你必须提交绑定全部业务交付的验证报告并获得人工批准；merge 始终由人执行。新交付写入由同一 Change Run 的 Archive Work 编排，Delivery 只是受保护的 Git/平台 Adapter，不再拥有平行生命周期。

## 配置边界

共享策略位于 `repoctopus.yaml` 的 `delivery` 段，示例见 [examples/repoctopus.yaml](examples/repoctopus.yaml)。自动 checkpoint 只有在以下条件全部成立时执行：

- `checkpoint.automatic` 为 `true`；
- 当前分支不匹配 `protectedBranches`；
- commit message 匹配 `commitMessagePattern`；
- 全局和当前仓库的快速检查全部通过。

`delivery checkpoint` 即使在新分支尚无改动时也会发布当前 HEAD。若 commit 已完成但 push 失败，命令返回失败；修复网络、凭据或远端漂移后重跑，Runtime 会直接发布现有 HEAD，不创建重复 commit。Repoctopus 只执行普通 push，绝不会用 force push 或 rebase 掩盖分歧。

缺少任何必需配置时采取 fail-closed。凭据不写入 YAML；GitHub Adapter 从受控 Credential Provider 读取 `GITHUB_TOKEN`。

每个 Change 通过 Delivery Intent v3 显式声明一个 Change 分支和至少一个业务交付，完整字段见 [Delivery Intent schema](schemas/delivery-intent.schema.json)，可复制的默认单 MR 配置见 [Delivery Intent 示例](examples/delivery-intent.yaml)。扫描到但没有选择的脏仓库只产生警告，不会被自动提交或发布。

`changeBranch` 固定规划批准时已经公开的 Change 分支，包括 Workspace Repository 身份、源分支、目标分支和远端提交 OID。开始 Delivery 时，Repoctopus 直接查询远端并重新核对这些事实；本地 Workspace 可以已经切换到业务分支。

`businessDeliveries` 使用稳定的 `deliveryId` 声明完整 Business MR 集合。默认只有 `primary` 一个交付。多个交付必须显式提供 `businessSplitReason`，不能根据 Tasks 自动拆分 MR。平台合入事件只映射 Business MR；Repoctopus 完成全部 Post-merge 工作后才创建最终 Change MR。

## 显式声明多个 Business MR

默认使用 [单 Business MR 示例](examples/delivery-intent.yaml)。只有一个 Change 跨越多个仓库、需要独立可验证的有序交付，或必须增加补充修复时，才复制[多 Business MR 示例](examples/delivery-intent-multiple.yaml)并声明完整集合。

编辑多 MR Intent 时：

1. 为每个 MR 设置稳定且唯一的 `deliveryId`。
2. 为每个 MR 设置独立的源分支，并明确其目标分支。
3. 设置 `businessSplitReason.kind` 和具体的 `summary`，说明为什么不能使用默认单 MR。
4. 在批准前列出完整集合。批准后增删或替换任何成员都会使批准失效。

同一仓库可以有多个源分支，但这些 MR 必须指向同一个目标分支。同一 Change Run 保留每个 MR 的权威 merge commit；执行 Archive 验证时，每个仓库只检出该集合中最后合入的 commit，作为包含该仓较早合入结果的最终目标分支状态。

## 从 Delivery Intent v2 迁移

v2/v3 旧状态仍可读取和诊断，但 `delivery checkpoint`、`delivery prepare`、`delivery publish`、`delivery resume` 与 `delivery refresh` 已被写入口 fence，返回 `migration_required`，不会与 Change Run 双写。CLI 检测到 `schemaVersion: 2` 或 `changeMergeRequest` 时同样停止，不会把旧字段静默解释成当前 lifecycle。

按照 [Delivery v2 到 v3 迁移指南](delivery-v2-migration.md)运行只读 `delivery migration-plan`，处理 `reprepare_required`、`manual_decision_required` 或 `repair_required`。迁移不会自动关闭、重开或替换旧 MR，也不会复用旧批准或 Evidence。

## 批准快照

`run archive-prepare` 只接受已经通过 Design 和 Verify Gate 的 Change Run、公开 Change 分支，以及已经提交验证报告且工作树干净的业务仓库。报告文件必须位于 Delivery Intent 显式选择的某个业务仓库中，并已被 Git 跟踪；把报告放在未选择或非 Git 目录中会阻断准备。快照摘要绑定：

- Change 分支、业务交付集合和拆分理由；
- 每仓源分支、HEAD tree、目标分支及远端基线；
- 验证报告、交付策略和动作计划摘要。
- 当前 composition digest，以及每个 Evidence Bundle 的相同 composition 身份。

IDE Adapter 应显示 `HumanDecisionRequest`。CLI 降级使用 `approval review`，要求交互式终端。批准以后，任何代码树、报告、策略、分支、仓库选择或目标基线变化都会让批准失效。

如果尚未产生人工决定且所有远端动作仍是零次尝试的 `pending`，可以用相同 Run、Attempt 与 Intent 重试 `run archive-prepare`。相同快照幂等返回原请求；新快照会生成新的 `requestId`，并在持久历史中记录被取代的请求和快照摘要。迟到的旧响应会因身份不匹配被拒绝。已经批准、拒绝或开始发布后，重新准备不能覆盖既有事实。

Delivery 状态来自不兼容 composition 时仍可查询，但不能继续批准、发布或刷新。使用者必须显式迁移或重新准备交付快照，不能把旧插件语义下的批准带入新组合。

## 部分发布与恢复

多仓远端不提供跨仓事务。日常 checkpoint 已经把各仓 HEAD 备份到远端；批准后的 Delivery 仍按稳定顺序重新核对并执行动作，每个动作成功后立刻写入 Journal：

1. 核对本地 HEAD、远端源分支和目标基线。
2. 普通 push 功能分支，不执行 force push。
3. 按源分支和目标分支查找已有 MR；存在则更新，不存在才创建。
4. 持久化远端 OID 或 MR identity，再执行下一动作。

中途失败后，修复网络、权限或配置，再对同一 Run 重试对应 Archive 命令。Runtime 会通过 Intent/Receipt 复核已经成功的动作，从第一个未完成动作继续。它不会自动删除已推分支、关闭已建 MR 或回滚其他仓库。

```powershell
node bin/repoctopus.js run archive-prepare --workspace . --run <run-id> --attempt <attempt-id> --intent <intent.yaml> --json
node bin/repoctopus.js run archive-publish --workspace . --run <run-id> --json
node bin/repoctopus.js run archive-refresh --workspace . --run <run-id> --json
node bin/repoctopus.js run archive-verify --workspace . --run <run-id> --profile post-merge --json
node bin/repoctopus.js run archive-complete --workspace . --run <run-id> --json
```

如果已完成动作对应的远端事实发生无法解释的变化，应停止自动恢复并人工检查托管平台。恢复过程中不得用 force push 掩盖差异。

## 合入事件协调

GitHub `pull_request` webhook 只提供业务 MR 的 `provider + remoteIdentity + number` 作为唤醒键。`PostMergeCoordinator` 不读取 payload 中的 `merged`、`state` 或 commit 字段来推进 Delivery，而是通过 `MergeRequestPort` 重新查询该 change 的全部业务 MR：

- 任一 MR 仍打开时记录当前合入证据并继续等待；
- 任一 MR 关闭但未合入时返回稳定阻断诊断，不启动收尾；
- 全部 MR 合入且每个都有权威 merge commit 时，生成不包含观察时间的稳定 `mergeFactsDigest`；
- 重复或乱序事件在 Delivery 已进入 `merged` 终态后成为无副作用的 no-op。

`mergeFactsDigest` 只绑定排序后的仓库身份、远端身份、目标分支、MR identity、merge commit 和合入时间。该事实被原 Change Run 的 Archive transition 接受，不生成 Post-merge Run identity。

## 受保护的收尾发布

同一 Change Run 通过 Delivery 权威边界发布规格关闭结果。它先记录完整 Business MR 集合的权威 merge commit，再生成 Evidence、同步主规格并归档 Change。只有这些步骤成功后，Repoctopus 才为已批准的 Change 分支创建或恢复一个最终 Change MR，并在 Receipt 被接受后标记 completed。

策略必须精确声明 `merge_target`、`commit`、`push` 和 `merge_request.create_or_recover`。Delivery 在任何 Git 副作用前确认 Change 分支、目标分支、仓库和锁定的远端 OID 未变化；Git Adapter 再确认 Workspace、remote identity 和审计基线一致。

发布只暂存路径审计列出的文件，并逐文件核对内容摘要。新 commit 必须来自受控的目标分支同步；push 使用显式非强制 refspec，完成后远端 OID 必须精确等于本地 commit。最终 MR 使用 create-or-recover 语义，Runtime 不执行 merge。

如果 commit、push 或最终 MR 创建已生效但响应丢失，重试会核对并复用相同事实。分支映射改变、远端漂移、提交身份不符，或策略包含自动合入最终 MR、force-push、rebase、删分支等操作时，发布 fail-closed。具体检查和恢复命令见 [运维和恢复 Post-merge 收尾](post-merge.md)。

## 平台能力降级

GitHub Adapter 区分认证失败、权限不足、套餐功能不可用、配置错误、限流和暂时故障。私有仓库因套餐不支持服务端分支保护时，Repoctopus 记录非阻断警告；本地检查或 CI 不能被描述成服务端保护。
