# Comet Design Handoff

- Change: repair-archive-publication-endpoint
- Phase: design
- Mode: compact
- Context hash: fab0a9338b4022d18eecada04bff62be8fab613c4bed1aad79562f38a69f4697

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/repair-archive-publication-endpoint/proposal.md

- Source: openspec/changes/repair-archive-publication-endpoint/proposal.md
- Lines: 1-21
- SHA256: 621a099f1757c9fff66a978a3e47950e15649f71145ed878b97178c5f836f8e2

```md
# Proposal

## Why

使用自定义 GitHub API 的五仓验收停在 `delivery.publish`。业务 PR 已通过配置的 API 创建，规格分支已推送，规格 PR 的发布适配器却仍向默认 API 查询并收到 401，导致原 Run 无法生成完整收据。

## What Changes

- 让 Archive 的业务发布与规格发布使用同一份通过 Runtime 摘要核验的 Workspace 发布策略。
- 通过现有精确前驱采纳和发布 Journal，验证修复包可以继续两条原 Windows 五仓 Run。
- 验证已经创建的业务 PR 和已推送的规格提交可以复用，完成收据后冷恢复不再产生发布副作用。

## Capabilities

### Modified Capabilities

- `delivery-governance` 增补 Archive 各发布项使用同一份已核验策略的需求，并覆盖部分发布后的恢复。

## Impact

涉及 Runtime 的 Archive 编排、Delivery 服务及 GitHub Adapter 构造和回归验收。继续使用现有 `delivery.publication.githubApiBaseUrl`、策略摘要、提交坐标、Journal 与 Receipt 格式。正式版渠道和 Archive 之外的一致性查询另行处理。

```

## openspec/changes/repair-archive-publication-endpoint/design.md

- Source: openspec/changes/repair-archive-publication-endpoint/design.md
- Lines: 1-45
- SHA256: cc4410a3f64743fa8fb554d6d9caaa6d81f65c6440d75c090253bc7bd49304b6

