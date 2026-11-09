# Comet Design Handoff

- Change: add-workspace-onboarding-guides
- Phase: design
- Mode: compact
- Context hash: df26b30b875b0da488688bf5c43fc022877771d112014e2e3bbe3256a3efbea5

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/add-workspace-onboarding-guides/proposal.md

- Source: openspec/changes/add-workspace-onboarding-guides/proposal.md
- Lines: 1-33
- SHA256: 74aef4c179b4d1e6e59f9e63a322208a0963ed58fbc0c1d338b4af2af2cd3098

```md
# Proposal

## Why

通过 Release 安装 CLI 并完成项目接入后，Workspace 只有配置和规格根，没有面向团队成员的使用入口，也没有新 Agent 可直接读取的工作流指令。用户需要返回 Repoctopus 产品仓查教程，Agent 则可能绕过已建立的 Runtime 工作流。

## What Changes

- 在获批项目接入中生成 Workspace 级 `README.md` 使用入口、`AGENTS.md` 执行入口和本地教程 `docs/repoctopus/workspace-guide.md`，以多仓场景为主，同时覆盖业务仓兼任 Workspace 的单仓场景。
- 引导团队成员从已安装 CLI 启动、查看和恢复 Change，了解共享配置、本机覆盖、Store 登记、SigNoz OTLP 地址及共享文件提交范围；基本用法不依赖回产品仓阅读文档。
- Agent 入口使用现有公共 CLI 和 Runtime 返回的 continuation、Work 及真实 Skill 内容，不新增文件驱动的阶段推进规则或第二套任务权威。
- 借鉴固定 Comet 的受管 Markdown 区块方式，保护已有项目说明与 Agent 规则；只维护明确标记的 Repoctopus 内容，重复执行与中断恢复不能产生重复区块或虚假接入完成状态。
- 从实际候选 tarball 安装后验证引导产物、相对链接和公共命令，覆盖多仓、单仓、已有文件及拒绝审批场景。

本次不增加 IDE 专用安装器、后台守护进程、自动选择活动 Run、独立文档管理命令或遥测字段改名；不更换 OpenSpec Store 布局，不改五阶段状态机，不在接入时 commit、push、创建 MR 或发布新 Release。已接入团队可通过现有 detect → prepare → review 流程，以原共享配置为候选获批补齐引导。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-configuration`: 扩展获批接入的共享产物、现有内容保护、可恢复写入和本地人机使用入口契约。
- `product-distribution`: 实际发布候选必须能在独立消费者环境完成初始化并生成可用引导，不依赖源码 checkout 或开发文件。

## Impact

- 主要边界：`ProjectOnboarding` 既有 Cordis Service 与项目接入平台适配器；新增文档模板、受管内容规划及受限文件写入，不建立平行 Runtime。
- 文档：产品首次接入说明与生成后的 Workspace 文档；不把产品开发用 Comet 配置、开发者 AGENTS 或内部绝对路径复制到团队项目。
- 测试：项目接入回归、公共 CLI 接入验收和真实 tarball 生产安装验收。
- 参考固定 Comet `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 `domains/skill/project-instructions.ts` 与 `managed-markdown.ts` 的所有权、幂等及区块校验思路；保留 Repoctopus 现有 Cordis / Service / filesystem 边界。若实施中实际采用上游代码，须同步现有来源清单及许可证审计；本提案不引入 Comet SDK 或新依赖。

```

## openspec/changes/add-workspace-onboarding-guides/design.md

- Source: openspec/changes/add-workspace-onboarding-guides/design.md
- Lines: 1-81
- SHA256: c24212f1be42f0b320e5bf41b2ca32e3c8008653f457a98eb8a09f65930ae113

[TRUNCATED]

