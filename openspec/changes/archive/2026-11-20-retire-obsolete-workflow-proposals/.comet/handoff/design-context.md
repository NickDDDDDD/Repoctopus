# Comet Design Handoff

- Change: retire-obsolete-workflow-proposals
- Phase: design
- Mode: compact
- Context hash: 5aef2a952a77de1cdbe125e780b4a524a9b44ea191e56905f2910c7b2fb7ae3d

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/retire-obsolete-workflow-proposals/proposal.md

- Source: openspec/changes/retire-obsolete-workflow-proposals/proposal.md
- Lines: 1-29
- SHA256: ec649e264d127d346e3cde6c0e92d847577de15ea1d070672385736ae1348e6b

```md
# Proposal

## Why

三个旧提案仍列在活动 Change 中，但其部分目标已由现有能力覆盖，部分方案已不再采用。它们没有可续接的 Comet 状态，继续展示为待实施任务会混淆当前工作范围。

## What Changes

- 撤出 `add-managed-team-required-checks`、`verify-open-intake-method`、`verify-tdd-method` 三个活动提案，记录取消、暂缓及保留目标的理由和原始 Git 坐标。
- 取消 Open 通用 Method Receipt 及自动判定 Agent 已理解需求的方案；保留现有 Skill 交付、规格校验与人工审查职责。
- 暂缓独立团队检查 Work；普通命令检查继续使用已有 Verify Profile，不宣称二者能力等价。
- 从旧 TDD 方案只保留后续目标：利用现有命令 Evidence 核验真实 RED/GREEN/回归执行。将来排期重新设计，不继承旧通用 Receipt 框架或旧任务清单。
- 清理活动引用；历史验证报告保持原样。旧提案不按已实现 Change 归档，不勾选旧任务，不应用旧 delta specs。

本次仅交付文档整理。Runtime、技能加载、验证行为与遥测均不变，不开发上述后续能力。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本次没有规格级行为变化，使用 `skip_specs: true`。

## Impact

涉及三个旧 Change 目录、当前 Change 的设计记录，以及文档中的当前状态说明。引入一份简短的处理结论与后续目标索引；该索引不包含第二套规格或执行任务。无第三方源码采用、依赖或许可证变化，无发布包及兼容性变化。

```

## openspec/changes/retire-obsolete-workflow-proposals/design.md

- Source: openspec/changes/retire-obsolete-workflow-proposals/design.md
- Lines: 1-46
- SHA256: 11f751b74b82a01c8a6becc0d51a0d0b38eb40c677b3267e042d3f791f32dcbf

