# Comet Design Handoff

- Change: preview-team-skill-bindings
- Phase: design
- Mode: compact
- Context hash: 9ced7e75dceca27742deb6ed6b20c27469adc659278e4174d5597333f9b6e846

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/preview-team-skill-bindings/proposal.md

- Source: openspec/changes/preview-team-skill-bindings/proposal.md
- Lines: 1-22
- SHA256: 766199da6adef22fab2c04bcfce138bcc24b2c871d69f3f5649472026cb89e47

```md
# 预览团队 Skill 的工作流绑定

## Why

团队可以用共享 YAML 将自定义 Skill 绑定到 Work，但目前只有单个 Skill 的查询入口。维护者在启动 Run 前需要知道配置最终会解析成什么、具体影响哪些 Work，以及错误应在哪修复。初始化生成的本地教程也缺少一套可以照做的示例。

## What Changes

- 新增启动 Run 前的只读预览，按 Work 列出 Skill、实际来源和装填顺序。对随执行配置变化的 Skill 显示条件。
- 返回可定位的配置错误，覆盖无效绑定、未知 Work 或 slot，以及当前环境无法加载或不允许参与团队生命周期的 Skill。
- 在生成的 Workspace 教程里串起 Skill 文件、共享 YAML、预览和团队提交，并说明如何刷新已有引导。

## Capabilities

### Modified Capabilities

- `skill-integration` 提供共享配置下的有效 Skill 组合预览。
- `project-configuration` 为 Workspace 本地引导提供完整的团队 Skill 示例。

## Impact

涉及 Repoctopus CLI、现有 Skill 组合服务和 Workspace 教程模板。团队继续使用 `lifecycle.skillBindings` 和当前 Skill Provider。IDE 手动安装和调用属于后续可独立交付的需求。

```

## openspec/changes/preview-team-skill-bindings/design.md

- Source: openspec/changes/preview-team-skill-bindings/design.md
- Lines: 1-21
- SHA256: 0f5a2813bbf848248ce22c45494aff05ad1a30ad9501daac40dec14c95ba2589

```md
# 团队 Skill 预览设计

## Context

`lifecycle.skillBindings` 已经将团队 Skill 绑定到 Work。现有 `skill get` 查单个 Skill，运行时则统一解析来源、验证绑定并编译 Work 的有效 Skill 组合。Build Execute 还有由 TDD 模式决定的运行时方法层。

## Goals / Non-Goals

维护者可以在启动 Run 前查看当前 Workspace 配置会如何生效，并据诊断修复配置。Workspace 受管教程提供从创建 Skill 到预览和提交的示例。本 Change 的入口只服务工作流接入，IDE 手动调用属于独立需求。

## Decisions

- 使用 `repoctopus skill preview --workspace .` 提供终端视图和 `--json`。复用项目配置和生命周期定义的读取，以及现有 Provider 解析和组合编译。以查询所需的服务为装配范围，排除 Run Store、遥测、桌面和交付的启动路径。
- 展示 Work 顺序、层的实际装填位置、Skill 名称、角色、选中的 Provider、来源类别及绑定或 slot。区分绑定的 `order` 与最终装填位置。复用 `buildActionSkillComposition` 和动态方法层的插入规则，在 Build Check 显示追加的 `code-review`，在 Build Execute 显示 TDD 与 direct 两种结果。
- 将现有配置和组合错误映射为可定位的 CLI 诊断，采用非零退出码。预览输出包含必要的元数据，省略正文、资源和本机绝对路径。现有接入流程支持声明可执行的团队 Provider。若该 Provider 无法在只读装配中安全查询，命令应指出该 Provider 并停止，避免静默切换到其他来源。
- Workspace 教程用一个独特的 API 兼容性审查 Skill 演示 `build.check` 的 guidance。示例列出文件内容、应合并的 YAML、实际预览命令及提交清单。已有 Workspace 复用受管引导刷新。
- 验收用真实 CLI 在隔离 Workspace 比较预览与实际领取的 Work。使用无效配置核对退出码和错误定位，对比预览前后的文件与 Run 状态，并检查宿主 Skill 目录没有产生新文件。

## Risks / Trade-offs

预览发生在 Run 和具体 Work 形成之前。能由配置与定义推导出的 Skill 层需要和真实派发一致，取决于执行配置的层则要显示条件。诊断应给出用户可以修改的字段或绑定，同时保留原组合校验的拒绝语义。已有独立的 IDE 补装流程继续负责宿主文件。

```

## openspec/changes/preview-team-skill-bindings/tasks.md

- Source: openspec/changes/preview-team-skill-bindings/tasks.md
- Lines: 1-12
- SHA256: c1202d61255005cff593ad0e8f2a4ded71eb69a4dd5696765e2fc4d0dab80870

