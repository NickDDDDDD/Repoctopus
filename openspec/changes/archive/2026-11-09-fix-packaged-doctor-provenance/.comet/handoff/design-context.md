# Comet Design Handoff

- Change: fix-packaged-doctor-provenance
- Phase: design
- Mode: compact
- Context hash: 3946eb908f59a554e9d3b47f4be1c7bd92aa827132bb7485261e5f4c64854a58

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/fix-packaged-doctor-provenance/proposal.md

- Source: openspec/changes/fix-packaged-doctor-provenance/proposal.md
- Lines: 1-26
- SHA256: 16a5fc1d540947272cc470df2b96bfb06f12879ef8c81c147ce702177c82acc1

```md
# Proposal

## Why

安装后的 `doctor` 把源码开发所需的 lockfile 和 Electron 准备脚本当成必需运行资源，而 npm 发布包不提供这些文件，导致健康安装也无法完成诊断。需要明确开发审计与安装后诊断的职责，并用真实发布包回归守住这条边界。

## What Changes

- 安装后来源诊断检查随包发布的来源清单、受保护文件及实际生产依赖，不再读取开发 lockfile 或开发准备脚本。
- 保留 CI 对依赖锁、integrity、开发依赖和准备脚本的完整审计。
- 为真实 tarball 隔离安装后的 `doctor` 增加成功与损坏反例；异常诊断不写 Run、Checkpoint 或 Trajectory。
- 补充用户诊断文档及验证报告；沿用现有 CLI 和 JSON envelope，不新增迁移、兼容别名或配置开关。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `product-distribution`: 安装包的健康诊断应独立于源码开发环境，并能识别实际资源损坏。

## Impact

涉及来源诊断、包 E2E、相关单元回归和诊断说明；不改工作流阶段推进、持久状态 schema、Desktop 生命周期或业务仓配置。参考固定 Comet 0.5.1 的随包 manifest 检查与实际安装包 doctor 验收，仅借鉴实现思路，不引入 SDK 或复制新上游源码。

```

## openspec/changes/fix-packaged-doctor-provenance/design.md

- Source: openspec/changes/fix-packaged-doctor-provenance/design.md
- Lines: 1-32
- SHA256: 5d11b1428023a523332d1cc3c6f92f679f3f152b276daa4282e9397889af55ac

```md
# Design

## Context

问题与边界见 proposal。现有运行时 `platform/provenance/check.ts` 与开发脚本 `scripts/check-provenance.mjs` 同时检查开发 lockfile 和准备脚本；运行时经 maintenance Contributor 在 `doctor` 中执行。npm 不分发根 package-lock，CLI 生产安装也不提供 Electron 开发资源。已有来源单元 fixture 主动复制开发文件，包 E2E 未调用 doctor，形成覆盖缺口。

## Goals / Non-Goals

**Goals:** 使用同一份已分发第三方来源清单完成安装后审计；保留源代码 CI 的完整约束；通过公共 CLI 证明健康成功、实际损坏失败以及诊断只读。

**Non-Goals:** 不引入新 manifest/schema、诊断模式开关、Comet SDK、依赖升级或持久 Run migration；不为用户安装开发依赖，不把诊断改成自动修复。

## Decisions

1. 保留现有 `checkProvenance` 运行时接口和 Cordis Contributor 装配。其受保护源码、Cordis/Matt 快照摘要、许可证及上游固定身份检查继续有效；将 DSH 开发锁检查改为产品声明与实际可解析的生产包 package.json 身份检查，缺失/解析失败/版本不符返回诊断。生产依赖解析从产品 package.json 建立 Node resolver，适配 npm 嵌套安装与当前 vendored workspace。禁止依赖声明继续校验；完整传递锁图的禁止依赖审计由开发 CI 保持。
2. 开发脚本继续拥有 lockfile/integrity、开发依赖和准备脚本检查。运行时不探测 lockfile 是否存在后切换模式：同一诊断在源码及安装环境使用同一语义，不因偶然文件改变检查强度。
3. 不分发锁文件副本或开发准备脚本。既有已发布来源清单足够承载预期身份；不引入第二份可漂移的来源权威。备选“只把读取错误忽略”会漏掉真损坏，拒绝；“改名复制整份 lockfile”增加开发依赖负担并仍不能证明实际安装事实，拒绝。
4. 单元测试使用真实来源资源与生产依赖 manifest 的最小消费 fixture，不为运行时补开发文件；先观察无开发资源失败，再修复。开发脚本另做版本/integrity/准备脚本缺失反例，证明职责分离没有减少 CI 约束。
5. 扩展现有实际 package E2E：只安装生产依赖，以安装后的 bin 对真实 Run 调用 doctor；断言开发资源缺席、健康成功、损坏必需资源失败、恢复资源后成功。比较诊断前后 Run/Checkpoint/Trajectory 原始字节。负例只修改临时消费者，finally 恢复，不动产品快照。
6. 参考固定 Comet 0.5.1 的 `domains/skill/platform-install.ts` manifest 资源检查及 `scripts/release/package-e2e.mjs` 安装后 doctor 验收，仅借鉴职责与消费式验证，保持本项目 Engine、Service 与平台适配器边界。工作流阶段、长任务恢复、Evidence 与 OpenTelemetry 行为不变，通过来源/CLI/真实包回归核对。

## Risks / Trade-offs

- 安装环境依赖布局不同 → 使用 Node 的产品根解析，不假定消费者 cwd 或全局安装目录。
- 错误被降级成健康 → 资源损坏与依赖缺失/漂移都做失败反例；不得返回虚构成功。
- 开发审计弱化 → 保留原 CI 脚本及反例，标准 verify 仍执行完整来源审计。
- 来源 fixture 与真实 npm 包不一致 → 同时执行现有 tarball 生产安装 E2E，不只测试手工 fixture。
- 规格、来源权威冲突 → 停止并报告，不改第三方受保护快照来迎合新结果。

## Migration Plan

无状态迁移。重新构建 CLI 后由正常 tarball 分发替换实现；回退使用旧版本包，不重写已有 Run 或来源清单。

```

