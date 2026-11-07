# Comet Design Handoff

- Change: repair-evidence-input-identity
- Phase: design
- Mode: compact
- Context hash: 2ffcae969cfb020f6cfd983e7f1911f1ceb7ba443a42e2a158f7697054002e11

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/repair-evidence-input-identity/proposal.md

- Source: openspec/changes/repair-evidence-input-identity/proposal.md
- Lines: 1-33
- SHA256: 75e2bff06bcd1e7b9a5107db6e9f7c5a54443086de6b51b9493d50518c23898c

```md
# Proposal

## Why

真实多仓验收中，Verify 已通过后仅提交 Runtime 生成的两个 Task 完成复选框，Archive 又要求重做 Verify。此前增量恢复 Change 已承诺分离规划语义与发布身份，但实际 Evidence 采集仍聚合原始 HEAD、tree 和 dirty 状态，依赖模型尚未接入生产链路；这使团队正常收尾持续触发无效返工。

## What Changes

- 统一当前规格中“无条件绑定 HEAD/tree”与“按实际依赖保留 Evidence”的矛盾，以检查声明的输入身份决定新鲜度，原始 Git 身份继续用于授权、发布与审计。
- 让实际输入采集、Receipt、Bundle、Gate 和 Verification Input 使用同一规范化依赖模型。由 Specification Provider 识别官方规划工件及语义，保持多仓和插件边界。
- 把已有依赖失效规则接入真正的 Verify 与 Archive 路径；等价收尾保留已接受证据，真实变化只失效依赖它的检查，规划与证据同时变化时由统一恢复权威选择最高受影响层。
- 借鉴固定 Comet 0.5.1 的逐文件输入、Task 语义归一化和显式 Git 依赖机制。保留产品未知文件、控制面、配置、工具、Adapter 和采集期间变化的保护。
- **BREAKING**：调整证据输入及依赖记录协议时显式拒绝不受支持的旧开发证据，不双读、自动升级或手改历史 Store。
- 用生产组合及实际安装后的多仓 CLI 证明完整路径，保存首次失败、转绿、命令调用次数和中断恢复结果。

本次交付是 Evidence 身份从采集到 Archive 的完整修复切片。Dashboard、发布功能、通用工作流扩展和旧状态兼容不在本次范围；后续产品功能继续单独规划。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `implementation-evidence`：实际依赖指纹、持久化依赖和有界失效闭包；修正原始 Git 身份与语义输入的边界。
- `change-lifecycle`：Archive 使用相同输入权威判断新鲜度，等价收尾不回退，真实漂移按最高受影响权威恢复。

## Impact

涉及 Evidence 领域模型、Git 输入采集、Specification Provider 的规划投影、共享 Profile 输入声明、EvidenceCoordinator、WorkflowRuns、持久化校验和相关 CLI 验收。沿用 Cordis composition、唯一 Change Run 和 OpenSpec 四类规划产物。

参考 Comet 固定提交 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的实现思路，不引入其 SDK 或新运行时依赖；若采用源码，按已有来源清单与许可证规则登记。

```

## openspec/changes/repair-evidence-input-identity/design.md

- Source: openspec/changes/repair-evidence-input-identity/design.md
- Lines: 1-166
- SHA256: 25cb55e8dd00dc5969bf6ea4ab3e64c3be94a4a1b6271a6be8bbc74ba631951e

[TRUNCATED]