```md
# Tasks

## 1. 查询与诊断

- [ ] 1.1 从现有生命周期与 Skill 组合服务生成只读预览。验收：每个 Work 的实际层、来源、角色、绑定和顺序可核对，Build Execute 明确区分 TDD 与 direct 的实际层。 <!-- comet-task:ce847853-95f1-4c27-8281-6db978b5b9e5 -->
- [ ] 1.2 将现有配置和组合错误呈现在 CLI。验收：无效 YAML、未知 Work 或 slot、缺少或不允许使用的 Skill 返回非零退出，并指出待修复的配置字段、绑定或 Skill。 <!-- comet-task:23672af6-62de-4836-a639-355b27e4f73c -->
- [ ] 1.3 提供终端与 JSON 命令。验收：在没有 Run 的 Workspace 成功查询，且不新增 Run、投影或 Skill 文件。结果仅包含预览元数据。 <!-- comet-task:675b22bf-ed28-40d6-aafa-571f19515c71 -->

## 2. Workspace 教程与验收

- [ ] 2.1 在生成的 Workspace 教程及公开 Skill 文档中加入完整示例。验收：依次提供 Skill 正文、现有 YAML 绑定、预览命令和提交文件清单。现有受管引导刷新可交付新示例。 <!-- comet-task:e8f2b4c5-f0cf-4676-8291-9708c8778679 -->
- [ ] 2.2 用候选安装包验证示例、失败诊断和与实际 Work 的一致性。验收：在隔离 Workspace 从无 Run 开始验证预览及其读写边界，比较真实领取的 Skill 层，并记录严格校验与项目验证结果。 <!-- comet-task:581be1ee-cb39-4071-a57d-081f426e1ac8 -->

```

## openspec/changes/preview-team-skill-bindings/.openspec.yaml

- Source: openspec/changes/preview-team-skill-bindings/.openspec.yaml
- Lines: 1-2
- SHA256: 95a9a7d17f5cbd573f5ec85bba1fef77465d4658dc49a60203cbef4f4af5f8df

```md
schema: spec-driven
created: 2026-11-15

```

## openspec/changes/preview-team-skill-bindings/specs/project-configuration/spec.md

- Source: openspec/changes/preview-team-skill-bindings/specs/project-configuration/spec.md
- Lines: 1-18
- SHA256: 5bd6e2a0c51f785f440ba156c0bdc1167eeee42a234d4db6e6d70dfc853a8c6d

```md
# Workspace 团队 Skill 教程规范

## ADDED Requirements

### Requirement: 初始化引导提供可照做的团队 Skill 示例

Workspace 本地教程 MUST 提供团队 Skill 的完整示例，包括项目默认查找目录、带有效元数据的 Skill、用现有 `lifecycle.skillBindings` 添加指导的 YAML、绑定预览命令及团队提交清单。

#### Scenario: 维护者首次添加项目团队 Skill

- **WHEN** 维护者照 Workspace 教程创建 Skill 文件并合并示例配置
- **THEN** 可以通过实际公开预览命令看到示例 Skill 的 Work、来源和顺序
- **AND** 教程说明把共享 YAML、Skill 正文及其所需资源一同提交

#### Scenario: 维护者从旧版 Workspace 获取教程

- **WHEN** 维护者用获批的引导刷新更新现有 Workspace
- **THEN** 受管教程包含团队 Skill 示例，区块外的团队内容保留

```

## openspec/changes/preview-team-skill-bindings/specs/skill-integration/spec.md

- Source: openspec/changes/preview-team-skill-bindings/specs/skill-integration/spec.md
- Lines: 1-30
- SHA256: ace0061d2b30846f6086689bd3d71132a8103143ea68ffd032387631b5d5df05

```md
# Skill 绑定预览规范

## ADDED Requirements

### Requirement: 启动 Run 前可以预览团队 Skill 组合

Repoctopus MUST 提供共享配置下的只读预览，使用与 Run 相同的生命周期定义、Skill Provider 解析与组合规则。有效结果 MUST 按 Work 展示 Skill 名称、角色、实际 Provider 与来源类别、实际装填顺序及适用的绑定 ID 或方法 slot。随执行配置变化的层 MUST 标明适用条件。

#### Scenario: 团队查看多个 Work 的生效绑定

- **WHEN** 维护者为 Build Check 添加团队指导，并通过已公开的 Design slot 替换默认方法
- **THEN** 预览分别显示两个 Work 的实际组合和顺序，保留各 Work 的 Action 层，并列出其余 Work 的默认组合
- **AND** 每个自定义层可追溯到 YAML 绑定与当前 Workspace 实际解析出的 Provider 和来源

#### Scenario: Build Execute 的 TDD 层取决于执行配置

- **WHEN** 维护者在任何 Run 创建前查看 Build Execute
- **THEN** 预览明确显示只有 TDD 模式会装填 TDD 方法，并反映该层与团队指导之间的实际顺序

#### Scenario: 配置或来源无效

- **WHEN** YAML 无效、目标 Work 或 slot 不存在、Skill 无法解析，或解析到禁止参与生命周期的来源
- **THEN** 预览返回非零退出码和可定位的诊断，并指明错误对应的配置字段、绑定或 Skill
- **AND** 响应不把无效配置列为可用组合

#### Scenario: Workspace 尚未创建任何 Run

- **WHEN** 维护者在新接入的 Workspace 或已有 Run 的 Workspace 查看预览
- **THEN** 命令不创建或推进 Run，不执行 Skill，不写入项目配置、Skill 文件或投影，也不需要 Run ID
- **AND** 输出提供装填元数据，省略 Skill 正文、资源内容和本机绝对路径

```
