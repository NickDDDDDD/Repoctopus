# 交付治理与失败恢复

Repoctopus 把功能分支 checkpoint 视为远端备份边界：策略允许的 commit 必须立即普通 push、建立 upstream，并在远端 OID 核对成功后才算完成。MR 创建或更新仍需要一份绑定全部受影响仓库的验证报告获得人工批准；merge 始终由人执行。

## 配置边界

共享策略位于 `repoctopus.yaml` 的 `delivery` 段，示例见 [examples/repoctopus.yaml](examples/repoctopus.yaml)。自动 checkpoint 只有在以下条件全部成立时执行：

- `checkpoint.automatic` 为 `true`；
- 当前分支不匹配 `protectedBranches`；
- commit message 匹配 `commitMessagePattern`；
- 全局和当前仓库的快速检查全部通过。

`delivery checkpoint` 即使在新分支尚无改动时也会发布当前 HEAD。若 commit 已完成但 push 失败，命令返回失败；修复网络、凭据或远端漂移后重跑，Runtime 会直接发布现有 HEAD，不创建重复 commit。Repoctopus 只执行普通 push，绝不会用 force push 或 rebase 掩盖分歧。

缺少任何必需配置时采取 fail-closed。凭据不写入 YAML；GitHub Adapter 从受控 Credential Provider 读取 `GITHUB_TOKEN`。

每个 change 通过 Delivery Intent 显式选择仓库，示例见 [examples/delivery-intent.yaml](examples/delivery-intent.yaml)。扫描到但没有选择的脏仓库只产生警告，不会被自动提交或发布。

Delivery Intent v2 使用 `coordinationMergeRequest` 记录承载规格、验证与最终收尾的协调 MR，`repositories` 则完整声明业务 MR 集合。“协调”是职责而不是物理位置：协调 MR 与业务 MR 可以位于同一个仓库，但不能是同一个 MR。同仓时必须使用不同的源分支或目标分支；平台返回业务 MR 后，Delivery 还会按 `provider + repositoryId + number` 核对它没有复用协调 MR。平台合入事件只映射业务 MR；协调 MR 的更新和最终合入遵循独立的收尾与人工决策边界。

## 批准快照

`delivery prepare` 只接受已经提交验证报告且工作树干净的选定仓库。报告文件必须位于 Delivery Intent 显式选择的某个仓库中，并已被 Git 跟踪；把报告放在未选择或非 Git 目录中会阻断准备。快照摘要绑定：

- change 和仓库选择；
- 每仓源分支、HEAD tree、目标分支及远端基线；
- 验证报告、交付策略和动作计划摘要。
- 当前 composition digest，以及每个 Evidence Bundle 的相同 composition 身份。

IDE Adapter 应显示 `HumanDecisionRequest`。CLI 降级使用 `approval review`，要求交互式终端。批准以后，任何代码树、报告、策略、分支、仓库选择或目标基线变化都会让批准失效。

Delivery 状态来自不兼容 composition 时仍可查询，但不能继续批准、发布或刷新。使用者必须显式迁移或重新准备交付快照，不能把旧插件语义下的批准带入新组合。

## 部分发布与恢复

多仓远端不提供跨仓事务。日常 checkpoint 已经把各仓 HEAD 备份到远端；批准后的 Delivery 仍按稳定顺序重新核对并执行动作，每个动作成功后立刻写入 Journal：

1. 核对本地 HEAD、远端源分支和目标基线。
2. 普通 push 功能分支，不执行 force push。
3. 按源分支和目标分支查找已有 MR；存在则更新，不存在才创建。
4. 持久化远端 OID 或 MR identity，再执行下一动作。

中途失败后，修复网络、权限或配置，再用原参数运行 `delivery resume`。Runtime 会复核已经成功的动作，从第一个未完成动作继续。它不会自动删除已推分支、关闭已建 MR 或回滚其他仓库。

如果已完成动作对应的远端事实发生无法解释的变化，应停止自动恢复并人工检查托管平台。恢复过程中不得用 force push 掩盖差异。

## 合入事件协调

GitHub `pull_request` webhook 只提供业务 MR 的 `provider + remoteIdentity + number` 作为唤醒键。`PostMergeCoordinator` 不读取 payload 中的 `merged`、`state` 或 commit 字段来推进 Delivery，而是通过 `MergeRequestPort` 重新查询该 change 的全部业务 MR：

- 任一 MR 仍打开时记录当前合入证据并继续等待；
- 任一 MR 关闭但未合入时返回稳定阻断诊断，不启动收尾；
- 全部 MR 合入且每个都有权威 merge commit 时，生成不包含观察时间的稳定 `mergeFactsDigest`；
- 重复或乱序事件在 Delivery 已进入 `merged` 终态后成为无副作用的 no-op。

`mergeFactsDigest` 只绑定排序后的仓库身份、远端身份、目标分支、MR identity、merge commit 和合入时间。下一阶段使用它与 `changeId` 共同形成 Post-merge Run 的幂等身份。

## 受保护的收尾发布

Post-merge Run 通过同一个 Delivery 权威边界发布规格关闭结果。发布动作只读取已记录的原协调 MR，不查找或创建替代 MR；协调 MR 与业务 MR 即使位于同一物理仓库，角色边界也保持不变。

策略必须精确声明 `commit`、`push` 和 `merge_request.update`。Delivery 在任何 Git 副作用前确认原 MR 仍开放，源分支、目标分支、仓库和 MR identity 未变化；Git Adapter 再确认 workspace、当前分支、remote identity 和远端源分支仍匹配审计基线。

发布只暂存路径审计列出的文件，并逐文件核对内容摘要。新 commit 必须是审计基线的普通单父子提交；push 使用显式非强制 refspec，完成后远端 OID 必须精确等于本地 commit。最后只更新原协调 MR 的 title/body，不改变 head、base 或合入状态。

如果 commit、push 或 MR update 已生效但响应丢失，重试会核对并复用相同事实。MR 已关闭、分支映射改变、远端漂移、提交身份不符，或策略包含 merge、force-push、rebase、删分支等操作时，发布 fail-closed。具体检查和恢复命令见 [观察和恢复 Post-merge 收尾](post-merge.md)。

## 平台能力降级

GitHub Adapter 区分认证失败、权限不足、套餐功能不可用、配置错误、限流和暂时故障。私有仓库因套餐不支持服务端分支保护时，Repoctopus 记录非阻断警告；本地检查或 CI 不能被描述成服务端保护。
