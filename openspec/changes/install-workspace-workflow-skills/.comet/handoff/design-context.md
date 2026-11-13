# Comet Design Handoff

- Change: install-workspace-workflow-skills
- Phase: design
- Mode: compact
- Context hash: a5bcc438bbd607a309a6ab72e7daa8886648fa78bfe9a98c879f4b52287210a3

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/install-workspace-workflow-skills/proposal.md

- Source: openspec/changes/install-workspace-workflow-skills/proposal.md
- Lines: 1-23
- SHA256: b1333618295f1d133c74392c2c66abd08c7655a476e9f22533931a58f8fdcce0

```md
## Why

Workspace 初始化已能安装工作流入口，但阶段 Skill 正文与资源仍在每次 Work 领取时随 JSON 重复交付，IDE 也不能直接发现这些阶段 Skill。采用 Comet 的本地安装方式，让宿主就近加载已安装的静态 Skill，同时保留 Runtime 对当前 Work 与版本的校验。

## What Changes

- 在获批初始化或补装时，把 Repoctopus 阶段 Action、工作流已采用的 Matt 方法 Skill，以及 OpenSpec Provider 支持的静态 Skill 安装到所选宿主的项目 Skill 目录。
- Runtime 按当前 Work 顺序交付 Skill。可核对实际本地正文和资源时，宿主使用绑定内容身份的引用。无法核对时使用随包正文和资源。
- OpenSpec Provider 继续提供当前 Change 的 Store 路径、模板、操作与产物约束。Matt 参考方法和团队 Skill 继续遵守现有生命周期绑定。
- 验证真实安装包、Windows 宿主发现与调用、跨进程恢复，以及本地缺失、修改或同名覆盖时的安全回退。

## Capabilities

### New Capabilities

### Modified Capabilities

- `project-configuration`：接入或补装时预览并安全安装所选宿主的工作流 Skill。
- `skill-integration`：允许 Runtime 按同一 Work 身份交付可校验的本地引用。

## Impact

涉及 Workspace 接入、宿主 Skill 安装、Runtime Work 领取、入口 Skill、安装包资产和使用文档。多仓项目沿用共享 OpenSpec Store，Verify Profile 继续独立配置。

```

## openspec/changes/install-workspace-workflow-skills/design.md

- Source: openspec/changes/install-workspace-workflow-skills/design.md
- Lines: 1-28
- SHA256: 58cd5a82f38e820c53dbbe61a31b0fae90d3a79cbe39ec6343372b77dd31b9e5

```md
## Context

Comet 将静态阶段 Skill 与所选外部方法安装到宿主目录，由 Runtime 指定当前 Action。Repoctopus 已有按宿主安装 Workspace 入口的审批及恢复机制，也已有冻结 Work packet、团队 binding 和 OpenSpec Provider 工件协议。阶段正文现由 Work packet 直接交付。

## Goals / Non-Goals

**Goals**

- 初始化后可在已选择的 IDE 中发现项目级工作流 Skill。
- 在能确认实际来源和内容的宿主中减少重复传输，并在切换进程和版本变化时保持同一 Work 身份。

**Non-Goals**

- 扩大 Matt 工作流方法集合、任意替换阶段 Action、复制 OpenSpec 规划权威或在业务仓批量安装 IDE 文件。
- 改动 Verify Profile 的单独配置流程。

## Decisions

1. 复用 Workspace 入口的宿主路径、接入候选和批准范围。静态资产由 Repoctopus Action、已采用的 Matt 方法及所用 OpenSpec Provider 提供，维护各自来源和版本。补装沿用 Workspace 接入的只补 Skill 能力。
2. 保留 Runtime 已冻结的组合、正文、资源和消费回执身份。在领取的宿主交付边界选择引用或完整正文，回退沿用原 Work。引用绑定来源及正文、资源身份，当前 Action 仍由 Runtime 选择。
3. 仅按 Skill 名称调用而无法确认实际读取来源的宿主，使用现有正文交付。项目文件经过校验、宿主实际使用该内容后才回报当前层已消费。
4. OpenSpec 动态路径、模板与操作约束继续作为当前 Work 的 Provider 层交付。静态 Skill 作为项目工具入口。

## Risks / Trade-offs

- IDE 的同名解析和来源可见性不同。验收逐宿主核对并报告实际使用的交付方式。
- Git 行尾、工作区链接、本地修改和资源缺失可能影响同一内容的判定。设计阶段明确规范化与资源校验规则，验收覆盖回退与冷恢复。
- 当前 Change 以未合入的宿主扩展为基底，同时包含最新 main 的 Windows 安装修复。两项交付按依赖顺序处理。

```

