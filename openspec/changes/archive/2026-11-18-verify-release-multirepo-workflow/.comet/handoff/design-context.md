# Comet Design Handoff

- Change: verify-release-multirepo-workflow
- Phase: design
- Mode: compact
- Context hash: 1ef200c018f027e0f7e2cea2e2043293a50b1199d3f3be33d86df8cd7ada1655

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/verify-release-multirepo-workflow/proposal.md

- Source: openspec/changes/verify-release-multirepo-workflow/proposal.md
- Lines: 1-26
- SHA256: 8574850436307eabad6c2ba4668e070ae5ce56439fb300718431db3425cfaa42

```md
# Proposal

## Why

Release Prepare 已验收候选包的安装、CLI 协议和桌面安装器。完整的 Windows 多仓生命周期和中断恢复目前仍依赖独立实验的驱动脚本，下一份候选包缺少同样的自动化验收。

## What Changes

- 增加可独立执行的 Windows 安装包端到端测试，接受指定的候选 `.tgz`，用已安装的公共 CLI 驱动隔离多仓 Workspace。
- 自动运行一条小 Change，从 Init 到 Archive，在首个 Build 工作包完成后换进程续跑，并模拟规格 PR 已创建但响应丢失。
- 核对同一 Run 完成、已完成工作包保留、规格 PR 被采纳，以及恢复和终态复读期间没有重复推送或创建请求。
- 让 Release Prepare 在封存和上传前用实际候选包运行这条测试。失败时保留可定位的阶段和验收证据。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `product-distribution` 增加一条 Windows 多仓安装包验收，并把它绑定到 Release Prepare 的候选文件。

## Impact

涉及安装包测试、Windows 实验环境、Release Prepare 和维护者文档。范围限定为一个小型多仓场景及其发布门禁。日常 PR CI 继续使用标准 Verify。Runtime 生命周期、公开 CLI 和正式发布渠道沿用现有实现。

```

## openspec/changes/verify-release-multirepo-workflow/design.md

- Source: openspec/changes/verify-release-multirepo-workflow/design.md
- Lines: 1-76
- SHA256: 5c04b43cccc72b714949f33fb5e1c495786a504c9ea7b098864c77a5095e7cb0

