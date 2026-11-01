# Comet Design Handoff

- Change: stabilize-host-owned-input-boundary
- Phase: design
- Mode: compact
- Context hash: 085ac2a9c558ab44428343492ada8a66292268edc25fc3710fadbfa4929edd43

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/stabilize-host-owned-input-boundary/proposal.md

- Source: openspec/changes/stabilize-host-owned-input-boundary/proposal.md
- Lines: 1-36
- SHA256: 09baf893a6038871991dc4581cfa9f4316f41befff0d2844a4e28dd5979efa03

```md
# Proposal

## Why

Repoctopus 当前把 Git 仓库中所有未忽略的未跟踪文件都计入 Evidence 仓库指纹，同时架构检查又按物理路径存在性拒绝 `.codex` 等旧工作流目录。外部 Host 或控制器在仓库旁安装 Hook、Skill、规则和锁文件后，即使产品源码没有变化，也会导致 `npm run verify` 失败，或在 Verify 到 Archive 之间造成输入指纹漂移。上一轮自举只能临时移走 `.codex` 才能继续，说明产品输入与执行控制面输入尚未形成稳定、可复现的边界。

简单把这些文件加入 `.gitignore` 或从指纹中全部排除并不安全：`AGENTS.md`、Skill、Hook 和锁文件会影响 Agent 实际执行，若不绑定其内容，Evidence 就无法证明由哪套执行方法产生。本 Change 需要把两类输入分区并分别内容寻址，使 Host 文件可以稳定存在，同时仍然 fail-closed。

## What Changes

- 建立版本化 Repository Input Policy，把仓库内容分为产品输入、已登记的 Host/控制面输入和未知输入。
- 产品输入继续绑定 HEAD、tree 和实际未提交内容；未知未跟踪文件继续进入 dirty fingerprint，不得被宽泛忽略。
- 只有显式登记、未被产品 Git tree 跟踪且不进入发布包的 Host 输入可以离开产品 dirty 集；其实际内容、类型和 Provider/策略身份必须进入独立的 control-plane manifest digest。团队有意跟踪的 `AGENTS.md` 或 Skill 仍按产品输入取指纹，不被控制面规则排除。
- `.codex`、`.agents`、`AGENTS.md`、Skill lock 和类似执行输入不得被静默丢弃；内容或策略变化会使 Evidence、Verification Input 和复用结果失效。
- 调整旧工作流架构检查：拒绝产品跟踪面、生产源码和发布包中的旧路径或标记，而不是仅因本机存在未跟踪 Host 安装目录就失败。
- 对外部独占路径进入产品面、未知路径、符号链接逃逸、目录竞态和策略漂移保持 fail-closed，并提供有界诊断。
- 增加真实自举验收：Host 文件在整个 Verify→Archive 窗口内保持原位即可通过；修改 Host 输入、把它加入产品 tree 或引入未知文件时必须使旧 Evidence 失效或门禁失败。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `implementation-evidence`：把产品仓库指纹与内容寻址的控制面输入共同绑定到 Evidence 和 Verification Input。
- `runtime-foundation`：把 Host 安装面与产品能力来源隔离改为可机器校验的所有权边界，而不是物理目录不存在约束。

## Impact

- 影响 Git 输入选择与 race-safe fingerprint、EvidenceCoordinator、Verification Input、composition/Host identity、架构治理脚本及相关配置。
- 增加单元、集成和端到端测试，覆盖单仓、多仓、未跟踪 Host 文件、双用途 tracked 输入、external-exclusive 冲突、策略变化、内容漂移和发布包边界。
- 可能更新自举和 Host 集成文档，明确哪些文件是产品输入、控制面输入或未知输入，以及每类变化如何使 Evidence 失效。
- 不修改五阶段生命周期，不新增后台进程，不依赖 Comet SDK，也不把 Comet 路径硬编码进领域层；Comet 0.5.1 仍只作为本 Change 的外部稳定执行器。
- 不提供任意排除 glob、用户可绕过门禁的 ignore 配置或旧版本兼容层。

```