## openspec/changes/install-workspace-workflow-skills/tasks.md

- Source: openspec/changes/install-workspace-workflow-skills/tasks.md
- Lines: 1-15
- SHA256: b5638e7f58b0b5d47d8e17e73fd36050f34c55d0a1d02fa45715d378ce90accb

```md
## 1. 静态 Skill 安装

- [ ] 1.1 建立可安装资产清单并复用宿主路径映射，核对每项来源和资源。验收：已采用的方法可发现，参考方法未进入执行目录。 <!-- comet-task:b30fee67-c8f6-4767-b1c7-2ec15ea6bade -->
- [ ] 1.2 将文件纳入初始化和既有 Workspace 补装预览，绑定批准、冲突检测与中断恢复。验收：所选宿主正确写入，团队文件和业务仓原状保留。 <!-- comet-task:c72c192a-19f0-44d7-bf15-5164c4dbdba9 -->

## 2. Runtime 与宿主交付

- [ ] 2.1 为支持来源校验的宿主交付当前 Action 的有序 Skill 引用。验收：匹配正文和资源时，交付视图省去相应静态内容，保持原 Work 身份。 <!-- comet-task:0364c4a2-92fb-4e5c-ba62-5564dc2c1184 -->
- [ ] 2.2 实现入口加载与同一 claim 的内容回退。验收：本地缺失、篡改、重名、无法证明来源和换进程恢复时，使用原冻结内容或给出明确阻断。 <!-- comet-task:d0614843-4391-4202-8077-917c24f8429d -->
- [ ] 2.3 核对 OpenSpec Provider、团队绑定和消费遥测。验收：动态工件协议完整，未消费的层不会因安装、调用成功或 Work 成功被记录为已消费。 <!-- comet-task:2be001be-36ee-41e1-84ff-e39fa4bafcf9 -->

## 3. 验收与说明

- [ ] 3.1 更新接入和 Skill 文档，说明安装位置、升级与回退。验收：初次接入与已接入团队有可执行步骤。 <!-- comet-task:bbc7801a-fd74-436d-9351-8b522b2c6605 -->
- [ ] 3.2 用实际安装包验证多仓接入、原生宿主发现/调用、完整冻结回退及进程恢复。验收：逐宿主记录能否验证来源、采用的交付方式和证据。 <!-- comet-task:7df9035b-3223-4029-a5bb-f7e571189e5f -->

```

## openspec/changes/install-workspace-workflow-skills/.openspec.yaml

- Source: openspec/changes/install-workspace-workflow-skills/.openspec.yaml
- Lines: 1-2
- SHA256: 3ea192d12c1ad3d96d8e6cfd6fddb23c8be77d85611385996b685b4736c117c0

```md
schema: spec-driven
created: 2026-11-13

```

## openspec/changes/install-workspace-workflow-skills/specs/project-configuration/spec.md

- Source: openspec/changes/install-workspace-workflow-skills/specs/project-configuration/spec.md
- Lines: 1-21
- SHA256: 6dd12070b14055e62d068604bd9768e79ea15f1fcb79bf3af6112b1545335158

```md
## ADDED Requirements

### Requirement: Workspace 接入安装工作流静态 Skill

Repoctopus MUST 在初始化和已接入 Workspace 的补装预览中列明所选宿主的静态 Skill 安装目标。获批后 MUST 在 Workspace 内安装阶段 Action Skill、已被工作流采用的 Matt 方法 Skill、所用 OpenSpec Provider 支持的静态 Skill 与其必要资源，并在报告完成前校验受管安装结果。

#### Scenario: 初始化单仓或多仓 Workspace

- **WHEN** 用户批准单仓或多仓接入及所选宿主
- **THEN** 安装目标位于 Workspace 内对应的项目 Skill 目录，宿主的新会话可以发现 Skill
- **AND** 多仓业务仓与用户级目录的 Skill 文件保持原状，接入可以在尚未配置 Verify Profile 时完成

#### Scenario: 预览、冲突或中断

- **WHEN** 接入尚未批准、目标存在同名团队文件或已被修改，或写入中断
- **THEN** 预览不写入目标，冲突保留现有文件并报告位置，中断后同一获批请求只补齐尚未完成的目标

#### Scenario: 已接入 Workspace 补装静态 Skill

- **WHEN** 团队批准对现有 Workspace 补装所选宿主的 Skill
- **THEN** 安装只物化所选受管文件，已有 Store、团队绑定与 Run 继续使用原有身份

```

## openspec/changes/install-workspace-workflow-skills/specs/skill-integration/spec.md

