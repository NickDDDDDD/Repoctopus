# Comet Design Handoff

- Change: stop-stagnant-verify-repair
- Phase: design
- Mode: compact
- Context hash: fc1f8df912a71d2b5d8713415d69d8f75a9cbe263185b53c3e4e1e0f587c5a43

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/stop-stagnant-verify-repair/proposal.md

- Source: openspec/changes/stop-stagnant-verify-repair/proposal.md
- Lines: 1-22
- SHA256: 38bd3390d4ec46e95e36ae34816a2d2d54a28286c202c761c383c8f256ddb733

```md
# Proposal

## Why

GitHub #120 报告 Verify 与 Build 往返数小时。用 v0.1.5 在 Windows 五仓实验中复现了可确认的一条路径：前后两轮 Verify 的机器检查指纹相同且同一个检查失败，Runtime 仍重新派发 Build Plan。报告者的首次失败仍待核对。

## What Changes

- 基于可核对的失败机器证据和实际输入识别同一 Run 的返工停滞。
- 在已经完成一次自动返工、仍观测到同一失败且输入未变时，暂停继续自动派发，展示原失败证据与可执行的下一步。
- 恢复保留原 Verify、完成事实和拒绝证据。对确有变化的输入保留现有核对规则，并提供受管的继续修复入口。
- 用同一个安装包复验重复失败、冷恢复和确有变化后的正常继续。

## Capabilities

### Modified Capabilities

- `change-lifecycle`：约束 Verify 实现失败引起的重复自动返工。

## Impact

涉及 Verify 失败与恢复、当前 Work 的继续处理和用户可见的阻塞原因。沿用 Repoctopus Runtime、OpenSpec 与多仓 Evidence 权威。暂不改变配置选项、上报频率、桌面 UI 或发布策略。

```

## openspec/changes/stop-stagnant-verify-repair/design.md

- Source: openspec/changes/stop-stagnant-verify-repair/design.md
- Lines: 1-29
- SHA256: 91b8c19abffbbd88416096d68399099444ca5add04c98eb5954fad7ff853b588

```md
# Design

## Context

独立 Windows 五仓实验用 v0.1.5 运行真实机器检查。A 仓的检查第一次失败后只重做了 A，B、C、D 的有效完成保留。实验故意保持 A 的实际检查输入不变，第二次失败时 Runtime 又派发 Build Plan。两次 Verify fingerprint 相同，Plan 也相同，尽管 Work、Attempt 和 Bundle 各自合法更新。

## Goals / Non-Goals

**Goals**

- 在同一个已知失败经过一次自动修复仍无进展时，结束自动派工循环。
- 提供冷恢复后的稳定暂停，以及经明确决定或真实输入变化继续工作的路径。

**Non-Goals**

- 改变正常首次自动修复、现有的可信 Evidence 条件或产品交付流程。
- 将 GitHub 报告的所有细节归因于本实验，或重做 Verify/Build 状态机。

## Decisions

- 参考 Comet Native 持久化失败签名和无进展暂停的做法。Repoctopus 从现有机器 Bundle、已冻结的声明输入与上一轮 Verify 修复事实提取可比较的范围。在 Design 复核哪些实际输入属于签名，确保正常派发身份不会被误当成进展。
- 将暂停绑定当前 Verify 和真实失败证据。既有 Runtime 权威负责续行，宿主只负责展示问题和传递用户的真实决定。复用现有继续处理及审批合同，Design 需确认最小可行扩展。
- 保留实际变化和未知外部结果的既有分流。有真实变化时允许合法的局部修复，暂时不可观察时保留原执行，可信失败停滞才暂停自动派发。

## Risks / Trade-offs

- 过宽的签名会把无关变更计算为进展，过窄则会拦住真实修复。用无语义变化与有效输入变化的对照验收证明边界。
- 暂停若只存在于 CLI 投影，冷恢复仍可能重跑。必须验证持久化行为和至少两个进程的 `status`、`next` 与 `resume`。
- 报告者现场的首次失败仍缺原始 Machine Gate 与 Evidence，本次只对已复现的自动重复派工做可验证的承诺。

```

## openspec/changes/stop-stagnant-verify-repair/tasks.md

