# Comet Design Handoff

- Change: publish-github-release-distribution
- Phase: design
- Mode: compact
- Context hash: 7ff282e7b776b6fff63a1e7929be14600b73f4c64ab25db1d4a2f651c9ed9efe

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/publish-github-release-distribution/proposal.md

- Source: openspec/changes/publish-github-release-distribution/proposal.md
- Lines: 1-24
- SHA256: 946a8c4f703889bee72c7fb3808c6acc00bc7c8b3cee1873e16566153012f373

```md
# Proposal

## Why

团队已经可以从构建好的 CLI 包启动 Repoctopus，但 GitHub Releases 还没有可下载的安装资产。建立可重复的发布路径后，成员可以从固定版本的下载地址用 `npx` 启动工作流。

## What Changes

- 建立维护者手动启动的 GitHub Releases 发布路径，从已经通过完整 CI 的 `main` 精确提交生成首版候选。
- 验证并分发同一组 CLI `.tgz`、可选的 Windows x64 Desktop 安装器及 `SHA256SUMS`，先交付可检查的 Release 草稿。
- 用固定版本的 Release 下载地址提供 `npx` 启动路径。README 和安装指南说明版本、CLI 与桌面看板的用途，并保留已有的独立目录安装方式。
- 首版目标为 `v0.1.0` 预发布。发布流程合入且该提交的 CI 通过后，才进入首版发布与实际下载验收。

## Capabilities

### New Capabilities

### Modified Capabilities

- `product-distribution` 定义 Release 候选的提交来源、产物验证与晋升边界，以及安装包的版本化消费方式。

## Impact

涉及 GitHub Actions、现有 CLI 打包和 Windows NSIS 验证入口、用户文档与发布记录。本次沿用现有打包依赖和第三方许可证随包规则。后续切片可独立评估 npm registry、安装器签名、自动更新及其他桌面平台。本次交付范围为 GitHub Releases、CLI `npx` 入口和 Windows x64 桌面包。

```

## openspec/changes/publish-github-release-distribution/design.md

- Source: openspec/changes/publish-github-release-distribution/design.md
- Lines: 1-43
- SHA256: b0dc13ffb7c5da5be2deb7c1a49a0e36aafa492de625dc5d33af7d563bf22e18

```md
# Design

## Context

现有 CI 从干净 checkout 运行 `npm run verify`。CLI 打包与隔离消费验收、Windows NSIS 打包与安装验收均有现成入口。工作区外的 Windows 空 npm 缓存已用本地 `.tgz` 验证 `npx` 能启动 CLI。发布后的固定 URL 仍需在真实环境验收。

## Goals / Non-Goals

- 复用仓库当前的打包、CI 和安装验证命令，补上从提交到公开资产的证据链。
- 发布属于代码托管与构建交付层。CLI、Cordis composition、Change 生命周期、多仓状态和 OTLP 协议沿用已有契约。
- 首版维护 GitHub Release 渠道，后续可评估 registry、签名和自动更新。

## Decisions

### 手动触发并绑定精确提交

从主分支明确选定版本对应的提交，核对远端 `main` 归属和同一 SHA 的完整 CI 成功记录。发布作业检出该 SHA，读取该提交的包版本，并拒绝版本冲突。每次 merge 自动发布会让日常提交和版本意图混在一起。维护者本机手工打包虽然可以启动首发，但难以证明构建来源并在团队内重复执行。

### 用同一份安装资产完成验收

构建任务生成 tarball 和 Windows 安装器。CLI 在独立消费者目录使用候选包的真实文件执行帮助与公共 JSON 协议，并覆盖空 npm 缓存的 `npx` 启动。桌面复用现有打包检查和 Windows 安装到卸载验收。通过后按实际资产计算 SHA-256。发布步骤传递已验收的文件，重新计算摘要以确认传递完整。

### 草稿与公开发布分开

构建任务只读源码。拥有发布权限的步骤消费已验证产物，按固定 Tag 创建或恢复草稿，核对已有 Tag 与发布资产。相同资产可复用，冲突留给维护者处理。核对完整草稿后由维护者公开发布。草稿保留提交、版本、CI 和候选运行关联。每个 Tag 只能对应一组资产，后续修正以新版本交付。

### 固定版本的命令作为团队入口

用户从 Releases 选择版本，README 用该版本的 CLI tarball URL 展示 `npx`，安装指南保留本地 tarball 与独立目录消费方式。首版公开前明示下载条件，公开后在源码外用实际地址复验。Windows 用户可以另行安装 Desktop Dashboard。

## Risks / Trade-offs

- 版本或分支在准备期间变化。每一步绑定精确 SHA、版本和摘要，核对不一致时停止。
- 构建完成后上传只成功一部分。草稿可恢复，公开前重新观察平台实际文件和摘要，发现冲突时保留现有结果。
- 公开前无法走匿名下载链接。先用验证过的候选包进行消费验收，公开后用干净缓存复验下载和 CLI。记录实际结果，发现问题时由维护者决定后续版本。
- 配置的产品证据与平台实际状态冲突。停止并保留原始 CI、Tag 或下载证据，修复归属后再继续。

## Migration Plan

1. 合入发布能力和用户指南，等待合并提交通过完整 CI。
2. 从符合条件的提交生成 `v0.1.0` 候选，验证资产并创建草稿。
3. 核对草稿后以预发布方式公开，用固定下载地址复验 `npx`。把结果写进交付证据。
4. 若候选阶段失败，保留已验证的独立目录安装路径和现有公开版本。发布后需要更正时以新 Tag 交付。

```