```md
# Design

## Context

动机和边界见 `proposal.md`。当前接入经 `ProjectOnboarding` Cordis Service 调用平台层 `prepareProjectConfigurationDecision` / `applyProjectConfigurationDecision`。获批 apply 先完成 OpenSpec Root、Store、业务仓 pointer，再写共享配置与完成状态；重试通过原 request 及 Intent/Receipt 恢复，confirmed 请求直接返回原结果。

根 README 与 AGENTS 是宿主团队文件，不能复制产品仓的 README 或 Comet 自举规则。当前产品没有 `run list` 或 ambient resume probe；`run status`、`run resume`、`run next` 等都需要真实 Run 身份。共享 AGENTS 一旦被 Git 跟踪，仍按既有产品输入规则处理，不能借本次引导修改 Evidence 的排除策略。

## Goals / Non-Goals

**Goals:**

- 在既有可信接入边界提供最小的人机入口和完整本地教程。
- 支持多仓与单仓，保留已有说明、Agent 规则和用户编辑。
- 对受管区块、文件类型、受限路径和中断重试有明确行为，不引入新的状态机。
- 安装后的实际 CLI 能生成并使用这些文件，示例与当前公开命令一致。

**Non-Goals:**

- 不生成 IDE 专属 Skill 目录、CLAUDE/GEMINI 等平台文件或独立 Runner。
- 不新增文档更新命令、自动 Run 选择、后台恢复探针或文件驱动的权限。
- 不新增配置字段、遥测协议或 Registry；不迁移旧 Run/Store，不在此 Change 发版。

## Decisions

### 1. 两个短入口与一份本地教程

README 安装简短的 Workspace 说明、已批准仓库的相对关系及本地教程链接；AGENTS 安装可执行的工作流入口；`docs/repoctopus/workspace-guide.md` 保存人可阅读的完整教程。三者都有明确的 Repoctopus 受管区块，区块外可由团队维护。

相较将整份教程复制到两个根文件，这样不会膨胀已有业务 README 或 Agent 的默认上下文。相较只链接 GitHub，基础用法可以离线阅读。教程按安装、首次任务、新成员与恢复等用例组织，包含共享 `repoctopus.yaml`、本机 `.repoctopus/local.yaml`、Store 登记、可选 SigNoz `telemetry.endpoint`、凭据仅从环境提供及共享产物的 Git 提交范围。

渲染使用已批准的共享配置和包内维护的模板，动态内容限于可移植仓库 ID/相对路径及 Store 逻辑身份。禁止嵌入安装机器绝对路径、真实 Header/凭据和开发者身份。不把 v0.1.0 或本地 Release 地址固化到团队教程；要求使用团队指定版本，并给出公开发布入口和 CLI 可用性检查。

### 2. Agent 文件只引导到真实 Runtime

AGENTS 先指向本地教程及共享配置，区分用户给出的新建或恢复目标。已有 runId 时使用原 Run；身份不明时先核对，不通过解析 Store 私有文件猜阶段。领取 Work、消费 Skill 正文、提交 Outcome、处理 Human Decision、失败和未知副作用，均遵循公共 CLI 返回的 packet 与 continuation。

不在模板里复制五阶段合法转换表、硬编码 Skill 名单或替用户批准。用户显式选择其他工作流时保留其选择，不用新指令块压过既有明确授权。基础说明不依赖外部 IDE 会自动识别任意特定目录或斜杠命令。

### 3. 借鉴 Comet 的受管内容所有权，复用本地文件适配器

固定上游 Comet `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 `domains/skill/project-instructions.ts`、`managed-markdown.ts` 及对应测试，提供缺失时创建、存在时追加、仅替换自身区块、重复/残缺标记拒绝和换行保持的成熟思路。

本次在现有项目接入平台边界实现小型、可测试的受管 Markdown 渲染/合并与安装能力，文件提交继续使用 `platform/filesystem/atomic-write.ts` 的 containedRoot、exclusive 与提交前检查。保留区块外原始字节，不通过重排/格式化整份文件实现更新。三份目标及父目录在产生接入副作用前统一预检，写入前再次核对观察到的内容/身份，出现变化时停止而不覆盖；拒绝非普通文件与符号链接，不为此引入复杂 alias 兼容。

