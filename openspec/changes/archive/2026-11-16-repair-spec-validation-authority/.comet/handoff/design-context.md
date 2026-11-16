# Comet Design Handoff

- Change: repair-spec-validation-authority
- Phase: design
- Mode: compact
- Context hash: 995cdd2e9a014942de06f24663f16830d620f4beaaffd210f8685d70cdfb1e03

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/repair-spec-validation-authority/proposal.md

- Source: openspec/changes/repair-spec-validation-authority/proposal.md
- Lines: 1-22
- SHA256: fa34ddc4529237a497f39fbd5e743dbe3c0afb2a3d46d38cbe02fb08b74ab63a

```md
# Proposal

## Why

`spec validate --run` 会在 Runtime 接受 Open 或 Design 证据前冻结校验摘要。实际安装包已复现失败校验卡死原 Run、有效草案无法继续迭代，以及另一份 Change 的校验结果写入当前 Run。另有部分 Build 和 Archive 入口会把 Provider 暂不可用当作规划变化。

## What Changes

- **行为变更** 将手动规格校验限定为当前 Change 的只读诊断。指定 Run 时先核对其归属。
- 让 Runtime 在接受当前阶段的有效证据时记录绑定，沿用阶段、批准提案与 Work 的现有校验。
- 统一处理 Provider 无法观察与已证实规划变更，前者保留当前 checkpoint，后者进入现有 Design 修订。
- 用实际安装包验证同一 Run 冷恢复，复验多仓 Verify 和 Archive 的身份约束。

## Capabilities

### Modified Capabilities

- `specification-authority`：规定校验查询的只读契约、阶段证据的提交边界和后续阶段观察结果。

## Impact

影响 CLI `spec validate --run`、Specification 命令与规划服务，以及 Runtime 中 Open、Design、Build 和 Archive 的观察与接受路径。现有失败现场和批准历史用于复核。

```

## openspec/changes/repair-spec-validation-authority/design.md

- Source: openspec/changes/repair-spec-validation-authority/design.md
- Lines: 1-48
- SHA256: 0a6757a4c3c39db8fdbb776432f570d33d029c054888ec6fd8f573db6560b751

