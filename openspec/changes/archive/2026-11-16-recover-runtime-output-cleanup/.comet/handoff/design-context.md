# Comet Design Handoff

- Change: recover-runtime-output-cleanup
- Phase: design
- Mode: compact
- Context hash: 4e117f96421f89f7c6e43781c1b28379607cccddb874d45c71d36bc2ea3447a0

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/recover-runtime-output-cleanup/proposal.md

- Source: openspec/changes/recover-runtime-output-cleanup/proposal.md
- Lines: 1-26
- SHA256: bf2b1a9a8e1a20e6a511d905e41e09d9e854e077eb17f1a5cd4f022597fbb75e

```md
# Proposal

## Why

GitHub #93 的 Workspace 误跟踪了 `.repoctopus/` 中的本地运行时文件。Evidence 拒绝这些输入，而在 Build 期间解除跟踪的提交又被当前逐仓 checkpoint 判定为未获授权的 HEAD，导致已开始的 Run 无法继续。

## What Changes

- 在 Build Configure 冻结 Binding 前检查受管工作区，报告被 Git 跟踪的运行时路径，让开发者在当前 Run 中先修正工作区。
- 当已绑定的 Workspace 产生可验证的纯运行时文件清理提交时，由 Runtime 在原 Run 上更新 Build 进度。保留已接受的规划、审批及仍有效的工作包成果。
- 沿用现有分支、逐仓写集和未知执行的保护。无法证明为纯清理的变更仍需受管处理。
- 用实际 Windows 安装包和独立多仓 Git 项目验证两个入口。覆盖待执行首包、保留先前完成事实和拒绝夹带业务改动。

## Capabilities

### New Capabilities

### Modified Capabilities

- `change-lifecycle`：规定 Build 绑定前的运行时文件检查及已绑定 Run 的受限恢复。

## Impact

改动涉及 Build Configure、`run resume`、`run next`、Git 观察及现有 Build workspace checkpoint。更新工作流文档，说明清理时机与原 Run 的恢复方式。范围限于 GitHub #93 的运行时文件误跟踪和恢复，常规外部提交仍按已有工作流处理。

参考 Comet Classic 0.5.1 的工作区身份核对、未解决执行保护和同一 Run 的版本化提交。本 Change 采用实现原则，第三方源码与许可证沿用仓库现有采用记录。

```

## openspec/changes/recover-runtime-output-cleanup/design.md

- Source: openspec/changes/recover-runtime-output-cleanup/design.md
- Lines: 1-59
- SHA256: f4f34e5bc7f9d9ed5db37fc65f7f1085feed0c3c96b3b447fae75efea34c2360