```md
# Design

## Context

普通五仓验收的业务 PR 已创建两条，规格 Journal 已记录推送 OID。Run 卡在 `delivery.publish`，闭合收据尚未生成。另一条五仓返工 Run 已保留后端完成记录并重新通过 Verify，停在同一发布边界。验收使用真实 Git 仓、安装包 CLI 及隔离的本地 HTTPS 发布接口。

## Goals / Non-Goals

- 让 Archive 的业务项和规格项使用同一份已核验的 `DeliveryPolicy`，保留原有副作用权限。
- 让两个现有实验 Run 换包后完成 Publish 并证明终态恢复的幂等性。
- 本次范围限于 Archive 发布路径。发布后的一致性查询与正式 Release 渠道分别评估。

## Decisions

参考固定上游 Comet Classic `35c9860b77b42bafa0c2d80d8d695889f888a924`。其 `classic-sdk-archive-decision.ts` 在提案绑定 remote 和 PR base，`classic-sdk-delivery.ts` 依据已批准目标构造并核对交付结果，`classic-sdk-delivery-checkpoint.ts` 保留原 Run 的归档及验证历史。Repoctopus 采用同一责任边界，由 Runtime 传递已经校验的发布授权，由 Delivery 适配器执行与观察。Comet Classic 的该路径负责验证实际 Git/PR 交付，Repoctopus 仍使用自己的多仓副作用及 Journal。

Archive Runtime 已比较当前 `DeliveryPolicy` 的摘要与冻结输入。规格发布端口接收这份策略，其 GitHub 客户端复用业务发布的 API 与凭据选择。MR URL 继续用于确定仓库和编号。发布集合、Closure、Work 和 Journal 的数据结构沿用现有实现。

受影响的受保护实现采用当前既有组合采纳机制，逐项核对直接前驱的代码、描述符和状态契约。验收保持两个原 Run 与原配置，先核对已创建的两个业务 PR 和规格分支 OID，再继续执行。

### 策略传递与客户端构造

`WorkflowRuns.executeArchiveDelivery` 在已存在的 `deliveryPolicyDigest(input.policy)` 校验后，从同一 `input.policy` 调用 `publishArchive` 和 `publishSpecification`。在 `Delivery.publishSpecification` 的内部签名中增加必填策略参数，信号参数继续位于最后。`FileDeliveryProvider` 从该策略的 `publication.githubApiBaseUrl` 构造 GitHub 客户端，并与业务发布共用客户端构造逻辑。凭据仍由当前已装配的 `EnvironmentCredentialProvider` 根据 Workspace 配置引用解析。MR URL 提供仓库路径和编号，API 主机取自已核验策略。

保留 Runtime 已有的摘要校验位置，覆盖初次尝试和查询恢复。Runtime 显式传递策略，让调用处能按类型强制提供已核验的输入，并把实际请求关联到冻结的 Archive 策略摘要。

本次核对客户端用来构造 MR API 请求的基址、路径和凭据来源。平台响应的 HTTP 重定向由现有 GitHub Adapter 传输实现处理。实验进程的地址白名单仅用于检测对默认 GitHub API 的回退。

### 直接前驱与两个原 Run

基线包对应 `1fdd4a63e76ffc7a15d890690b2a825c6883dafc`。两条实验 Run 保存的 `workflow-runs` 和 `delivery-file` 前驱完全一致。若实现更改后两者代码身份变化，在现有 catalog 和精确前驱回归中登记实际观察到的 codeDigest、descriptorDigest。校验配置、权限和状态 schema 同时满足既有采纳规则。

用两条原 Run 的原配置启动新进程，先验证升级前后的策略摘要、Run ID、Bundle、Closure 和已完成包事实相同。普通轮的规格 Journal 已进入 `pushed`，应采用已验证的 archive source OID，复用业务 PR #1 和 #2，完成缺少的规格 MR。返工轮保存了受管发布 Outcome，应接受该 Outcome 并完成三项发布。然后对每条 Run 交替执行 `resume`、`next`，核对始终返回 completed、收据和 Git/API 副作用计数稳定。

### 验证入口

优先扩展现有的 Archive 组合回归，在 GitHub Adapter 的请求边界记录 URL，覆盖自定义 API 的查询、创建与恢复。另以不同 API 的策略作为输入，核对摘要守卫拒绝该调用，同时检查 API 创建计数和 Git refs。

公开 CLI 验收复用已有五仓工程、本机 Git 远端及测试 HTTPS 发布接口。保留两个原 Run 冻结的地址，重启监听原端口的测试服务。测试进程只允许访问实验 API，并记录其请求地址、MR 创建和 Git 写入次数。最终收据记录包摘要、CLI 响应、Plan、Bundle、Closure、MR 编号、已发布的 Git OID 和两轮实际执行次数。

## Risks / Trade-offs

- 部分完成后重试可能重复提交、推送或创建 MR。验收以实际 Git refs、HTTPS 请求计数、原 Journal 和终态 Receipt 交叉核对。
- 安装包升级可能改变受保护组合。只接受经实际包核对的直接前驱，保留当前策略漂移与状态兼容性守卫。
- 验收使用本地测试凭据。回归应证明配置了自定义 API 时，规格发布所有 API 请求均留在授权目标。

```

## openspec/changes/repair-archive-publication-endpoint/tasks.md

- Source: openspec/changes/repair-archive-publication-endpoint/tasks.md
- Lines: 1-25
- SHA256: 4c338259a139e6cbe6436a5b10120cd4ccf6fba3f97fb419c3e370f6014e177d

