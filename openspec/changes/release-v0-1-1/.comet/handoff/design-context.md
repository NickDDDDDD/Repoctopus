# Comet Design Handoff

- Change: release-v0-1-1
- Phase: design
- Mode: compact
- Context hash: 0699bd3041af83dd23ac51efe40701e0b167b393924792486f8c4ac324002d4b

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/release-v0-1-1/proposal.md

- Source: openspec/changes/release-v0-1-1/proposal.md
- Lines: 1-32
- SHA256: 18993462edc0bfaf3677910731963da86636e05b128fc4f62804b5b061e7ee68

```md
# Proposal

## Why

已合入 main 的 Workspace 本地引导、安装后 doctor 和多仓恢复修复尚未进入公开安装包。团队目前仍只能取得旧版 v0.1.0；同时 CLI 与遥测中散落的产品版本常量会使单独更新 package.json 后的新版仍报告旧版本。

## What Changes

- 准备 v0.1.1，保持现有预发布交付方式；同步根包及 lockfile 的产品版本，并让 CLI、运行时遥测和桌面观测的产品版本由包元数据统一派生。插件自身版本、协议版本、持久化 schema 及第三方版本保持各自语义，不做批量替换。
- 更新面向使用者的固定版本安装示例与本地测量工具的安装器定位，核对实际 tarball 的 --version、npx、初始化入口及遥测版本。
- 沿用已实现的 Release Prepare → Publish → public-smoke：版本维护 Change 先验证、归档并合入 main；再对 main 上 CI 通过的精确提交生成候选，核对同一资产后公开 v0.1.1，并验证公开下载与 npx。
- 保留旧版 v0.1.0、原始实验和已有三个无关提案。发布或上传中断沿用原候选及回执核对恢复，不覆盖已公开资产。

本次不新增发布后台、版本兼容层、生命周期状态、遥测字段重命名或独立版本注册服务。不修改第三方源码或新增依赖。范围内的产品版本统一用于避免这次发布的身份错误，不扩展 Runtime 执行语义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `product-distribution`：明确包版本、CLI 输出和产品遥测版本与候选发布身份一致，保留已有精确提交、同一资产和失败保留规则。

## Impact

- 版本与文档：package.json、根 lockfile 元数据、README、安装指南及 Windows 测量脚本。
- 产品身份：CLI 版本输出、观测发送与桌面 OTLP 编码的产品版本引用；使用受架构所有权审计的小型包元数据模块，保留 Cordis / Service / Host 边界。
- 验证：安装包与版本回归、相关遥测回归、完整仓库 Verify、PR/main CI；合入后的 Release 候选继续接受现有 CLI/npx/Windows 安装器验收与公开下载核对。
- OpenSpec Tasks 覆盖可在合入前完成的版本维护与验收准备。需要 main 成功 CI 的实际发布在 Change 交付后按同一任务执行，不把“发布已完成”提前勾选，也不为等待远端结果改造 Runtime。
- 来源：复用仓库已有发布方案和平台工具；无新的 Comet/DSH 源码采用、依赖或许可证变更。

```

## openspec/changes/release-v0-1-1/design.md

- Source: openspec/changes/release-v0-1-1/design.md
- Lines: 1-68
- SHA256: defcf79483c216aa90f296a5fbbc091414187f476aad5ab33e9f4a723f44393a