```md
# Design

## Context

在精确对应 `origin/main` 的 Windows 安装包上，独立 Workspace 与两个业务仓到达首个 `build.execute`。在工作包范围之外的 Workspace 仅执行一笔运行时文件解除跟踪提交后，`resume` 和 `next` 都报告 `unaccepted-head`，保持原 Work。尝试 `work-reconcile` 返回没有需要核对的 Host 调用。这把问题定位到 Build workspace checkpoint 的合法进度采纳。

Comet Classic 0.5.1 的 `classic-branch-binding.ts` 以已绑定 checkout 和分支确定工作区归属。`classic-sdk-revision.ts` 在运行中或结果未知的执行结算后，通过同一 Run 的版本校验完成受限更新，并保留已有执行历史。已核对上游 `78b1b11` 仍保持该顺序。Repoctopus 的逐仓 HEAD 与工作包写集需要额外的 Git 证明。参考固定上游源码 `35c9860b77b42bafa0c2d80d8d695889f888a924`。

## Goals / Non-Goals

**Goals**

- 绑定前识别被跟踪的运行时输出，返回可操作的仓库和路径诊断。
- 受限接纳已绑定 Workspace 的纯清理进度，并保留原 Run 和有效事实。
- 用公开 CLI 验证 Windows 多仓的待执行首包、已完成包、重放、并发和拒绝路径。

**Non-Goals**

- 自动修改开发者的 Git index、提交或分支，扩大工作包写集，或为任意 HEAD 漂移增加允许选项。
- 对历史 checkpoint 引入通用迁移，改变第三方源码、插件绑定或 Release。

## Decisions

### 1. 在 Build Configure 接受处复用输入策略

`WorkflowRuns` 用当前 `RepositoryInputPolicies` 和已观察的 checkout 调用执行工作区 Git adapter。检查所有登记 checkout 的 Git index 与准备绑定的 HEAD，复用当前规则查询，仅报告在同一规则下以跟踪状态分类为 `conflict`、以非跟踪状态分类为 `runtime-output` 的路径。读取必须可区分缺失事实和没有冲突。诊断以稳定顺序给出仓库 ID、相对路径和总数，数量受限。现有 Evidence 输入策略和未跟踪本地输出的处理继续生效。

在计算 Binding 候选前返回可重试诊断，保留原 Configure Work、Strategy 和当时已经提交的候选。当前 Host Outcome 接受与 Binding 持久化分两次写入。既有 Outcome 验证回调复查 HEAD 和 index，最终 `build-binding-accepted` 的受保护提交再复查一次，覆盖新候选和已经 terminalized 的候选路径。若并发变化触发既有过期提交拒绝，继续在原 Configure Work 通过现有入口补交候选，保持 Strategy。修复提交完成后重新观察同一 Run，重新计算候选的真实 HEAD。

### 2. 只接纳同一 Workspace 的一笔纯清理提交

首次自动恢复覆盖已绑定且当前 Work 为 `build.execute` 的 Run。使用最新 `BuildWorkspaceCheckpoint` 的 Workspace HEAD 作为旧 OID。新 HEAD 必须是该 OID 的单父直接子提交，当前分支、登记仓库、remote identity、checkout/worktree ownership 与 Binding 一致。其他登记仓库保持已接受 HEAD，所有 checkout 在判定时没有额外产品工作区变更。已有 protected branch 与 write scope 守卫继续执行。

Git adapter 使用明确的两个 OID 和不做 rename 推断的 NUL 分隔路径记录，证明变化集合非空且全部为普通文件删除。每一路径必须满足同一 `runtime-output` 输入规则，原树存在跟踪条目，新树和当前 index 均不再跟踪它。工作树可保留同一规则下允许的本地输出。缺失 Git 对象、无法读取、合并、多个提交、混合清理、`.gitignore` 改动、分支或其他仓变化按已有 blocker 处理。仅用 Git 树比较而忽略中间提交会把已修改又还原的历史归并为纯清理，因此本轮使用直接子提交。

### 3. 在原 Run 受保护提交内推进 checkpoint

`resume` 与 `next` 复用 `recoverBoundBuildWorkspace`。只有当前 `build.execute` 尚未开始，或 Execution Authority 已确认原 attempt 未执行，并且规划授权仍有效，才尝试读取清理证明。存在活动 invocation、待处理提交或未知副作用时，保留相同调用的既有核对责任。Provider 暂时不可用时等待重观测。

用物理 Git 事实通过现有 `advanceBuildWorkspaceCheckpoint` 生成候选，只给这笔受证实的 Workspace 进度授予范围。通过 Runtime Store 的同一个受保护提交检查 Run 版本、check epoch、Work、Binding、旧 checkpoint 与现有 blocker 归属，并重读所有相关 Git 与规划事实。提交采用 Build 内受管恢复转换，原子写入新 checkpoint、待执行 Work、清理接受事实及该入口拥有的 blocker 更新。其他恢复入口拥有的 blocker 继续交由原入口处理。Git 保持外部权威，提交结束后的再次漂移由下一个受保护入口检查。

把采纳接入 `reconcileBoundWorkspace` 的构建恢复事务，使用专用、可验证的恢复事实。已有 blocker 时，事务必须在权威 trajectory 中确认它源于这一 Binding、旧 checkpoint、Work、当前 Workspace HEAD 组合对应的唯一 `unaccepted-head:<workspace>` 冲突。无关 blocker、缺少原冲突事实或后来观察到的新冲突均阻断。通用恢复 API 的全局 reconciliation 守卫继续生效。

现有 Execute Work 的稳定输入包含 `workspaceCheckpointDigest`。因此保留 Run、Binding、Plan、Plan Evidence、当前 Package ID、审批和已接受 Completion，为同一尚待执行的包使用正常的 Execute Work 构造器生成绑定新 checkpoint 的 Work，并推进一次 check epoch。旧 Work 及已知未执行的 attempt 保留为历史，旧 packet 或提交无法承接新 Work。重复恢复沿已接受的 checkpoint 和新 Work 继续，无第二次接受记录。新 Work 的注册走已有持久生命周期事实的幂等恢复，任何在提交前后中断的进程都可从 checkpoint 恢复一次派发。

Build Check 的证据原本绑定最终 checkpoint。本次选在待执行包边界更新进度，随后照常生成绑定新 checkpoint 的 Build Check 和 Verify。历史 Completion 保留其原采集 checkpoint。显式要求旧 Git 输入的验收由既有证据依赖校验处理。

### 4. 验证原 Run 的版本边界和失败路径

独立安装基线包和最终候选包，使用公开 CLI、独立三仓 Git checkout 和本地 bare remote。基线到第一个 Execute 后复现可验证的 `unaccepted-head`。候选验证新接入的防护、同一 Run 的恢复和后续包完成。已绑定样本通过现有精确前驱组合采纳验证，按实际受影响 protected plugin 的 code 与 descriptor 摘要登记直接前驱，核对 authority、state schema 和配置。若新增 Build 恢复转换改变定义摘要，也沿用已有定义采纳入口登记同一精确前驱，并验证可恢复当前 Build Work。没有精确前驱证明的候选保留现有阻断。覆盖既有已完成包后再清理的样本，核对新 Work 的包身份、旧 packet 拦截及重复 pull 的记录次数。

领域和 Runtime 回归固定混合提交、旧 Run revision、重复接纳、工作区观测变化、原调用不明和提交 Journal 中断的行为。最终提交后从当前 checkpoint 继续 Execute、Build Check 和真实 Verify。

## Risks / Trade-offs

- 误将混合提交归为清理会绕过 Build 写集，因此单独证明提交对象、Git index、活动 Work 及全部登记仓库的权限事实。
- 采用专项进度接受可以保留已确认 Plan 和有效 Work。使用现有 Binding 重建适用于 checkout 身份改变，且会重建依赖旧 Binding 的后继工作。当前选择以 Git 证明和现有 checkpoint 事务限定影响。
- 诊断在 CLI 给出必要路径，持久审计记录采用有界原因和 Git 身份，OpenTelemetry 按现有恢复事件验证，路径与 OID 不作为指标标签。
- 如果实施观察与正式规格、Design 或接口权威发生冲突，在对应阶段复核后再继续。

```

