# Comet Design Handoff

- Change: simplify-workspace-init
- Phase: design
- Mode: compact
- Context hash: 77e7eca956bd85c110c40590c79d4baf3f1befc3d1fe4d2901e11e9f21e3e4c3

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/simplify-workspace-init/proposal.md

- Source: openspec/changes/simplify-workspace-init/proposal.md
- Lines: 1-26
- SHA256: 44bb1283ebd0d7c24bcf39c05722d8e40f788f684df65bda722695f1c5be49aa

```md
# Proposal

## Why

首次接入需要用户转交探测草稿、让 Agent 生成候选文件、在终端运行准备和审批命令。GitHub #85、#86 暴露了草稿和候选混用，以及普通子目录被误当成 Workspace 后直到批准才失败的问题。初始化同时要求推断构建和测试命令，用户因此在创建第一个 Change 前就得完成团队验证配置。

## What Changes

- 提供安装后可发现的个人级 `repoctopus-init` Skill。用户在宿主一次调用中完成单仓或多仓接入，审阅并确认一份可见的初始化计划。
- 接入仅确定 Git 仓库、Workspace、Store 和必要入口。Runtime 校验真实 Git 根、所选仓和审批输入，直接生成可审阅候选。错误布局、缺失绑定和输入类型错误在审批前得到具体诊断。
- 提供单独的 `repoctopus-configure-verify` Skill。用户需要时再确认构建、测试和 Acceptance coverage，把通过校验的 Profile 写入共享配置。
- 无 Verify Profile 的 Workspace 可以启动 Change、完成 Open、Design 和 Build。需要 Profile 时 Runtime 在同一 Run 给出可恢复的等待和配置指引。配置获批后继续真实 Verify 并满足门禁才可归档。
- 保留已有团队配置、Store 和有效证据，更新安装指引与 Workspace 本地引导。

## Capabilities

### Modified Capabilities

- `project-configuration`：最小候选、有效 Workspace Git 根、接入批准、按需更新验证配置。
- `skill-integration`：接入前可发现的 Init Skill 和独立的 Verify 配置 Skill。
- `implementation-evidence`：区分已配置 Profile 的 Design 预检与未配置时的显式延期。
- `change-lifecycle`：缺少 Profile 的 Run 可开始开发并在 Verify 边界恢复。

## Impact

涉及公开 CLI、接入配置 Schema、审批接口、入口资产、Design 预检与 Verify continuation。首批覆盖 Codex 和 OpenCode。CodeBuddy、CodeArts 和 TRAE 由 `extend-workspace-skill-hosts` 交付。本次保留 OpenSpec Store、五阶段和有效 Evidence 门禁。参考 Comet 的个人级与项目级入口安排，产品实现沿用 Repoctopus 公共接口，无第三方源码复制或许可证变更。

```

## openspec/changes/simplify-workspace-init/design.md

- Source: openspec/changes/simplify-workspace-init/design.md
- Lines: 1-58
- SHA256: 4f5bf26d2a34e59af905ae9e25f15817fcd37155284811a34689f5d822469751