```md
---
comet_change: repair-evidence-input-identity
role: technical-design
canonical_spec: openspec
---

# Design

## Context

参见 [proposal.md](./proposal.md) 的动机。本次从已合入的 `22b5cd0` 开始，继续使用外部 Comet Classic 控制产品开发，Repoctopus 仅在独立实验多仓接受验证。

原始验收的两个 Evidence Attempt 配置、业务仓、工具、Adapter 和检查计划相同。Workspace 的唯一 Git 差异是两个 Task checkbox 从 pending 提交为 Runtime 已完成状态；第一次证据采集已经读到相同的完成文件，但它当时是 dirty。原始指纹分别为 `6261a7ee9faa0ebb9af845505cbfbffbe21a5ab84bbe8666cc17f0638b18809b` 与 `b147d9ceff741eb8faac0ec54c2be418047170a885bda1d95f6969e8a38ed745`。

已核对的接线缺口：

- `platform/git/evidence-fingerprint.ts` 无条件采集 HEAD、tree 和 dirty，`domains/evidence/fingerprint.ts` 聚合这些原始字段。
- `services/evidence-coordinator.ts` 的实际采集、Receipt 与 Gate 仍使用聚合 profile 指纹，`services/workflow-runs.ts` 的 Archive freshness 比较直接据此返回 Verify。
- `domains/evidence/dependencies.ts` 已有分区与依赖失效模型，但生产入口没有调用；现有覆盖集中在 `test/evidence-dependencies.test.ts`，未证明原始采集到 Archive 的路径。
- 主规格“Evidence 绑定完整输入指纹”仍无条件要求绑定 HEAD/tree；后加的“Evidence 失效必须按声明输入面传播”要求等价收尾不失效。“Archive 关闭前必须重验冻结输入”还描述先 Verify 后 Design，与既有最高受影响权威规则冲突。本次 delta 将这些冲突提交给 Open 与 Design 审查，获批前不实现。

先前 `stabilize-incremental-workflow-recovery` 的任务 7.1—7.3 和 9.1 已描述目标，局部模型验证没有覆盖真实接线，是本轮补齐的依据。

## Goals / Non-Goals

**Goals:** 由真实输入采集建立可持久化、可比较的依赖身份，让 Verify 与 Archive 对同一事实作相同判断；证明合法收尾不重做检查，真实变化仍准确阻断。

**Non-Goals:** 不增加阶段、后台任务或第二套任务/证据权威，不继续旧开发协议，不把任意目录忽略规则当成规划语义，也不改变上一 Change 的 checkout 授权和工作包恢复边界。

## Decisions

### 借鉴逐文件内容与显式依赖，分离原始来源

固定 Comet 提交 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 `domains/comet-classic/classic-check-policy.ts` 默认使用 `git: none`、`taskCheckboxes: ignore`；`classic-check-snapshot.ts` 在实际采集中用规范化 Task requirements 和文件内容建立 manifest，只有策略显式要求才纳入 HEAD/index。

本次采用相同的身份分离原则，按 Repoctopus 的多仓、Contributor 和 Specification Provider 端口重建生产接线。Runtime 仍保留真实 Git observation，用于 Binding、检查期间竞态、发布与审计。证据有效性使用其声明的输入投影；不能简单移除所有 Git 检查或仅在 Archive 加例外。

### Provider 提供规划语义，Git Adapter 观察实际内容

官方工件及 Task 完成归一化由注册的 Specification Provider 给出。Git Adapter 负责稳定枚举和读取实际产品内容；纯领域模块负责依赖排序、摘要和失效闭包。EvidenceCoordinator 作为 Cordis Service 组合这些事实，Engine 的 Run CAS 继续负责受保护状态接受。Evidence 不解析写死的 OpenSpec 路径。

没有精确输入声明的检查保留保守内容依赖；显式声明才能收窄范围。以下契约是本轮 Design 候选，批准后才实施。

### Profile 输入声明

在 command 节点增加可选 `inputs`，不另设命令策略文件。command 的 executable、args、cwd、timeout、cache 和 required/covers 继续由同一共享 Profile 管理；Host 不能用 Outcome 改写它们。

```yaml
inputs:
  schemaVersion: 1
  repositories:
    - repository: frontend
      files: ['src/**', 'package.json', 'package-lock.json']
      outputs: ['dist/**']
    - repository: shared-library
      files: ['src/**', 'package.json']
  git: none
  taskCheckboxes: ignore
  env: [NODE_ENV]
