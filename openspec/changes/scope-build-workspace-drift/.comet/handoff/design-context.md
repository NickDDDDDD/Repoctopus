# Comet Design Handoff

- Change: scope-build-workspace-drift
- Phase: design
- Mode: compact
- Context hash: db3c5fc29b64c0d5e16d63b69e855309400029da3f3272fb56cdaa802b3e864f

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/scope-build-workspace-drift/proposal.md

- Source: openspec/changes/scope-build-workspace-drift/proposal.md
- Lines: 1-25
- SHA256: c43f491d8c0822da98be186bc172e94864959fb6684454aa9dec5446fcfb6dd3

```md
# Proposal

## Why

[Issue #114](https://github.com/NickDDDDDD/Repoctopus/issues/114) 报告 Framework 工作包完成时，另一个团队同步只读 Web Front 仓，导致验收被拒。[Issue #115](https://github.com/NickDDDDDD/Repoctopus/issues/115) 报告同一执行工作区内，包写集以外的 Backend 业务提交也触发了相同的阻塞。当前 Build 恢复和 Outcome 验收将登记仓库的 HEAD 当作统一的进度锁。Runtime 需要继续严格校验 checkout、写入授权和实际输入，同时允许能证明与当前工作无关的仓库正常前进。

## What Changes

- 统一 Build 的 `run resume`、`run next`、Execute Outcome 和 Build Check 对工作区变化的判定。区分 checkout 身份冲突、受管实现提交、无关的外部 fast-forward 和受管输入变化。
- 对于能证明无关的外部 fast-forward，同一 Run 保留现有 Plan、审批和有效 Completion。该提交不计为当前包的实现或发布结果。
- 对于已确认的相关变化，只复核受影响的包、依赖这些包的后续工作和证据。存在未结算执行、不能证明输入范围、出现越权或重写历史时，保留可恢复进度并返回明确原因。
- 用实际候选安装包在 Windows 模拟多仓验证两条 Issue、真实输入变化、不同进程恢复、写入边界及最终发布内容。

## Capabilities

### New Capabilities

### Modified Capabilities

- `managed-work-execution`：区分 Package 写入推进和外部 Git 观察，要求 Runtime 按实际依赖校验 Outcome。
- `change-lifecycle`：让 Execute 与 Build Check 复用同一漂移判定，按受影响的输入收敛恢复范围。

## Impact

影响 Runtime 的 Build workspace checkpoint、Git 观察、Outcome 验收及证据恢复路径。沿用现有 Build 策略、Git 隔离和 OpenSpec 权威。Issue #105 单独只读排查，目前缺少其版本和恢复日志，无法确认属于同一故障。本 Change 的验收以 #114、#115 及相邻恢复边界为准。

```

## openspec/changes/scope-build-workspace-drift/design.md

- Source: openspec/changes/scope-build-workspace-drift/design.md
- Lines: 1-56
- SHA256: 63814a66adeda66c11318e80f52310bc89992f3301a234e69c220771faf76dac

```md
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

```

## openspec/changes/scope-build-workspace-drift/tasks.md

- Source: openspec/changes/scope-build-workspace-drift/tasks.md
- Lines: 1-18
- SHA256: 94603573c2ce8c9cb9889da24426bd8d2d1295d9f303b944c7dc9e9de91c4f25