```md
# Design

## Context

Release Prepare 已将构建出的 CLI tarball 传给安装和 npx 验收。现有多仓实验已验证过工作包恢复和发布响应丢失，实验依赖预先准备的仓库和本机路径。见 [Proposal](proposal.md)。

当前 Windows candidate 作业预算为 35 分钟。它先构建和打包，随后执行包消费、npx 和桌面安装器验收，再调用 `scripts/github-release.mjs seal`。封存会检查干净的精确提交、CLI 摘要和桌面验收收据。候选目录有固定文件清单，诊断需要独立存放。

## Goals / Non-Goals

用指定的 `.tgz` 完成一条可重复的 Windows 多仓验收。单独执行和 Release Prepare 共用入口。验收范围聚焦消费后的 CLI、一个小 Change 和两个已知恢复边界。

测试 Host 按实际 Work 读取 Skill、执行固定的小任务并提交 Outcome。各阶段门禁使用隔离实验的测试答复。该场景验证 Runtime 与公共 CLI 的运行协议；人工评审的质量由开发流程中的独立审查覆盖。

## Decisions

### 独立入口和候选身份

增加 `npm run test:windows-multirepo-package-e2e -- <candidate.tgz>`，对应 `scripts/windows-multirepo-package-e2e.mjs`。显式路径为必填输入。入口先检查 Windows、Git、候选文件及 npm 调用环境，记录字节数和 SHA-256，再在临时消费目录安装生产依赖，使用安装后的 `bin/repoctopus.js`。

每次公共 CLI 调用都使用新 Node 进程，并记录 argv、退出码、阶段和 JSON 结果。控制器只持有测试场景配置和已持久化的标识。独立脚本放在标准 Vitest 收集范围之外，其契约和收据校验进入常规测试。

备选的源码集成测试适合快速回归，但安装后的依赖布局和入口需要从候选包消费才能覆盖。多仓入口接受维护者先前生成的包，使同一条验收可以单独复现。

### 三仓垂直切片

场景创建一个 Workspace、两个平级业务仓及对应的临时 bare 远端。仓库从空 Git 历史初始化。公共 Init 完成接入，公共 Verify 配置入口建立两个真实 Node 标记检查，测试通过正常配置设置本地发布端点。每个业务仓分配一个小型标记任务，共同构成一条 Change。

测试 Host 依次处理 Open、Design、Build Configure、Plan、Execute、Check、Verify 与 Archive。它领取 Work 后检查当前 Action Skill 正文和所需增强层，再执行指定任务和检查，并提交由当前 invocation 约束的 Outcome。两包各保留真实失败和转绿结果，Verify 执行实际命令。

多仓 Git 状态、OpenSpec Store registry、宿主 Skill 目录和测试配置都位于隔离目录。测试控制环境关闭外部遥测，使用仓库级 Git 身份，独立设置 Git 全局配置来源。短临时路径降低测试自身的路径噪声。

### 首包后的冷恢复

控制器分两次启动驱动进程。第一进程在首包完成且完成事实持久化后退出，保存原 Run、Plan、首包完成身份与业务文件摘要。第二进程从持久化标识恢复，先调用 `run resume`，再继续 `run next`。

核对原 Run 和计划身份、首包完成记录及执行计数，随后完成第二包。首包成功的实施计数应为一次。中断点设在已提交完成事实的边界，测试结果会明确记录这个位置。

### Archive 发布响应丢失

测试夹具提供 Git smart HTTP 与 GitHub 兼容 HTTPS 接口。Git 请求只到本机测试服务；API 基址通过现有配置注入。HTTPS 使用专用测试证书与子进程信任配置。

业务 PR 按正常 Archive 路径建立。创建规格 PR 时，夹具先验证远端分支、持久化 PR，再断开响应，并暂时在列表中隐藏该 PR。接口入口记录全部创建请求和 Git receive-pack 请求，包括失败或被拒绝的请求。

结果未知时，换进程执行 `resume`、`next` 和原发布入口，核对同一 Run 与原 invocation 仍处于 reconcile，写请求计数保持稳定。恢复查询可见性后，原调用采纳已存在的规格 PR，最终 Run 为 completed。PR 身份、远端分支 OID、完成记录和 Verify 证据需与恢复前事实一致。随后交替执行终态 `resume` 和 `next`，再次核对远端效果及状态。

验收编排和故障注入位于测试侧。Engine、Cordis Service、领域模块及平台适配器通过已安装 CLI 的正常装配执行。

### Prepare 接线与封存

Prepare 将 `REPOCTOPUS_PACKAGE_CANDIDATE` 对应的实际文件作为显式参数传入。新验收在 `seal` 前运行，输出路径由 `REPOCTOPUS_WORKFLOW_E2E_EVIDENCE` 指向候选资产目录之外。封存通过 `RELEASE_WORKFLOW_EVIDENCE` 读取收据，并核对成功状态、实际包摘要与大小、Run 终态、冷恢复及发布去重检查。

缺少收据、状态失败、关键检查缺失或候选文件改变时封存失败。新增契约测试检查实际参数、执行顺序、收据绑定和失败路径。诊断上传使用独立的 Actions artifact，执行条件为 `always()`，与通过后上传的正式候选资产分别绑定。

Windows candidate 作业预算调整为 55 分钟，独立验收预算先设为 15 分钟，单次 CLI 和 npm 安装均有超时。预算耗尽时保留最后阶段与原始输出。独立验收预算会在实际执行后复核。

备选的独立 Prepare 作业会新增候选传输和身份核对边界。现有 candidate 作业已经持有待封存文件，直接在其中复用独立入口能集中完成验收与摘要核对。

## Validation

先为候选输入、测试收据、故障注入时序与发布工作流契约写失败回归，再实现独立入口和 Prepare 接线。

Windows 实测使用本次代码构建出的安装包，以公共 Init 开始运行两个业务仓的一条 Change。验收收据包括候选摘要、各阶段、两次驱动进程、Run 和计划身份、首包完成记录、PR 与推送计数、原始命令日志和终态探针结果。

本次在 Windows 本地执行与 Prepare 相同的入口参数和证据环境，并覆盖封存收据的正反例。GitHub Prepare 的完整远端执行随合入后的下一份发布候选完成。正式 Verify 执行仓库检查和独立集成审查，核对源码调用、实际安装包证据和规格场景。

## Risks / Trade-offs

- 本地托管夹具覆盖受控 GitHub 协议场景，真实平台的权限和配额仍需发布环境核对。
- npm 安装依赖网络可用性。安装超时按环境失败记录，整个验收保持失败状态。
- 丢弃响应前若没有真实创建 PR，实验只覆盖请求失败。因此夹具以持久化创建记录和远端 Git 引用证明注入边界。
- 超时或驱动异常可能留下测试子进程。退出路径需要停止所拥有的服务进程、保存诊断，并对已核对的临时根进行清理。诊断输出保留在独立证据目录，避免清理时一起丢失。

## Rollout

维护者文档增加独立命令、前提、正常输出和失败证据位置。合入后，下一份候选按新 Prepare 门禁验收。若验收暴露产品缺陷，保留失败证据并定位处理，发布流程保持失败状态。

```

## openspec/changes/verify-release-multirepo-workflow/tasks.md

- Source: openspec/changes/verify-release-multirepo-workflow/tasks.md
- Lines: 1-22
- SHA256: 7a07f756e0524d498cc3456236c01ded45d6bd749f1fa3db31b91ece890b4dc3