```

- `repositories` 省略时覆盖全部登记仓，`files` 省略时覆盖该仓保守内容集合。显式空列表拒绝，不能借空集合产生零输入成功证据。
- 显式仓库集合是该命令声明的完整跨仓读取范围；仓库名只能引用当前项目登记项。路径使用仓库根相对的 `/` 分隔，支持字面路径及 `*`、`?`、`**`，拒绝绝对路径、`..`、NUL、越界 symlink 和未支持语法。
- `outputs` 默认空，仅排除该命令明确声明写出的路径；文件同时作为该命令的显式输入和输出时拒绝歧义。后继节点读取前驱产物时，仍绑定该产物实际内容，不能继承前驱的输出排除。
- `git` 默认 `none`；`all` 绑定所选仓的 HEAD、tree 和 index 内容身份。原始分支、remote、topology、checkout ownership 始终经过独立授权核对，不受此开关影响。
- `taskCheckboxes` 默认 `ignore`，仅对 Provider 证明属于当前 change、且完成状态与当前 Run 接受事实一致的官方 Tasks 生效。`include` 额外绑定其实际内容；未被 Provider 认领的文件维持普通产品输入。
- `env` 默认空，值仅形成有域隔离的摘要，不保存或上传环境变量原值。Windows 按环境键大小写规则去重。Node、实际解析的命令程序及当前 Contributor/Adapter 身份始终绑定，命令程序不可可靠识别时禁止复用。
- 各节点绑定其有效配置及输入声明摘要，不能让无关节点条目替代当前命令身份。配置整体仍需通过当前 Run 的配置与 composition 权威；不兼容变化不能借节点级复用绕过正式恢复。
- 服务、浏览器、视觉和 Specification 节点保持现有采集及新鲜度规则，本轮不为其开放命令缓存选项。它们使用保守依赖并保留实际上游输入；`inputs` 放在不支持的节点类型时直接拒绝。

### Provider 投影与稳定文件采集

`SpecificationWorkspace` 增加只读的证据输入投影端口，输入是当前 change、绑定的 Specification Root 和已有规划观察。返回版本化投影，记录 Provider/schema/policy、稳定 repository ID、逐个官方工件的仓内路径、实际读取内容摘要和语义摘要。语义投影不包含本机绝对路径、发布 OID、mtime 或 checkbox 状态。Tasks 复用现有 Task revision、依赖、Acceptance 与 Requirement 语义解析；完成合法性仍依据当前 Run 与 Task completion receipt，不能从勾选反推实现成功。

Provider 负责官方路径及语义，Git Adapter 核对投影中的实际字节来源，保证没有把另一个文件的语义套用到当前内容。状态、schema、元数据、路径、Provider 或任务映射不能证明时 fail closed；不以预先保存的 semantic digest 跳过实际读取。

EvidenceCoordinator 的 `plan`/观察入口接受可选 workflowRunId，并沿调用链携带当前 change 与 Provider 投影；不能只在 `run` 阶段补投影而让 Build Check、Verify gate 与 Archive 比较不同输入。独立 Profile 没有可核对的 Change 上下文时，对未被证明的规划文件使用普通内容依赖，其 Bundle 仍无生命周期 Acceptance 权威。

采集清单包含选中路径、文件类型、实际字节摘要、大小及规范化语义来源。HEAD/index 中的 tracked 文件即使被 ignore 仍保留；选中范围内的未跟踪与显式 ignored 输入也被实际枚举，Git ignore 不是安全排除依据。只允许显式 command outputs、Git 自身元数据及已登记的 Runtime 输出 ownership 排除自产日志、Journal、收据与缓存；执行控制面输入仍独立绑定，不能被宽泛输出规则覆盖。Runtime 输出规则沿现有 Repository Input Policy 的 Contributor 机制声明并校验冲突，不建立平行忽略清单。默认范围过大时返回有界诊断，引导明确声明输入及输出，不能静默截断。


```

Full source: openspec/changes/repair-evidence-input-identity/design.md

## openspec/changes/repair-evidence-input-identity/tasks.md

- Source: openspec/changes/repair-evidence-input-identity/tasks.md
- Lines: 1-27
- SHA256: 1da9cb6a84ec8f676859a57c7cd06cc2441afb31634ec589232fe947ed51f8c4