```md
# Design

## Context

阶段审批已经各自绑定规划语义与当前提案。早期的 `specification.validate` 命令在 Provider 返回后调用通用 Run 绑定，CLI 此后才检查有效性。Open 和 Design 也依赖这条单独写入路径，并把首个校验摘要当作整个 Run 的固定值。候选包复现了校验失败卡住原 Run、两份有效草案之间出现漂移，以及另一个 Change 的校验摘要写入当前 Run。

另一个入口差异出现在后续规划观察。`observeAuthority` 将调用异常表示为 `invalid/unknown`，Verify 恢复路径识别这个组合，Build 恢复和 Archive 准备的部分调用方却把它送入 Design 修订。

## Goals / Non-Goals

- 让手动严格校验、受管 Open/Design 接受、Provider 兼容检查各自使用对应的输入和写权限。
- 让暂时不可用与确定性规划失效走一致的分支，并保留已有的多仓、证据和发布保护。
- 本次范围覆盖 Specification 命令、规划观察、Open 和 Design 提交，以及受影响的 Build、Verify 和 Archive 入口。历史 Run 中无法证明来源的绑定保留作为原始证据。

## Decisions

### 1. 手动校验通过只读身份核对

`spec validate --run` 先从 Runtime 的只读 Run 入口读取归属，核对 Workspace、Run 和 Change。无法读取、非 Change Run 或身份不匹配时停止。匹配后调用严格校验，以现有 CLI 退出码和 JSON 协议返回结果或能够定位工件的诊断。校验输入相同或不同都不提交 Run、checkpoint、审批、规划快照或已接受证据。使用现有 Provider 校验方式，对调用者返回真实失败。

对其他绑定入口做同一检查。移除只供旧命令使用的通用规格绑定入口。当前 `specification.prepare-closure` 可以在 Provider 层计算候选，但可选 Run 写入不参与正式 Archive，去掉这条发布快照的旁路。Archive Work 仍以受管前置条件、Closure Receipt 和 Publication Journal 核对实际关闭和远端效果。

### 2. 通过阶段转换提交有效证据

在现有 `acceptChangeObservation` 受保护提交中，让获准的 Open 和 Design 转换携带最小的阶段接受证据。核对 Run 和 Change、阶段与生命周期 revision/checkEpoch、当前适用的 Work 或 Wait、可信批准请求和提案摘要，并重新观察 Provider、规格根和批准所指工件。重新观察使用只读入口。旧 revision、工件不匹配或快照未通过严格校验时，沿现有阶段恢复处理，不接受该候选。

在同一次 Run Store 提交中记录阶段转移、最小的已接受 Provider/校验身份和其轨迹。复用现有 `SpecificationUsageSnapshot` 作为最近一次已接受规格证据的投影，原 Open/Design 证据通过现有生命周期事件保留。它的校验摘要只描述接受它的阶段输入。合法 Design 或重新批准的 Design 可产生新摘要。原有 Provider id、版本、协议与受保护 Work 的 Provider 检查继续生效。确定性规划漂移仍使用现有 planning semantic identity 和当前批准判定。

采用这条路径是因为现有 Run Store 和生命周期事件已经具备提交边界。仅增加 `validation.valid` 条件会留下有效草案提前冻结的问题。另建阶段证据 Store 会要求协调第二份状态，增加中断后的不一致风险。Comet Classic 0.5.1 的 `recordEvidence` 也在证据有效且待接收项匹配后才提交同一 Run。

### 3. 分清观察不可用和规划失效

用可区分的观察结果表示 `authorized`、`invalid` 和 `unavailable`。只有确凿证实的工件无效、语义差异或批准失效可以进入现有 Design 修订分类。Provider、Store 或验收进程无法给出可靠结果时，保留阶段、revision、Work、审批、已接受包、Gate 和 Bundle，并返回可重试的重新观察诊断。

统一检查 Build 恢复与 Configure/Plan 的只读规划核对、Verify 运行或恢复、Archive 准备与副作用前检查。消费当前观察的入口必须短路等待，避免继续使用一次失败的观察创建 Work。已明确开始的 Archive 操作继续遵循既有 Journal 对外部结果的核对顺序。确定性失效沿用现在的 `revise-design`，并保留精确依赖失效逻辑。

## Risks / Trade-offs

- **并发与中断**。Provider 校验完成后，另一 Host 可能推进批准或 Work。单次提交仍核对当前阶段身份，过期或失败提交不留下提前绑定。成功后响应丢失时复用已接受事实，不重复派发。
- **已部署输入**。旧初始快照缺少校验成功事实和阶段来源。保持其历史记录供定位，本 Change 验收使用正常公开入口生成与恢复 Run。若持久化身份根本不兼容，沿用 Runtime 的现有诊断。
- **调用者预期**。CLI 调用方式与退出码保持可用，`--run` 的写入效果收敛为只读，且用户指南同步。正式 Archive 继续使用其现有发布身份和证据。

## Verification

- 先让公开 CLI 回归对旧实现失败。覆盖无效后修正、两次有效草案、Change A 配 Run B，以及读取完成 Run 不改写历史。
- 在提交边界覆盖生成候选后的中断、两个 Host 使用同一版本竞争、旧审批被拒和成功后重放。测试 Open 与 Design 使用不同有效摘要，还要覆盖 Build 带合法 Design 调整返回同一 Run。
- 注入 Provider 暂不可用，对比 Build Configure/Plan、Verify、Archive preflight 与 publish 的阶段、Work、批准和副作用计数。恢复 Provider 后继续原 Work。确定性规划变更继续进入 Design。
- 以实际安装包走多仓公开 CLI，从失败校验修正到同一 Run 的 Open、Design、Build、Verify 和 Archive。复验复选框提交保留 Verify 证据、真实远端发布和终态恢复不重复发布。

```