## openspec/changes/publish-github-release-distribution/tasks.md

- Source: openspec/changes/publish-github-release-distribution/tasks.md
- Lines: 1-28
- SHA256: 014e994693270fea44d27fd30dba886bd894cc8c19c320e39fd576423768c008

```md
# Tasks

## 1. 选定版本与构建候选

- [ ] 1.1 接入维护者手动触发的 Release workflow。验证远端 `main` 归属、精确 SHA 的完整 CI、版本与 Tag 的匹配，覆盖条件不满足时无写入的情形。 <!-- comet-task:8c2969a5-bd33-4300-a327-8514a214105a -->
- [ ] 1.2 复用固定依赖、CLI 构建和 Windows NSIS 打包命令。通过一次候选构建确认输出包含预期的 CLI tarball 与 Windows x64 安装器，且都来自同一 checkout。 <!-- comet-task:b336b12d-356e-46ce-9c78-3a77b81b8bee -->
- [ ] 1.3 用候选 tarball 执行独立消费者的 CLI 协议验证和空 npm 缓存的 `npx` 验证，检查 Windows 消费路径。 <!-- comet-task:b42691b9-d66c-4799-8df6-f58027688bf2 -->
- [ ] 1.4 对候选桌面安装器运行既有包检查与 Windows 安装到卸载验收，确认安装、激活及清理回执。 <!-- comet-task:9aaa1d43-bb64-4e6b-aeec-5319b5443520 -->

## 2. 草稿与校验

- [ ] 2.1 生成 `SHA256SUMS` 和发布来源信息。通过摘要复算及故意改动一份资产的用例验证文件传递边界。 <!-- comet-task:3cd3ddc3-da07-4f27-911c-b7ce67f09126 -->
- [ ] 2.2 增加最小权限的草稿步骤。用成功、上传中断重试和 Tag 或资产冲突用例验证草稿复用、拒绝覆盖与公开前核对。 <!-- comet-task:ff5d5c96-3243-46f1-94ea-be983104d8ba -->

## 3. 团队使用文档

- [ ] 3.1 更新 README 与安装指南，提供固定版本 Release URL 的 `npx` 命令、Desktop 资产用途和本地包安装路径。校对命令在源码外的执行方式，验证公开前说明准确。 <!-- comet-task:adb1e577-0ff1-45dc-bae4-918afedde3dd -->
- [ ] 3.2 记录维护者触发构建、复核草稿、公开预发布、复验及失败恢复的步骤。按文档执行只读或候选演练，核对每一步的输入与证据。 <!-- comet-task:9c6f36f3-ef8e-47dc-a92f-ffc63111d03c -->

## 4. 集成验证

- [ ] 4.1 检查 workflow 的分支触发、权限和资产传递契约，执行组合验证，记录候选身份与本地或 GitHub 验收结果。 <!-- comet-task:e396e92b-436d-4299-a052-4a31b1f66ff8 -->

## Workflow follow-up

- 发布流程合入后，确认目标 `main` 提交的完整 CI 通过。
- 生成、核对并公开 `v0.1.0` 预发布，验证公开资产的 SHA-256 和固定 URL。
- 在源码仓以外用空 npm 缓存执行实际 Release URL 的 `npx`，核对帮助输出和 CLI JSON 响应。

```

