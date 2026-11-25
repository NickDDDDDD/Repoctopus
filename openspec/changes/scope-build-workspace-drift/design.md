---
comet_change: scope-build-workspace-drift
role: technical-design
canonical_spec: openspec
---

# Design

## Context

Issue #114 的只读 Web Front 同步和 #115 的 Backend 业务提交都发生在当前 Package 写仓之外。原有 `recoverBoundBuildWorkspace` 会产生 `unaccepted-head`，`advanceBuildWorkspaceProgress` 只接受当前包写仓的 HEAD 前进，`assertBuildWorkspaceCheckpointCurrent` 又对所有登记仓做精确比较。统一过续跑 CLI 的入口之后，这三处仍采用“所有登记 HEAD 都是当前工作输入”的假设。

参考固定的 Comet 0.5.1，并核对上游 `2e33ae4`。Classic 区分继续 Build、修订 Plan 和修订 Design，使用当前 Run revision、阶段和未结算执行约束可执行的恢复动作。交付从检查选定的路径与 Git 结果核对范围，参与检查的内容没有因此取得交付权限。Repoctopus 采用相同的边界判断，保留自己的多仓绑定、工作包依赖和发布协议。[Comet 恢复](https://github.com/rpamis/comet/blob/2e33ae49fcf9bcd490153987d2095a3c6c08bd42/domains/comet-classic/classic-sdk-revision-application.ts) · [Comet 交付输入](https://github.com/rpamis/comet/blob/2e33ae49fcf9bcd490153987d2095a3c6c08bd42/domains/comet-classic/classic-sdk-delivery-inputs.ts)

## Goals

- 用同一套 Git 观察与判定支撑 `run resume`、`run next`、Execute Outcome 和 Build Check/Verify 交接。
- 保留仍有效的 Plan、审批、Work 和完成证据。实际输入变化通过同一 Run 处理，失效范围由 Runtime 决定。
- 使用实际 Windows 候选包证明两个 Issue 可续跑，外部提交不会进入本次 Change 的发布差异。#105 根据独立诊断另行处理。

## Decisions

### 1. 固定 checkout 身份，按工作读取 Git 状态

在现有 Git adapter 核对 repository ID、远端身份、真实工作树及其 ownership、attached branch 和 topology。快进使用固定的旧、新 OID 核对祖先关系，检查 index、工作树和 Git 对象；读不到、history rewrite、替换 Git 对象、未获批 branch 或未结算副作用均保留最后安全状态。无关性只由受管输入证明，Git 作者、commit message 和仓库标记均不能作为授权。使用现有的 Workspace 清理、Verify Profile 发布、OpenSpec 规划发布和受保护分支更正判定处理其各自的事实，保持原有前提。

Plan 的 `repositoryIds` 定义包使用的仓库范围，技术指导明确要求列齐直接读取、执行检查和写入的仓库，通过 `dependsOn` 追踪跨包依赖。以仓库为默认粒度；只在 Runtime 已持有可信、可重验的输入证明时收窄到路径。Verify 节点根据现有 input manifest 和 receipt 依赖验证，不把 Verify 节点的声明反推成 Package 完整读取范围。遇到跨仓读取范围不明确、动态检查或计划没有提供足够事实时，不能以 write scope 代替输入证明。

### 2. 将漂移分类接入现有 Build 决定

| 观察结果 | Runtime 动作 |
| --- | --- |
| 无关仓库 clean fast-forward，仍可使用同一受管输入 | 保留当前 Work、证据与受管实现 OID。记录外部观察用于诊断。没有其他受管变化时，保留 Plan、epoch 和 checkpoint 身份。 |
| 当前包或既有完成项的已知输入变化 | 由 Runtime 核对受影响的包和依赖闭包，保留其他完成项；当前执行尚未结算时先等待原执行结果。已提交旧输入的 Outcome 留存拒绝原因。 |
| 只影响尚未执行的包，或只影响 Check/Verify 的输入 | 在该消费者实际派发前冻结新输入。只需复核 Check/Verify 时保留有效的包完成事实。 |
| 写仓结束了符合当前 Work 的实现 | 从独立 Git 观察验证写范围、祖先关系、当前 Work 绑定和 Evidence，经受管提交推进 checkpoint 和 Package Completion。 |
| 无法确认输入或提交归属，或绑定身份已变化 | 返回稳定诊断及可行处理方式；用户可恢复授权 checkout，或将无关业务移到正确分支后重新观察。 |

接入 `classifyBuildWorkspaceRecovery` 与现有 Build Outcome 受管提交，统一准备和提交前复观察。输入变化只扩大到依赖闭包；使用 `createBuildInvalidation` 的传播逻辑与现有正常 Work 派发，扩充原因时使用专门归因。仅输入变化不能伪装成 Plan 约束变化或实现验证失败。真正的规划语义变化仍走现有审批。无效 Work 历史保留，使用现有 epoch/Work 身份拒绝旧 Outcome。需要补做实现时按当前策略取得真实 RED/GREEN；只需复核证据时保留已有效的实现事实和历史 TDD 收据，通过相应 Check/Verify 重验。

区分受管实现 HEAD 与业务仓外部基线。无关快进不写入旧 Completion 绑定的实现 OID。受影响 Work 需要重验时，由当前 Git 对象、已有受管记录和批准范围确定新观察基线，与失效记录和新 Work 一起提交。重用当前 Run 版本、Binding、checkpoint、当前 Work、epoch 和相关 Git 观察作比较条件。并发变化导致重新观察；已接受的相同事实保持幂等，未知或已发生的效果不自动重放。

### 3. Check、Verify 与发布采用各自已批准的输入

Build Check 基于接受的 Completion、依赖证据与有范围的实际输入，拒绝已变更输入的旧结果。Verify 继续使用现有 profile fingerprint。配置为 Git 敏感的节点仍按其真实声明判定；无声明的外部变化不自动触发全部包重做。

在 Archive 预检及发布前，用现有发布策略取得真实目标 OID 和允许的源 OID，检查 PR 的三点差异与源端独有提交。业务仓可接受的发布内容必须能由本 Change 的受管实现事实证明。已进入目标分支的外部快进不产生本次业务差异；仍出现在 PR 范围内的外部提交阻断发布并给出隔离提示。沿用冻结 OID 的推送、远端核对和重复发布去重。保留 Workspace OpenSpec 关闭提交的既有允许路径；这次没有自动重写或挑拣用户分支，也没有增加审批层。

Windows 临时 Git fixture 已验证下面两种实际差异。外部提交只在源分支时，三点 diff 同时显示外部文件和实现文件；目标已包含该提交时，只显示实现文件。候选包验收需覆盖同样的正反路径。

## Verification

- 先用现有真实 Git workflow fixture 做两个 RED 回归。一个已绑定的只读仓在执行中被快进，另一个已经绑定的 Backend 在当前包写集外收到用户提交。补独立安装包试验，记录 Run ID、完成项和实际 PR base/head 与差异。
- 在首包完成后换进程，以 `resume`、`next` 的两种先后顺序续跑，复核包、证据、公告的阻塞理由和处理次数。验证相关 repo/显式 Git 输入的局部重验、真实依赖传播和导航进入原 Work。
- 覆盖未授权 checkout、历史改写、未知输入、越权 staged/unstaged 写入、提交前并发变化、丢失结果与旧 Outcome。复用已有清理、规划发布、Verify 配置补齐和纯复选框提交测试。
- 延伸现有 Windows `test:windows-multirepo-package-e2e` 的试验 Host 和本地发布环境，保留原发布丢响应门禁。在新增验收中证明两条 Issue 从真实 Git 变动续跑至 Archive，外部提交未被发布；另验证真实的输入变化仅复核受影响范围。

## Risks / Trade-offs

- 单纯放宽全仓 HEAD 或用 write scope 推断读取范围，都会让 stale 证据与外部提交漏过检查。仓库默认粒度在共享依赖明显时可能触发复核，但可以用现有可信输入把范围收小。
- 给全部登记仓加锁会把正常同步恢复成产品阻塞。现有 Run 提交的版本校验及提交前再次观察覆盖 Runtime 可以验证的并发边界。Git 操作在观察后仍可能发生，后续 Outcome 和发布还会独立回验固定坐标。
- 如果构建源分支包含无法安全区分的外部提交，保持 Build 有效事实但阻断发布。用户整理分支后由 Runtime 重新验证坐标；已有未知发布结果继续先查远端事实。