## openspec/changes/repair-spec-validation-authority/tasks.md

- Source: openspec/changes/repair-spec-validation-authority/tasks.md
- Lines: 1-34
- SHA256: 1d2a765b41e4368a43e3d0a3a863543fdfe0d34ec328c3c76f2681ff058c57f2

```md
# Tasks

## 1. 锁定失败行为

- [ ] 1.1 通过公开 CLI 固定失败校验、有效草案迭代和跨 Change 查询的回归。 <!-- comet-task:31d05ef2-5eb2-4305-9fd8-e28d4b834099 -->
  **Acceptance:** 修复前的候选分别复现错误绑定、摘要变化被拒和跨 Change 写入，记录持久化影响。
  **Requirements:** specification-authority#手动规格校验只读并绑定查询归属
- [ ] 1.2 加入 Provider 故障注入与阶段接受中断、并发回归。 <!-- comet-task:5730719a-2b5b-46df-81a6-bbade6ef489b -->
  **Acceptance:** 能区分观察不可用、真实规划语义变化、版本过期、重复提交和同一提交未落盘。
  **Requirements:** specification-authority#阶段校验证据随受保护转换提交, specification-authority#规划观察区分不可用和确定性失效

## 2. 修复 Runtime 权威边界

- [ ] 2.1 让 `spec validate --run` 使用只读 Run 归属核对并返回当前严格校验诊断。 <!-- comet-task:3ff70cbb-d90e-451c-988a-8e3da941d260 -->
  **Acceptance:** 无效草案、有效草案和错误 Run 的请求均不改变原 Run 的状态、checkpoint 或批准。
  **Requirements:** specification-authority#手动规格校验只读并绑定查询归属
- [ ] 2.2 将各阶段的有效校验证据与受保护接受一起提交，核对同义的其他公开和内部绑定入口。 <!-- comet-task:0fdeb3e8-514f-4117-9bb8-27c4c56c392c -->
  **Acceptance:** 合法 Design 可以产生不同校验摘要，当前阶段的过期批准或过期提交仍被拒绝，重复提交幂等。
  **Requirements:** specification-authority#阶段校验证据随受保护转换提交
- [ ] 2.3 统一 Build、Verify 和 Archive 的规划观察不可用处理。 <!-- comet-task:1c71c7f5-3495-4167-930a-0ec4696a2bda -->
  **Acceptance:** Provider 故障保留现有 Work 和有效事实，恢复后可继续，真实规划变更仍进入 Design 修订。
  **Requirements:** specification-authority#规划观察区分不可用和确定性失效

## 3. 安装包验收与文档

- [ ] 3.1 复跑生命周期、规划批准、Verify 身份与 Archive 回归。 <!-- comet-task:aa7b2ce0-202b-46ef-bc53-770fc9e5f2d0 -->
  **Acceptance:** 原审批和冷恢复守卫测试通过，复选框提交与真实规划变更继续走各自路径。
  **Requirements:** specification-authority#阶段校验证据随受保护转换提交, specification-authority#规划观察区分不可用和确定性失效
- [ ] 3.2 用实际安装包完成同一 Run 的失败修正与多仓真实验收。 <!-- comet-task:5e9abfb6-3915-4853-ab62-b7d297e44421 -->
  **Acceptance:** 从无效草案修正、换进程、正式批准 Open 和 Design，到多仓 Verify、Archive 及发布后的终态恢复，验证关联和副作用次数。
  **Requirements:** specification-authority#手动规格校验只读并绑定查询归属, specification-authority#阶段校验证据随受保护转换提交, specification-authority#规划观察区分不可用和确定性失效
- [ ] 3.3 对齐 CLI 说明并记录验证证据。 <!-- comet-task:6d8d3a0a-a9fc-4119-82cf-d7f117874630 -->
  **Acceptance:** 文档说明 `--run` 查询关联、阶段接受与故障恢复，固定候选包及实际验收证据可以复核。
  **Requirements:** specification-authority#手动规格校验只读并绑定查询归属, specification-authority#规划观察区分不可用和确定性失效

```