```md
# Design

## Context

接入逻辑当前把 Git/Store 探测、构建命令推断和共享配置审批放在一起。共享配置拒绝空 Profile，Design preflight 又默认编译 `verify`。Build Check 的当前接受路径在持久化通过事实前会先编译 Verify、冻结输入和准备下一份 Work。除此之外，完整有效配置摘要被放进 `delivery-file` 的组合配置，而 FileDeliveryProvider 实际没有消费这个字段。补加 Profile 因而还可能造成受保护组合被误判为变化。Git Build checkpoint 绑定精确仓库 HEAD，提交 Verify 配置也需要独立验证。

## Goals / Non-Goals

- 用户在尚未接入的项目显式调用一次 Init，通过宿主看见并决定同一份接入计划。单仓、同级多仓均可用。
- 首次接入只需 Git 仓库与 Store，已有团队配置可继续使用。Verify 配置按需执行。
- 在最小 Workspace 上完整开发并保留 Build 结果，缺 Profile 时从原 Run 恢复。正式交付仍以当前 Evidence Gate 为准。
- 本 Change 的宿主验收覆盖 Codex 和 OpenCode。CodeBuddy、CodeArts 和 TRAE 由另一个 Change 实现。保留 OpenSpec 规格权威和五阶段。手工证据交付留给独立需求。

## Decisions

### 1. 入口安装与一次宿主交互

将个人级 `repoctopus-init` 与项目级 `repoctopus`、`repoctopus-configure-verify` 作为安装包内的受管资产。安装指引提供一次显式的宿主选择和个人级 Init 安装。范围限定所选宿主的入口文件，安装目标预览及冲突处理复用受管资产规则。Workspace 接入仅计划项目级入口，由原接入请求批准后应用。Comet 0.5.1 的项目级与个人级安装分工解决同样的首次发现问题。

CLI 增加一个把最小探测和准备串联的 Init 入口，返回结构化计划与待决定请求。已有 `project detect/prepare/review` 仍供终端和调试使用，同一服务负责候选和请求；命令参数以实际 argv 传递。宿主显示仓库、Store、拟写入文件和影响，并通过与 `run decision` 类似的公开请求读取和 response-file 协议回传真实选择。共享请求解码方式，审批绑定具体请求、候选摘要、作用范围和本机调用身份。终端入口可处理同一请求，无法收集选择时保持待确认。配置变更、请求或 Workspace 身份不符时拒绝。批准后复用现有 Intent/Receipt；同一请求中断后可重试。

### 2. 最小候选由 Runtime 构造

单仓直接核对指定目录的真实 Git 根，多仓复用同级探测并限制到用户确认的仓库。布局可确定时只展示一个计划；不明确时列出真实可选仓库。普通业务仓子目录、未选中的 Workspace Git 根、重复仓库身份或不同 checkout，分别给出可操作诊断。探测草稿与共享候选继续用不同的 `kind`；误传完整探测草稿时输出候选位置和用法。

最小共享配置包括 Workspace、仓库、OpenSpec Store 和合法的空 `profiles`。项目探测读取 Git 与 Store 状态。已有 Profile 和其他团队字段从当前配置保留，初次接入无需推断构建命令。准备请求时验证探测所得 Store binding 必须存在且匹配；批准前再观察根和候选基线。Store Bootstrap、业务仓 pointer 和入口写入继续走原有事务。单纯补齐入口时复用已有健康 Store。

### 3. Verify Profile 有独立的作用域

已接入 Workspace 显式调用 Verify 配置 Skill，读取选定仓的构建和测试证据，核对实际执行命令和覆盖范围。编译检查依赖、必需节点和 coverage 结构，显示目标 Profile 前后差异。配置服务以当前共享配置为基线，只批准并写入目标 Profile，复用候选摘要、可信选择和原子写入。具有现有 Run 时，先提供该 Run 的 Acceptance 预检反馈。未命中的选择器、只有 optional 覆盖、请求漂移和候选越权都需明确诊断。用户完成批准并按团队 Git 流程提交后，通过原 Run 继续；此配置过程复用已接入 Store。

### 4. Build Check 完成和 Verify 准备使用两个 Runtime 观察

Comet 0.5.1 在 Build Check Evidence 后派发独立 Verify Action。借鉴这个顺序，复用 Repoctopus 已有的 Build checkpoint、Build Check Evidence 与 continuation。Build Check 在当前 invocation 和精确 checkout 上验证，先持久化接受、已完成工作包和原 checkpoint。随后通过 Runtime 观察准备当前 Verify 输入，现有 `build.verification-blocked`/准备验证入口可承载待配置状态，`build.validated` 仍在输入具备后进入 Verify。持久化通过事实、接受回执与可恢复状态时使用现有事务边界。Verify 计划具备的路径同一次 `next` 可继续派发。配置、重试、失败诊断的投影均由 Runtime 生成。

Design 冻结 Acceptance Set。已配置的选定 Profile 使用原有精确 coverage preflight；只在默认 Profile 尚未配置且用户未指定其他 Profile 时延期。Build 完成后，缺少 Profile 或当前 coverage 无法满足时保持可恢复，返回配置 Skill 指引。用户完成配置后，对当前 Profile 重新使用同一 coverage resolver，再创建 Verification Input、派发原有 Verify Work。已冻结的 Verify 与 Archive 仍走现有证据有效性规则。

### 5. 在原 Run 中核对哪些输入确实变化

- 当前 `loadChangePlanningBase` 读启动时的配置摘要，`EvidenceCoordinator` 则读取当前配置。原启动基线保留在 Run；冻结 Verify 时绑定实际编译的 Profile、Acceptance、仓库、当前相关配置及 Evidence fingerprint。在 Verify repair、归档和发布入口继续核对这一当前身份。
- `delivery-file` 当前将整个配置摘要计入保护组合身份，但实现从配置只消费工作区和 GitHub 凭据设置，并从操作参数读取实际交付策略。移除未被该适配器使用的全配置注入，实际消费的配置和归档输入仍参与相应身份。用 Profile、交付策略、凭据、插件配置分别变化的用例验证作用域。
- 对 Build Check 之后的正常配置提交，复用 Workspace binding 和恢复分类。继续前核对同一分支、worktree、仓库、Plan、Store、已接受 Check 与配置审批回执。只有能证明从已接受 HEAD 延续且变更限定于获批的 Verify Profile 时，接受新 HEAD 作为当前观察，保留历史 Check 与工作包。混有产品、规格、Store、隔离策略或不明变更时走原恢复分类。实际 checkout 授权和 Verify 声明的显式 Git 输入继续参与校验。
- 记录缺 Profile、配置获批、重观察和 Verify 派发的已有 trajectory/OTLP 事实。重复调用、并发和中断从存储事实恢复，避免重提 Build Check、重复发放审批或派发两个 Verify Work。

### 6. 验证路径

| 入口 | 必测事实 |
| --- | --- |
| 已打包 Windows CLI 与真实 Codex/OpenCode | 未接入时发现个人级 Skill。含空格路径的单仓和同级多仓在一次宿主交互完成。真实拒绝保持原状，认可后写入最小配置和项目入口。 |
| 接入负例 | 重放 #85/#86。错误 argv、错传草稿、普通子目录、缺 binding、已被登记的其他 checkout 有不同诊断。审批之前没有 Store 写入。 |
| 最小配置的真实多仓 Run | 公开 CLI 走到 Build Check，通过后退出进程。换进程读到同一待配置状态。批准真实 Profile、正常 commit/push，再换进程继续，仍有效的工作包和审批保持原身份。Verify 生成当前有效 Gate，真实 Archive 完成。 |
| 恢复与已有团队 | 覆盖并发或中断、无关配置与真实代码/branch/Store 漂移、已有有效 Profile 直通、已有 coverage 不足在 Design 阻断、无有效证据时拒绝 Archive。 |

## Risks / Trade-offs

- 采用延后验证配置，使用者可以开始开发，覆盖缺口必须在交付前解决。备选是强制开工前配置，接入会重新暴露当前阻塞。引入新的手工证据来源会扩大正式门禁范围。
- Profile 更新同时影响 Git 和配置身份。兼容性比较、Build workspace recovery 和 Evidence fingerprint 要各自复验，单纯用文件名、HEAD 相等或修改后的配置摘要都不足以判定。
- 老版配置已有 Profile 时沿用现有使用路径。当前产品版与候选版本间状态采纳沿用已有兼容性合同，只按真实先前状态和边界证明。实现方案与正式规格或公开宿主约束冲突时先回到 Design 核对。

```

