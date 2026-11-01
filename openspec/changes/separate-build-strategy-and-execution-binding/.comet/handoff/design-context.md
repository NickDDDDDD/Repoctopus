# Comet Design Handoff

- Change: separate-build-strategy-and-execution-binding
- Phase: design
- Mode: compact
- Context hash: 6badac2a85a13630b7f135f1d577e587064481510feee34e66d595ffcb9fb756

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/separate-build-strategy-and-execution-binding/proposal.md

- Source: openspec/changes/separate-build-strategy-and-execution-binding/proposal.md
- Lines: 1-35
- SHA256: d52c1fb4281592bf5208ff077b09f71e40ff577fdbecbc48f19fe9d7da5f81fd

```md
# Proposal

## Why

当前 `BuildConfiguration` 的 semantic digest 同时包含 execution/TDD/review/isolation 选择与 Host、capability、checkout/binding 等机器事实。机器切换、HEAD 推进或兼容 checkout 修复因此可能生成新的 Build Configuration approval，重复询问用户已批准的语义。

本 Change 把稳定的人/团队选择建模为 `BuildStrategy`，把本机可重建事实建模为 `ExecutionBinding`。Design approval 绑定 Strategy；Build Configure 自动解析和验证 Binding，只有真实语义改变才建立新 Human Decision。

## What Changes

- 用 `BuildStrategy + ExecutionBinding` 替代预发布 `BuildConfiguration`。
- 将完整 Strategy 纳入 Design proposal/approval；实际 Skill composition 继续由独立兼容性权威验证，不进入规划批准摘要。
- Build Configure 只解析、验证和冻结 ExecutionBinding，不建立常规人工批准。
- 按 `decisionKind + semanticDigest` 复用/失效 Human Decision。
- 加强 Plan Evidence，在 Execute 前核对 Tasks、验收、仓库/write scope、报告归属、Host capability、Strategy、Binding 和 composition。
- 增加恢复/返工矩阵、OTLP 和桌面当前决定投影。

## Capabilities

### Modified Capabilities

- `change-lifecycle`: 以稳定策略驱动 Design approval 和 Human Decision 复用。
- `managed-work-execution`: 分离 Strategy/Binding 并加强 Plan Evidence。
- `development-telemetry`: 记录策略、绑定、决定复用和 preflight finding。
- `desktop-observability-dashboard`: 只展示当前有效语义决定。

## Dependencies

该 Change 的 Plan Evidence 和 Work input 引用当前有效 Skill composition identity；实施时应基于 `add-auditable-team-skill-composition` 的最终合同，但不得把实现代码/配置身份并入 Strategy approval。它不依赖 required check 或 Method Receipt 才能完成基本切换。

## 非目标

- 不增加 Hotfix/Tweak profile、Direct execution、Executing Plans 或运行中模式切换。
- 第一版只支持 `autonomous|subagent-driven-development`、`tdd|direct`、`review=standard` 与 `current|branch|worktree`。
- 不保留未发布 `BuildConfiguration` Run 的执行兼容层；旧状态仅提供只读诊断。

```

## openspec/changes/separate-build-strategy-and-execution-binding/design.md

- Source: openspec/changes/separate-build-strategy-and-execution-binding/design.md
- Lines: 1-243
- SHA256: dc6ee4779f9b66684e349a2599d8b0c703ed395f2ce4957c58c4816bf3940d73

[TRUNCATED]

