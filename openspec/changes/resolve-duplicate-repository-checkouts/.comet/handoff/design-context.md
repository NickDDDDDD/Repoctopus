# Comet Design Handoff

- Change: resolve-duplicate-repository-checkouts
- Phase: design
- Mode: compact
- Context hash: 57694b1858b7256eca598716b71f62c5eccb64ce7a9d565c983a895ea0ff4a93

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/resolve-duplicate-repository-checkouts/proposal.md

- Source: openspec/changes/resolve-duplicate-repository-checkouts/proposal.md
- Lines: 1-26
- SHA256: 858959be11d879d114fcd536969859578a06ee1d7dfb6a6fee834a9698a8584e

```md
# Proposal

## Why

同一远端在开发目录中有多个 checkout 时，多仓接入会剔除整组目录，探测候选也没有解释原因。GitHub #110 中，用户明明选择了 `backend`，仍只能临时移走其他目录才能完成初始化。

## What Changes

- 在多仓接入的候选中展示指向同一远端的 checkout 和实际路径。
- 允许用户在有歧义时绑定明确的 checkout，或显式排除整组，仍在原接入审批中核对最终选定的仓库。
- 使用已登记路径识别已有 Workspace 的绑定。路径失效、选择矛盾或审批期间身份变化时，给出可执行的恢复提示。
- 维持首次接入的轻量路径。Verify Profile 单独配置，项目仍使用既有 OpenSpec Store。

## Capabilities

### New Capabilities

### Modified Capabilities

- `project-configuration` — 多仓探测、checkout 选择、接入候选审批与恢复。

- `multi-repository-probe` — 将同一远端的候选路径作为探测诊断返回，保留已选择仓库快照中的身份唯一性。

## Impact

影响多仓项目探测、Init CLI 与 Skill、用户接入指南和 Windows 实包验收。一个远端在一个 Workspace 中仍绑定一个 checkout。Comet 的路径与分支核对仅作设计参考，无第三方源码采用或许可证变更。

```

## openspec/changes/resolve-duplicate-repository-checkouts/design.md

- Source: openspec/changes/resolve-duplicate-repository-checkouts/design.md
- Lines: 1-31
- SHA256: 697cc56dcce0e583d338b382cac7d55373b72407bd931d8a305a94c3a8c36d8b

```md
# Design

## Context

平台探测能识别远端冲突，当前却在生成接入候选前排除了整个冲突组。接入候选随后按逻辑仓库 ID 选取仓库，因此显式输入该 ID 也无法恢复 checkout。Windows 四目录实验确认了公开 CLI 的失败。

## Goals / Non-Goals

- 将发现的路径信息传给接入候选，让 Host 能解释冲突并收集选择。
- 保持作用域校验，以及配置和 Store pointer 由同一接入审批授权的边界。
- 将 Run 的 Git 身份、Store 模型和 Verify Profile 独立配置留在各自现有职责内。

## Decisions

### 发现、选择、应用

平台 Git 适配器报告规范化路径与远端事实，Cordis 接入 Service 负责候选、审阅和应用。选择必须先确定实际目录，再为已选择的仓库生成配置与 pointer 计划。CLI 和 Init Skill 共用接入服务的决议结果。Engine 只消费已经生效的 Workspace 配置。

Comet Classic 0.5.1 的 workspace prepare / resolve 在复用工作区时分别核对 Git 登记、分支和路径。这里借鉴同一原则，让远端身份与 checkout 路径各有一份可核对的事实。多仓选择和 OpenSpec Store 计划沿用 Repoctopus 现有边界。

自动挑首项、最短路径或最新 HEAD 都会把文件写入位置交给偶然的扫描结果。为同一远端分配多个正式 ID 会让交付与恢复出现身份歧义。保留已登记的有效路径，首次接入有歧义时由用户选择。

### 审批与恢复

申请中的 checkout 选择随现有候选审批绑定。应用或恢复时核对实际 Git 根、路径范围与远端事实。已登记路径无法核实时显示冲突。发生规格或接口契约冲突时停在当前阶段，待确认权威后继续。

## Risks / Trade-offs

- 目录名、路径别名或扫描顺序容易造成误选。展示实际目录，按规范化路径去重，以唯一身份验证选择。
- 用户可能在探测后替换或移动 checkout。写入前重新核对原审批目标，失败时让用户重做探测，避免配置到其他副本。
- Windows 验收核对检测、选择、审批及重新接入，比较未选 checkout 的文件与写入事实。测试证据放在正式 Verify 报告。遥测沿用接入诊断，检查路径和远端凭据未被新增上报。

```

## openspec/changes/resolve-duplicate-repository-checkouts/tasks.md

- Source: openspec/changes/resolve-duplicate-repository-checkouts/tasks.md
- Lines: 1-16
- SHA256: 0148ff06ca406874418a5c530d29a10406f56f51d85c388fbfda4d3a231b3743