```md
# Tasks

## 1. 失败基线与输入权威

- [ ] 1.1 在生产组合中复现已通过 Verify 的完成复选框仅暂存、提交后又返回 Verify，记录真实失败断言、命令计数与原始指纹，并把先前依赖模型未接线及规格冲突的根因核对写入 design.md。 <!-- comet-task:13b7b7b2-999f-42a7-a87b-5ab01e04edbc -->
- [ ] 1.2 建立 Provider 所有的规划语义输入投影和实际有效内容采集，验证 dirty、暂存、提交前后等价内容稳定，真实正文、未知文件及读取竞态仍能阻断，并同步接口与输入边界说明。 <!-- comet-task:2dacb54c-979c-4690-962b-1f3456d4d989 -->

## 2. 接通真实证据纵切

- [ ] 2.1 让实际 Receipt、Bundle、Gate、Verification Input 及相关 Check Evidence 持久化规范化依赖，验证实际采集结果在重启后往返一致，缺失或未知依赖不能被接受，并更新证据契约说明。 <!-- comet-task:5b02cd16-d1d4-4fda-906b-53e6889fd728 -->
- [ ] 2.2 让 Verify 和 Archive 使用相同依赖观察与既有恢复分类，验证任务状态收尾不重做 Verify、真实输入漂移回到合法 checkpoint、规划与证据同时变化只恢复最高受影响权威。 <!-- comet-task:3d9a65ef-27fa-473d-8c95-291204b92511 -->

## 3. 显式依赖与有界失效

- [ ] 3.1 接入检查输入声明与共享配置校验，验证默认保守内容依赖、显式 Git/checkbox 依赖和拒绝越界输入，附可执行配置示例并说明确定性命令与外部观察的新鲜度边界。 <!-- comet-task:e432e230-a248-4f0a-ade6-2a0d4e2f7d98 -->
- [ ] 3.2 接通依赖失效闭包、节点复用及原 Journal 恢复，用两个独立检查的实际调用计数证明只重采受影响节点，并验证控制面、配置、工具、不可用和中断状态不会被错误复用；同步恢复与遥测原因说明。 <!-- comet-task:726db950-8bd3-4a10-a478-177cb08121b3 -->

## 4. 多仓集成验收

- [ ] 4.1 构建并独立安装固定候选，在新实验多仓 Run 通过公开 CLI 验证 Verify 后完成状态提交与新进程恢复，核对无额外 Verify Work或检查调用；再以真实输入变化负例证明门禁仍阻断，保存原始轨迹和正式验证报告。 <!-- comet-task:bdacc7d6-d03c-40b0-9327-391890d0647f -->
- [ ] 4.2 执行严格 OpenSpec、类型、lint、完整生产组合测试和包复现检查，独立复核实际采集至 Archive 的链路、失败基线与协议边界，核对所有实现任务有实际检查结果。 <!-- comet-task:b45389e7-b35d-44dc-b2de-2af481420f4b -->

## Workflow follow-up

- 经当前 Change 的正常 Open 与 Design 审查后进入实施，保留 Comet 控制器与独立实验项目的职责边界。
- 正式 Verify 与 Archive 使用当前 Run 的真实收据；当前 Change 完成后再创建 PR，CI 通过并获交付授权后合入。
- 复核归档后的主规格不存在原始 Git 身份与语义依赖规则冲突，保留原实验与失败证据，不手改 Store。

```

## openspec/changes/repair-evidence-input-identity/.openspec.yaml

- Source: openspec/changes/repair-evidence-input-identity/.openspec.yaml
- Lines: 1-2
- SHA256: cb72bd9217510d5461ddb5384ca197195a83da2d8dfbd237178f7ed662291c68

```md
schema: spec-driven
created: 2026-11-07

```

## openspec/changes/repair-evidence-input-identity/specs/change-lifecycle/spec.md