```md
---
comet_change: release-v0-1-1
role: technical-design
canonical_spec: openspec
---

# Design

## Context

参见 proposal.md 的发布目标和 specs/product-distribution/spec.md 的版本一致性要求。现有 Release workflow 已有 main 精确提交 CI、Windows 候选构建、草稿、同资产 Publish 与公开下载/npx 验收，继续作为发布权威。本次不重做这些机制。

当前根包与 lockfile、CLI_VERSION、观测 Resource 和桌面 OTLP Scope 含独立的 0.1.0 文本。桌面插件和内置插件另有自己的描述符版本，不能仅凭字符串相同就视为产品版本。

## Goals / Non-Goals

**Goals:**

- 以根包元数据表达唯一产品发布版本，生成的 CLI 与 Desktop 观测均带正确产品身份。
- 新版用户安装示例、独立消费验收、Windows 安装器定位与 v0.1.1 一致。
- 沿既有发布流程保存精确提交、CI、候选工件、草稿与公开下载回执，失败可核对恢复。

**Non-Goals:**

- 不更改五阶段、审批、Run 身份、执行或恢复语义；不引入新迁移和兼容路径。
- 不把插件描述符版本、协议/schema 版本或第三方版本绑定到产品包版本。
- 不把 Release 流水线的外部运行结果变成新的运行时状态机；不追加自动发布后台。

## Decisions

### 单一产品版本来源

使用一个小型平台侧产品版本模块静态导入根 package.json 元数据，由已有 esbuild 构建内联到产品产物。CLI、Resource 配置及桌面 OTLP 编码引用该值；不读取消费者当前目录的 package.json，也不依赖 Electron 跨进程内存。新增源文件按既有架构所有权登记。根 lockfile 仅更新自己的包版本，不更新依赖解析。

备选方案是发布时同步多份常量；它不能防止下次发版遗漏。另一个方案是在运行时从当前目录或路径猜测包版本，会混入业务项目身份和额外 I/O，不采用。

内置插件及桌面 composition 的独立插件版本保留原语义。此处的产品遥测版本是诊断数据，不作为新的执行或审批权威。

保留 `createRepoctopusResource` 现有部署覆盖优先级：显式 OTEL_RESOURCE_ATTRIBUTES 中的 service.version 可以覆盖 Resource 默认值，Instrumentation Scope 仍绑定产品包版本。默认环境的一致性验收和显式覆盖的兼容回归分别执行，后者不豁免前者。独立审查指出原规格的“默认值”措辞不够明确，因此经同一 Run 的 Design 修订及范围内代理审批澄清此边界，不修改配置行为。

### 验收落在用户能观察的边界

先在包版本更新后得到 CLI/遥测版本的真实失败，再接入共享版本来源转绿。安装包 E2E 比较安装后的公开 --version 与包元数据；npx smoke 增加版本核对；相关遥测回归核对最终 Resource 与三个 OTLP 信号的 Scope。避免仅测试常量等于另一个常量。

README 与安装指南的当前安装示例升级到 v0.1.1，关于旧版 v0.1.0 缺少初始化引导的历史说明保留。Windows 测量脚本沿用既有 releaseAssetNames 和包版本派生文件名，不继续定位旧安装器。

### 先交付版本维护，再执行既有 Release

Change 内任务完成版本维护、独立消费验证与可执行的发布输入/恢复计划。Comet 按既有阶段完成 Verify、Archive 与 PR 交付；main CI 成功后，当前 Agent 按用户已授予的 v0.1.1 发布授权执行现有维护者流程：

1. 固定 main 的完整提交及成功的 push CI，核对 v0.1.1 Tag/Release 无冲突。
2. 启动现有 workflow 的 prepare；候选运行 CLI 包 E2E、npx、Windows 打包/安装/卸载验收，并保留工件 ID 与摘要。
3. 核对成功 Prepare 的候选、草稿与三份公开资产计划，再用同一提交、Tag、工件 ID 启动 publish。
4. 核对 public-smoke、实际公开下载字节与 npx，保存外部发布回执；不回写已封存的归档目录。

备选方案是在版本 Change 合入前执行 Prepare；它违反既有 main 精确 CI 前置条件。另一方案是把 Publish 作为 Build 任务完成条件，会产生合入依赖循环，均不采用。任务完成与公开 Release 完成分开如实报告。

## Risks / Trade-offs

- [元数据导入遗漏某个打包入口] → 核对 CLI、Desktop Main/Host 的构建产物及实际包版本；保持发布包根元数据和固定导入路径。
- [观察版本修改影响组合快照] → 只更新因真实代码变化受影响的期望值；保留组件版本语义，不以放宽断言恢复测试。
- [Windows 或网络验收失败] → 按同一流水线及工件恢复，结果未知先查 Run/草稿/资产，不重建或覆盖已绑定候选，不绕过安装器门禁。
- [已有 Desktop 偶发激活问题] → 首轮失败与未定位限制保留在原验证报告；本次如再现先保留真实证据定位，不把发版当作修复结论。
- [权威资料冲突或候选身份改变] → 停止受影响步骤，核对源提交、Tag、工件和已有资产；规格级范围变化返回用户确认，不选择性忽略。

## Migration Plan

使用新版本与新 Tag 分发，不修改 v0.1.0。发布失败时保留既有公开版本可用；同一候选可验证恢复时复用原结果，不能恢复或已有公开资产需要更正时采用新的版本号。团队升级按现有安装与项目接入指南执行，无数据迁移。

```

## openspec/changes/release-v0-1-1/tasks.md

- Source: openspec/changes/release-v0-1-1/tasks.md
- Lines: 1-20
- SHA256: 3d861293e429adfd4199dd05c562fec06251d2d8299c6ea1c9535e8a58049e75