安装器分为纯渲染/区块合并与文件观察/提交两个部分：前者只接收批准后的逻辑配置和旧文本，后者保留每个目标的原始字节与文件身份。现有文件只替换区块所在的字节区间，缺少区块时追加，区块外混合换行或无结尾换行不能因整体规范化而变化；新文件使用一致的 UTF-8 文本格式。相同渲染结果不重新写文件。不存在的文件使用 exclusive 创建；现有文件在原子替换的提交前重新核对当前内容与身份。父目录预检只观察，实际创建目录交给 containedRoot 原子写入，不在 detect/prepare 或冲突预检时创建共享目录。

只借鉴实现思路时不增加来源登记；若实际复制或改编上游实现，采用现有 `third-party` 来源和许可证审计，不能把复制的文件伪装为原创。不导入 Comet SDK，不改变 Cordis 生命周期或 Service 依赖。

### 4. 插入既有接入事务，不建立第二本 journal

prepare 不生成共享引导。可信 review 的现有摘要说明三份文件的受管写入范围，不新增一轮人工审批。apply 在原批准与 candidate digest 验证后规划/预检引导，沿用原 Store binding Intent/Receipt 完成前置事实，再安装引导与 `.gitignore`，最后发布新 `repoctopus.yaml` 并确认请求。

具体边界仍在既有 `ProjectOnboarding` Service 后的项目接入平台层，不增加 Engine、Plugin 或配置入口。保持当前请求/响应 Schema：review 通过现有候选和固定输出约定说明受管文件范围，安装器不向项目共享配置塞入模板、绝对路径或 Loader 字段。固定输出和故障处理作为本版本接入行为的一部分，由同一可信批准控制。

部分引导成功后失败不删除任何已有文件；原 applying 请求重试时重新观察，已符合的区块不重复写，区块外新内容保留。写入完成且产物复核成功才能记录 confirmed。confirmed 重放仍返回已有结果，不利用升级包静默扩大旧批准的效果。

已接入团队更新后，以现有共享配置为候选重新走 detect → prepare → review；复用既有健康 Root/登记与 pointer，只补齐或刷新引导。无状态迁移，也不要求删配置或旧 Run。文档同其他共享产物一样由团队走 Git，不在初始化时自动 commit/push/MR。

### 5. 验收分层且保持真实交互边界

- 受管文件回归先给出真实 RED，再覆盖创建、追加、区块替换、幂等、CRLF/无结尾换行、重复/残缺区块、路径冲突与并发变化。
- 接入回归覆盖 detect/prepare/reject/request_changes 无共享文件写入、多仓与单仓、引导失败不确认/不提前发布新配置、同一请求中断恢复及 confirmed 幂等。
- 文档内容按 docs-writing 与 agents-md 的可执行命令、短入口、按需展开原则审查。相对链接实际解析；仅检查字面字符串不足以证明命令可运行。
- 公共 CLI 与候选 tarball 独立安装验收覆盖实际 detect/prepare/review、生成引导及后续启动/状态/新进程恢复；`project review` 目前要求真实交互终端，因此交互批准部分使用真实 PTY，并保留命令、退出码和结果证据。不得通过伪造 `isTTY`、新生产测试后门或导入源码 apply 来冒充安装包审批验收。
- 已用当前宿主的 Windows PTY 执行无副作用的 Node 探针，实际 `stdin.isTTY` 和 `stdout.isTTY` 均为 true。实施验收将使用同一终端能力运行已安装 CLI；该能力探针只证明真实交互路径可用，不代表接入或模板已通过验收。
- 覆盖新建多仓和已有说明的单仓；对原 README/AGENTS 的区块外内容做字节比较。测试使用隔离 Registry，清理临时消费者，不触及之前五仓实验的 Run。
- 无新增 OTel 埋点需求；保证现有接入与 Run 观测契约不变，文档说明现有 OTLP URL 配置，不修改字段名。

## Risks / Trade-offs

