# `close-runtime-telemetry-measurement-gaps` 验证报告

## 报告状态

- 结论：实现符合已批准的 Proposal、Design、Delta Spec 和 Tasks，当前候选可以进入 Archive 决策。
- 验证日期：2026-11-02。
- Change：`close-runtime-telemetry-measurement-gaps`。
- 已验证实现分支：`codex/revise-dashboard-telemetry`。
- 已验证实现提交：`4577b8ab6533c0fc640aba93067f95e67c4b1455`。
- 基线提交：`42e7c669be2ceed99b83ca5d2bd2028ec39d4779`。
- Package：`repoctopus@0.1.0`，`992941` bytes，SHA-256 `1ee2ba6935ec996f272de4f0be3ee99b5e8b932e05a051adb049fa8f6a606e98`。
- Build Guard Receipt：`.comet/runtime/classic-sdk-checks/59a714e8f3ab9cdafcb42ca032a9340852d1588fa0960e7ad5cafb774eff4e5d/a991ae49-1d71-46da-9799-35fe7d087118.log`。

本报告提交只允许包含验证 Evidence、OpenSpec Task 完成标记和 package 级验证报告刷新；若产品或打包内容在已验证提交之后变化，必须重新生成 package checksum 并执行完整验证。

## Verification Report: close-runtime-telemetry-measurement-gaps

### Summary

| Dimension    | Status                                                                           |
| ------------ | -------------------------------------------------------------------------------- |
| Completeness | 29/29 tasks；7/7 ADDED requirements；22/22 候选指标已分类，9 项纳入、13 项范围外 |
| Correctness  | 7/7 requirements 与 14/14 scenarios 均有实现和自动化测试证据                     |
| Coherence    | 7/7 Design decisions 已遵循；目录优先、事实增量、查询聚合和后端中立边界保持一致  |

### Issues by Priority

- CRITICAL：0。
- WARNING：0。
- SUGGESTION：0。

### Final Assessment

所有适用检查均已通过，可以进入 Archive 决策。公司现有 SigNoz 服务的实际网络、认证和 Dashboard 查询不是本次离线验证的前置条件；本次通过本地 OTLP HTTP Receiver 验证标准协议、端点优先级、Header、Timeout、三类 Signal 和 Collector 不可用时的业务隔离。连接具体公司环境属于部署验证，不改变产品协议结论。

## OpenSpec 完整性与一致性

`comet classic openspec` 适配器返回：

- Schema：`spec-driven`，规划源为当前仓库。
- Proposal、Delta Specs、Design、Tasks 四项产物均为 `done`。
- `instructions apply` 聚合 29 个 Task，完成 29 个，剩余 0 个，无不可读 tracking file。
- `validate close-runtime-telemetry-measurement-gaps --strict`：1 项通过，0 项失败。
- 完整 `npm run spec:validate`：15 项通过，0 项失败。

逐项核对 7 条 Requirement 和 14 个 Scenario：

1. 候选度量覆盖矩阵由 `TELEMETRY_METRIC_COVERAGE` 提供机器权威，测试固定 22 项输入及 9/13 范围边界。
2. Skill measurement 只从 `skill.consumed` 与同一 Work attempt、Host invocation、Outcome/Validator 或 correction transition 投影；resolved/delivered 不计为使用。
3. Rule measurement 只接受带稳定 Rule、Evaluator、applicability 和 result 的结构化 receipt；自由文本缺少 Evaluator 时不伪造命中。
4. Workflow measurement 从权威 Run start 与唯一 terminal lifecycle fact 投影执行、失败和周期，measurement identity 支持重放去重。
5. Runtime、Evidence、Lifecycle、Delivery exporter 复用标准 OTLP deployment resolver 与 Resource factory，支持统一和按信号 endpoint、headers、timeout、service name 与 resource attributes。
6. 公开 schema v1 机器目录覆盖 Resource、Span、Event/Log、Metric、Attribute、类型、单位、枚举、基数和隐私边界，并生成 `docs/telemetry-reference.md`。
7. Metric 仅使用受控的角色、类别、结果、workflow name/version 等低基数维度；精确 Skill、Rule、Run 和 Work identity 只进入安全下钻信号。

## Design 遵循

- 机器目录是公开名称的单一来源；生成手册不建立第二份手写权威。
- Runtime 持久化原始、可重放事实；比例、趋势和效率提升由 SigNoz 查询端聚合。
- Skill 结果明确表达相关性，不声称 Skill 导致成功或返工。
- Rule 统计缺少结构化 Evaluator 时为 unknown，不把 Skill 加载或最终成功误当规则证据。
- 全部 exporter 共享标准 OTel 配置，但领域层不依赖 SigNoz、Collector 或环境变量。
- 字段名维持版本化协议，本 change 没有加入字段别名、字段改名或 Collector Transform。
- 13 项范围外指标明确列出所缺的 RAG/评测、IDE/代码归因、身份、规则编辑审计或培训系统来源。

## 最终差异审查

最终审查范围为 `42e7c669be2ceed99b83ca5d2bd2028ec39d4779..4577b8ab6533c0fc640aba93067f95e67c4b1455`，覆盖 35 个文件。审查重点包括：

- 领域事实与 OTLP Adapter 的依赖方向；
- measurement identity、重放去重和终态唯一性；
- Validator accepted/rejected receipt 的同一原子提交边界；
- Endpoint/Resource 合并优先级与 signal-specific 禁用行为；
- Metric label 基数、精确身份下钻及敏感数据边界；
- 生成文档与机器目录的一致性；
- 动态 `diagnosing-bugs` Skill 的窄 allowlist，不放宽其他未知 layer 的 fail-closed 行为。

未发现 CRITICAL、IMPORTANT、WARNING 或 SUGGESTION finding。受当前会话禁止新增代理的上层约束，审查由同一 Host Agent 在 Verify 阶段作为与 Build 分离的最终差异审查执行；报告没有虚构第二位 reviewer。`autonomous` 执行仍由 Runtime Guard、完整测试和 OpenSpec 适配器独立约束结论。

## 自动验证

Comet Build Guard 在输入不变、工作区检查期间无修改的条件下执行：

```text
npm run verify
  TypeScript 主程序与 Desktop Renderer 类型检查通过
  ESLint 通过
  CLI 与 Desktop Renderer 构建通过
  129 个测试文件通过
  476 个测试通过，1 个既有条件测试跳过
  check:generated 通过
  check:brand 通过
  check:architecture 通过：240 个生产源文件、21 个能力所有者
  check:provenance 通过
  OpenSpec strict validation：15 通过，0 失败
  managed execution report 校验通过
```

Guard 结果：exit code 0；`changedDuringExecution=[]`；执行前后 input hash 相同。`git diff --check 42e7c669be2ceed99b83ca5d2bd2028ec39d4779..4577b8ab6533c0fc640aba93067f95e67c4b1455` 无输出。

## 范围边界

- 本 change 不创建或修改 SigNoz Dashboard、Alert 或 Collector Transform。
- 本 change 不提供公开字段改名、别名或租户自定义 schema。
- 本 change 不把 13 项缺少权威数据源的组织/个人指标伪造成零值或估算值。
- 本 change 不验证公司私有 SigNoz 网络连通性与凭据；标准 OTLP 配置和协议行为已经由本地真实 HTTP Receiver 验证。
- Skill 指标只可用于相关性分析；任何因果判断仍需要实验设计或外部评测系统。