- Source: openspec/changes/repair-evidence-input-identity/specs/change-lifecycle/spec.md
- Lines: 1-40
- SHA256: 43337a72258b13f2e61a8df7daac7ceaf3a6797c6035f34a30a6da2541334b24

```md
## MODIFIED Requirements

### Requirement: Archive 关闭前必须重验冻结输入

Repoctopus MUST 在执行 `specification.close` 或 publication 副作用前，使用与 Verify 相同的输入依赖权威比较当前事实与冻结 Verification Input。等价收尾 MUST 保留有效验证证据，发布坐标仍由独立 preflight 核对。声明的证据依赖确实漂移且尚无 Closure 或 Publication Receipt 时，Runtime MUST 退役失效 close execution、清除相应 Archive input 并返回 Verify，只重采受影响证据；规划授权同时失效时 MUST 按既有最高受影响权威规则直接恢复 Design。副作用已经开始后 MUST 使用既有 journal/reconciliation，不得回滚或伪造重验。

#### Scenario: Close Work 冻结后源树漂移

- **WHEN** `specification.close` Work 已创建或验证，当前事实使冻结 Verification Input 声明的产品内容依赖失效，且尚未开始关闭或发布副作用
- **THEN** Runtime 在调用 Specification provider 前返回 Verify、创建新的 `evidence.verify` Work 并退役旧 execution checkpoint，只要求重采受影响的检查

#### Scenario: 漂移同时改变规划语义

- **WHEN** Archive 的同一次受保护观察同时发现批准的规划语义失效与其下游 Evidence 依赖漂移
- **THEN** Runtime 复用既有最高受影响权威判定，只建立一次 Design 恢复及下游失效事实，不先退回 Verify 再因相同根因退回 Design

#### Scenario: Closure 已经产生

- **WHEN** Specification Closure 或 Publication Receipt 已存在
- **THEN** Runtime 不回退到 Verify，而继续既有 publication journal/reconciliation 流程

#### Scenario: Verify 后只提交完成复选框

- **WHEN** 当前 Run 已合法完成 Task 并通过 Verify，随后 Workspace 仅暂存和提交相同完成状态，Provider 证明规划语义未变，检查也未声明消费该 Git 身份或 checkbox
- **THEN** 新进程的恢复和 Archive preflight 保留已接受的有效 Gate、Bundle 和完成事实，不创建额外的 Verify Work或重跑检查；发布坐标未变时保持当前 Archive Work，首次准备或合法更新发布 checkpoint 的正常 transition 仍可递增 epoch

#### Scenario: 等价收尾改变已冻结发布坐标

- **WHEN** 验证依赖仍有效，但实际发布提交与已冻结 Archive input 不同，且关闭或发布副作用尚未开始
- **THEN** Runtime 阻断使用旧发布输入，重新执行受保护 preflight，核对批准的分支、远端、提交范围、当前发布坐标及验证证据；只有重验通过才建立匹配的发布 checkpoint，不因发布来源变化使有效 Verify Evidence 失效

#### Scenario: 收尾提交影响显式 Git 依赖

- **WHEN** 相同收尾提交改变了某个检查明确声明消费的 Git 身份，而规划语义仍有效
- **THEN** Runtime 只使该检查及其证据后继失效，返回合法 Verify checkpoint，不以等价规划语义跳过该项重验

#### Scenario: 重验期间输入来源暂时不可用

- **WHEN** Archive preflight 无法读取 Provider 或实际依赖，尚不能证明有效或失效
- **THEN** Runtime 保留当前证据、Work 和副作用边界并返回受限重试或 reconciliation，不把不可用误判为实现失败或规划返工

```

## openspec/changes/repair-evidence-input-identity/specs/implementation-evidence/spec.md

- Source: openspec/changes/repair-evidence-input-identity/specs/implementation-evidence/spec.md
- Lines: 1-59
- SHA256: 442563597450d9f0c7de6533bb9db303cc5481290f2b97ff47ea8c84114a6ee4