## openspec/changes/recover-runtime-output-cleanup/tasks.md

- Source: openspec/changes/recover-runtime-output-cleanup/tasks.md
- Lines: 1-31
- SHA256: 1b694aa2aa4952f0609e99c5b853953bebb6c4b662a0baf5e606ac826783a2a2

```md
# Tasks

## 1. 复现与绑定前防护

- [ ] 1.1 固定真实三仓复现及保护回归。 <!-- comet-task:31a2399e-563a-405b-b0dd-d38e5b49d194 -->
  **Acceptance:** 基线安装包在解除跟踪提交后通过 `resume` 和 `next` 报同一 Workspace 的 `unaccepted-head`，Work ID 保持一致，记录 `work-reconcile` 的实际返回。
  **Requirements:** change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交
- [ ] 1.2 在 Build Configure 的受保护接受前检查运行时文件跟踪。 <!-- comet-task:65d563e2-172e-4e27-828f-67017cc397c0 -->
  **Acceptance:** 有冲突时给出仓库和路径且缺少初始 Binding/checkpoint，清理提交后换进程可继续原 Configure，正常本地输出通过。
  **Requirements:** change-lifecycle#Build 冻结仓库绑定前检查运行时文件跟踪

## 2. 已绑定 Run 的受限恢复

- [ ] 2.1 使用 Git 与现有仓库输入策略分类清理候选。 <!-- comet-task:8b1a6921-d4e7-470f-a686-47ace9286637 -->
  **Acceptance:** 纯运行时输出解除跟踪通过，混合业务提交、普通文件删除、运行时文件内容修改、其他仓变化、分支变化、历史改写和观察不全均被拒绝。
  **Requirements:** change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交
- [ ] 2.2 在 `resume` 与 `next` 的同一 Build 恢复入口接纳纯清理进度。 <!-- comet-task:bd34d9d8-af6d-4364-bfc6-7fc5ca6b9c7e -->
  **Acceptance:** 一次受保护提交更新原 Run 的 Workspace checkpoint 和对应 blocker，为同一待执行包派发绑定新 checkpoint 的 Work，保留有效 Approval、Plan、Completion 和旧执行历史。重复 pull 不重复应用。
  **Requirements:** change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交
- [ ] 2.3 验证原 invocation、并发和提交中断边界。 <!-- comet-task:396cbd60-6f74-4129-99c7-a61756060ff5 -->
  **Acceptance:** 原结果未知时保留待核对执行，过期 Run revision 或 checkout 不写入，受保护提交中断可恢复为一次接受且无部分状态。
  **Requirements:** change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交

## 3. 交付证据与用户说明

- [ ] 3.1 用 Windows 实际安装包完成独立多仓验收。 <!-- comet-task:654cfd4c-837b-4808-a980-08ab4954fb29 -->
  **Acceptance:** 两条真实多仓序列覆盖绑定前清理及已绑定后清理。从新进程调用 `resume` 和 `next`，核对同一 Run、相同待执行包、新 checkpoint 对应的 Work、先前有效完成事实、混合提交拒绝和后续 Build Check、Verify。
  **Requirements:** change-lifecycle#Build 冻结仓库绑定前检查运行时文件跟踪, change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交
- [ ] 3.2 更新 Runtime 状态说明与正式验证证据。 <!-- comet-task:463c0bce-9ae8-4493-b25d-fc5247e2a885 -->
  **Acceptance:** 文档准确说明初次防护、已绑定恢复和需要另行处理的冲突，验证报告绑定安装包与实际 CLI 收据，证明恢复遥测没有加入路径或 OID 指标标签。
  **Requirements:** change-lifecycle#Build 冻结仓库绑定前检查运行时文件跟踪, change-lifecycle#Build 恢复仅接纳可证明的运行时文件清理提交

```

