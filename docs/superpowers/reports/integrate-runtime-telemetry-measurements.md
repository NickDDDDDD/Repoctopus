# Runtime Telemetry Measurements 验证交接

## 结论

`integrate-runtime-telemetry-measurements` 的实现、协议级 OTLP 集成、隐私与基数约束、完整产品门禁均已通过。独立复核没有发现未解决的阻断项。

## 权威证据

- Repoctopus 正式验证报告：`verification/integrate-runtime-telemetry-measurements/verification-report.md`
- 核心产品实现边界：`d345063a0e2e0dd4c90926498017fb1014f21a76`
- 报告新鲜度边界：`90bdacf9bc9d8e1bdf4c8f484b2e4fc79002cb4b`
- 控制器：`@rpamis/comet@0.5.1`
- 独立复核：canonical outbox 单一权威、OTLP 标准配置、Skill/Rule/Run 事实绑定、22 项覆盖矩阵、低基数指标、隐私过滤、Desktop/远端协议一致性和生成文档防漂移均通过，阻断项为 0。

本文件是 Comet Classic Verify 所需的报告入口，只负责把生命周期收据绑定到上述正式 Evidence；它不建立第二套规格、任务、实现笔记或产品验证权威。`docs/superpowers/**` 已从发布包排除，产品包摘要只记录在正式报告中。

## 当前 Build Checkpoint 证据

- Build Check 命令：`npm run check:managed-execution-report`
- 结果：退出码 0，执行期间工作区无变化，输入前后摘要一致
- 输入摘要：`85ed8b414cd2a6e3d9f39ababf192a9508a4ca4bf5673ec2e094fc7593f61c6b`
- 内容摘要：`fb11a45349915a2e55370808188812ad8c702d0020f2d8c2430f802c0a14fda2`
- 收据：`.comet/runtime/classic-sdk-checks/bbfe614ad3819031d386b92e188b015d03a60b7e1895e24ff9cbee81e698ac26/80af3bed-ee9f-44d4-92ec-bf9102b79b0a.log`

正式报告记录的完整验证覆盖 TypeScript、Desktop TypeScript、Lint、CLI/Desktop 生产构建、167 个测试文件、734 个通过测试与 2 个跳过测试、generated/brand/architecture/provenance/Dashboard salvage、18 项严格 OpenSpec 校验、Package E2E、Runtime tracer 和最终包摘要复现。

## 审查范围与结论

- Workflow、Work、Evidence、Lifecycle、Delivery、Skill、Rule 和工作流 Run 指标全部由同一个 canonical OTLP encoder 投影；旧直连 exporter 已删除。
- Skill outcome 只关联同一 Run、Work attempt 和 Host invocation 的 consumed receipt；正式人工修正只有四种固定类别。
- Rule 指标只接受带稳定 Evaluator identity/version 的持久 receipt；无 Evaluator 时保持 unknown。
- 9 项 Runtime 可观察指标有权威来源和查询公式；13 项外部指标明确保持范围外，不伪造零值。
- 精确 Run、Work、Skill、Rule 和 Evaluator identity 不进入 Metric 标签；自由文本、路径、header 和凭据不进入公开属性。
- 标准 OTLP endpoint、按信号 endpoint、header、timeout、service name 和 Resource attributes 已覆盖；字段名是 schema v1 协议而不是部署配置。

## 已知边界

- 本文件只服务 Comet Verify，并被发布包显式排除。
- Archive 前仍须由 Comet Verify Guard 生成 Verify 作用域的真实检查收据；Build 收据和正式报告不能替代该收据。
- OpenSpec 的四份 Change 文档与 `tasks.md` 仍是规格和计划权威。