```md
# Tasks

## 1. 多仓首次接入

- [ ] 1.1 为公共 CLI 重现 #110，先验证两个 checkout 都从候选消失。验收：测试在修复前报告复现，探测新合同在修复后显示两个路径和冲突原因。 <!-- comet-task:7fdebb4a-dacd-4bd9-b87a-bcb5836f8967 -->
- [ ] 1.2 让 Init CLI 和 Skill 收集并提交 checkout 选择，沿用接入审批。验收：用同一远端的两个 checkout，从探测进入批准并启动工作流，只有所选目录收到 Store pointer。 <!-- comet-task:ab7e1ecc-4709-4df3-bbee-2bfed492b614 -->

## 2. 已有绑定与错误处理

- [ ] 2.1 保留已有 Workspace 的有效登记路径、仓库 ID 和 Verify Profile。验收：增加一份同远端 checkout 后重新接入，原绑定和配置差异正确，缺失路径可定位。 <!-- comet-task:9d72c090-f001-475d-bb44-6cf7e94259a2 -->
- [ ] 2.2 核对排除范围、选择冲突、无效路径和审批期间的目标变化。验收：显式排除可继续，同组重复、越界或替换身份的选择被拦截，目标目录无意外写入。 <!-- comet-task:58a68616-4cf4-4c58-aa57-126d6dbc3232 -->

## 3. 文档与验证

- [ ] 3.1 更新 Init Skill 与项目接入指南，给出可执行的选择示例。验收：文档命令在 Windows 接入实验目录可直接使用，单仓与无冲突多仓仍走一次接入审批。 <!-- comet-task:71d9da2a-d64a-4df1-9069-859e5f6b17ea -->
- [ ] 3.2 验收实际安装包并完成全量检查。验收：Windows 安装包完成重复 checkout 的探测、选定、批准和冷进程复核，仓库全量 Verify 通过。 <!-- comet-task:1e68496f-f11a-4e18-8b6d-80e198e6d7bf -->

```

## openspec/changes/resolve-duplicate-repository-checkouts/.openspec.yaml

- Source: openspec/changes/resolve-duplicate-repository-checkouts/.openspec.yaml
- Lines: 1-2
- SHA256: 4492318684c90914e715dee55afe9b23f60f7465350ada31d1d9437964f126f8

```md
schema: spec-driven
created: 2026-11-26

```

## openspec/changes/resolve-duplicate-repository-checkouts/specs/multi-repository-probe/spec.md

- Source: openspec/changes/resolve-duplicate-repository-checkouts/specs/multi-repository-probe/spec.md
- Lines: 1-18
- SHA256: b10dc91b6e2a47a02114f8cd985355e90e68a4f7203683ecd298338b062ecbc8

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: 探测路径受作用域约束

探测器 MUST 规范化和校验父目录及仓库路径，拒绝路径逃逸、重复身份和无法安全读取的工作树，并返回逐仓诊断。多仓接入 MUST 能将重复身份的有效 checkout 作为待选择的候选事实返回。已解析的仓库快照和后续 Run MUST 保持仓库身份唯一。

#### Scenario: 子目录解析到作用域外

- **WHEN** 符号链接或路径规范化使候选仓库位于指定父目录外
- **THEN** 探测器拒绝该候选并报告路径原因

#### Scenario: 探测多个同远端 checkout

- **WHEN** 两个作用域内的 Git 根规范化为同一远端身份
- **THEN** 多仓接入能得到包含实际路径的冲突组
- **AND** 同一路径的多个别名不会被当成不同 checkout

```

## openspec/changes/resolve-duplicate-repository-checkouts/specs/project-configuration/spec.md

- Source: openspec/changes/resolve-duplicate-repository-checkouts/specs/project-configuration/spec.md
- Lines: 1-29
- SHA256: 6c9bfc2e85ed9ae701b67d1314b7531fd5ecec8b71f881f4b4d9d8e1c17c71d2

```md
# Spec Delta

## ADDED Requirements

### Requirement: 多仓接入显式解决同一远端的 checkout 歧义

多仓接入 MUST 在探测结果中展示同一远端的候选 checkout、实际目录及解决方式。对参与本次接入的远端，候选 MUST 绑定唯一可验证的路径。对已有登记，Repoctopus MUST 优先核对已登记路径；无法核实时报告冲突。正式写入 MUST 绑定原审批所审阅的路径与仓库身份，并在应用前验证。

#### Scenario: 首次接入发现多个 checkout

- **WHEN** 多仓扫描发现两个直接子目录指向同一远端，且没有已登记或明确指定的路径
- **THEN** 探测候选列出同组 checkout 及各自目录，并说明如何选定一项或明确排除整组
- **AND** 未解决且属于接入范围的组不会被静默略过，也不能进入可批准的配置请求

#### Scenario: 用户选择一个 checkout

- **WHEN** 用户通过 Init Skill 或 CLI 指定同组中一个有效目录，或明确限定范围排除整组
- **THEN** 原接入请求只包含最终选定路径及其 Store 绑定计划
- **AND** 批准后仅配置所选仓库，其他 checkout 的文件保持原状

#### Scenario: 已登记 checkout 旁新增另一份克隆

- **WHEN** 一个已有 Workspace 的已登记路径仍可核对为原仓库，且扫描发现同远端的新 checkout
- **THEN** 重新接入保留已登记路径和仓库 ID，并核对现有配置差异

#### Scenario: 路径选择无效或身份变化

- **WHEN** 所选路径越界、同一组选择多个目录、已登记路径无法核实，或审批中的目标不再对应原路径和仓库身份
- **THEN** Repoctopus 报告冲突及重新探测或选择的方法，阻止为该目标写入共享配置或 Store pointer

```
