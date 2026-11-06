# Comet Design Handoff

- Change: configure-workspace-otlp-endpoint
- Phase: design
- Mode: compact
- Context hash: b6c860b3267d093106be3a9b0076d9d2a26ba098dc602769587104b9585fdd25

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/configure-workspace-otlp-endpoint/proposal.md

- Source: openspec/changes/configure-workspace-otlp-endpoint/proposal.md
- Lines: 1-23
- SHA256: df9fdea9e79a2de6009e521bf717f9bec5d6297769ce22803448dd3c7153fa26

```md
# Proposal

## Why

团队已经能向远端 OTLP Collector 上报遥测，但每台开发机都要给 Runtime 进程设置环境变量。协调仓提供一个共享 URL 后，团队可以直接从该工作区启动 Repoctopus。

## What Changes

- 在协调仓的 `repoctopus.yaml` 支持可选的 `telemetry.endpoint`，一个 OTLP/HTTP 基础 URL 供 traces、logs 和 metrics 使用。
- 保留已有环境变量配置。按信号端点优先于公共环境变量端点，公共环境变量端点优先于工作区 YAML。
- 更新使用文档和示例。认证 Header、超时和 Resource 属性沿用现有环境变量，遥测字段继续使用既有协议。

## Capabilities

### New Capabilities

### Modified Capabilities

- `development-telemetry`：定义工作区默认 Collector 地址、覆盖优先级、URL 边界和未配置行为。

## Impact

影响工作区配置解析、Project Composition 的 OTLP 投递配置、部署文档及验收。团队只需在协调仓配置一次；兼容既有纯环境变量部署。

```

## openspec/changes/configure-workspace-otlp-endpoint/design.md

- Source: openspec/changes/configure-workspace-otlp-endpoint/design.md
- Lines: 1-33
- SHA256: fbd8f36aefd8329d35f56a0eb04b90662dbab78c9f5f19e7cea922afcc594dda

```md
---
comet_change: configure-workspace-otlp-endpoint
role: technical-design
canonical_spec: openspec
---

# Design

## Context

远端和本地 Desktop 共用 Canonical Observation outbox。工作区已通过 Project Composition 给投递服务提供启动参数，所有遥测来源通过同一投递入口解析目的地。

## Goals / Non-Goals

**Goals**

- 工作区加载一次团队默认地址，所有遥测来源使用同一优先级。
- 通过真实 CLI 启动和 HTTP 测试接收器验证三类信号。

**Non-Goals**

- 本次范围是远端地址配置。认证、服务身份、Desktop 接收器配置及公开遥测字段沿用既有机制。

## Decisions

1. 在现有共享配置 schema 添加 `telemetry.endpoint`。解析器验证绝对 HTTP(S) 基础地址，允许路径前缀，拒绝嵌入凭据、查询参数和片段。错误只指向配置字段。
2. Project Composition 将工作区地址作为运行时投递参数传给共享 Observation Delivery。现有 OTLP 解析器按单信号环境变量、公共环境变量、工作区地址的顺序选址，无需写入全局 `process.env` 或让每个遥测 Adapter 各自读取 YAML。
3. Runtime 重用现有信号路径、请求头、独立目的地和失败恢复逻辑。实际地址变化沿用现有 outbox 的远端目的地语义。

## Risks / Trade-offs

- 工作区 URL 指向团队共享接收端。地址可提交，认证值由启动环境提供。URL 格式校验不等同于连通性校验，接收端不可用由现有遥测投递健康状态表达。
- 用带路径前缀的 HTTP 测试接收器验证 YAML-only 启动。用覆盖测试锁定优先级及纯环境变量部署行为，并验证错误不会回显带凭据的输入。

```

## openspec/changes/configure-workspace-otlp-endpoint/tasks.md

- Source: openspec/changes/configure-workspace-otlp-endpoint/tasks.md
- Lines: 1-11
- SHA256: 17187a98238289be4cc11959069012e6978d93099ec574d925a3f7594bac54f4