## openspec/changes/simplify-workspace-init/tasks.md

- Source: openspec/changes/simplify-workspace-init/tasks.md
- Lines: 1-22
- SHA256: af1afaf016453f7f7fc92ffa1813f48f9afabff2a256ddeddd856d0c2ac94421

```md
# Tasks

## 1. 单仓入口与最小接入

- [ ] 1.1 交付个人级 Init Skill、公开的接入调用和选择入口。验收：从仅安装发布候选包的 Codex 和 OpenCode 新项目原生调用，单仓各显示一个真实接入计划。 <!-- comet-task:221ece0e-1c4e-46fd-b406-ee6a61837f96 -->
- [ ] 1.2 分离仓库与 Store 接入和 Verify 配置。验收：没有构建文件、测试命令或 Profile 的 Git 根可以获批接入，生成可启动 Run 的配置、OpenSpec Store 与受管入口。 <!-- comet-task:e3f222c2-b3f5-4982-8656-2173ee2bc362 -->
- [ ] 1.3 保护接入审批与可恢复写入。验收：拒绝或输入变化时不改正式配置，中断从原请求恢复，已有团队内容和 Profile 保留。 <!-- comet-task:3d692f8f-c039-4200-91d0-3a2305f4c2bc -->

## 2. 多仓与错误诊断

- [ ] 2.1 实现同级多仓选择与 Git 根核对。验收：仅选中仓进入实际接入计划，业务仓普通子目录和未包含 Workspace 根的扫描在审批前得到可操作诊断。 <!-- comet-task:0a7c2aea-90c2-4794-ac35-a39465562523 -->
- [ ] 2.2 区分草稿、候选、缺失 Store binding 和不同 checkout。验收：复现 #85、#86 的路径、错传文件和绑定错误，检查输出指向正确恢复操作，验证 PowerShell 带空格路径。 <!-- comet-task:832f3936-d3e2-4661-b490-d57f755dae98 -->

## 3. 按需配置与同一 Run 验证

- [ ] 3.1 交付独立 Verify 配置 Skill。验收：用户看到从真实仓库确认的命令、范围和覆盖，拒绝保持配置不变，批准仅更新目标 Profile，optional-only 覆盖被拒。 <!-- comet-task:16258cfc-0213-4eb5-a612-0d697cf1288b -->
- [ ] 3.2 接入没有 Profile 的开发与验证等待。验收：同一 Run 经过 Open、Design、Build，保留 Acceptance Set 和 Build Check，缺少 Profile 时得到可恢复入口且 Archive 被拦截。已有无效 Profile 仍按原规则在 Design 报错。 <!-- comet-task:6a8b8234-a771-4429-bca1-26e4075ce0e5 -->
- [ ] 3.3 实现并验证配置后恢复。验收：从新进程恢复同一 Run，补配及正常提交共享配置后保留仍有效的工作包和审批，通过真实 Verify 与 Archive；实际代码、仓库或规划变化按现有分类生效。 <!-- comet-task:a119dec8-ae7c-4372-bf7c-5bd012660419 -->

## 4. Windows 安装包验收

- [ ] 4.1 更新安装说明和生成的本地引导。验收：新人从发布候选包和独立单仓或多仓项目能完成对应流程，验收记录包含宿主实际装填、Run 状态和证据身份。 <!-- comet-task:4f06016a-649f-472b-8adf-3c356f795088 -->

```