## openspec/changes/publish-github-release-distribution/.openspec.yaml

- Source: openspec/changes/publish-github-release-distribution/.openspec.yaml
- Lines: 1-2
- SHA256: 9b4b840064a33a6866a0ebc375b496fbdc2387a324f6c8fb4f21b270218c0d37

```md
schema: spec-driven
created: 2026-11-06

```

## openspec/changes/publish-github-release-distribution/specs/product-distribution/spec.md

- Source: openspec/changes/publish-github-release-distribution/specs/product-distribution/spec.md
- Lines: 1-55
- SHA256: aea18a9d3ae15b406325a56f373ac5159f725460711781a7661696fcdb03a676

```md
# Spec Delta

## ADDED Requirements

### Requirement: Release 候选绑定已验证的产品提交

Repoctopus MUST 提供由维护者显式启动的 GitHub Release 流程。候选必须绑定远端 `main` 历史中完整 CI 已成功的精确提交，Release Tag 必须与该提交的包版本对应。

#### Scenario: 从通过 CI 的提交构建候选

- **WHEN** 维护者为 `main` 上已有完整 CI 成功结果的提交请求匹配版本的 Release
- **THEN** 流程从该提交的干净 checkout 构建候选并在发布记录中保留提交、版本和验证结果

#### Scenario: 提交、CI 或 Tag 不满足发布要求

- **WHEN** 请求提交不在远端 `main` 历史、该提交的完整 CI 未成功、版本不匹配，或同名 Tag 已指向其他提交
- **THEN** 流程停止并给出可核对的原因，保留已有 Tag 和 Release

### Requirement: Release 资产先验收再公开

Repoctopus MUST 用最终上传的同一份 CLI tarball 和 Windows x64 Desktop 安装器完成验收。Release MUST 提供这两份资产和对应的 `SHA256SUMS`，在草稿中核对完整性后才能公开。

#### Scenario: 验证并上传同一组产物

- **WHEN** 候选包通过独立 CLI 消费验收和 Windows 安装到卸载验收
- **THEN** 草稿附上已验证的 CLI 包、可选桌面安装器与校验文件，下载资产的文件名和 SHA-256 与候选记录一致

#### Scenario: 构建、验收或上传中断

- **WHEN** 任何必需检查失败、发布资产缺失或实际摘要不同
- **THEN** Release 保持未公开，诊断说明失败步骤和实际状态

#### Scenario: 发布操作被重试

- **WHEN** 同版本已有草稿或已公开 Release
- **THEN** 流程核对 Tag、提交和资产身份，匹配时复用已有结果，冲突时停止并保留现有资产

### Requirement: 团队用固定版本的 Release URL 运行 CLI

Repoctopus MUST 在用户文档给出固定版本的 GitHub Releases CLI 下载入口和 `npx` 调用。用户能够在源码仓以外从公开资产执行 CLI。Windows 桌面安装器仅用于本地 Dashboard。

#### Scenario: 从已公开的版本运行 CLI

- **WHEN** 用户在具备受支持 Node.js 和 Git 的环境中通过 `npx` 引用固定 Tag 的公开 `.tgz` 下载 URL
- **THEN** npm 从该资产解析并运行 `repoctopus`，可验证帮助输出和公共 CLI JSON 协议

#### Scenario: 首个版本仍在准备

- **WHEN** 对应版本的公开 Release 资产尚不可用
- **THEN** 文档说明发布状态并保留通过已取得 tarball 安装或运行的方式

#### Scenario: 仅需要 CLI 工作流

- **WHEN** Windows 用户没有安装 Desktop
- **THEN** 使用发布包运行 CLI 和 Change 工作流仍可用

```