```md
# Tasks

## 1. 发布策略和回归

- [ ] 1.1 固定规格发布使用默认 API 的失败回归，并覆盖策略漂移。 <!-- comet-task:5ad42c94-49b6-40ae-bf86-be1941b4f8fb -->
  **Acceptance:** 自定义 API 的 Archive 验收在原候选暴露规格请求的目标差异。改变冻结策略会在任何新的发布副作用前被拒绝。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略

- [ ] 1.2 将 Runtime 已核验的 Delivery Policy 传给规格发布，与业务发布共用客户端配置路径。 <!-- comet-task:af9a4883-ace1-45cb-9399-9511e28a76ef -->
  **Acceptance:** 两类 MR 的查询与创建都到达配置的 HTTPS 测试接口。默认配置的发布回归通过。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略

## 2. 原 Run 恢复与正式验证

- [ ] 2.1 以原候选包为精确前驱验证受保护实现采纳。 <!-- comet-task:d88955bb-d28d-4416-b4c9-e91801424226 -->
  **Acceptance:** 保留 Run、策略、Verify Input、Bundle、Closure 和逻辑发布身份。错误前驱继续被拒绝。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略

- [ ] 2.2 用实际 Windows 安装包续跑原两条五仓实验。 <!-- comet-task:a94b4f27-a5eb-446a-9c06-1286e77de93c -->
  **Acceptance:** 普通轮复用两个业务 PR 与已推送的规格 OID，只补一个规格 PR。返工轮完成三项发布，后端原完成记录保持。两条 Run 都完成，重复冷恢复保留收据且无额外发布。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略

- [ ] 2.3 固定验收收据和通过完整 Verify。 <!-- comet-task:8353771b-8d8e-484f-acf6-0dbe7f8e5f0b -->
  **Acceptance:** 记录包摘要、实际 API 和 Git 副作用计数、原 Run 的终态及独立审查结果。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略

```

## openspec/changes/repair-archive-publication-endpoint/.openspec.yaml

- Source: openspec/changes/repair-archive-publication-endpoint/.openspec.yaml
- Lines: 1-2
- SHA256: db997d460a2d6d123d14faf903215b90f63faf4e7e2dadacfdab82c07857e113

```md
schema: spec-driven
created: 2026-11-16

```

## openspec/changes/repair-archive-publication-endpoint/specs/delivery-governance/spec.md

- Source: openspec/changes/repair-archive-publication-endpoint/specs/delivery-governance/spec.md
- Lines: 1-23
- SHA256: a4540df8164e09debff2b2a92ce7252b8baa02cae28fc0bf2f4cc23d86161a35

```md
# Spec Delta

## ADDED Requirements

### Requirement: Archive 发布使用同一份已核验的发布策略

一次 Archive Work 的业务及规格发布 MUST 使用 Runtime 已与冻结摘要核验的 Workspace Delivery Policy。创建、查找、采纳和核对 MR 的请求 MUST 使用该策略选择的平台 API 地址和凭据引用。Runtime MUST 在执行发布副作用前继续拒绝策略漂移，发布适配器不得以收据或 MR URL 替换已批准的 API 目标。

#### Scenario: Workspace 使用自定义 GitHub API

- **WHEN** 同一个已验证的 Archive 同时发布业务分支和规格分支，且 Workspace 配置了自定义 GitHub API
- **THEN** 业务项与规格项都通过该 API 查询及发布，完整的 Publication Receipt 允许原 Run 完成

#### Scenario: 规格发布失败后继续部分完成的 Archive

- **WHEN** 业务 PR 已创建且规格提交已推送，修复后的 Runtime 经精确前驱校验采纳原 Run
- **THEN** 继续使用原发布策略、Verify 证据、Closure 和 Journal，复用已经完成的动作并完成剩余的规格 PR
- **AND** 终态冷恢复保持同一收据且不再次发布

#### Scenario: 发布策略漂移

- **WHEN** 当前发布策略与 Archive 已冻结的策略摘要不一致
- **THEN** Runtime 在执行发布副作用前拒绝当前策略，保留已接受的归档和发布事实

```