- 团队可能编辑受管区块 → 文件内说明更新范围，团队规则置于区块外；标记不完整时明确阻断。
- 三份引导不是跨文件原子事务 → 逐文件原子写入并沿原 request 恢复，完成状态最后保存；不承诺失败时回滚或删除团队文件。
- 教程随产品演进过期 → 模板属于发布包维护面，实际包验收执行示例；新获批接入更新受管内容，不靠开发者手工同步团队仓。
- 新 Agent 仅有文件仍可能不遵循 → 文件负责入口发现，安全和状态合法性继续由 Runtime 强制验证，不将提示词当成已执行 Skill 或成功证据。
- 现有 README/AGENTS/教程路径冲突 → 预检报具体文件和原因，不另选隐蔽路径或自动覆盖。
- 文件被不遵循本进程约定的外部工具持续写入 → 使用提交前文件身份与内容复核检测已观察到的变化，发生冲突时保留原请求并重试；不把现有原子替换原语描述为跨进程文件锁或跨文件事务。

## Migration Plan


```

Full source: openspec/changes/add-workspace-onboarding-guides/design.md

## openspec/changes/add-workspace-onboarding-guides/tasks.md

- Source: openspec/changes/add-workspace-onboarding-guides/tasks.md
- Lines: 1-17
- SHA256: 835dd34d2438cb8a94e933f4c681889f390e4f81549d95b3ddafc0bbd9a96ee8

```md
# Tasks

## 1. 获批接入的本地引导

- [ ] 1.1 交付空白 Workspace 的 README 短入口、AGENTS 执行入口和本地教程模板，并接入现有获批 apply；以真实 RED→GREEN 接入回归证明三份文件均可生成、相对链接有效，模板不包含产品 checkout 或开发者绝对路径。 <!-- comet-task:579fe2e4-b9fa-4798-88f1-4e7a1552f20b -->
- [ ] 1.2 完善受管 Markdown 安装器的内容所有权、换行、文件类型和路径保护；以针对性回归证明已有团队文本字节不变，幂等无重复，残缺/重复标记、符号链接与并发变化被拒绝，并核对实际采用上游代码时的现有许可证与来源登记。 <!-- comet-task:60f2e194-a82d-4b54-b769-27d5b87600e4 -->
- [ ] 1.3 完成引导预检、配置最后发布和同一请求恢复的协作；以接入测试证明 detect/prepare/reject/request_changes 不写共享引导、部分写入后可以续接、失败不记录 confirmed、不提前发布新配置，且 confirmed 重放维持原有幂等结果。 <!-- comet-task:ffd162e4-1c89-4fde-a076-f43c38b3d97e -->

## 2. 团队入口与实际安装包验收

- [ ] 2.1 更新现有接入审批摘要及产品接入说明，说明三份引导的受管范围、已有团队的补齐步骤和共享文件提交范围；核对生成教程的多仓/单仓、新成员、Run、配置与 SigNoz 示例均匹配公共 CLI，根 AGENTS 只保留短入口，不重建阶段或 Skill 权威。 <!-- comet-task:56a8c9c8-4b37-4b58-a6cd-e5ffddd1c3ff -->
- [ ] 2.2 扩展公共 CLI 与候选包集成验收，并从指定 tarball 生产安装后用真实 PTY 执行接入 review；验证多仓新 Workspace、已有说明的单仓、拒绝审批、启动/状态/新进程恢复和全部本地链接，保留包身份、命令、退出码及原始内容比较证据，不用源码 apply 或伪造 isTTY 代替安装后交互。 <!-- comet-task:74562c66-1331-4a9f-b04f-0e8e84857fdc -->

## Workflow follow-up

- 以上任务完成后，由 Comet 执行独立 Verify 和归档/交付决定；不把归档、PR 或 Release 当作 Build 完成复选框。
- 本 Change 不公开新的 Release；后续版本应从合入后通过 CI 的精确 main 提交构建并验证实际发布资产。

```

## openspec/changes/add-workspace-onboarding-guides/.openspec.yaml

- Source: openspec/changes/add-workspace-onboarding-guides/.openspec.yaml
- Lines: 1-2
- SHA256: 309e6764c826c3fc6250bcce33b56b7e44adebafc76c7df25f058663d6de4299

```md
schema: spec-driven
created: 2026-11-09