## openspec/changes/repair-spec-validation-authority/.openspec.yaml

- Source: openspec/changes/repair-spec-validation-authority/.openspec.yaml
- Lines: 1-2
- SHA256: db997d460a2d6d123d14faf903215b90f63faf4e7e2dadacfdab82c07857e113

```md
schema: spec-driven
created: 2026-11-16

```

## openspec/changes/repair-spec-validation-authority/specs/specification-authority/spec.md

- Source: openspec/changes/repair-spec-validation-authority/specs/specification-authority/spec.md
- Lines: 1-50
- SHA256: a09758645e5e1ee69228291afbeba9b137ffad5a78cf00c47e538a66fc450ba9

```md
# Spec Delta

## ADDED Requirements

### Requirement: 手动规格校验只读并绑定查询归属

规格校验 MUST 返回当前工件的严格校验结论和诊断。指定 Run 时，Runtime MUST 核对该 Run 与 Change 的归属。手动校验 MUST 保持 Run 状态、checkpoint、批准与已接受证据不变。校验结论仅对本次观察的工件生效。

#### Scenario: 修正失败的规格草案

- **WHEN** 同一个 Open Run 对应的草案首次校验失败，修正后再次校验
- **THEN** 命令分别返回实际失败与通过结论，冷启动后仍能通过 Open 阶段的正式审查继续原 Run

#### Scenario: 批准前迭代有效草案

- **WHEN** 同一个 Open Run 的两份草案先后通过严格校验且产生不同摘要
- **THEN** 两次查询都能完成，Runtime 的正式审批只对提交并复核的当前提案生效

#### Scenario: 查询指定了另一份 Change

- **WHEN** 调用方给出的 Change ID 与指定 Run 的 Change ID 不同
- **THEN** Runtime 拒绝查询关联，且指定 Run 的持久化状态保持原样

### Requirement: 阶段校验证据随受保护转换提交

Open 与 Design 的有效 Provider 校验证据 MUST 绑定各自阶段、当前 Work 或批准请求、工件身份与输入版本。Runtime MUST 仅在当前受保护转换接受证据时提交其权威绑定。重放同一接受 MUST 幂等，过期候选 MUST 被拒绝。Provider 身份检查与阶段校验摘要 MUST 各自按其语义执行。

#### Scenario: Design 合法深化 Open 草案

- **WHEN** Design 合法细化规格并产生与已接受 Open 证据不同的校验摘要，当前 Design 获得独立批准
- **THEN** Runtime 接受当前 Design 证据并进入 Build，保留 Open 的历史决定和阶段证据

#### Scenario: 阶段接受遇到中断或并发

- **WHEN** Provider 校验通过后受保护提交失败、版本被另一进程推进，或原请求在重启后重放
- **THEN** 持久化事实只能对应实际接受的当前阶段，原提交不得提前固定摘要或覆盖新阶段

### Requirement: 规划观察区分不可用和确定性失效

Build、Verify 和 Archive 的公开恢复与受保护入口 MUST 区分 Provider 暂时无法观察和已经证实的规划失效。无法观察时 MUST 保留当前 Work、审批、有效执行和证据事实，等待重新观察。确定性失效 MUST 沿现有规划恢复分类进入受保护的 Design 修订。

#### Scenario: Provider 暂时不可用后恢复

- **WHEN** 当前规划无法观察，随后同一 Provider 恢复并返回仍然有效的输入
- **THEN** Runtime 保留原 checkpoint 并继续原 Run，期间不会派发替代 Design Work 或执行归档副作用

#### Scenario: 已批准输入发生确定性变更

- **WHEN** Provider 成功观察到实际规划语义变化或现有批准失效
- **THEN** Runtime 使用现有分类生成受保护的 Design 修订，并按依赖失效后续事实

```