## openspec/changes/simplify-workspace-init/.openspec.yaml

- Source: openspec/changes/simplify-workspace-init/.openspec.yaml
- Lines: 1-2
- SHA256: 81efc95b309487579cc63ceff200744cbd9fab2401597cbbdcf38d0cb54bace8

```md
schema: spec-driven
created: 2026-11-12

```

## openspec/changes/simplify-workspace-init/specs/change-lifecycle/spec.md

- Source: openspec/changes/simplify-workspace-init/specs/change-lifecycle/spec.md
- Lines: 1-19
- SHA256: 8b898f74ad3a788bf30a97430b41a19b617e0b2871a939470f073a2b419023d7

```md
# Spec Delta

## ADDED Requirements

### Requirement: 首次配置 Verify Profile 可从原 Run 继续

Runtime MUST 允许最小 Workspace 的 Change 通过原有 Open、Design 和 Build 门禁。选定 Verify Profile 尚未配置时，Runtime MUST 在需要正式验证的边界保留原 Run 并返回可执行的配置指引。批准配置后 MUST 从同一 Run 继续验证，按真实依赖保留仍有效的批准、Plan 和 Build 完成事实。进入 Archive MUST 具有当前有效 Acceptance Gate。

#### Scenario: 未配置 Verify Profile 时完成 Build

- **WHEN** 最小 Workspace 的 Change 已满足 Build Check，选定 Verify Profile 缺席
- **THEN** Runtime 返回可恢复的待配置状态
- **AND** 不创建假 Evidence、不进入 Archive、不重置有效 Build 成果

#### Scenario: 从新进程恢复同一 Run

- **WHEN** 用户批准添加选定 Profile，正常提交配置，然后从新进程恢复
- **THEN** Runtime 从原 checkpoint 冻结当前真实 Verification Input 并执行验证
- **AND** 有效工作包保持完成，真实仓库、规划或实现漂移仍按正常规则处理

```