```md
# Design

## Context

背景见 [proposal.md](proposal.md)。整理基线为 `47779021e06418b7edbdd57f44922e65f7933522`。三个旧提案均来自 `37c04f4`（2026-10-31，`docs(spec): split team skill composition delivery`），合计 26 项未勾选任务；没有可恢复的 Comet 状态。

| 原活动提案 | 当前能力与缺口 | 本次处理 |
| --- | --- | --- |
| `add-managed-team-required-checks` | 团队 Skill 支持 guidance、augmentation-replacement；Verify Profile 支持 required 命令节点；尚不支持旧提案的独立 Agent 检查 Work | 暂缓独立 Work，不继续这份旧计划；一般命令检查复用现有 Profile |
| `verify-open-intake-method` | 已有 Skill 交付/消费记录、当前 Work outcome、Provider 严格校验和 Open 人工批准；消费记录不证明语义理解 | 取消通用 Method Receipt 与自动理解判定方案 |
| `verify-tdd-method` | 已有 TDD 策略、行为切片和 RED/GREEN/回归引用；引用的结构检查尚不等于真实命令 Evidence 核验 | 撤回旧方案，仅保留重新设计的后续目标 |

代码核对入口：`domains/project-configuration/config.ts`、`domains/evidence/types.ts`、`services/workflow-runs.ts`、`domains/change-lifecycle/build-protocol.ts`、`services/managed-work-executor.ts`。当前主规格与说明见 `openspec/specs/skill-integration/spec.md`、`openspec/specs/project-configuration/spec.md`、`docs/skills.md`、`docs/evidence.md`。

## Goals / Non-Goals

只整理活动清单、记录处置与保留一个后续目标。Engine、Cordis Service、领域模块、平台适配器及多仓状态均不改动；不新增方法回执、检查 Work、TDD 校验代码、迁移逻辑或遥测。既有验证报告与实验现场保持原样。

## Decisions

### 用撤回记录区分计划和已交付事实

实施时删除三个旧活动目录，并新增 `docs/workflow-follow-ups.md`，记录每个提案的原路径、源提交、处置原因与重新提案条件。原文通过 `git show 37c04f4:openspec/changes/<name>/proposal.md` 等命令查阅，完整历史由 Git 保留。

不把旧目录移入普通 Archive，不同步其 delta specs，不把旧任务改成完成。这避免后续读者将取消或暂缓误认为交付。相比保留旧目录再加状态标记，移出活动目录也能避免缺失状态的旧提案持续参与恢复探针。

### 后续索引只保存目标

TDD 后续目标为：将 Host 提交的 RED/GREEN/回归引用解析到真实命令 Evidence，核对所属 Run/Work/工作包、执行输入、结果及执行顺序；预期失败是否符合行为意图仍由 Host 和审查判断。具体模型、安全边界、验收与排期留给新 Change，不复用旧任务清单，也不承诺本次交付。

索引只记录处置和目标，没有可执行任务列表，也不产生第二套规格权威。独立团队检查 Work 仅说明暂缓及当前替代能力的边界，不列为本版承诺。

### 借鉴已核实的 Comet 边界

固定 Comet 源码基线 `35c9860b77b42bafa0c2d80d8d695889f888a924`（0.5.1）的 Classic 方法通过 Skill、真实执行与审查要求约束 TDD；未找到旧提案所设想的通用 Method Receipt 框架。Native 的实际 check receipt 可作为未来命令证据绑定的参考，但不能直接视为 TDD 周期的语义证明。本次不引入源码或升级上游。

## Risks / Trade-offs

- 旧提案删除容易被误读为已实现：处置索引明确标记取消或暂缓，附 Git 坐标，不改历史完成事实。
- 一般命令检查与独立 Agent Work 不等价：记录其适用范围，未来有真实团队需求时重新提案。
- 文档引用失效：盘点当前说明中的链接并更新；历史验证报告中的原始叙述保留，读者可从索引追溯原文。
- 发现主规格与以上处置冲突，或必须改 Runtime 才能完成整理时，停止并报告范围差异，不借 housekeeping 实施功能变更。

## Migration Plan

没有 Runtime 或数据迁移。Build 阶段完成处置索引、三个目录的撤回与当前引用清理。Verify 核对 OpenSpec 严格校验、Git diff、原文可追溯性和活动 Change 清单；不对文档变更制造 RED/GREEN，也不重新运行无关多仓发布实验。回退可通过还原文档提交恢复旧目录，不修改已有 Run。

```

## openspec/changes/retire-obsolete-workflow-proposals/tasks.md

- Source: openspec/changes/retire-obsolete-workflow-proposals/tasks.md
- Lines: 1-14
- SHA256: 35a4dd994714f3243f8fa56dd54ff4af790956e9132c77b728f049ce344e5710

```md
# Tasks

## 1. 旧提案处置

- [ ] 1.1 新增 `docs/workflow-follow-ups.md`，记录三个旧提案的取消或暂缓结论、原因、原路径及源提交，只保留 TDD 真实命令 Evidence 核验目标；验收：逐项与 design.md 的处置表核对，原文可通过 `git show 37c04f4:<原路径>` 读取，索引没有执行任务或新规格。 <!-- comet-task:1d7297e6-ccd1-498a-99b8-4ed83520bdba -->
- [ ] 1.2 撤出三个旧活动目录并清理当前文档的活动引用；验收：`comet classic openspec -- list --json` 不再列出这三项，`git diff --name-status` 仅包含本次规划、处置文档及三个旧目录，不产生旧提案 Archive 或主规格修改。 <!-- comet-task:c851389a-95dc-415f-ac37-4ac51191344d -->

## 2. 整理结果验证

- [ ] 2.1 验证严格校验、链接和历史追溯，形成正式验证报告；验收：`comet classic openspec -- validate retire-obsolete-workflow-proposals --strict --no-interactive`、`git diff --check` 通过，逐一检查处置索引及历史坐标，确认未修改 Runtime、既有验证报告或旧任务完成事实。 <!-- comet-task:13bff3a4-d43b-49d2-a381-4a6e65f1d797 -->

## Workflow follow-up

- 经当前归档与交付目标确认后归档本次整理 Change；不将旧提案的 delta specs 同步到主规格。

```

## openspec/changes/retire-obsolete-workflow-proposals/.openspec.yaml

- Source: openspec/changes/retire-obsolete-workflow-proposals/.openspec.yaml
- Lines: 1-3
- SHA256: fbc0c7ff72420ffdc980cf0329136b2732845d9701cd9ef0fd8a9b96292fca7c

```md
schema: spec-driven
created: 2026-11-19
skip_specs: true

```