## openspec/changes/stabilize-host-owned-input-boundary/design.md

- Source: openspec/changes/stabilize-host-owned-input-boundary/design.md
- Lines: 1-183
- SHA256: cfaafa9cca978b19b763b9d6992f853cb39dfeaab9a4669b745007db66a754db

[TRUNCATED]

```md
---
comet_change: stabilize-host-owned-input-boundary
role: technical-design
canonical_spec: openspec
---

# Design

## Context

`platform/git/evidence-fingerprint.ts` 目前用 `git diff --name-only HEAD` 与 `git ls-files --others --exclude-standard` 合并 dirty path，并对每个文件进行竞态安全的内容哈希。这一机制对产品源码是正确的，但无法表达“文件影响执行，却不属于待验证产品”的控制面输入。

与此同时，`scripts/check-architecture.mjs` 对 `architecture-governance.json` 中 `legacyWorkflow.forbiddenPaths` 直接执行 `lstat`。因此外部 Host 合法生成 `.codex/hooks.json` 或 `.codex/rules/**` 后，即使路径未被 Git 跟踪、未进入 npm 包且生产代码没有依赖，架构检查仍会失败。上一轮自举在 Verify 前移走 `.codex`、完成后恢复，又因为 Evidence 对全部未跟踪文件取指纹而触发输入漂移。

这不是“是否忽略 `.codex`”的单点问题，而是三种身份被混在一起：

1. 产品输入：业务源码、规格、配置和所有未知 dirty 内容；
2. 执行控制面输入：Host Hook、Agent 指令、Skill 安装和锁定身份；
3. Runtime 状态：已经由 `.gitignore` 和 Store 边界管理的短期状态。

控制面输入会改变 Agent 行为，所以必须被内容寻址；但它不应作为产品源码污染 dirty tree，也不应因为物理存在而被误判成产品复制了旧工作流。

## Goals / Non-Goals

**Goals:**

- 建立一个确定、版本化、跨平台的输入所有权分类和摘要模型。
- 允许已登记 Host 文件在完整 Verify→Archive 窗口内保持原位。
- 保持未知输入、external-exclusive 冲突、路径逃逸和策略变化的 fail-closed 行为。
- 让 Evidence、Verification Input、复用和 Archive 重验使用同一份输入身份。
- 让架构检查证明产品没有依赖旧工作流，而不是要求开发机上不存在任何 Host 安装文件。

**Non-Goals:**

- 不允许任意自定义排除 glob，也不把 `.gitignore` 当作安全策略。
- 不隐藏会影响执行但没有内容身份的 Agent 指令、Skill 或 Hook。
- 不修改 Comet、Codex 或其他 Host 的安装实现。
- 不改变 Open→Design→Build→Verify→Archive 状态机或 Evidence Gate 语义。
- 不为预发布旧指纹 schema 保留双读、双写或迁移兼容层。

## Approaches

### 采用：产品输入与控制面输入分区、共同绑定

Repository Input Policy 先依据 Git 身份、版本化路径规则和发布边界分类候选路径。产品输入继续形成现有 repository fingerprint；已登记且未跟踪的控制面输入形成独立 manifest，其中包含规范路径、文件类型、内容摘要、大小、owner/provider identity 和 policy version。最终 Evidence fingerprint 同时绑定两者。

这使 `.codex` 等 Host 文件不再制造“产品 dirty”噪声，但其内容变化仍会使旧 Evidence 失效。该方案也能解释未来团队 Skill：Skill 不是产品源码，却是可重现执行的一部分。

### 放弃：仅扩充 `.gitignore`

Git ignore 可以让当前指纹看不到文件，但同时让影响执行的规则、Hook 和 Skill 完全脱离 Evidence 身份；不同机器可能在相同产品 fingerprint 下使用不同方法。因此 `.gitignore` 只能管理纯 Runtime 状态，不能定义控制面可信边界。

### 放弃：对 `.codex` 或所有点目录硬编码跳过

宽泛跳过会隐藏真实产品文件、未知攻击面和所有权冲突，也无法覆盖其他 Host。领域层不应认识某个外部产品品牌；具体路径必须来自版本化 Provider/Host policy，并经过同一分类器。

### 放弃：Verify 前移动、Archive 后恢复

临时搬移依赖调用顺序，破坏崩溃恢复，并让验证环境与实际开发环境不同。它是手工 workaround，不是稳定输入模型。

## Decisions

### 1. Repository Input Policy 是唯一分类权威

新增不可变、可规范化的 `RepositoryInputPolicy`，至少包含 schema/version、owner/provider identity 和精确 path rules。分类结果只允许：

- `product`：Git tree 中的文件、tracked modification/deletion，以及所有未被更具体可信规则接纳的输入；Git 跟踪身份优先，因此团队有意版本化的 Agent 指令或 Skill 仍属于产品输入；
- `control-plane`：与已登记规则匹配、当前未被 Git 跟踪且不属于发布包的执行输入；
- `runtime-state`：由既有 Runtime Store/ignore 边界管理，本 Change 不把它重新纳入 Evidence；
- `conflict`：外部独占路径进入产品面、类型不符、路径逃逸、重叠规则或无法稳定读取。

分类器默认拒绝，未知未跟踪路径仍是产品 dirty 输入。规则只接受仓库相对、正斜杠规范化、无 `..` 的精确文件或受限根路径；不提供任意否定规则和用户自定义通配绕过。

策略由 composition/Host integration Contributor 提供，Git Adapter 只执行已编译策略。领域模型只认识 owner 和类别，不认识 Comet、Codex 等品牌。Builtin integration 可以在插件层登记已知 Host 路径，团队插件可以通过现有 admission 与 composition 机制增加受审查规则；公共配置不开放任意 exclude glob。

### 2. 控制面不是被忽略，而是单独内容寻址

对每个 `control-plane` 文件使用与 dirty product file 相同的 race-safe 读取、symlink 检查和 root containment。manifest 记录：

- 规范相对路径与 `file | symlink` 类型；

```

Full source: openspec/changes/stabilize-host-owned-input-boundary/design.md

## openspec/changes/stabilize-host-owned-input-boundary/tasks.md

- Source: openspec/changes/stabilize-host-owned-input-boundary/tasks.md
- Lines: 1-53
- SHA256: 91cc1ca54e838099c0dcfc2a0be53b78d3054d3061b8201cc9031e2e176a5a00

```md
# Tasks

## 1. 建立输入所有权 red baseline

- [ ] 1.1 为当前 Git fingerprint 增加失败测试：登记 Host 文件、未知未跟踪文件、tracked 双用途文件和 external-exclusive 冲突必须得到不同结果；运行 `npx vitest run test/evidence-fingerprint.test.ts` 证明当前实现无法区分。（Requirements: implementation-evidence#Evidence输入必须区分产品与执行控制面, implementation-evidence#控制面输入分类必须fail-closed） <!-- comet-task:6177f05b-f960-4bb7-bdc2-406a19b626d0 -->
- [ ] 1.2 为 `check:architecture` 增加进程级失败测试，证明未跟踪 `.codex` 当前被误拒绝，而 tracked/packaged `.codex` 必须继续失败；运行 `npx vitest run test/architecture-governance.test.ts`。（Requirements: runtime-foundation#Host安装面与产品面必须以所有权隔离） <!-- comet-task:1961826d-da2d-431b-91c5-85786b49c64d -->
- [ ] 1.3 为 Evidence→Verification Input→Archive 重验增加纵向失败测试：Host 文件保持不变可复用，内容或策略变化必须失效；运行 `npx vitest run test/evidence-gate.test.ts test/change-lifecycle-archive.test.ts`。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate） <!-- comet-task:67179a4b-7d9f-4131-9bba-5d6071ba3fc2 -->

## 2. 实现版本化 Repository Input Policy

- [ ] 2.1 定义纯领域值对象和 schema，包含 policy/provider identity、精确规则、owner、允许类型和稳定摘要；用表驱动测试覆盖规范路径、重叠、`..`、绝对路径、大小写与枚举顺序。（Requirements: implementation-evidence#控制面输入分类必须fail-closed） <!-- comet-task:c90430a3-777d-40ae-ab4a-5d6ec2f33131 -->
- [ ] 2.2 实现默认拒绝的 policy compiler 和 Cordis Contributor registry，使具体 Host 路径只由 builtin/team integration plugin 提供而 Git Adapter 不依赖品牌；运行 policy 与 registry 单元测试验证未知路径始终回落为 product、重复 owner 被拒绝。（Requirements: runtime-foundation#Host输入策略必须绑定composition身份） <!-- comet-task:37a3b58c-922a-4ebb-b99f-66610c4afe0f -->
- [ ] 2.3 将 policy Contributor 的稳定 id、version、代码和配置摘要纳入 composition identity；运行 composition 恢复测试验证策略漂移使用现有 migration/阻断语义。（Requirements: runtime-foundation#Host输入策略必须绑定composition身份） <!-- comet-task:ac22246d-bc5b-40ab-98c1-93509d613861 -->

## 3. 分区并内容寻址仓库输入

- [ ] 3.1 重构 Git selection，一次稳定采集 HEAD、tree、tracked changes、unknown untracked 与 registered control-plane candidates；已登记规则必须独立枚举被本地 ignore 的控制面文件，运行 `npx vitest run test/evidence-fingerprint.test.ts` 验证 tracked 双用途输入保持 product、external-exclusive 冲突 fail-closed。（Requirements: implementation-evidence#Evidence输入必须区分产品与执行控制面） <!-- comet-task:154d2563-b47d-43c3-aaff-f55b2b2c1e0c -->
- [ ] 3.2 复用 race-safe file identity、root containment 和 symlink 校验生成规范 control-plane manifest；测试读取期间新增、删除、改型和仓库外链接全部 fail-closed。（Requirements: implementation-evidence#控制面输入分类必须fail-closed） <!-- comet-task:1495f29c-8024-428a-96ec-dd7ea02276cb -->
- [ ] 3.3 把 policy digest 与 control-plane manifest digest 加入 Repository/Evidence fingerprint schema v2，并在首次与最终 selection 中共同复核；验证枚举顺序不影响摘要，旧 schema 明确要求重新采集而不双读。（Requirements: implementation-evidence#Evidence绑定完整输入指纹） <!-- comet-task:10bf45ea-696b-48a6-8bc5-a3552fc080f5 -->
- [ ] 3.4 保持 unknown untracked、tracked modifications 和 deletions 的既有产品 dirty 语义，增加回归测试证明点目录或 Host 品牌不能自动绕过。（Requirements: implementation-evidence#Evidence输入必须区分产品与执行控制面） <!-- comet-task:22e9ab60-c2b9-4348-8a15-45319cc15a84 -->
- [ ] 3.5 为文件数量、单文件大小和 manifest 总量设置明确上限与无敏感正文诊断，运行安全边界测试验证超限时 fail-closed。（Requirements: implementation-evidence#控制面输入分类必须fail-closed） <!-- comet-task:dc2238c3-3051-4dd2-8599-3f6c717ac621 -->

## 4. 贯通 Evidence 与 Verification Input

- [ ] 4.1 让 EvidenceCoordinator 从当前 composition 取得已编译 policy，并对 Profile 的每个登记仓库生成 product/control-plane 联合 fingerprint；运行单仓和多仓测试。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate） <!-- comet-task:a2ed6786-07a6-4f01-93d4-031b064aec90 -->
- [ ] 4.2 将新增摘要贯通 create/compare Evidence fingerprint、Receipt 复用、Bundle、Gate 与 Verification Input v3，运行 `npx vitest run test/evidence-gate.test.ts test/verification-input.test.ts`，验证旧开发输入明确失效而不保留兼容层。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate, implementation-evidence#Evidence绑定完整输入指纹） <!-- comet-task:7256394a-895f-4741-af64-fc0b4cb2a3e3 -->
- [ ] 4.3 更新 Archive 冻结输入重验，验证 Host 文件不变时不会因物理存在重复要求 Verify，Host 内容变化时会走现有 stale/repair 路径。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate） <!-- comet-task:631f77ce-2fb0-4ff8-9d29-36ecba6e7d38 -->
- [ ] 4.4 删除任何仅为 Host 路径搬移、临时忽略或 fingerprint 绕过而存在的实现/测试假设；确认没有第二套 lifecycle state 或特殊 Archive 分支。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate） <!-- comet-task:c4c8f673-6eee-49e1-a3eb-62f250848f1f -->

## 5. 修正架构治理与发布边界

- [ ] 5.1 把 legacy path 治理从物理 `lstat` 改为基于 `git ls-tree`/`git ls-files`、source manifest 和 package contract 的产品面检查；运行架构测试验证未跟踪 Host 路径可存在且未知路径仍由 Evidence 作为 product dirty 处理。（Requirements: runtime-foundation#Host安装面与产品面必须以所有权隔离, runtime-foundation#能力来源和旧工作流隔离可机器检查） <!-- comet-task:1a64d8fd-ba25-49fc-bd2c-41ee85fb3051 -->
- [ ] 5.2 保留生产源码 marker 扫描和能力账本校验，并增加 external-exclusive tracked/staged、生产引用、package files、不安全类型及双用途 tracked 正常路径测试。（Requirements: runtime-foundation#能力来源和旧工作流隔离可机器检查） <!-- comet-task:17d2c8c9-810e-4b75-b8a0-af3ac4a5de2f -->
- [ ] 5.3 登记首版最小 Host 输入规则，逐项证明 owner、执行影响和文件类型；AGENTS/Skill/Hook/lock 内容进入 manifest，未知 `.codex/**` 不自动接纳。（Requirements: runtime-foundation#Host安装面与产品面必须以所有权隔离） <!-- comet-task:5ec5a296-28b2-480d-8671-795c55159fc6 -->
- [ ] 5.4 运行 `npm run check:architecture` 与 `npm run test:package-e2e`，验证 Host 安装文件不进入 npm 包且产品源码不依赖 Host 路径。（Requirements: runtime-foundation#能力来源和旧工作流隔离可机器检查） <!-- comet-task:04bbdc62-3d38-4d27-a9ab-83d8aa4fa09c -->

## 6. 多仓、安全与可观测诊断

- [ ] 6.1 增加多仓 E2E，验证每仓独立 policy/manifest 摘要、规范聚合顺序、repository override 和 sibling worktree 边界。（Requirements: implementation-evidence#控制面输入分类必须fail-closed） <!-- comet-task:eb97ab6b-416f-4030-91cf-2bfe594c2603 -->
- [ ] 6.2 增加 Windows 大小写、目录 junction/symlink、同一文件对象跨 root 和采集竞态测试，验证不读取仓库外内容。（Requirements: implementation-evidence#控制面输入分类必须fail-closed） <!-- comet-task:112f5e34-9582-44a0-a033-b7279b4f3b07 -->
- [ ] 6.3 为分类冲突、策略漂移和 control-plane 漂移提供有界诊断/遥测，只上报类别与计数，不把路径、owner 自由值或内容放入 Metric label。（Requirements: runtime-foundation#Host输入策略必须绑定composition身份） <!-- comet-task:2133f1dc-1d6a-4d12-813a-ead27c827b52 -->

## 7. 文档与真实自举验收

- [ ] 7.1 更新自举与 Host 集成文档，解释 product、control-plane、runtime-state、unknown 四类边界和失效规则，并移除移动 `.codex` 的 workaround。（Requirements: runtime-foundation#Host安装面与产品面必须以所有权隔离） <!-- comet-task:ea516def-e9df-4e8a-8ab8-52a59f167811 -->
- [ ] 7.2 在真实 worktree 保持 Host Hook、Skill、Agent instructions 和 lock 原位运行 Verify→Archive 输入重验，保存 Evidence 证明没有目录搬移或临时 ignore。（Requirements: implementation-evidence#控制面身份必须沿用现有EvidenceGate） <!-- comet-task:71f2a332-7166-48e3-9c6f-e5097665eedc -->
- [ ] 7.3 在同一验收中修改一个控制面文件并新增未知文件，确认旧 Bundle 分别因 control-plane digest 和 product dirty digest 失效；把修复后结果记录到正式验证报告。（Requirements: implementation-evidence#Evidence输入必须区分产品与执行控制面） <!-- comet-task:c9d61332-45f4-4b46-8cf6-bfe2850f6a48 -->
- [ ] 7.4 执行 `npm run verify`、`npm run test:package-e2e` 和完整 OpenSpec 严格校验，确认类型、Lint、构建、测试、架构、来源、包边界与规格全部通过。（Requirements: implementation-evidence#Evidence绑定完整输入指纹, runtime-foundation#能力来源和旧工作流隔离可机器检查） <!-- comet-task:8c6cedb2-4245-4c45-bd23-92faf9acc5a0 -->

## Workflow follow-up

- 在 Open 与 Design 分别取得人工审批后进入 Build。
- 验证完成并合入后归档 Change，确认主规格已包含产品/控制面输入边界。

```

## openspec/changes/stabilize-host-owned-input-boundary/specs/implementation-evidence/spec.md

- Source: openspec/changes/stabilize-host-owned-input-boundary/specs/implementation-evidence/spec.md
- Lines: 1-76
- SHA256: 51d5ecbb2910b4eb1c02785d8b74be67a2c96b21f0593a788dc0fad8129751b2

```md
# implementation-evidence Specification Delta

## ADDED Requirements

### Requirement: Evidence 输入必须区分产品与执行控制面

Repoctopus MUST 使用版本化 Repository Input Policy 把已登记仓库输入区分为产品输入、内容寻址的执行控制面输入和未知输入；产品 repository fingerprint、策略摘要与控制面 manifest 摘要 MUST 共同进入 Evidence fingerprint 和 Verification Input，任何一项不得被静默忽略。

#### Scenario: 外部 Host 在仓库中安装执行文件

- **WHEN** 未被 Git 跟踪的 Hook、Agent 指令、Skill 或锁文件匹配当前 composition 提供的受限 Host input rule
- **THEN** Runtime 不把它计为产品 dirty file，但以规范路径、类型、内容摘要、owner 和 policy identity 写入 control-plane manifest，并使 Evidence 绑定该 manifest digest

#### Scenario: 未知未跟踪文件出现

- **WHEN** 一个未跟踪文件不匹配任何受信 Host rule
- **THEN** 该文件继续按实际内容进入产品 dirty fingerprint，不因目录名、点前缀或用户 ignore 配置被控制面分类器排除

#### Scenario: 控制面文件在采集后变化

- **WHEN** Host Hook、Skill、指令、锁文件集合、内容、类型或输入策略在 Evidence 采集开始后变化
- **THEN** 当前 Attempt 标记为 `superseded` 或 Gate 拒绝旧 Bundle，Archive 重验不得复用变化前的 Evidence

### Requirement: 控制面输入分类必须 fail-closed

Repository Input Policy MUST 只接纳未跟踪、未打包、位于仓库根内且满足版本化精确规则的控制面输入；Git tracked 路径 MUST 保持产品输入，只有 external-exclusive 路径进入产品面、规则重叠、类型不符、路径逃逸、竞态或无法稳定读取才 MUST 阻断指纹采集。

#### Scenario: 双用途 Host 路径被团队版本化

- **WHEN** 团队把允许版本化的 `AGENTS.md`、Skill 或其他双用途路径提交到 HEAD、index 或 tracked modification
- **THEN** Runtime 把它作为产品 tree 或 dirty 输入取指纹，不再按本地 control-plane rule 排除

#### Scenario: 外部独占路径被提交到产品 tree

- **WHEN** policy 声明为 external-exclusive 的旧 Host 安装路径出现在 HEAD、index 或 tracked modification
- **THEN** Runtime 报告产品与控制面所有权冲突并拒绝 Evidence

#### Scenario: 控制面符号链接逃逸仓库

- **WHEN** 登记路径解析到仓库根外、在读取期间改变对象身份或使用不允许的文件类型
- **THEN** 指纹采集 fail-closed，且诊断不读取或泄露仓库外内容

#### Scenario: 输入枚举顺序不同

- **WHEN** 两次采集观察到相同产品内容、控制面内容和策略，仅 Git 或文件系统返回顺序不同
- **THEN** 规范排序后的 product、control-plane 和最终 Evidence digest 完全相同

### Requirement: 控制面身份必须沿用现有 Evidence Gate

EvidenceCoordinator MUST 通过现有 fingerprint、Verification Input、Bundle 和 Gate 比较链路核对控制面输入，不得建立独立生命周期状态或允许 Host 自述替代实际内容摘要。

#### Scenario: 相同产品源码使用不同 Skill 安装

- **WHEN** HEAD、tree 和产品 dirty 内容相同，但 control-plane manifest 或 policy Contributor identity 不同
- **THEN** 两次运行产生不同 Verification Input，旧 Receipt、Bundle 和 Gate 不得复用

#### Scenario: 产品与控制面均未变化

- **WHEN** 仓库产品 fingerprint、control-plane manifest、policy digest、composition 和其他 Evidence 输入完全相同
- **THEN** Runtime 可以按既有确定性和新鲜度规则复用 Receipt，无需把 Host 文件移动出仓库

## MODIFIED Requirements

### Requirement: Evidence 绑定完整输入指纹

Repoctopus MUST 把仓库 HEAD、tree、产品未提交内容、内容寻址的执行控制面 manifest、Repository Input Policy、配置、lockfile、Journey、工具、浏览器、Adapter 和输入 Artifact 摘要绑定到 Bundle 指纹，并在采集开始和结束时重新核对产品与控制面选择集合。

#### Scenario: 采集期间源码发生变化

- **WHEN** 结束时的产品指纹、控制面 manifest 或策略摘要与开始时不同
- **THEN** 当前 Attempt 标记为 `superseded`，保留制品但不得用于 Verify

#### Scenario: 开发阶段存在未提交修改

- **WHEN** Profile 允许在 dirty worktree 收集开发反馈
- **THEN** 产品 dirty 集包含实际选中文件内容摘要，已登记控制面输入包含独立内容摘要，不能只使用 Git 状态文本或忽略 Host 执行输入

```

## openspec/changes/stabilize-host-owned-input-boundary/specs/runtime-foundation/spec.md

- Source: openspec/changes/stabilize-host-owned-input-boundary/specs/runtime-foundation/spec.md
- Lines: 1-62
- SHA256: 5c034d0188b716f60cbd72c4a18aacf240691e23759cf26b5eb7fd2cf146b9a6

```md
# runtime-foundation Specification Delta

## ADDED Requirements

### Requirement: Host 安装面与产品面必须以所有权隔离

Repoctopus MUST 允许外部 Host 的未跟踪本地安装文件存在于开发仓库，但 MUST 以版本化 policy、Git 跟踪身份、生产源码边界和发布包边界证明这些文件不属于产品；影响执行的 Host 文件 MUST 进入内容寻址的控制面身份，不得因本地存在而被误判为产品采用，也不得被无痕忽略。

#### Scenario: 已登记 Host 目录在验证期间存在

- **WHEN** 本地 `.codex`、`.agents` 或等价 Host 安装路径未被 Git 跟踪、未进入发布包，且匹配当前 composition 的受限 input policy
- **THEN** 架构检查允许其保持原位，同时 Evidence 把影响执行的内容绑定到 control-plane manifest

#### Scenario: 产品提交旧工作流目录

- **WHEN** external-exclusive Host 路径被 Git 跟踪，或任意未登记 Host 内容由生产源码引用、被能力账本覆盖或意外进入发布包
- **THEN** 架构检查失败并报告产品/控制面所有权冲突，即使本机也安装了同名 Host

#### Scenario: 团队版本化双用途 Agent 指令

- **WHEN** `AGENTS.md`、团队 Skill 或等价双用途路径被 Git 跟踪且不违反产品能力、来源和发布边界
- **THEN** 该文件按产品输入验证，控制面规则不把它从 repository fingerprint 中排除

#### Scenario: Host rule 未登记新路径

- **WHEN** 外部 Host 生成一个不属于既有 Runtime ignore 且未被当前 policy 接纳的路径
- **THEN** 该路径保持普通未知仓库输入，不能仅凭 Host 品牌或父目录自动取得控制面所有权

### Requirement: Host 输入策略必须绑定 composition 身份

提供 Repository Input Policy 的 Host integration Contributor MUST 以稳定 id、version、代码摘要和配置摘要进入 composition；Run 恢复、Evidence 接受和规格关闭 MUST 同时核对 Provider identity 与实际 control-plane manifest。

#### Scenario: Host policy 在 Run 中途变化

- **WHEN** Provider 版本、规则或配置摘要在活动 Run 恢复时改变
- **THEN** Runtime 按现有 composition 漂移规则阻断或要求显式兼容决定，不使用新策略重新解释旧 Evidence

#### Scenario: Host 文件内容单独变化

- **WHEN** Provider identity 不变但 Hook、Agent 指令、Skill 或锁文件内容改变
- **THEN** composition 仍表示同一 Provider，而 Verification Input 因 control-plane manifest digest 变化而失效

## MODIFIED Requirements

### Requirement: 能力来源和旧工作流隔离可机器检查

Repoctopus MUST 为全部生产源码声明唯一能力归属和采用方式，登记从 Comet 复制、实质改写或行为重建的边界，并拒绝旧 `agents-workspace` 的 Hook、Skill、阶段常量、批准口令、客户端配置和项目专有路径进入 Git 跟踪产品面、生产源码或发布包；未跟踪且由当前 Host policy 接纳的本地执行文件 MAY 存在，但其影响执行的内容 MUST 进入控制面输入身份。

#### Scenario: 新增生产模块没有能力归属

- **WHEN** `app`、`domains` 或 `platform` 出现未被能力账本唯一覆盖的源码
- **THEN** 架构检查失败并报告缺失或冲突的能力归属

#### Scenario: 旧工作流文件或口令被复制

- **WHEN** Git 跟踪产品路径、生产源码或发布包出现旧 Hook、旧阶段常量、中文动作批准口令或旧模板配置路径
- **THEN** 架构检查失败并定位文件、路径和冲突的所有权

#### Scenario: 外部 Host 安装未跟踪执行文件

- **WHEN** 本地路径未被 Git 跟踪、未被生产代码依赖、未进入发布包并匹配版本化 Host input policy
- **THEN** 架构检查不因物理路径存在而失败，Evidence 仍以 control-plane manifest 绑定其执行身份

```