```md
# Design

## Context

`BuildConfigurationProposal` 当前把稳定策略和 `bindingDigest`、`bindingStateDigest`、`hostId`、`hostCapabilities` 共同加入 semantic digest，随后建立 `build-configuration:*` Human Decision。该模型让机器事实变化与用户语义变化共享失效规则：切换 Runner、正常推进 HEAD、修复 checkout 或 Verify 返回 Build 都可能重复询问已经批准过的 execution/TDD/review/isolation 选择。

### 固定上游证据

2026-11-01 重新核对固定的 Comet `0.5.1`（`35c9860b77b42bafa0c2d80d8d695889f888a924`）与默认分支审计头（`63d2ba736a24090ee826c012b5963a579ca5fb8c`）。默认分支新增的 MiniMax Code 平台支持没有修改 Classic Runtime、Runtime SDK、Engine 或生命周期状态机，因此不改变本 Change 的参考边界，也不升级固定采用版本。

Comet Classic 的成熟边界是：Resolver 先选择 `configure`，有效配置才进入 `plan`；配置决定绑定精确 proposal hash；计划必须绑定当前 Tasks/plan reference 并记录 Plan Evidence，之后才能 Execute；暂停或恢复时重新观察精确身份，只重做缺失、无效或被用户明确改变的部分。Repoctopus 采用这些不变量，但不复制 Comet 的单仓状态文件、Superpowers Design Doc 或第二份 Build Plan 文档：OpenSpec Tasks 仍是规格与任务权威，Run-local BuildPlan 只是执行投影；稳定的人/团队选择进入 Strategy，Host、checkout 与 HEAD 等可重建事实进入 Binding。

### 上游映射与本地取舍

| Comet 0.5.1 参考 | 成熟不变量 | Repoctopus 采用方式 |
| --- | --- | --- |
| `domains/comet-classic/classic-sdk-build.js` 的 `proposeClassicSdkBuild` / `decideClassicSdkBuild` | 配置候选和决定绑定精确 proposal hash；过期决定不能作用于新候选 | Design approval 绑定 `BuildStrategy.semanticDigest`；稳定决定身份为 `decisionKind + semanticDigest` |
| 同文件的 `submitClassicSdkBuildPlan` / `continueClassicSdkBuildPlan` | Plan 在 Execute 前绑定当前配置、Tasks revision、plan receipt 与 evidence；恢复必须重新证明同一输入 | `PlanEvidence` 绑定 Strategy、Binding、Tasks、拓扑、scope、composition checkpoint 与 plan revision，任何依赖输入变化只失效相应后继事实 |
| 同文件的 `completeClassicSdkBuild` | 没有已接受计划和完成证据不能离开 Build | Build Check 只接受当前 Plan revision 的 required package completion 和 Evidence |
| `domains/comet-classic/classic-sdk-application.js` 的 `full.build.configure → confirm → plan → execute → check` | Runtime 选择合法 Action，Host 只完成当前 Action | 保留 `Configure → Plan → Execute → Check`；把稳定策略提前并入既有 Design approval，Configure 只解析机器 Binding，因此删除产品内部重复的常规 confirm |

Comet 的 `confirm` 对其一次性 Build 配置是必要的。Repoctopus 已有独立 Design Human Decision，而且需要支持多仓、跨 Runner 与独立 composition compatibility；继续在 Configure 为同一稳定策略再确认一次只会建立第二个批准权威。因此本设计采用 Comet 的精确身份、evidence-before-effect 和增量恢复规则，不照搬重复批准或单仓状态布局。

## Goals

1. 将稳定、可审查的人/团队选择与瞬时、可重建的执行事实分离。
2. 保留 Comet 成熟的 `Configure → Plan → Execute → Check` 顺序和精确恢复语义。
3. 让 Runtime 仍是 Action、Outcome 验证和 phase 推进的唯一权威，Agent/Host 不能自行选阶段或改策略。
4. 用依赖图精确失效 Strategy、Binding、Plan、Evidence 和 Work，而不是重建整个 Build Protocol。
5. 在预发布阶段一次性删除错误的可写协议，不维护双写或猜测式兼容层。

## Non-goals

- 不新增 Hotfix/Tweak profile、Direct execution、Executing Plans 或运行中模式升级。
- 不把实际 Skill composition 的代码、版本、配置身份并入 planning approval。
- 不新增第五类规划文档、第二套任务 checkbox 或独立 ADR。
- 不把本机绝对路径、正文、摘要原文或无界 identity 导出到 OpenSpec、共享配置或 OTLP。

## Decisions

### 1. BuildStrategy 是 Design 批准的稳定语义

`BuildStrategy` 采用以下预发布 schema：

```ts
interface BuildStrategy {
  schemaVersion: 1;
  strategyId: string;
  revision: number;
  executionMode: 'autonomous' | 'subagent-driven-development';
  tddMode: 'tdd' | 'direct';
  reviewMode: 'standard';
  isolationIntent: 'current' | 'branch' | 'worktree';
  semanticDigest: string;
}
```

`semanticDigest` 只规范化并散列四个策略字段及其 schema version；`strategyId` 由 Change/Run identity 与该摘要确定性派生，`revision` 只在语义摘要变化时递增。Strategy 不包含 Host、capability、仓库 HEAD、checkout path、worktree owner、actual composition identity 或批准记录。Design proposal 展示完整 Strategy，Design Human Decision 的 planning snapshot 引用其 semantic digest；批准本身仍由 planning approval authority 所有，避免 Strategy 再嵌入第二份 approval authority。

实际 Cordis composition 由已有独立 compatibility authority 比较 `same | compatible-adoption | migration_required`。兼容 adoption 可以更新当前 composition checkpoint 和受影响 Evidence，但不得刷新 Design approval；不兼容变化进入 `migration_required`，不得伪装为 Strategy 修改。

### 2. ExecutionBinding 是 Configure 解析的机器事实

`ExecutionBinding` 采用以下可移植核心：

```ts
interface ExecutionBinding {
  schemaVersion: 1;
  bindingId: string;
  revision: number;
  strategyDigest: string;
  host: {
    hostId: string;
    capabilityDigest: string;
  };
  repositories: Array<{
    repositoryId: string;
    branchRef: string;
    headRevision: string;
    isolation: 'current' | 'branch' | 'worktree';

```

Full source: openspec/changes/separate-build-strategy-and-execution-binding/design.md

## openspec/changes/separate-build-strategy-and-execution-binding/tasks.md

- Source: openspec/changes/separate-build-strategy-and-execution-binding/tasks.md
- Lines: 1-40
- SHA256: e94ae1953f72c451fae1a9c687e9e37a95b44307bd53f82a719314bd35c43f19

```md
# Tasks

## 1. 固定退化基线

- [ ] 1.1 为 Build Configure 重复批准、Host/checkout/HEAD 变化触发新决定、Verify 返工重复询问和 Plan 未预检 scope 增加历史旅程 red tests。 <!-- comet-task:05cd2200-79a6-4d1a-9d6b-e4d81dc8d0b8 -->
      **Acceptance:** 新测试分别证明四类旧行为会失败，且失败原因绑定重复决定、机器事实漂移、返工复用或缺失 preflight，而不是无关环境错误。
- [ ] 1.2 定义 `BuildStrategy`、`ExecutionBinding`、独立 digest/失效规则和预发布 schema 切换；运行领域单测。 <!-- comet-task:72e19e09-c249-43ad-bf86-b22f48ee075b -->
      **Acceptance:** 领域测试证明 Strategy 与 Binding 使用独立身份、摘要和失效规则，旧可写 `BuildConfiguration` schema 不再进入生产路径。
- [ ] 1.3 在不改变行为的前提下拆分主规格中超长的“规划授权失效必须原子恢复 Design checkpoint” Requirement，使全仓 OpenSpec strict validation 恢复为通过。 <!-- comet-task:3d26f41d-6da4-41a4-92b8-b31a78230db5 -->
      **Acceptance:** `openspec validate change-lifecycle --type spec --strict` 与 `openspec validate --all --strict` 都通过，拆分后的 scenarios 与原有授权、精确失效和权威正交语义一致。

## 2. Strategy 与 Design approval

- [ ] 2.1 从 Open/Design 输入产生完整 Strategy proposal，并把 Strategy 摘要纳入 planning snapshot 与 Design approval；运行 planning authority 与 composition compatibility tests。 <!-- comet-task:a04416b0-35c3-4bd8-8d7d-773688926156 -->
      **Acceptance:** Planning authority 测试证明 Design proposal 和批准绑定完整 Strategy；composition 实现身份不进入 approval semantic digest，兼容 adoption 不刷新批准，不兼容变化进入 `migration_required`。
- [ ] 2.2 实现 `decisionKind + semanticDigest` 创建、复用、supersede 和失效规则；运行重试、恢复、返工和真实语义变化测试。 <!-- comet-task:f1718834-e265-4284-bb8e-c04e5529e2cc -->
      **Acceptance:** 重试、恢复和同摘要返工只记录 reused；真实语义变化建立唯一新决定并把旧决定标记 superseded。

## 3. Binding 与 Build Configure

- [ ] 3.1 将 Configure 改为只解析/验证 ExecutionBinding，覆盖 current/branch/worktree、多仓 ownership、Host capability 和本地路径隔离。 <!-- comet-task:f01879d2-0ca9-4f01-8079-a347df6b1af6 -->
      **Acceptance:** Configure 测试覆盖三种 isolation、多仓 ownership、兼容与不兼容 Host，并证明绝对路径只存在本地 overlay。
- [ ] 3.2 删除旧 BuildConfiguration approval 生产路径和未发布兼容执行分支；运行架构边界与恢复测试。 <!-- comet-task:981953df-9058-4f29-a3b4-da5eac884f51 -->
      **Acceptance:** 定向搜索和架构测试证明没有旧配置批准生产入口或双写协议，旧状态只返回只读诊断和重新开始提示。

## 4. Plan Evidence 与返工

- [ ] 4.1 扩展 Plan Evidence 核对 Task/acceptance、repository/write scope、依赖、报告 owner、Host、Strategy、Binding 和 composition；运行越界/缺失 red-to-green tests。 <!-- comet-task:b1365a0b-4839-46b5-afce-f1edf4af3796 -->
      **Acceptance:** Plan Evidence 的 red-to-green 测试对每类缺失或越界输入 fail closed，完整输入才允许创建 Execute Work。
- [ ] 4.2 建立 Configure、Plan、Execute、Check、Verify→Build 和同摘要 fallback 矩阵，确认精确失效且无重复决定。 <!-- comet-task:5d6bb744-f0cc-40d3-9df1-303bc26a6ee5 -->
      **Acceptance:** 状态矩阵测试证明各类漂移只失效依赖旧输入的 Evidence/Work，Verify 返工与同摘要 fallback 不增加人工决定数量。

## 5. 观测与验收

- [ ] 5.1 增加 Strategy/Binding/Decision/Plan finding 的 Trajectory、OTLP、隐私、基数和离线复算测试。 <!-- comet-task:43579ae8-578e-44ad-bd3e-9521f776db05 -->
      **Acceptance:** 遥测测试覆盖全部新增事件、离线复算和有界枚举，并证明不会导出绝对路径、正文或高基数摘要片段。
- [ ] 5.2 更新 Desktop projection/UI，区分人工语义决定、自动 Binding 重验和历史复用/失效；运行 reducer、组件与 Windows 测试。 <!-- comet-task:993c22b8-3dd0-4c63-a740-0f6458135214 -->
      **Acceptance:** Reducer、组件与 Windows 测试证明当前有效决定只有一张待处理卡片，自动重验和历史决定具有不同的确定性展示状态。
- [ ] 5.3 更新文档，用真实单仓、多仓和跨 Runner 恢复执行 E2E，运行 `npm run spec:validate`、`npm run verify` 并生成正式验证报告。 <!-- comet-task:9773fc73-5b85-4c9d-bbbe-8da3f958b931 -->
      **Acceptance:** 文档命令可复现，三类 E2E、`npm run spec:validate` 与 `npm run verify` 全部成功，正式验证报告绑定最终提交和 Evidence。

```

## openspec/changes/separate-build-strategy-and-execution-binding/specs/change-lifecycle/spec.md

- Source: openspec/changes/separate-build-strategy-and-execution-binding/specs/change-lifecycle/spec.md
- Lines: 1-48
- SHA256: ce6c4536dd34f6b7c6d6b5bc81117e688f0a0956cad42d6e18a848531fc407c6

```md
# change-lifecycle Delta

## MODIFIED Requirements

### Requirement: Build Configuration 只允许受支持的固定策略

Repoctopus MUST 把 Build 的稳定人类/团队语义建模为版本化 `BuildStrategy`，仅允许 `executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard` 和 `isolationIntent=current|branch|worktree`。Design Human Decision MUST 绑定完整 Strategy semantic digest，但不得把实际 Skill composition 的代码、版本或配置身份并入批准摘要；Build Configure MUST 只解析和验证独立 `ExecutionBinding`，不得因兼容 Host 更换、能力重探测、正常 HEAD 变化、同 isolation 下修复 checkout、兼容 composition adoption、进程恢复或同摘要返工而重复请求批准。

#### Scenario: 用户批准受支持的配置

- **WHEN** Runtime 根据已批准 Open、仓库拓扑、Tasks 和用户选择提出合法 BuildStrategy，当前 composition 能兼容执行该策略，且可信用户批准 Design 语义摘要
- **THEN** Run 固定 Strategy identity/digest，后续 Configure、Plan、Work、Check 和遥测都引用该 Strategy，不再创建常规 Build Configuration approval

#### Scenario: 兼容 Host 或 checkout 变化

- **WHEN** 恢复时 Host 或本地 checkout 变化，但 capability、isolation intent、repository ownership 和全部 Strategy 语义仍满足
- **THEN** Runtime 重新验证并冻结新的 ExecutionBinding，使依赖旧输入的 Plan/Evidence 失效，但复用已批准 Strategy且不建立新 Human Decision

#### Scenario: 实际隔离没有可信 binding

- **WHEN** Runner 或 Host 只声明 isolation 名称，但没有为受影响仓库提供可验证 checkout、branch、head、worktree ownership 与 Workspace facts
- **THEN** Build Configure 阻断并报告 ExecutionBinding 诊断，不从路径或当前进程目录猜测，也不要求用户批准无法验证的机器事实

#### Scenario: 请求 Hotfix profile

- **WHEN** 调用方请求 Hotfix、Tweak 或任一未声明 workflow profile
- **THEN** Runtime 拒绝请求并保持唯一完整 Change lifecycle，不把 profile 映射成隐藏快捷路径

#### Scenario: 批准后请求切换执行模式

- **WHEN** 已批准 Strategy 的 execution/TDD/isolation 语义被显式改变
- **THEN** Runtime 使旧 Strategy approval 失效并建立绑定新语义摘要的 Human Decision，不静默重写或把机器 binding 重验冒充策略批准

#### Scenario: direct TDD 模式执行任务

- **WHEN** Strategy 选择 `tddMode=direct`
- **THEN** Work 可以不强制逐任务先红后绿，但仍必须声明相关测试、执行回归检查并通过 Build Check 与 Verify

## ADDED Requirements

### Requirement: Build 策略只在语义改变时请求人工决定

Repoctopus MUST 以 `decisionKind + semanticDigest` 判定 Human Decision 的创建、复用和失效。正常 Change 固定保留 Open 与 Design 两个审查边界；Design approval 绑定 BuildStrategy，但实际 Skill composition identity 只能由独立 compatibility authority 处理。相同摘要的重试、re-entry、恢复、兼容 composition adoption 和机器事实变化 MUST NOT 产生重复待处理请求。

#### Scenario: 同摘要返工重新进入 Build

- **WHEN** Verify finding 返回 Build，Strategy 摘要未改变且当前 composition 与既有 checkpoint 兼容
- **THEN** Runtime 复用原批准并从 Plan revision/ExecutionBinding 验证继续，不创建新的配置确认

```

## openspec/changes/separate-build-strategy-and-execution-binding/specs/desktop-observability-dashboard/spec.md

- Source: openspec/changes/separate-build-strategy-and-execution-binding/specs/desktop-observability-dashboard/spec.md
- Lines: 1-17
- SHA256: b2b5e962fd043bcb0f04c2a64af028b1619232b068467ed5f1779e8e62fa787f

```md
# desktop-observability-dashboard Delta

## ADDED Requirements

### Requirement: 人工等待只展示当前有效语义决定

桌面应用 MUST 从标准 OTLP 投影当前有效 Human Decision，并展示 phase、decision kind、有界 reason、创建时间和其绑定的 Strategy/Plan revision；实际 composition compatibility 作为独立状态展示，不得伪装成人工决定输入。相同 semantic digest 的重试、恢复或返工不得产生重复待处理卡片。界面 MUST 区分真正需要用户选择、Runtime 正在自动重验 ExecutionBinding/composition，以及历史已复用/失效决定。

#### Scenario: Build Configure 重验 checkout

- **WHEN** 当前 Strategy 已批准而 Runtime 正在验证新的 ExecutionBinding
- **THEN** Dashboard 显示自动验证状态和受影响 Work，不显示“请再次批准 Build Configuration”

#### Scenario: 相同摘要重复投递

- **WHEN** receiver 因 OTLP 重试收到同一 decision created/reused 事实
- **THEN** 投影收敛为一张当前卡片并保留历史事件，不增加待处理数量

```

## openspec/changes/separate-build-strategy-and-execution-binding/specs/development-telemetry/spec.md

- Source: openspec/changes/separate-build-strategy-and-execution-binding/specs/development-telemetry/spec.md
- Lines: 1-17
- SHA256: 06cda2278cacef168fb2faeeeffb65c2469b15482712d8c5e3174ecae49f3e5e

```md
# development-telemetry Delta

## ADDED Requirements

### Requirement: Build 策略绑定与人工等待必须可观测

Repoctopus MUST 分别记录 BuildStrategy proposed/approved/reused/invalidated、ExecutionBinding validated/drifted、Human Decision created/reused/superseded 和 Plan preflight finding，并保留 phase、Build action、strategy/binding revision、独立 composition identity、reason class 与 duration 关联。Composition identity MUST 只用于兼容性、执行和 Evidence 关联，不得成为 Strategy approval semantic digest。相同 Strategy semantic digest 的恢复、兼容 adoption 或返工 MUST 产生 decision reused 而不是新的 approval request；Metric labels MUST 只使用有界策略、结果和原因枚举。

#### Scenario: Configure 自动重验 binding

- **WHEN** Host 或 checkout 变化但批准 Strategy 语义未变，Runtime 接受新 ExecutionBinding
- **THEN** Trace 表示 binding revision 和受影响 Evidence invalidation，approval count 不增加且不导出 checkout 路径

#### Scenario: Plan 提前阻断越界写入

- **WHEN** Plan Evidence 发现 package write scope 超出任务或仓库边界
- **THEN** Trace 在 Execute 前记录有界 planning finding，使团队可计算 preflight catch rate，Metric 不使用路径文本作为 label

```

## openspec/changes/separate-build-strategy-and-execution-binding/specs/managed-work-execution/spec.md

- Source: openspec/changes/separate-build-strategy-and-execution-binding/specs/managed-work-execution/spec.md
- Lines: 1-62
- SHA256: 5d930d2fe670ef955d3818420c0e5128fb9544b570970453bf5b6fc73cd1ba34

```md
# managed-work-execution Delta

## MODIFIED Requirements

### Requirement: Build Configure 产生可批准的不可变配置

Runtime MUST 从已通过 Design Human Decision 的版本化 `BuildStrategy` 读取 execution/TDD/review/isolation intent，并根据当前 Run、仓库拓扑、隔离事实与 Host capabilities 解析独立 `ExecutionBinding`。Strategy 以稳定 identity、semantic digest 和 approval Evidence 固定；Binding 以 repository/branch/head/worktree ownership、capability digest、可移植 semantic digest 和只在本地保存的 path/local digest 固定；实际 Skill composition identity 由独立 compatibility authority 固定和验证。Agent 与 Host不得增删策略字段、以执行行为反向改写 Strategy，或把机器绑定/composition 变化变成人工策略选择。

#### Scenario: 多仓任务选择 subagent 模式

- **WHEN** 任务可按仓库和依赖边界形成 Work Package，且 Host 声明兼容协调能力，用户在 Design approval 中接受 subagent Strategy
- **THEN** Runtime 固定该 Strategy 并把模式绑定全部 Build Action，Configure 只验证实际 ExecutionBinding

#### Scenario: Host 不支持批准配置

- **WHEN** 恢复时当前 Host 不满足冻结 execution mode 的 capability contract
- **THEN** Runtime 在副作用前寻找或等待兼容 Host 并重新验证 Binding，不静默降级 Strategy；只有请求改变策略语义时才需要新 Human Decision

#### Scenario: 多仓 isolation binding 通过验证

- **WHEN** Runner 为批准的 current、branch 或 worktree intent 提供受影响仓库的本地 checkout facts
- **THEN** Runtime 以稳定 repository identity、branch、head、worktree identity、Workspace ownership 与 capability 验证 Binding；绝对路径只保存在本地 Run overlay

#### Scenario: 绑定变化但策略未变

- **WHEN** 同 isolation intent 下 checkout HEAD、Host 或本机路径发生兼容变化
- **THEN** Runtime 生成新 Binding identity、使依赖旧输入的 Plan/Evidence 失效并自动重验，不创建 Build Strategy approval

### Requirement: Plan Evidence 在执行前证明计划可行

Runtime MUST 在创建 Execute Work 前验证 BuildPlan 对批准 Tasks、验收、仓库拓扑、依赖、repository/write scope、terminal report ownership、Host capability、ExecutionBinding、有效 Skill composition 和 BuildStrategy 的完整覆盖，并持久化绑定当前输入的 Plan Evidence。

#### Scenario: 低风险计划自动通过

- **WHEN** Plan Validator 证明全部 Task/acceptance、仓库边界、write scope、报告归属、能力、绑定和 composition 被覆盖，且风险策略不要求暂停
- **THEN** Runtime 接受 Plan Evidence 并生成第一个就绪 Execute Work，不创建虚假人工审批

#### Scenario: 计划的 write scope 与任务不一致

- **WHEN** Work Package 请求写入未被 Task、definition 或目标仓库允许的路径
- **THEN** Plan Evidence 返回结构化 planning finding 并留在 Plan revision，不等到 Execute 工具调用后才失败

#### Scenario: 计划触发可选人工暂停

- **WHEN** 计划包含 definition 声明的高风险副作用、跨仓不可逆顺序或其他暂停条件
- **THEN** Runtime 建立绑定 Strategy、Binding 与 plan digest 的 Human Decision，在可信决定前不创建 Execute Work

#### Scenario: 计划输入漂移

- **WHEN** Tasks、验收、仓库拓扑、Strategy、Binding、能力快照、Skill composition 或计划 identity 与 Plan Evidence 输入不一致
- **THEN** Runtime 使旧 Evidence 失效并按变化权威返回 Plan revision、Design 或 `migration_required`；composition 漂移不得单独刷新 Strategy approval

## ADDED Requirements

### Requirement: BuildStrategy 与 ExecutionBinding 使用独立身份

Repoctopus MUST 分别持久化可移植 `BuildStrategy` 和本机可重建 `ExecutionBinding`，并让 Work input 同时引用两者。Strategy 变化表示人/团队语义变化；Binding 变化表示执行环境事实变化。Runtime MUST 使用不同 digest、Validator 和失效规则处理二者，且本机绝对路径不得进入 Strategy、OpenSpec 工件、共享配置摘要或 OTLP。

#### Scenario: 相同 Strategy 在另一台机器恢复

- **WHEN** 同一 Run 在具有兼容 Host 与仓库 checkout 的另一台 Runner 恢复
- **THEN** 已批准 Strategy 保持有效，Runtime 为新机器建立并验证新 Binding，再使依赖旧本地输入的 Work/Evidence 精确失效

```