- Source: openspec/changes/stop-stagnant-verify-repair/tasks.md
- Lines: 1-12
- SHA256: 2a4f4e98c4899a05705d6afd4f850d49a3cd7bb3775f7b0bc1045caa11cb4f38

```md
# Tasks

## 1. 失败身份与自动派发

- [ ] 1.1 在生产入口验证旧版同一失败循环，固定两个不同 Attempt 但相同声明输入与失败范围的反例。 <!-- comet-task:a96d47a6-2e11-4289-8c5f-ebe552210ffc -->
- [ ] 1.2 实现从受管失败证据归纳进展。验证真实输入变化继续走现有规则，仅恢复标识变化不能触发第二次自动返工。 <!-- comet-task:84125beb-6823-4e41-bbbf-2e553524c8b6 -->
- [ ] 1.3 持久化暂停与可执行的继续处理。验证重复 `next` 和 `resume` 保留同一失败与执行身份，明确决定只对当前失败生效。 <!-- comet-task:bb76374f-1074-4b25-ad2d-2ab0df82035d -->

## 2. 真实实包验收

- [ ] 2.1 用 Windows 安装包五仓实验验证重复失败暂停、冷恢复及受管继续。对照真实修复的输入变化仍可通过 Verify，同一 Run 可进入 Archive，其他包完成事实保留。 <!-- comet-task:0c943267-4fbc-4d5f-8118-789610baaab0 -->
- [ ] 2.2 执行相关测试和完整 Verify，将安装包摘要、两条路径的结果以及报告者现场限制写入正式验证报告。 <!-- comet-task:6363aa3b-d79e-4ae6-88e8-818aa4c4c5dd -->

```

## openspec/changes/stop-stagnant-verify-repair/.openspec.yaml

- Source: openspec/changes/stop-stagnant-verify-repair/.openspec.yaml
- Lines: 1-2
- SHA256: d80b853b48e4aa975645172ad7ef5fa151e0123233d254d536f1f288336f6023

```md
schema: spec-driven
created: 2026-11-27

```

## openspec/changes/stop-stagnant-verify-repair/specs/change-lifecycle/spec.md

- Source: openspec/changes/stop-stagnant-verify-repair/specs/change-lifecycle/spec.md
- Lines: 1-27
- SHA256: f384c49d9f172c50cdeda84e459e567188632230fd167345429223e6fdcb1219

```md
# Change lifecycle

## ADDED Requirements

### Requirement: Verify 停止同一失败的重复自动返工

Runtime MUST 在已完成一轮自动返工后，用两个可归属于同一 Run 的失败机器证据比较失败检查、验收范围和声明的实际输入。当失败范围与输入均未变化时，Runtime MUST 保留当前 Verify Work、原机器 Attempt 和失败证据，并暂停自动派发 Build 或新 Verify。新的 Attempt、Bundle、Work、epoch、完成记录或 recovery decision 标识 MUST NOT 单独作为输入变更或返工进展的证据。

#### Scenario: 同一失败与实际输入未变

- **WHEN** 一轮自动 Build 返工结束后，再次观测到相同的机器检查失败，受影响的验收范围与声明输入保持不变
- **THEN** Runtime 停在同一 Verify Work，返回可定位的失败证据及继续修复的指引，保留有效完成事实，不再自动派发 Build Plan 或机器检查

#### Scenario: 暂停后从新进程恢复

- **WHEN** Runner 断开后，再执行 `status`、`resume` 或 `next`，且影响当前暂停的事实没有变化
- **THEN** 所有入口保持同一暂停、Work、Attempt 和失败证据，重试读取不产生新的执行或重复审批

#### Scenario: 有实际变化或可信决定后继续

- **WHEN** Runtime 观察到声明输入确实变化，或接受同一失败范围的明确继续决定
- **THEN** Runtime 沿受管路径重观或重新修复，保留不受影响的完成事实，不接受旧或不相干的决定，不跳过 Verify；再次观察到同一无进展失败时仍须阻断自动循环

#### Scenario: 首次失败或失败证据变化

- **WHEN** 首次观察到可归属的实现失败，或后续机器失败范围或声明输入有实质变化
- **THEN** Runtime 继续执行现有的有界证据核对和局部返工规则

```
