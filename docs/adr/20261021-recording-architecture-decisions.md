# ADR：分层记录规格内设计决定与长期架构决定

本 ADR 确立 Repoctopus 的决策记录层级，并移除非标准的共享实施日志。

- 状态：Accepted
- 日期：2026-10-21
- 决策人：Repoctopus 维护者与 Agent
- 相关 change：`enable-self-hosted-development`
- Supersedes：无
- Superseded by：无

## Context

Repoctopus 使用 OpenSpec 的 Proposal、Delta Specs、Design 和 Tasks 协调团队开发。早期自举 change 额外维护了共享 `implementation-notes.md`，用于混合记录设计偏差、来源采用、测试数字和恢复结果。

该文件不是 OpenSpec spec-driven schema 声明的产物。多人并行修改会形成热点冲突，也会让维护者无法判断 Design、验证报告和实施笔记中哪一份是权威。这个决定会影响所有后续 change 和 Agent，因此需要长期 ADR。

## Decision

Repoctopus 不创建或识别 `implementation-notes.md`。当前 change 内的普通设计决定、实施约束和偏差记录在该 change 的 `design.md`；产品行为记录在 Delta Specs；测试事实记录在 Evidence 和正式验证报告。

Agent 按 [ADR 决策规则](README.md)筛选跨 change 的长期架构决定。Agent 必须向用户说明候选信号和替代方案，取得确认后才能创建 ADR。评分和 Agent 推荐只用于发起讨论，不替代人的批准。

OpenSpec Provider 只映射 Provider 状态明确声明且领域契约支持的产物。目录中存在额外 Markdown 文件时，Provider 不推断新的规格或验证产物。

## Consequences

团队拥有单一、清晰的决策层级，普通开发不会争用共享实施日志。验证事实由可重放 Evidence 或正式报告承载，长期取舍由独立 ADR 保留。

Agent 在高影响决定前需要一次显式的人机确认。这个边界增加少量等待，但避免 Agent 把自己的架构偏好固化成团队标准。

## Alternatives

保留一个共享实施日志会继续产生合并冲突和权威重叠，因此未采用。为每个任务创建独立实施笔记虽然减少文件冲突，但会与 Evidence、提交和验证报告重复，因此也未采用。把所有决定都写成 ADR 会产生大量低价值记录，降低长期决策的可发现性。