## openspec/changes/recover-runtime-output-cleanup/.openspec.yaml

- Source: openspec/changes/recover-runtime-output-cleanup/.openspec.yaml
- Lines: 1-2
- SHA256: db997d460a2d6d123d14faf903215b90f63faf4e7e2dadacfdab82c07857e113

```md
schema: spec-driven
created: 2026-11-16

```

## openspec/changes/recover-runtime-output-cleanup/specs/change-lifecycle/spec.md

- Source: openspec/changes/recover-runtime-output-cleanup/specs/change-lifecycle/spec.md
- Lines: 1-39
- SHA256: 02e3040444a319bf22b2d67ab5de525086548c312e407e1bc931286328494218

```md
# Spec Delta

## ADDED Requirements

### Requirement: Build 冻结仓库绑定前检查运行时文件跟踪

Repoctopus MUST 在接受 Build Configure 并持久化初始 Execution Binding 与 workspace checkpoint 前，检查登记 checkout 中由现有仓库输入策略识别为运行时输出的 Git 跟踪文件。发现冲突时 MUST 报告对应仓库与路径，保留当前 Run、配置和 Work，等待开发者清理后重试。检查 MUST 通过 Runtime 的 Git 观察完成。

#### Scenario: 已有仓库误跟踪运行时文件

- **WHEN** 登记 checkout 的 Git index 或将要绑定的 HEAD 包含由运行时输出规则判定为冲突的文件
- **THEN** Runtime 指出冲突路径并阻止冻结 Binding 和初始 workspace checkpoint
- **AND** 开发者提交清理后，可以通过同一 Run 的公开 CLI 入口继续 Build Configure

#### Scenario: 正常的本地运行时文件

- **WHEN** 本地存在运行时输出，但这些文件未纳入 Git 跟踪
- **THEN** 该检查允许合法 Configure 继续，现有 Evidence 输入分类照常执行

### Requirement: Build 恢复仅接纳可证明的运行时文件清理提交

对已有 Build workspace checkpoint 的活动 Run，`run resume` 与 `run next` MUST 使用同一受管判定。Runtime 只有在核对原 Run、登记仓库、绑定分支和 checkout 身份，且以真实 Git 对象证明 Workspace 的前向提交只解除现有运行时输出文件的跟踪，并确认相关原执行没有未决副作用时，才可接纳新的 Workspace HEAD。接受必须与 checkpoint 更新、恢复事实和有效 blocker 处置原子提交，并在提交时确认原证据仍有效。

#### Scenario: 待执行工作包期间清理 Workspace

- **WHEN** 当前 Build Work 的包只涉及业务仓，Workspace 越过冻结 HEAD 的提交仅解除运行时输出文件的跟踪
- **AND** 绑定身份、其他登记仓库和当前工作包的有效输入通过复核
- **THEN** 新 CLI 进程可使同一 Run 接纳清理提交并继续执行待执行的工作
- **AND** Runtime 保留有效审批、Build Plan、已接受工作包和原执行收据，等价恢复重放不重复应用 checkpoint 更新

#### Scenario: HEAD 变化夹带其他内容

- **WHEN** Workspace 的提交还修改了业务代码、规划、共享配置、运行时文件内容，或存在未授权的其他仓变化、分支变化和历史改写
- **THEN** Runtime 阻止该清理恢复，保留原接受的 workspace checkpoint，并报告实际需处理的冲突

#### Scenario: 原执行结果未知或观察已过期

- **WHEN** 同一 Run 还有结果未知的相关执行，或者核对期间另一个进程改变了 Run revision 或 checkout
- **THEN** Runtime 仍通过原执行核对或重试最新观察处理，禁止使用过期证据更新 checkpoint 或重放原执行

```