## openspec/changes/simplify-workspace-init/specs/implementation-evidence/spec.md

- Source: openspec/changes/simplify-workspace-init/specs/implementation-evidence/spec.md
- Lines: 1-39
- SHA256: ff78b492f5b44c3928cd919e24f9ee6dcf0285a177a9e15e7148a931db521876

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: Evidence Profile 编译完整 Acceptance Coverage Plan

用于 Change Verify 的 Evidence Profile MUST 显式声明 required 节点覆盖的 Acceptance selector，并在执行任何节点前解析为绑定完整 Acceptance Set、Profile plan、仓库和配置摘要的不可变 coverage plan。缺失、未知、重复或仅由 optional 节点覆盖的 Acceptance MUST 阻断执行。Design 规格与 Tasks 冻结后，已配置的选定 Profile MUST 使用相同确定性 resolver 做只读 preflight，之后复核 Planning Manifest identity；最小配置尚未配置默认 Profile 时 MUST 记录待配置事实并保留原 Acceptance Set；显式指定不存在的 Profile MUST 返回可定位配置错误。此预检不得执行 Evidence 节点、创建 Attempt 或计算正式 Verify 仓库 fingerprint。

#### Scenario: Profile 没有覆盖 UI Acceptance

- **WHEN** Design Tasks 包含 UI Acceptance，但已选 Profile 的 required 节点没有覆盖它
- **THEN** Runtime 在建立 Build Work 前保持 Design，报告未覆盖的 Acceptance identity

#### Scenario: 共享 Profile 显式覆盖全部 Acceptance

- **WHEN** 已选 Profile 的 required 节点覆盖全部 Acceptance
- **THEN** Design preflight 解析每条 Acceptance 的节点映射
- **AND** Verify 继续将有效映射和真实执行输入固定进 Verification Input

#### Scenario: 选定 Profile 尚未配置

- **WHEN** 用户以最小 Workspace 配置开始开发，未显式指定 Profile 且默认 Profile 缺席
- **THEN** Runtime 允许进入 Build 并保留已确认的 Acceptance Set
- **AND** 进入正式验证前使用同一 resolver 编译已批准 Profile，缺失或覆盖不足时不执行节点、不发放 Gate

#### Scenario: preflight 期间 Planning Manifest 漂移

- **WHEN** Runtime 发现 Tasks 或其他受保护规划产物的 semantic digest 已变化
- **THEN** Runtime 丢弃此次预检并保持 Design，从当前规划重新观察

#### Scenario: coverage 只由 optional 节点声明

- **WHEN** 已选 Profile 的 coverage 只由 optional 节点声明
- **THEN** Design preflight 拒绝继续，不创建 Build Work，也不把 optional 结果提升为正式证据

#### Scenario: 修正 Profile 后重试 Design

- **WHEN** 已配置 Profile 的覆盖只来自 optional 节点或不完整，之后获批修正
- **THEN** Runtime 从原 Design checkpoint 重试预检并保留有效 Host Work

