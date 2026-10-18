# Runtime 架构

Repoctopus 把确定性领域规则与文件、进程、浏览器、Git 和遥测副作用分开。Runtime 是唯一的 composition root；Engine 不直接访问这些平台能力。

```text
IDE / Agent / CLI
        │ versioned request, response and CLI envelope
        ▼
┌──────────────────────────────────────────────────────────┐
│ Runtime composition roots                               │
│                                                          │
│ RepoctopusRuntime          EvidenceRuntime                │
│ 工作流状态与恢复            实施反馈、恢复与 Gate 投影       │
└──────────────┬───────────────────────┬───────────────────┘
               │                       │
       ┌───────▼────────┐      ┌───────▼─────────────────┐
       │ Pure domains   │      │ Project configuration   │
       │ Engine         │      │ Profile → immutable DAG │
       │ Workflow       │      │ Fingerprint / Gate      │
       │ Delivery       │      │ Human Decision          │
       └───────┬────────┘      └───────────┬─────────────┘
               │                           │ ports
       ┌───────▼───────────────────────────▼─────────────┐
       │ Platform adapters                              │
       │ Git · process · command · service · browser    │
       │ Artifact Store · Journal · lease · OTLP        │
       └────────────────────────────────────────────────┘
```

## 配置与项目接入

`repoctopus.yaml` 是 Git 跟踪的团队事实，包含逻辑仓库、Evidence Profile、保留规则和 `delivery` 策略。`.repoctopus/local.yaml` 只覆盖本机路径、端口、浏览器位置、视觉反馈交换目录和资源上限。

`project detect` 只生成本机草稿。Agent 可以补全候选，但正式配置必须经过绑定候选摘要、当前配置摘要和 reconcile diff 的 Human Decision。具体流程见 [项目接入](project-onboarding.md)。

## Evidence Runtime

Evidence Runtime 按以下顺序工作：

1. 加载并规范化共享配置与本机覆盖，计算各自摘要。
2. 将 Profile 编译为不可变 DAG，在启动副作用前拒绝循环和未知依赖。
3. 采集仓库 HEAD、tree、未提交文件内容和工具身份，形成输入指纹。
4. 取得 Profile lease，按 DAG 可执行层并行运行 Adapter，并追加保存 Attempt、Journal、Receipt 与 Artifact。
5. 再次采集输入指纹。开始与结束不一致时，Evidence 标记为 `superseded`。
6. 聚合 Bundle，并投影为只含稳定事实的 `EvidenceGateProjection`。
7. 本地事实落盘后写入遥测 outbox，再通过 OTLP 导出允许列表元数据。

统一 Profile 执行器支持命令、Managed/Attached 服务、组合 readiness、浏览器 Journey 和结构化视觉检查。Managed 服务在依赖它的 Journey 和视觉节点结束后按逆拓扑顺序关闭；Attached 服务只观察，不接管生命周期。并行节点产生的 Receipt 按稳定拓扑序写入 Bundle，避免调度时序改变审计结果。

## Gate 边界

必需节点只有同时满足 `status=passed`、`trust=verified` 且 freshness 不是 `superseded` 才能满足 Gate。系统浏览器或无法核对 build identity 的 Attached 服务产生 `observed`，可用于诊断，但不能推进正式 Verify。

## 恢复与并发

- Attempt、节点 intent/completion Journal、运行上下文和进程登记都写入 `.repoctopus/`。
- 同一 Profile 的并发运行通过带 PID 创建身份的 lease 隔离。
- 恢复不会静默重跑已经开始但没有 Receipt 的命令；该节点变为 `incomplete`。
- Managed 服务只在进程身份和 lease 所有权同时匹配时终止进程树。
- 输入在中断期间变化时，已收集证据变为 `superseded`。
- Artifact Store 允许并行节点写入相同内容：竞争写入者必须重新读取并核对目标字节，只有摘要和内容一致才视为去重成功。该规则兼容 Windows 的 `EPERM` 与 POSIX 的 `EEXIST` 差异。

## 触手、吸盘、神经与眼睛

- **触手**连接并探测多个独立 Git 仓库，保存逻辑 identity，不把本机绝对路径写进共享配置。
- **吸盘**收集命令、服务、浏览器、测试、Artifact 和 Gate 事实。
- **神经**由版本化 CLI envelope、Human Decision、Adapter 端口和 Journal 事件组成。
- **眼睛**由 Browser Journey、截图 Artifact 和结构化 Visual Inspection 协议组成。

## 与上游来源的关系

采用的 Comet 代码保留在 `third_party/comet/` 的来源清单中。产品公开模块和命令只使用 Repoctopus 命名。来源校验用于确认许可证、固定上游提交、原始摘要和本地改造摘要，没有把上游目录结构当成产品架构。