```md
# Tasks

## 1. 确定观察和恢复契约

- [ ] 1.1 用公开 CLI 和真实 Git fixture 复现两条 Issue，梳理 resume、next、Execute Outcome、Build Check 的原有判定及提交边界，并先记录失败回归。**Acceptance:** 两个独立场景均复现全仓 HEAD 阻塞，当前实现和 Comet 对照可追溯。**Requirements:** managed-work-execution#Runtime 必须按 Package write scope 推进 workspace revision <!-- comet-task:00eeee26-8802-43bf-8131-21e5bb1591ce -->
- [ ] 1.2 在正式 Design 明确可核验的 Package 输入、Check 输入和发布边界，以及未知范围、工作树修改和历史改写时的处理。**Acceptance:** 每类判定均有真实输入来源、允许动作和失败路径，对缺少读范围的仓库有保守策略。**Requirements:** change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:a4b03b35-e844-4f7f-9f88-2ddf58bd424a -->

## 2. 统一 Build 漂移判定与提交

- [ ] 2.1 实现共用的 checkout 与 Git 变化分类，验证仓库身份、祖先关系、受管写入和外部变化。**Acceptance:** 分支切换、改写和无法观测不会误判为无关快进。**Requirements:** managed-work-execution#Runtime 必须按 Package write scope 推进 workspace revision <!-- comet-task:f04ef1a9-1c51-42a4-866b-0154830d2b25 -->
- [ ] 2.2 将继续入口和 Execute Outcome 接入同一判定，使用受管提交保留合法进度和处理失效范围。**Acceptance:** 同一 Run 冷恢复保留有效包与审批，并发、丢失响应和未结算执行不会重复写入或留下部分进度。**Requirements:** change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:6a8d1740-bd32-44ec-8876-9db430784db3 -->
- [ ] 2.3 让 Build Check 依据同一观察绑定有效输入，复用现有 Evidence 失效及依赖传播。**Acceptance:** 已知输入变化只复核相关包及依赖者，无关快进保留有效结果，实际规划变化仍受既有审批约束。**Requirements:** change-lifecycle#Build Check 必须验证最终 workspace checkpoint、change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:f1c147d9-9c78-458e-8d5d-c6175a0fb9d0 -->
- [ ] 2.4 保持 Git 交付坐标和范围可验证，补齐阻塞时的公开诊断与恢复说明。**Acceptance:** 外部提交不会计为受管实现或混入发布，无法安全隔离时给出可行动的诊断。**Requirements:** managed-work-execution#Runtime 必须按 Package write scope 推进 workspace revision <!-- comet-task:3f4afe50-a396-41dd-b49d-8126ccb411ba -->

## 3. 端到端验证

- [ ] 3.1 在 Windows 安装实际候选包，在模拟多仓分别复现只读仓同步、包外业务提交和相关输入变化，覆盖冷恢复并验证真实发布差异。**Acceptance:** 两个无关快进场景均续跑原 Run 到 Archive，相关变化场景仅复核受影响的范围，发布差异不含外部业务改动。**Requirements:** managed-work-execution#Runtime 必须按 Package write scope 推进 workspace revision、change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:27901fb0-8bd8-479b-bc51-a4dba75a9b8c -->
- [ ] 3.2 运行相关回归、正式 Verify 和独立审查，核对规划发布、Verify 配置补齐、纯 Runtime 输出清理及旧证据复用路径。**Acceptance:** 附带公开验收步骤与实际证据，已知阻塞和范围限制均可追溯。**Requirements:** change-lifecycle#Build Check 必须验证最终 workspace checkpoint、change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:1cf5b00d-249f-46b3-af85-e58cbbfe1444 -->

```

## openspec/changes/scope-build-workspace-drift/.openspec.yaml

- Source: openspec/changes/scope-build-workspace-drift/.openspec.yaml
- Lines: 1-2
- SHA256: 4492318684c90914e715dee55afe9b23f60f7465350ada31d1d9437964f126f8

```md
schema: spec-driven
created: 2026-11-26

```

## openspec/changes/scope-build-workspace-drift/specs/change-lifecycle/spec.md

- Source: openspec/changes/scope-build-workspace-drift/specs/change-lifecycle/spec.md
- Lines: 1-42
- SHA256: c8e387c700ae386f809763b5ec8ef70e890013ada211795f89aba0b4fc0a827a

```md
## MODIFIED Requirements

### Requirement: Build Check 必须验证最终 workspace checkpoint

Repoctopus MUST 将 Build Check 绑定到已接受的 Package Completion 和最终 BuildWorkspaceCheckpoint，并核对当前 checkout 身份、Build Check 的有效输入及交付内容。可以证明无关的快进 SHALL NOT 单独使 Check 失效。影响 Check 或受管实现的变化 MUST 走 Runtime 派发的复核路径，且 SHALL NOT 直接放行 Verify 或纳入交付。

#### Scenario: Check 期间出现可证明无关的快进

- **WHEN** 某个登记仓库在 Check 期间前进，且仓库身份、Check 的有效输入与获准交付的内容均保持一致
- **THEN** Runtime 可接受符合原 checkpoint 与检查契约的 Check Outcome

#### Scenario: Check 观察到额外 commit

- **WHEN** 任一登记仓库的变化影响 Check 输入、已通过的包或获准交付范围
- **THEN** Runtime MUST 拒绝由旧输入产生的 Check 结果，按实际影响派发复核，并保持无关包的完成事实

## ADDED Requirements

### Requirement: 多仓 Build 漂移仅失效受影响的有效进度

Repoctopus MUST 让 `run resume`、`run next`、Execute Outcome 和 Build Check 共用同一工作区漂移判定。Runtime MUST 基于受管输入和依赖关系选择恢复动作，并以当前绑定、checkpoint 和状态版本保护转换。影响范围未知、checkout 身份不符或执行副作用未结算时 MUST 阻断自动采纳或重放，并保留最后安全进度。

#### Scenario: 冷恢复保留无关完成事实

- **WHEN** 一个包已完成，下次进程启动时出现已证实的无关快进
- **THEN** 两个继续入口 MUST 保留同一 Run、Plan、审批和有效 Completion，并继续派发当前应执行的 Work

#### Scenario: 只需复核部分包或证据

- **WHEN** 受管输入变化且 Runtime 能确定受影响的包或证据
- **THEN** Runtime MUST 只失效受影响的事实及依赖它们的结果
- **AND** 只有实际规划输入发生变化才可依既有契约重进 Plan 或 Design

#### Scenario: 恢复时遇到身份变化或未结算执行

- **WHEN** checkout 切换到未授权分支、历史被改写、观察无法建立，或受影响 Work 仍有未结算副作用
- **THEN** Runtime MUST 保留已接受的进度和执行记录，返回可归因的阻塞，并 SHALL NOT 自动重试可能已发生的副作用

#### Scenario: 恢复时出现并发变化

- **WHEN** 状态版本、绑定或需验证的 Git 观察在恢复提交前发生变化
- **THEN** Runtime MUST 拒绝陈旧的恢复判定并重新观察，且 SHALL NOT 留下部分更新的 checkpoint、任务完成或 Work

```