```md
# Tasks

## 1. 独立 Windows 多仓验收

- [ ] 1.1 实现指定 `.tgz` 的隔离消费入口，创建临时 Workspace、两个业务仓、Git 远端和托管服务，打通 Init 至 Archive。 <!-- comet-task:4b087a72-25e9-4ea4-827b-a7e517cf6e65 -->
  - **Acceptance:** 独立 Windows 命令可以安装给定候选包，经公共 CLI 完成一个多仓 Change，输出实际包摘要与终态。无效候选明确失败。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收
- [ ] 1.2 在首包完成后换进程恢复，完成剩余工作包及 Verify。 <!-- comet-task:c7b8f639-34f2-42a1-a78f-b62e5ed48d03 -->
  - **Acceptance:** 重新启动 CLI 后 Run 和计划身份一致，首包仍为完成状态且未重做，剩余工作包与 Verify 有实际结果。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收
- [ ] 1.3 在 Archive 注入规格 PR 创建响应丢失并验证恢复。 <!-- comet-task:957a7a41-9038-4cba-8366-2c12a396081f -->
  - **Acceptance:** 服务端确实创建 PR，初次恢复在结果不可见时等待，随后同一 Run 采纳其身份并完成。比较首次发布、等待、恢复和终态复读的原始请求与 Git 引用，确认没有重复创建或推送。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收

## 2. Release Prepare 门禁与验证

- [ ] 2.1 接入 Release Prepare 并增加发布契约检查。 <!-- comet-task:393efa9a-89b0-4f04-85dc-9283369c7770 -->
  - **Acceptance:** Windows Prepare 用实际候选文件运行独立入口，验收摘要与封存摘要一致。失败或证据缺失时拒绝封存和上传，并保留阶段诊断。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收
- [ ] 2.2 记录维护者运行方式，并验证独立入口和发布接线。 <!-- comet-task:b89cd085-8d91-45b9-8892-c68a5b521bd1 -->
  - **Acceptance:** 保存实际候选包的独立 Windows 通过证据及 Release Prepare 调用证据，覆盖恢复和副作用计数。维护者可按文档重现并定位失败。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收

```

## openspec/changes/verify-release-multirepo-workflow/.openspec.yaml

- Source: openspec/changes/verify-release-multirepo-workflow/.openspec.yaml
- Lines: 1-2
- SHA256: 277c3c07d7ab9927f15fff0d9c08afbbb9cc808d563ada95016a72a464a761e0

```md
schema: spec-driven
created: 2026-11-18

```

## openspec/changes/verify-release-multirepo-workflow/specs/product-distribution/spec.md

- Source: openspec/changes/verify-release-multirepo-workflow/specs/product-distribution/spec.md
- Lines: 1-26
- SHA256: 4d2dd9712bbc64475581093963b1867a7cf64b9a5c5a5537c74c8cee861fea71

```md
# Spec Delta

## ADDED Requirements

### Requirement: Windows 候选包通过多仓生命周期验收

维护者 MUST 能在 Windows 上独立使用指定的 Repoctopus CLI 安装包运行多仓端到端验收。Release Prepare MUST 对当前发布候选使用同一验收入口，并在验收通过后才封存和上传资产。

#### Scenario: 独立验收指定安装包
- **WHEN** 维护者在 Windows 上提供一个候选 `.tgz` 并启动多仓验收
- **THEN** 验收 MUST 在隔离的消费目录中安装指定包，并通过安装后提供的公共 CLI 初始化 Workspace 和业务仓、完成一条 Change 的 Open、Design、Build、Verify 和 Archive
- **AND** 验收 MUST 记录实际消费的包摘要、各关键阶段结果及最终 Run 状态

#### Scenario: 工作包完成后在新进程继续同一 Run
- **WHEN** 第一个 Build 工作包的完成事实已持久化，且验收结束当前 CLI 进程
- **THEN** 新 CLI 进程 MUST 以原 Run 继续执行尚未完成的工作包，保留原计划与首包完成事实，最终完成 Verify 和 Archive

#### Scenario: PR 创建成功但响应丢失后采纳原发布结果
- **WHEN** Archive 已推送目标分支，托管服务已创建规格 PR 但创建响应丢失，且初次恢复暂时无法观察到该 PR
- **THEN** Runtime MUST 保留原 Run 并等待可核验的发布结果，恢复查询后采纳已创建的同一个 PR
- **AND** 验收 MUST 根据原始创建请求、Git 推送请求及远端事实确认等待、恢复和终态复读期间未重复发布

#### Scenario: 使用实际候选包作为准备门禁
- **WHEN** Release Prepare 生成待发布的 CLI 候选包
- **THEN** Windows 多仓验收 MUST 使用该候选的实际文件，且封存的 CLI 文件摘要 MUST 与通过验收的摘要一致
- **AND** 在验收失败或证据缺失时，Release Prepare MUST 停止准备并保留可定位的阶段与诊断

```