```

## openspec/changes/add-workspace-onboarding-guides/specs/product-distribution/spec.md

- Source: openspec/changes/add-workspace-onboarding-guides/specs/product-distribution/spec.md
- Lines: 1-28
- SHA256: b99a3520413d821220a4a1843005c5303608b8ebc270c7c7564f748b10ce1640

```md
# Spec Delta

## ADDED Requirements

### Requirement: 发布包初始化生成可用的 Workspace 引导

Repoctopus MUST 在实际候选 tarball 的独立生产安装环境中，通过已安装的公共 CLI 完成获批项目接入，验证 README、AGENTS 和 Workspace 内教程能够生成并用于基本操作。验收 MUST 覆盖新建多仓 Workspace 与已有说明文件的单仓项目，验证本地链接、公开命令以及未批准请求的无共享文件副作用；不得注入源码开发文件才能通过。

#### Scenario: 从候选 tarball 初始化多仓 Workspace

- **WHEN** 候选包仅安装生产依赖，用户在与产品源码无关的临时多仓项目中通过公共 CLI 完成 detect、prepare 和可信 review
- **THEN** Workspace 存在可阅读的人与 Agent 引导和完整本地教程，链接均指向有效文件，教程使用的启动、状态及恢复命令能由已安装 CLI 解析和执行
- **AND** Agent 指令不依赖未随包提供的 Skill 文件、产品 AGENTS、开发 lockfile 或产品 checkout 路径

#### Scenario: 单仓已有团队说明与 Agent 规则

- **WHEN** 同一候选包为已有 README 和 AGENTS 的单仓项目完成接入
- **THEN** 保留原有内容，生成与单仓布局一致的受管入口，并能够按教程进入受管工作流

#### Scenario: 未批准初始化或引导资源不可用

- **WHEN** 接入被拒绝、仅停在草稿或准备阶段，或者发布包缺少引导所需资源
- **THEN** 前两种情况不修改共享引导文件，资源缺失则接入或候选验收明确失败，不把源码模板可用视为安装包可用

#### Scenario: 模板内容与当前公共 CLI 不一致

- **WHEN** 生成教程引用不存在的子命令、必需参数错误、缺失的本地教程或未分发的源码路径
- **THEN** 候选验收失败并指出具体命令或链接，不将该候选报告为完整初始化可用

```

## openspec/changes/add-workspace-onboarding-guides/specs/project-configuration/spec.md

- Source: openspec/changes/add-workspace-onboarding-guides/specs/project-configuration/spec.md
- Lines: 1-77
- SHA256: 3c1d1e6808f92b0aecb28198d78cd2132f68443fed5e561525eb99755c9d0c2c

```md
# Spec Delta

## ADDED Requirements

### Requirement: 获批 Workspace 接入提供本地使用入口

Repoctopus MUST 在可信用户批准的项目接入中，为 Workspace 根提供 `README.md` 和 `AGENTS.md` 引导，并提供 Workspace 内可直接阅读的使用教程。引导 MUST 适用于独立的多仓 Workspace 和业务仓兼任 Workspace 的单仓项目；接入完成前 MUST 核对这些产物已物化。探测、准备审批、拒绝或请求修改不得安装这些共享文件。

#### Scenario: 全新多仓 Workspace 完成接入

- **WHEN** 用户批准有效多仓候选且接入成功
- **THEN** Workspace 根存在 README 和 AGENTS 引导，README 的本地教程链接可解析，教程说明该 Workspace 与已登记业务仓的关系
- **AND** 业务仓的 README 和 Agent 指令保持原样

#### Scenario: 单仓项目完成接入

- **WHEN** 用户批准业务仓兼任 Workspace 的候选
- **THEN** 引导说明规格、配置与业务代码同仓的用法，不要求额外创建一个 Workspace 仓

#### Scenario: 尚未批准项目接入

- **WHEN** 用户只执行 detect 或 prepare，或者选择 reject 或 request_changes
- **THEN** README、AGENTS 和本地教程保持原样，不产生声称已经接入的文档

