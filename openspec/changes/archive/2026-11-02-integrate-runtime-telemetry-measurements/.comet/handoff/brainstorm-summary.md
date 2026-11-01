# Design Brainstorm Summary

状态：候选，等待 Design 决策。

## 已确认事实

- Open 已批准；行为权威为本 Change 的 proposal、delta spec 和当前主规格。
- 最新 `origin/main` 是实现基线；旧遥测分支只作需求、测试和失败案例参考。
- 主线生产 composition 已使用 canonical observation envelope、双目的地 outbox、Desktop receiver 与远端 OTLP 目的地。
- `observationDestinationsFromEnvironment` 已解析总 endpoint、按信号 endpoint、共享 header 与 Desktop token。
- Runtime stability facts/metrics 已存在，不能复制为第二套同义事实。
- 四个旧直连 OpenTelemetry exporter 没有生产 composition 调用者；它们会绕过 canonical outbox，主要剩余价值是测试断言。
- 项目尚未正式发布，不为旧补丁或未发布入口保留兼容层。

## 候选方案

### A. canonical directory-first projection（推荐）

保留每个已持久化领域事实的一份 canonical envelope；用机器目录控制唯一 OTLP projection。编码同时保留 Desktop 可逆 envelope 属性，并展开标准 Resource、允许列表 attributes、Span/Event 与有界 Metric。Desktop 和远端只在 endpoint、认证和 Delivery Cursor 上不同。旧直连 exporter 的有效测试迁移后删除。

优点：符合当前主规格；只有一套 mapping、重放和隐私边界；SigNoz 可直接查询标准字段。代价：需要重写旧补丁而非 cherry-pick，并迁移历史 exporter 测试。

### B. canonical 与直连 SDK exporter 并存

共享 Resource 工厂，但保留两套协议输出。短期删除较少，长期会维护两套 mapping、失败语义和字段目录，并允许同一领域事实产生不一致 OTLP，因此不推荐。

### C. 只查询 JSON envelope

保持当前 encoder，不增加展开属性和原生指标，由 SigNoz 解析 JSON。改动最小，但查询、索引、Metric 基数和跨后端可移植性都转嫁给部署方，无法满足完整公开数据字典目标，因此不推荐。

## 关键设计

- 领域层新增的 Skill outcome 与 Rule evaluation 必须先成为稳定、可重放的 additive fact，再映射为 envelope；exporter 不从相邻事件推断。
- Resource、service name、endpoint、header 和 timeout 是部署元数据，不进入 envelope identity。
- 精确 Skill/Rule identity 只用于 Event/Span 下钻；Metric 仅保留角色、类别、结果等有界维度。
- 覆盖矩阵恰好包含输入的 22 项指标：9 项直接/派生/可选 evaluator，13 项外部系统范围；缺失保持 unknown。
- 数据字典从机器目录生成，文档、实现和测试由 `check:generated` 防漂移。

## 风险与验证

- 编码 payload 变大：增加体积上限、敏感字段和基数回归。
- 删除旧 exporter 可能丢测试覆盖：先迁移协议、Span/Metric、故障测试，再删除入口。
- OTLP 环境优先级错误：表驱动测试覆盖总/按信号 endpoint、header、timeout、service/resource 属性。
- 双目的地语义漂移：dual-destination E2E 对同一 envelope 验证等价 payload 和独立 cursor。
- 最终执行全量 verify、package E2E、tracer E2E、生成物与 OpenSpec 严格校验。

## Spec Patch

不需要。当前主规格已经要求每个领域事实一份 canonical envelope、同一 mapping/payload 服务 Desktop 与远端，以及目的地不得重新解释领域事实。本轮只把技术设计收敛到该已批准要求。