- Source: openspec/changes/install-workspace-workflow-skills/specs/skill-integration/spec.md
- Lines: 1-62
- SHA256: 9fe4d33e6e865dd9495be548990edead7d4aae24fa9fbecf9be4fd5ab996bba3

```md
## MODIFIED Requirements

### Requirement: Skill 正文必须由当前 Work 的 Host 实际消费

Repoctopus MUST 从冻结的 Provider 身份解析 Action 与 augmentation Skill 正文和必要资源。Runtime MUST 给唯一的执行 Host 提供随包内容或绑定本地来源与内容身份的引用。仅当宿主能核对其实际装填的正文与资源时，才可用引用装填。引用无法核对时，宿主 MUST 使用同一 Work 的冻结随包内容。名称、路径、digest、安装结果或成功调用不能单独证明 Skill 已装填或已使用。

#### Scenario: Build Skill 已绑定但正文未交付

- **WHEN** Run 含 `tdd` 与代码边界 Skill snapshot，但 Host 只收到名称和 digest
- **THEN** Runtime 不得将其视为已交付正文，宿主须获取同一 Work 的完整内容后执行及报告消费

#### Scenario: Host 收到固定组合

- **WHEN** 当前 Work 的所有 Skill 和 Specification 指令均与冻结 identity 一致
- **THEN** Host 按 definition 顺序装填完整内容，消费事实绑定执行包 digest 和当前 claim

#### Scenario: 宿主可以核对实际装填的本地 Skill

- **WHEN** 当前 Work 的已安装静态 Skill 的实际来源、正文及资源与冻结身份一致，且宿主能按该来源装填
- **THEN** Runtime 可以在交付视图中用绑定引用表示该层，宿主按原有组合顺序装填并在实际消费后报告当前 claim 与 packet 对应的层摘要

#### Scenario: 仅支持按名称加载或安装内容漂移

- **WHEN** 宿主不能核对实际加载来源，或本地 Skill 缺失、已修改、资源不匹配、被同名 Skill 覆盖
- **THEN** 宿主获取原 Work 的冻结正文和资源，使用原 claim、packet 与层身份，无法获取完整冻结内容时停止当前 Action
- **AND** 宿主不得仅凭 Skill 名称、路径、安装清单或工具成功回报消费

### Requirement: 宿主仅装填 Runtime 指定的当前 Action Skill

对已领取的可执行 Action，Runtime MUST 给执行宿主交付当前 claim 绑定的有序内容或可验证本地引用。宿主 MUST 装填当前 Action 的真实 Skill 内容、必要资源及按序交付的受管层，并只对实际装填的层回报消费。宿主 MUST 按 Runtime 指示处理人工决定、等待、待核对或完成状态；不得根据阶段名称、同名 Skill 或旧执行包选择执行内容。

#### Scenario: 从 Open 推进到 Design

- **WHEN** 同一 Run 的 Open Outcome 被接受且人工批准完成，Runtime 返回 Design Action
- **THEN** Open 与 Design 各自只装填已经领取的当前 Action 与对应组合，消费回执绑定各自的 claim 及执行包
- **AND** 两个阶段所需的 OpenSpec Store 位置、模板、操作与产物约束仍从当前 Specification Provider 取得

#### Scenario: 当前内容无法装填

- **WHEN** 宿主无法获取必要内容，或拿到其他 Action、旧 attempt 的执行包
- **THEN** 宿主报告缺口并停止当前 Action，不回报未消费内容

#### Scenario: 换进程恢复时本地内容变化

- **WHEN** 冷恢复原 Run 时本地已安装 Skill 的内容、资源或宿主能力发生变化
- **THEN** Runtime 保持原 Work 的内容与身份，按需要交付原来绑定的随包内容，旧 attempt 的回执不得用于当前 Action

#### Scenario: 恢复时存在待决定项或未知结果

- **WHEN** Runtime 返回人工决定、等待、待核对或已完成
- **THEN** 宿主处理该返回状态，保持原 Action 的执行权与恢复语义

## ADDED Requirements

### Requirement: 已安装的方法 Skill 遵守工作流权威

安装的 Repoctopus Action 与 Matt 方法 Skill MUST 服从当前 Runtime Work、能力与写入约束。OpenSpec 静态 Skill 的宿主可发现性 MUST NOT 替代运行时 Provider 工件协议。仅作为方法参考的 `to-spec`、`to-tickets` 不得以工作流执行 Skill 形式安装。

#### Scenario: 团队启动多仓 Change

- **WHEN** Workspace 已安装宿主 Skill，团队使用共享 OpenSpec Store 进入工作流
- **THEN** Runtime 依现有团队绑定决定当前组合，OpenSpec Provider 继续提供动态工件协议与唯一规格权威

```