```

## openspec/changes/simplify-workspace-init/specs/project-configuration/spec.md

- Source: openspec/changes/simplify-workspace-init/specs/project-configuration/spec.md
- Lines: 1-66
- SHA256: 248dcb728ece9e7d22d6836636aa56972b2317e117d8a4cb3ecf48e9200b714b

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: 项目探测只生成候选草稿

接入探测 MUST 只读检查显式范围内的 Git 仓库、Workspace Git 根与 Store，在本地生成最小可审阅候选，正式共享配置保持原状。首次接入 MUST 独立于构建文件识别、测试命令推断和 Verify coverage 配置。已接入 Workspace 的候选 MUST 保留已配置的 Profile 和不在本次更新范围内的共享字段。

#### Scenario: 首次探测项目

- **WHEN** 用户在单仓业务 Git 根或独立的多仓 Workspace 选择接入
- **THEN** Repoctopus 根据所选布局生成含明确 Git 根、仓库及 Store 的接入候选
- **AND** 无可识别的构建文件或 Verify Profile 时仍可准备审批

#### Scenario: 无效 Workspace 布局

- **WHEN** Workspace 是业务仓普通子目录，或扫描范围中无法识别所选 Workspace Git 根
- **THEN** Repoctopus 在审批前报告实际路径、预期布局和恢复操作
- **AND** 不生成缺失 Store binding 的可批准接入请求

#### Scenario: 已存在共享配置

- **WHEN** 用户重新运行接入或补齐受管入口
- **THEN** Repoctopus 输出相关 diff 并保留已有 Verify Profile 和其他未授权修改的配置

### Requirement: 用户确认后才能写入共享配置

Repoctopus MUST 把候选、作用范围及现有配置差异作为 Human Decision 输入，只有可信用户确认后才生成或更新 `repoctopus.yaml`。首次接入 MAY 无 Verify Profile；配置一个 Verify Profile 时 MUST 校验其结构和 required coverage 声明。已选 Profile 的 Run coverage 校验沿用 Evidence 权威。

#### Scenario: 首次调用的接入确认

- **WHEN** Runtime 已形成包含 Workspace、仓库、Store 和入口目标的有效候选
- **THEN** 用户在同一宿主调用中审阅一次计划并选择
- **AND** 可信批准后 Runtime 应用同一请求，无需用户搬运草稿或候选路径

#### Scenario: 没有可信确认通道

- **WHEN** Runtime 未获得可信批准
- **THEN** 接入或配置请求保持待确认，正式配置保持原状

#### Scenario: 传错候选或缺少绑定

- **WHEN** 用户把探测草稿交给候选参数，或请求缺少可验证的 Workspace Store binding
- **THEN** Repoctopus 在审批前报告对应的输入或绑定错误，并引导重新获取正确候选

#### Scenario: Verify Profile 没有 required coverage

- **WHEN** 候选 Verify Profile 没有声明非空 coverage 的 required 验证节点
- **THEN** Repoctopus 在写共享配置前报告缺少 required coverage

#### Scenario: 前置节点不直接覆盖 Acceptance

- **WHEN** Profile 有带 coverage 的 required 验证节点，且有服务或准备节点不直接覆盖 Acceptance
- **THEN** 静态校验接受该结构，精确覆盖由当前 Run 的 preflight 校验

## ADDED Requirements

### Requirement: Verify Profile 可按需独立配置

Repoctopus MUST 提供独立 Verify 配置流程，在用户选定范围内检查实际命令和 Acceptance coverage，展示 Profile 变更，经可信批准后更新共享配置。生成的 required 检查 MUST 明确声明 coverage，推断的 coverage MUST 作为待确认内容。此流程 MUST 保留 Workspace、Store、其他共享配置和既有 Run。

#### Scenario: 初始化后补配 Verify

- **WHEN** 已接入 Workspace 的用户调用 Verify 配置流程
- **THEN** Repoctopus 展示拟用的命令、仓库和覆盖范围
- **AND** 仅获批后更新相关 Profile，返回当前 Run 的继续方式（如有）

```

## openspec/changes/simplify-workspace-init/specs/skill-integration/spec.md

- Source: openspec/changes/simplify-workspace-init/specs/skill-integration/spec.md
- Lines: 1-18
- SHA256: 51f874df4008a2232b511033af3624916dcbf1167db7f7aed8afa694c640f952

```md
# Spec Delta

## ADDED Requirements

### Requirement: 宿主提供首次接入与 Verify 配置 Skill

Repoctopus MUST 随可安装 CLI 分发宿主可显式调用的 Init 和 Verify 配置 Skill。Init MUST 可在没有项目级入口或 `repoctopus.yaml` 的宿主中发现。Verify 配置入口 MUST 可在已接入 Workspace 单独调用。宿主通过公开接口调用 Runtime，可信用户选择和结果保持绑定原请求。

#### Scenario: 未接入项目调用 Init

- **WHEN** 用户在已安装个人级入口的 Codex 或 OpenCode 中请求 Repoctopus init
- **THEN** 宿主启动单仓或多仓接入，展示 Runtime 预览、提交实际决定并报告结果
- **AND** 接入本身不要求用户执行中间终端命令或编辑候选文件

#### Scenario: 已接入项目配置 Verify

- **WHEN** 用户在已接入 Workspace 明确调用 Verify 配置 Skill
- **THEN** 宿主使用独立公开接口配置 Profile，并沿 Runtime 指引恢复原 Run（如有）

```
