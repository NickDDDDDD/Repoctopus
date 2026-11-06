---
comet_change: configure-workspace-otlp-endpoint
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-06-configure-workspace-otlp-endpoint
status: final
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