```md
# Tasks

## 1. v0.1.1 产品身份与使用入口

- [ ] 1.1 更新根包及 lockfile 的产品版本，交付共享产品版本来源并接入 CLI；先在新包元数据下复现公开 --version 报旧版本的 RED，再验证源构建和实际安装包报告 0.1.1，登记新增生产源码所有权，确保不改依赖解析或独立插件/协议版本。 <!-- comet-task:26f78004-36cd-4b04-92b3-c3bdb673eb83 -->
- [ ] 1.2 将产品 Resource 和桌面 OTLP 三个信号的 Scope 版本接入同一来源；以最终观测资源和编码结果的失败回归转绿证明与包版本一致，保留遥测字段、维度和生命周期行为，运行相关遥测及桌面编码测试。 <!-- comet-task:48f85edd-23cd-4d56-8ead-e5498cd7e888 -->
- [ ] 1.3 更新 README/安装指南的当前固定版本示例、Windows 测量脚本的安装器定位及 npx smoke 版本核对；运行文档/发布策略/打包契约相关检查与实际 npx --version、帮助和 JSON 协议验收，保留旧版历史说明。 <!-- comet-task:fb39d9f9-3b21-47d5-a592-4474d09e4d9f -->

## 2. 独立消费与发布准备验收

- [ ] 2.1 从精确提交构建 v0.1.1 tarball 并生产安装，运行包 E2E 与实际 CLI/npx 版本核对；在独立 Workspace 通过真实终端批准初始化，检查 README、AGENTS 与本地教程，核对旧版资产未改动，保存候选内容摘要、完整提交及命令退出码。 <!-- comet-task:f19287c7-e367-4339-9a59-6bc74ee47212 -->
- [ ] 2.2 完成独立审查并保存带候选身份的正式验证报告，核对标准完整仓库 Verify 入口及证据条件；完整检查交给随后 Comet 阶段 Guard 真实执行，通过前不得归档。核对既有 Prepare/Publish 输入、main CI 前置条件及失败恢复步骤可执行，不以本地构建通过代替 Windows 安装器或公开下载结果。 <!-- comet-task:69069919-0b12-4c75-a531-1b1a821e809f -->

## Workflow follow-up

- 由 Comet Build/Verify Guard 执行精确的标准构建与完整验证命令；实现任务完成不代表阶段检查或发布已通过。
- 按同一 Comet Run 完成 Archive、版本维护 PR 和 main 交付，保留已验证实现的提交祖先关系。
- main 上该精确版本提交的 push CI 成功后，按已获用户授权启动既有 Release prepare；候选必须通过 CLI/npx 和 Windows 安装器验收。
- 核对原候选工件、草稿、提交、Tag 与摘要后启动 publish，等待 public-smoke 并核对实际公开资产；保存外部回执后才报告 v0.1.1 已发布。
- 这些远端后续步骤不纳入合入前任务勾选，不倒写已封存的归档目录；结果未知时先核对，冲突时保留已有 Tag/Release/资产。

```

## openspec/changes/release-v0-1-1/.openspec.yaml

- Source: openspec/changes/release-v0-1-1/.openspec.yaml
- Lines: 1-2
- SHA256: 309e6764c826c3fc6250bcce33b56b7e44adebafc76c7df25f058663d6de4299

```md
schema: spec-driven
created: 2026-11-09

```

## openspec/changes/release-v0-1-1/specs/product-distribution/spec.md

- Source: openspec/changes/release-v0-1-1/specs/product-distribution/spec.md
- Lines: 1-34
- SHA256: 8b136b70361f8a721a1ed10fc2a45dfd01c438897dce93a59db9490d8b51a0db

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: Release 候选绑定已验证的产品提交

Repoctopus MUST 提供由维护者显式启动的 GitHub Release 流程。候选 MUST 绑定远端 `main` 历史中完整 CI 已成功的精确提交，Release Tag MUST 与该提交的包版本对应。候选的 CLI `--version`、默认产品遥测 `service.version` 与产品观测 Instrumentation Scope 版本 MUST 与包版本一致，并从同一包元数据派生。显式 OTEL 部署资源覆盖 MUST 保留既有优先级，候选验收 MUST 核对无显式覆盖时的默认版本；插件、协议及持久化 schema 的独立版本不得因此被批量改写。

#### Scenario: 从通过 CI 的提交构建候选

- **WHEN** 维护者为 `main` 上已有完整 CI 成功结果的提交请求匹配版本的 Release
- **THEN** 流程从该提交的干净 checkout 构建候选并在发布记录中保留提交、版本和验证结果

#### Scenario: 提交、CI 或 Tag 不满足发布要求

- **WHEN** 请求提交不在远端 `main` 历史、该提交的完整 CI 未成功、版本不匹配，或同名 Tag 已指向其他提交
- **THEN** 流程停止并给出可核对的原因，保留已有 Tag 和 Release

#### Scenario: 新版安装包报告产品版本

- **WHEN** 用户在源码仓之外运行新版本实际安装包的 `--version`，或该版本在未显式覆盖资源版本时向 Collector 输出产品观测
- **THEN** CLI 版本、资源的 `service.version` 和产品 Instrumentation Scope 版本均与安装包版本一致，不继续报告上一个发布版本
- **AND** 插件与协议的独立版本仍保持其自身契约

#### Scenario: 既有部署显式覆盖资源版本

- **WHEN** 部署通过现有 OTEL 资源配置显式设置 `service.version`
- **THEN** 产品 Resource 保留既有覆盖结果，Instrumentation Scope 与 CLI 仍报告实际产品包版本
- **AND** 默认版本一致性验收仍然执行，显式覆盖不替代或豁免候选默认版本检查

#### Scenario: 版本身份发生漂移

- **WHEN** 候选包的公开版本输出、产品观测版本或 Tag 与被验证的包版本不一致
- **THEN** 对应版本验收失败，候选不得被报告为可公开发布，也不覆盖旧版资产

```
