# Design

## Context

当前 `executionBindingDrift()` 在处理成功的 `build.execute` Outcome 时重新观察所有仓库，并把任一 `headRevision` 变化分类为 `head` drift。检查发生在结果结构、Package Completion、Task receipt 和下一 Work 之前。真实验收因此产生了以下轨迹：合法实现 commit/push → successful Host Outcome → `change.build-binding-revalidation-required` → Configure；原 Plan 与 completion 均未保留。

### 固定上游证据

2026-11-03 重新 fetch Comet upstream：固定采用版本仍为 `0.5.1` / `35c9860b77b42bafa0c2d80d8d695889f888a924`，默认分支为 `63d2ba736a24090ee826c012b5963a579ca5fb8c`。新增提交只有既有 Shape/BOM 修复和 MiniMax Code 支持，没有改变 Build workspace 模型。

- Classic `classic-branch-binding.ts` 在执行期比较 `bound_branch` 与 current branch，不把正常 commit 后的新 HEAD 当作接管漂移。
- Native `native-sdk-continuation.ts` 同样只因 change branch 不一致而阻断并要求显式 rebind。
- Native Supervisor 在最终验证前允许 integration HEAD 前进，但要求新 HEAD 是已记录 HEAD 的后代，再把它提升为验证对象。

Repoctopus 采用这些不变量，并扩展为多仓、逐 package、精确 write scope 的 revision checkpoint；不复制 Comet 的单仓状态文件、产品 shell 或 Supervisor 目录布局。

## Goals

1. 合法 Build commit 不触发 Configure 或丢失 Plan/completion。
2. branch/worktree/owner/Host 等身份漂移继续 fail closed。
3. 每个 package 只能推进获授权写集中的仓库，且只能 fast-forward。
4. Runtime 独立观察并拥有 Git revision 事实，Host 只报告实现与测试 Evidence。
5. 恢复时由 checkpoint 精确区分已接受进度、外部并发修改和历史重写。

## Decisions

### 1. Binding 授权身份，Checkpoint 表达进度

`ExecutionBinding` 继续保存 Configure 时的 Strategy、Host、repository/branch/isolation/ownership 和初始 HEAD。它是 Plan Evidence 的授权基线，不随 Build commit 原地改写。

Build Protocol 增加：

```ts
interface BuildWorkspaceCheckpoint {
  schemaVersion: 1;
  revision: number;
  repositories: Array<{
    repositoryId: string;
    branchRef: string;
    headRevision: string;
  }>;
  digest: `sha256:${string}`;
}
```

Configure 接受 Binding 时以其仓库事实建立 revision 1。之后每个成功 Package 原子产生下一 revision。Checkpoint 不含绝对路径、dirty 文件、时间或凭据；本机 path/ownership 仍由 Binding overlay 验证。

### 2. Package Outcome 先验证结构，再观察 workspace

成功 `build.execute` 的处理顺序固定为：

1. 验证 Outcome 属于当前 Work/package，Skill consumption 与 Evidence 结构有效；
2. 重观察 Host、branch、isolation、owner、worktree identity；不一致走现有 Binding revalidation；
3. 读取当前 checkpoint 和 package write scopes；
4. 未授权仓库 HEAD 必须等于 checkpoint；授权仓库 HEAD 必须等于或为 checkpoint HEAD 的后代，历史重写 fail closed；
5. Runtime 生成新 checkpoint，并用其 digest 建立 Package Completion；
6. 在同一 lifecycle transition 中接受 Outcome、completion、Task receipts、新 checkpoint 与下一 Work。

不得在 completion 被接受前因为合法 HEAD 前进退回 Configure。结果结构错误继续使用同 Work 的 correction protocol；Git identity/ancestry 无法证明时保持阻断，不猜测成功。

### 3. Host 不声明 Runtime 可独立观察的 repository digest

`build-package-completion` 删除 `repositoryDigest`；`build-check-candidate` 同样删除该字段。Host 继续返回 acceptance/test/TDD Evidence 与 `implementationDigest`，但 repository revision/checkpoint digest 只由 Runtime 的 Git observation 产生。

`PackageCompletionEvidence` 增加 `workspaceCheckpointDigest`；Build Check Evidence 改为绑定最终 checkpoint digest。旧字段不双写，不允许 Host 用任意摘要替代 Git observation。

### 4. 多仓 advance 采用最小权限

对于当前 package：