## openspec/changes/scope-build-workspace-drift/specs/managed-work-execution/spec.md

- Source: openspec/changes/scope-build-workspace-drift/specs/managed-work-execution/spec.md
- Lines: 1-40
- SHA256: 5ac4386049f0d03369c3381f08ca467330b8400f8cc8294075a4da6820b25807

```md
## MODIFIED Requirements

### Requirement: Runtime 必须按 Package write scope 推进 workspace revision

Repoctopus MUST 在接受 Package Completion 前，根据 BuildWorkspaceCheckpoint 重观察登记仓库并校验仓库、分支及 checkout 身份。受管实现提交 MUST 满足当前 Package 的写范围、Git 祖先关系与 Evidence。对于写范围外的 fast-forward，Runtime MUST 按已验证的包输入、检查和交付边界判定影响。只有能证明无关的外部变化才可继续使用当前证据，且 SHALL NOT 记为当前包的实现或扩大交付范围。无法确定影响范围、存在越权写入或历史改写时 MUST 保留最后安全状态并指出原因。Checkpoint 更新、Completion acceptance 与下一 Work 创建 MUST 是同一受管生命周期转换。

#### Scenario: 只读仓同步与当前工作无关

- **WHEN** Framework 包正在验收，已绑定的 Web Front 只读仓 fast-forward，Runtime 证明变化不影响当前包所消费的输入
- **THEN** Runtime 接受满足原写范围和证据要求的 Framework Completion，且 SHALL NOT 将 Web Front 的提交记为实现或交付结果

#### Scenario: 包外业务提交与当前工作无关

- **WHEN** 已绑定的 Backend 仓收到当前包写范围外的业务提交，且 Runtime 可证明其快进与当前包有效输入及交付范围无关
- **THEN** Runtime 保留同一 Run 和有效进度，且 SHALL NOT 把外部提交纳入当前 Change 的发布范围

#### Scenario: 外部变化触及真实依赖

- **WHEN** 已绑定仓库的快进改变包实际消费的输入
- **THEN** Runtime MUST 拒绝依赖旧输入的新 Outcome，只复核影响范围及其依赖者，并保留无关完成事实

#### Scenario: 未授权仓库同时变化

- **WHEN** Runtime 不能证明写范围外的变化是无关的外部快进，或观察到越权工作区修改
- **THEN** Runtime MUST 返回明确原因，保留最后接受的 checkpoint，且 SHALL NOT 接受 Completion 或推进 Task

#### Scenario: 写集仓库历史被改写

- **WHEN** 当前包写集的新 HEAD 不是 checkpoint HEAD 的后代
- **THEN** Runtime MUST 拒绝新的 workspace revision，保留已有受管状态供明确修复

#### Scenario: 幂等恢复时 HEAD 未改变

- **WHEN** 包实现已在 checkpoint HEAD 中，Host 重新验证并提交完整 Evidence，且没有产生新 commit
- **THEN** Runtime MAY 建立语义等价的下一 checkpoint 并接受 Completion，无需伪造 HEAD 变化

#### Scenario: 兼容 Runtime adoption 后恢复已派发 Work

- **WHEN** composition compatibility gate 已接受精确直接前驱，Run 采用新 composition，但当前 Work 的 Action Intent 与 Work Packet 是采用前冻结的同一旧 snapshot
- **THEN** Runtime 必须按 Intent 与 Packet 的冻结身份恢复并验证 Outcome，不得因其 snapshot digest 不等于 Run 当前 composition digest 而重派发或拒绝

```