```md
## MODIFIED Requirements

### Requirement: Evidence 绑定完整输入指纹

Repoctopus MUST 把检查实际声明的产品内容、规划语义、执行控制面、输入策略、配置、lockfile、Journey、工具、浏览器、Adapter 和输入 Artifact 身份绑定到证据依赖指纹，并在采集开始和结束时重新核对选中输入。原始 HEAD、tree、index 和工作树状态 MUST 保留为授权或审计来源；只有检查显式消费 Git 身份时才把对应 Git 身份作为证据有效性依赖，不得用原始仓库状态替代有效内容身份。

#### Scenario: 采集期间源码发生变化

- **WHEN** 结束时的产品指纹、控制面 manifest 或策略摘要与开始时不同
- **THEN** 当前 Attempt 标记为 `superseded`，保留制品但不得用于 Verify

#### Scenario: 开发阶段存在未提交修改

- **WHEN** Profile 允许在 dirty worktree 收集开发反馈
- **THEN** 产品 dirty 集包含实际选中文件内容摘要，已登记控制面输入包含独立内容摘要，不能只使用 Git 状态文本或忽略 Host 执行输入

#### Scenario: 相同有效内容经过暂存和提交

- **WHEN** 已验证文件从未暂存变为暂存或提交，选中的实际内容、规范化规划语义及其他依赖未变，检查没有声明消费 Git 身份
- **THEN** 该检查的依赖指纹保持一致，原始 Git 来源可以更新而不使成功证据失效

#### Scenario: 检查直接读取提交身份

- **WHEN** 检查显式声明读取 Git 身份，并在内容等价时观察到新的提交或声明绑定的 index
- **THEN** 对应依赖指纹变化，旧证据不能证明新输入，即使其他检查的内容依赖保持相同

#### Scenario: 规划文件不能可靠归一化

- **WHEN** Specification Provider 无法证明官方规划工件、Task 完成变化和当前批准语义之间的关系
- **THEN** Runtime 阻断归一化或使用明确的保守输入，不得按目录名称忽略文件，也不得声称旧证据仍有效

### Requirement: Evidence 失效必须按声明输入面传播

每个 Receipt、Bundle、Gate、Plan Evidence、Build Check Evidence 和 Verification Input MUST 保存实际采集形成的规范化依赖集合。Runtime 选择 `invalidate-evidence` 时 MUST 沿身份依赖图只退役直接或传递依赖已变化输入的事实，并记录保留项、失效项和原因；采集、恢复、复用和门禁 MUST 消费同一依赖权威，phase、commit、checkbox 或文件时间变化本身不得成为全量失效依据。

#### Scenario: 一个测试命令的源码输入变化

- **WHEN** 只有命令A声明的实现文件发生变化，命令B的argv、cwd、环境、工具和输入集合均未变化
- **THEN** Runtime只使A的Receipt及其下游Bundle/Gate失效，并可保留B的有效Receipt

#### Scenario: 检查显式依赖 Git identity

- **WHEN** 检查产物包含commit SHA并在策略中声明Git identity为输入
- **THEN** 对应commit变化使该检查Evidence失效，即使文件语义内容等价

#### Scenario: 非语义收尾提交

- **WHEN** Workspace 中的提交只更新Task checkbox、验证报告引用或publication provenance，且没有改变planning semantic identity或任何检查声明的输入
- **THEN** Runtime保留Design approval、Build Plan、实现completion与Verify Evidence，不返回Design或Verify

#### Scenario: 新进程恢复已采集依赖

- **WHEN** 一个进程保存 Receipt 和 Bundle 后退出，另一个进程重新核对对应 Gate 或准备 Archive
- **THEN** 新进程从持久化事实获得同一依赖及原始来源，只复用当前仍有效且满足新鲜度规则的证据，不从聚合 HEAD 差异重建全部检查

#### Scenario: 缺失或无法识别的依赖记录

- **WHEN** 证据缺少当前协议要求的依赖记录，或引用的输入身份不能可靠读取与比较
- **THEN** Runtime 返回明确的证据不可复用或暂时不可判定诊断，保持受保护 checkpoint，不伪造依赖、不把旧成功记录提升为当前有效证据

```