```md
# Tasks

## 1. 工作区地址与投递

- [ ] 1.1 用真实工作区 YAML 和本地 OTLP 接收器复现缺失能力。验证解析器接受 HTTP(S) 基础地址并拒绝无效或带凭据的 URL。 <!-- comet-task:83fb171b-6e7b-43bd-bd07-80a42888bf93 -->
- [ ] 1.2 将工作区默认地址接入共享投递路径。验证 YAML-only 发送全部三类信号、路径前缀保留，以及单信号和公共环境变量覆盖优先级。 <!-- comet-task:cecc80c7-c2be-49ac-870a-0b93b230526e -->

## 2. 使用与验收

- [ ] 2.1 在现有配置示例和遥测文档提供一个 URL 的用法、认证和优先级说明，保留原有纯环境变量部署说明。 <!-- comet-task:26be8091-66d2-40cf-be04-b64728cbd3df -->
- [ ] 2.2 完成独立审查、定向测试和完整门禁。保存验证报告并核对报告与 Git 提交的字节一致。 <!-- comet-task:09edf430-8df9-4439-a0c5-72f56a6c7135 -->

```

## openspec/changes/configure-workspace-otlp-endpoint/.openspec.yaml

- Source: openspec/changes/configure-workspace-otlp-endpoint/.openspec.yaml
- Lines: 1-2
- SHA256: 9b4b840064a33a6866a0ebc375b496fbdc2387a324f6c8fb4f21b270218c0d37

```md
schema: spec-driven
created: 2026-11-06

```

## openspec/changes/configure-workspace-otlp-endpoint/specs/development-telemetry/spec.md

- Source: openspec/changes/configure-workspace-otlp-endpoint/specs/development-telemetry/spec.md
- Lines: 1-37
- SHA256: 082cfa2aad256760bb35139d93e410cf02c4d19091443cbc21ea1b6223403fbd

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: 标准 OTLP 部署配置必须完整生效

Telemetry Adapter MUST 支持在工作区 `repoctopus.yaml` 中声明可选的 `telemetry.endpoint` 作为远端 OTLP/HTTP 基础地址。按信号环境变量端点优先于公共环境变量端点，公共环境变量端点优先于工作区地址。Telemetry Adapter MUST 保留标准 OTLP 请求头、服务名和 Resource Attributes 配置，并以确定优先级合并 Repoctopus 默认资源身份。配置缺失或后端不可用不得改变领域结果。

#### Scenario: 工作区仅用 YAML 配置 Collector

- **WHEN** 协调仓在 `telemetry.endpoint` 填写一个合法的 HTTP 或 HTTPS Collector 基础 URL，并且没有 OTLP 环境变量端点
- **THEN** 从该工作区启动的 Runtime 使用这个地址发送 traces、logs 和 metrics，保留可选的 URL 路径前缀并追加相应的 `/v1/{signal}`

#### Scenario: 团队配置统一 OTLP 端点

- **WHEN** 部署环境提供 `OTEL_EXPORTER_OTLP_ENDPOINT` 和认证请求头
- **THEN** Trace、Log 与 Metric 使用该配置发送到兼容 Collector，凭据不进入配置摘要、领域状态、诊断正文或普通遥测属性

#### Scenario: 单类信号覆盖默认地址

- **WHEN** 工作区配置了基础 URL，且一个信号的完整端点由环境变量提供
- **THEN** 该信号使用它的环境变量端点，其余信号按公共环境变量端点或 YAML 地址投递

#### Scenario: 部署覆盖 Resource Attributes

- **WHEN** 部署环境提供合法的 `OTEL_SERVICE_NAME` 或 `OTEL_RESOURCE_ATTRIBUTES`
- **THEN** 所有 Repoctopus exporter 使用同一合并规则输出资源属性，并保留规范产品和 schema 身份以支持跨信号关联

#### Scenario: 未配置远端端点

- **WHEN** 工作区和进程都没有 OTLP 端点配置
- **THEN** 远端导出保持禁用，Run、Evidence 与 Delivery 继续工作且不产生连接重试

#### Scenario: 工作区 URL 无效或包含认证信息

- **WHEN** `telemetry.endpoint` 不是有效的绝对 HTTP(S) URL，或包含凭据、查询参数或片段
- **THEN** 工作区配置验证以字段路径拒绝该值，诊断不回显 URL 内容；认证请求头继续通过环境变量配置

```
