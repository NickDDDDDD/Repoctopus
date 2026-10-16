# Proposal

## Why

Repoctopus 需要一个显式、确定性、可恢复的 Runtime 作为多仓 Agent 工作流内核。当前已确认的能力覆盖工作流状态机、TDD、证据反馈、多仓交付、IDE 适配、OpenSpec、OpenWiki、长任务恢复和研发过程遥测；如果一次性横向实现全部能力，会在核心运行模型尚未被真实验证前形成大量耦合。

Comet `0.4.5` 已提供 Engine、Run、Resolver、Trajectory、Checkpoint、工作流契约和 CLI 等成熟实现。本变更先从固定 commit `575ab0d172e8105257b3c9172b8c8a9b628960ca` 采用满足需求的源码，完成一个最小但真实的纵向闭环，证明 Repoctopus 能探测多个 Git 仓库、启动工作流、确定性解析下一步、持久化轨迹、在进程重启后恢复，并通过 OpenTelemetry 输出可关联的研发过程数据。

## What Changes

- 建立独立的 TypeScript + Node.js 产品源码、构建、测试和 CLI 骨架，公共命令统一为 `repoctopus`，本地运行数据统一位于 `.repoctopus/`。
- 采用并改造 Comet 的 Engine 和 Workflow Contract 成熟边界，保留适用测试、MIT 许可证、固定来源清单和本地偏差记录；公共源码和命令不暴露 Comet 产品命名。
- 建立 Engine 与 Runtime 的明确分层：Engine 只处理确定性状态转换，Runtime 组合工作流、存储、多仓探测、Trajectory、Checkpoint 和平台适配器。
- 提供只读的平级 Git 仓库探测，生成包含仓库身份、路径、分支、HEAD 和工作树摘要的运行快照；不在本切片生成最终项目配置。
- 提供版本化工作流快照、独立 Run、确定性 Resolver、追加式 Trajectory、原子 Checkpoint、恢复探测和状态协调。
- 提供 `project probe`、`run start`、`run status`、`run next`、`run record`、`run resume` 和 `doctor` 的最小公共命令闭环，并同时支持人类文本和版本化 JSON 输出。
- Runtime 先把领域事件写入本地 Trajectory，再异步映射为 OpenTelemetry Trace、Event/Log 和基础 Metric；SigNoz 或网络不可用不得阻塞工作流推进。
- 建立 OpenTelemetry Collector 的开发接入样例和自动化验证，生产环境的 SigNoz 部署、长期 Dashboard 与告警在后续切片完成。

## Capabilities

### New Capabilities

- `runtime-foundation`: 定义 Engine、Runtime、工作流快照、Run、Resolver、Trajectory、Checkpoint、恢复和公共 CLI 的基础契约。
- `multi-repository-probe`: 定义安全、确定性的平级 Git 仓库探测及运行快照。
- `development-telemetry`: 定义研发过程事实到 OpenTelemetry 信号的映射、脱敏和故障降级。

## Scope

本变更只交付第一个可运行垂直切片。以下能力保留在产品架构中，但进入独立后续 OpenSpec change：

1. TDD 模式、Superpowers 方法和结构化 RED/GREEN 证据。
2. 浏览器画面、前端控制台、后端日志和服务健康反馈。
3. 正式验证报告、可信用户批准和内容摘要绑定。
4. Codex、OpenCode、CodeBuddy、CodeArts 的 Adapter、Hook 能力分级和 CLI 降级。
5. 多仓 Delivery Plan、commit、push、MR、CI、合入证据和交付状态机。
6. OpenSpec 规划、合入后复验、主规格同步和归档事务。
7. OpenWiki 更新、跨仓知识检索和事实回写。
8. 项目初始化、确定性扫描、Agent 补全、用户确认和模板分发。
9. SigNoz 正式 Dashboard、告警、Ubuntu 部署运维和跨项目分析。

本变更不兼容任何旧产品状态，不提供升级命令，不修改外部业务仓，不自动执行 Git 提交、推送或创建 MR。

## Impact

- 新增 Repoctopus 产品的初始源码、测试、构建产物约定、第三方来源治理和 OpenSpec 基线。
- 本地 E2E 使用临时目录创建多个 Git 仓库，不依赖任何真实业务仓。
- 运行时只依赖 Node.js；TypeScript、构建器和测试框架只属于产品维护环境。
- OpenTelemetry 使用厂商中立 OTLP 契约，SigNoz 是首个支持的查询与分析后端，不进入领域层依赖。