- write scope 未覆盖的仓库必须保持精确 HEAD；
- write scope 覆盖的仓库允许 HEAD 不变或 fast-forward；不变支持幂等恢复和“实现已在分支上”的情况；
- branch、isolation、worktree、workspace owner、Host 或 capability 变化仍是 Binding drift；
- non-fast-forward、未知 revision 或无法执行 ancestry check 是 progress rejection，不自动 reconfigure。

每个后续 package 从最新 checkpoint 出发。因此已完成仓库在其他 package 执行期间再次变化会被识别为未授权修改，而不会被后一个 completion 吞并。

### 5. Check 与 Verify 绑定最终结果

Build Check 派发时冻结最新 checkpoint digest。Check Host 只读审查；Outcome 接受前 Runtime 要求 live workspace 与该 checkpoint 精确一致。若 review 需要修改代码，应返回 finding 并由 Runtime 派发 repair/execute，而不是在 Check 中吸收新 commit。

Verify Evidence 对当前仓库 fingerprint 与 Build Check checkpoint 建立关联。Archive 仍重检最终代码、报告和 Delivery intent，不复用 Build 初始 Binding HEAD 作为完成 revision。

### 6. 恢复和兼容边界

本变更不建立通配迁移。受保护 plugin 只声明精确直接前驱实现，并且仅当旧状态仍能安全进入 Configure 重新建立 checkpoint 时允许 adoption。已经处于错误 head-revalidation checkpoint 的验收 Run 可以通过现有 Configure 重新观察当前 HEAD；无法证明状态的 Run 返回 `migration_required`，不得补写 Store。

兼容 adoption 更新 Run 当前 composition 后，已经派发的 Action Intent 与 Work Packet 仍以派发时冻结的 composition snapshot 互相校验。Runtime 不能再要求 Intent 的旧 snapshot digest 等于 Run 已采用的新 composition digest；是否允许 adoption 已由 composition compatibility gate 决定。否则合法升级会在 Outcome 已接受后把同一 packet 错判为内容漂移，破坏 checkpoint 恢复。

### 7. 遥测

新增或扩展有界事件属性：

- `build.workspace-progress.accepted`：package、checkpoint revision、advanced repository count；
- `build.workspace-progress.rejected`：`unauthorized-head-change|non-fast-forward|identity-drift|observation-failed`；
- `build.check.workspace-stale`：Check 前 live workspace 与 checkpoint 不一致。

Metric labels 不包含 repository id、branch、HEAD、path、digest 或诊断正文；精确仓库 finding 只保留在本地 trajectory/CLI diagnostic。

### 8. Planning 与 Publication 共享远端身份

真实 Archive 暴露了两个边界对 `remoteIdentity` 的不同解释：Planning branch inspection 把 Repoctopus 配置中的 `repositoryId` 当作平台稳定仓库 ID，而 Project snapshot 从 Git remote URL 生成规范化身份。前者只是拓扑内逻辑名称，不是 GitHub repository id，不能替代远端身份。

Change branch inspection 改为复用 Project probe 的 `normalizeRemoteIdentity(remoteUrl)`。这样 `repositoryId` 继续负责 Workspace/业务仓拓扑定位，`remoteIdentity` 只负责证明两个边界观察的是同一个远端仓库；Archive publication 可以在产生任何远端副作用前做精确比较。真正的平台稳定 ID 以后若由受信 Adapter 提供，必须拥有独立来源与类型，不能从配置别名猜测。

对于修复前已经冻结、但尚未产生任何远端 publication 副作用的 Archive，Runtime 只允许从仍有效的 Design approval 重绑定 Change branch 的 `remoteIdentity`，并把 OID 约束为隔离 Closure candidate 的 base OID，然后生成新的 `delivery.publish` Work。repository、source/target branch、业务交付、Evidence、策略或 Closure identity 任一变化仍返回 Design/失败，不把这条恢复路径扩展成通用 intent 改写。

## Testing Strategy

1. 领域红测：checkpoint 创建、逐包 fast-forward、未授权仓变化、non-fast-forward、幂等不变 HEAD。
2. Service 红测：真实临时 Git 多仓中，Execute commit 后 completion 被接受且直接派发下一 Execute，不进入 Configure。
3. 恢复测试：首包完成后第二仓执行；再次修改第一仓必须 fail closed；旧错误 checkpoint 经 Configure 重建。
4. Check/Verify：最终 checkpoint 精确匹配才接受 Check；review 期间修改拒绝。
5. 遥测与隐私：分类可离线复算且无高基数 revision/path label。
6. 真实验收：恢复模拟多仓 Change，完成三个 package、Build Check、Verify 和 Archive。
7. Delivery 回归：Planning approval 与 Project snapshot 对同一 Git remote 生成相同 identity，并完成真实 Archive publication。