## openspec/changes/fix-packaged-doctor-provenance/tasks.md

- Source: openspec/changes/fix-packaged-doctor-provenance/tasks.md
- Lines: 1-24
- SHA256: a0e1540b3c81e4237b94c253a565be2cdc92197edf7b3a1b22bb905ed3463f78

```md
# Tasks

## 1. 安装后来源诊断

- [ ] 1.1 先记录无开发资源的失败回归，再实现生产依赖身份诊断并验证健康、缺失、版本漂移和受保护资源损坏场景。 <!-- comet-task:3f6f2525-3fe5-465d-8673-2767d46439cf -->
  **Acceptance:** 来源单元测试通过；健康 fixture 无 lockfile/准备脚本；缺失或漂移生产依赖及损坏快照均失败。
  **Requirements:** product-distribution#安装后诊断独立于开发资源
- [ ] 1.2 保留开发来源脚本，并用锁版本、integrity 和准备脚本缺失反例验证 CI 审计仍然失败。 <!-- comet-task:f07fc2be-5f62-4874-a3a6-6ea2715c208f -->
  **Acceptance:** 开发来源审计健康样本成功，三个反例分别返回非零；完整来源检查仍通过。
  **Requirements:** product-distribution#开发审计与发布包诊断分别验证

## 2. 实际发布包消费验证

- [ ] 2.1 扩展 tarball 生产安装 E2E，经公共 CLI 验证 doctor 健康成功、资源损坏失败和恢复成功，核对诊断不改 Run 持久事实。 <!-- comet-task:f9926e98-5bc4-4bba-bbcd-37a178955b3c -->
  **Acceptance:** package E2E 通过；未注入开发文件；诊断前后 Run、Checkpoint、Trajectory 字节一致；真实损坏返回结构化错误。
  **Requirements:** product-distribution#安装后诊断独立于开发资源; product-distribution#开发审计与发布包诊断分别验证
- [ ] 2.2 补充诊断说明，完成相关回归、独立审查与正式验证报告，记录 Comet 参考和真实 RED/GREEN。 <!-- comet-task:1a971bb8-f8bd-499b-81ee-6a7b698c9dbf -->
  **Acceptance:** 文档与实现一致，相关检查及完整标准 verify 通过，独立审查无未解决阻塞，报告区分已执行与未执行。
  **Requirements:** product-distribution#开发审计与发布包诊断分别验证

## Workflow follow-up

- 经 Comet 正式归档、创建 PR、CI 通过后合入 main。
- 从 main 构建安装包，复验健康诊断、真实损坏与只读边界；不通过则继续修复。

```

## openspec/changes/fix-packaged-doctor-provenance/.openspec.yaml

- Source: openspec/changes/fix-packaged-doctor-provenance/.openspec.yaml
- Lines: 1-2
- SHA256: 309e6764c826c3fc6250bcce33b56b7e44adebafc76c7df25f058663d6de4299

```md
schema: spec-driven
created: 2026-11-09

```

## openspec/changes/fix-packaged-doctor-provenance/specs/product-distribution/spec.md

- Source: openspec/changes/fix-packaged-doctor-provenance/specs/product-distribution/spec.md
- Lines: 1-34
- SHA256: 64525e1ee1c32ba67b422185d637497aaae8c665b48b2bb41a7f29091c994ba2

```md
## ADDED Requirements

### Requirement: 安装后诊断独立于开发资源

安装后的 `doctor` MUST 使用产品随包分发的来源清单、受保护资源和已安装的生产依赖完成来源诊断，不要求开发 lockfile、开发依赖或源码准备脚本。诊断 MUST 保留现有只读状态检查及 CLI 输出契约；实际资源缺失、损坏或生产依赖身份不符时不得报告健康。

#### Scenario: 仅安装生产依赖的健康 CLI

- **WHEN** 当前候选 tarball 在独立消费者目录中仅安装生产依赖，且工具包内没有开发 lockfile 和准备脚本
- **THEN** 对有效 Run 执行 `doctor --json` 成功并返回健康结果，不改变 Run、Checkpoint 或 Trajectory

#### Scenario: 已分发资源被损坏

- **WHEN** 安装包的必需来源资源缺失、被修改或无法解析
- **THEN** `doctor` 返回非零退出码与明确的结构化错误，不回退到源码 checkout，不跳过失败，也不修改 Run 的持久事实

#### Scenario: 生产依赖与登记版本不一致

- **WHEN** 安装后的生产依赖身份与产品来源清单不符
- **THEN** 来源诊断失败并指出相关依赖，不以开发锁文件中的历史版本代替安装事实

### Requirement: 开发审计与发布包诊断分别验证

Repoctopus MUST 保留 CI 对源码 lockfile、依赖 integrity、禁止依赖和开发准备资源的审计，并在实际 tarball 隔离安装后执行公共 `doctor` 的健康与损坏反例。源码测试通过不能代替安装后诊断验收。

#### Scenario: 开发锁与固定来源不一致

- **WHEN** 源码 lockfile 中的固定依赖版本或 integrity 漂移，或开发准备资源缺失
- **THEN** 完整来源审计失败，即使安装后诊断不依赖这些开发文件

#### Scenario: 发布候选的诊断命令回归

- **WHEN** 实际安装包不能对健康 Run 完成诊断，或损坏必需资源后仍报告健康
- **THEN** 包 E2E 失败并阻止候选被认定为通过完整验证

```