### Requirement: Workspace 引导保留团队自有内容

Repoctopus MUST 只创建缺失的引导文件或维护明确标记的 Repoctopus 受管区块，保留区块外原始内容及原有换行格式。重复执行 MUST 不产生重复区块。重复、嵌套或残缺的受管标记、非普通文件及不安全的路径 MUST 返回可定位冲突，不覆盖或解引用该目标，也不得返回成功接入。

#### Scenario: 项目已经有说明和 Agent 规则

- **WHEN** 单仓或多仓 Workspace 已有团队 README 与 AGENTS
- **THEN** 引导只追加或更新自身的唯一受管区块，团队原有文本逐字节保留

#### Scenario: 文件中存在有效旧受管区块

- **WHEN** 新的获批接入请求更新引导
- **THEN** 仅该区块被替换，区块外新加入的团队规则不变，相同输入再次应用不增加重复内容

#### Scenario: 受管标记损坏或目标不是安全普通文件

- **WHEN** 引导目标存在重复或不完整标记，或目标及其路径包含不允许写入的目录、符号链接或越界指向
- **THEN** 接入报告具体冲突，不覆盖该文件或外部目标，不把请求标记为 confirmed

### Requirement: 引导安装沿用接入批准与中断恢复边界

Repoctopus MUST 在接入中预先检查引导目标，并在发布新共享配置和完成状态前完成引导写入。中断或写入失败 MUST 保留原批准、已经完成的 Store 与 pointer 事实及团队内容，允许从同一请求安全续接，不重复产生副作用。已确认请求的重放 MUST 保持原有幂等语义；已接入团队补齐或更新引导 MUST 通过现有的重新探测、准备及可信审批入口。

#### Scenario: 写入部分引导文件后中断

- **WHEN** 获批请求在部分引导已写入、接入完成状态尚未保存时退出
- **THEN** 同一请求的重试保留已写入的唯一受管区块，补齐未完成文件后才保存完成状态，不重复登记或改写已完成的 Store 与 pointer

#### Scenario: 写入前文件被并发修改

- **WHEN** 引导目标在规划后、受管写入前发生变化
- **THEN** 接入停止该次写入并保留新内容，报告冲突且不发布新的完成结论

#### Scenario: 已接入团队补齐引导

- **WHEN** 团队以原有共享配置为候选，通过新的 detect、prepare 和 review 请求获批
- **THEN** 接入复用健康规格根与精确 Store 登记，补齐或更新受管引导，不要求删除已有配置、规格或历史 Run

### Requirement: 人与 Agent 的本地引导使用真实工作流接口

Repoctopus MUST 为团队成员提供可移植的本地教程，覆盖安装入口、新成员接入、启动与恢复 Change、审批、共享与本机配置、SigNoz OTLP 地址以及共享文件提交范围。AGENTS 引导 MUST 使用现有公共 CLI 获取同一 Run 的 continuation、领取 Work 和消费真实 Skill 内容，并保持 Runtime 的阶段、能力与审批权威；不得靠指令文件直接授权阶段推进。

#### Scenario: 新 Agent 进入团队 Workspace

- **WHEN** Agent 读取根 AGENTS 且用户提供了待恢复的 Run 身份
- **THEN** 引导使其使用该 Run 的公共状态与恢复入口，按 Runtime 返回的当前 Work 执行，遇到可信人工决定或未知副作用时按返回结果处理
- **AND** 未提供 Run 身份时先核对新建或恢复意图，不虚构不存在的自动探针、枚举命令或阶段状态

#### Scenario: 团队成员在产品源码之外阅读教程

- **WHEN** 成员仅拥有团队 Workspace、业务仓和已安装 CLI
- **THEN** 可以通过 Workspace 的本地链接找到首次任务、恢复和配置说明，不需要读取产品 checkout 或打开产品 README 才能执行基本操作
- **AND** 示例不包含安装机器的绝对路径、发布凭据、Collector Header 值或维护产品源码用的 Comet 自举指令

```
