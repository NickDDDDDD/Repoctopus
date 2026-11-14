# 接入团队 SigNoz

在 Workspace 的 `repoctopus.yaml` 配置 Collector 地址后，Repoctopus 默认将工作流健康事实和必要诊断作为 OTLP Logs 发到团队的 SigNoz。Windows Desktop 可同时显示当前 Change，两者消费同一套 OTLP 事件。完整字段、信号、单位和指标公式见[遥测 schema v1 参考](telemetry-reference.md)。

## 配置

### 1. 取得 Collector 地址

请 SigNoz 管理员提供开发机和 CI 能访问的 **OTLP/HTTP 基础 URL**。自托管 Collector 直连常用 HTTP 端口 `4318`，团队也可以通过 HTTPS 网关暴露。例如，网关基础地址 `https://signoz-collector.example.internal/otlp` 对应 Trace 路由 `https://signoz-collector.example.internal/otlp/v1/traces`。Repoctopus 发送 OTLP/HTTP JSON，网关需要允许 `POST` 与 `application/json`。SigNoz 看板网页地址用于浏览数据，默认 gRPC 端口 `4317` 用于其他客户端。参见 [SigNoz 自托管接入文档](https://signoz.io/docs/ingestion/self-hosted/overview/)。

### 2. 写入团队共享配置

在 Workspace 根目录已有的 `repoctopus.yaml` 增加以下块。把示例 URL 换成团队提供的基础地址，保留网关路径前缀，省略末尾的信号路径。

```yaml
telemetry:
  endpoint: https://signoz-collector.example.internal/otlp
```

默认使用 `/v1/logs`。开启细粒度诊断时，Runtime 也会使用 `/v1/traces` 和 `/v1/metrics`。YAML 使用 HTTP(S) URL，省略 URL 内的凭据、查询参数和片段。凭据通过进程环境提供。

### 3. 按需注入认证与部署属性

自托管 SigNoz 默认无需 ingestion key。如果团队网关要求认证，在启动 Agent 或 CLI 的同一个环境中提供 `OTEL_EXPORTER_OTLP_HEADERS`。值是逗号分隔的 `键=值`，例如由凭据管理器注入 `authorization=Bearer%20...`。Header 会发送到实际选中的 Collector。

同一 Runtime 版本内，Collector 地址不参与 Run 的执行配置身份。字段名使用 [schema v1](telemetry-reference.md) 的公开名称。Repoctopus 不提供字段别名，也不要求 Collector Transform 改名。

| 变量                                                                                                            | 作用                                                                         | 优先级                                              |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                                                                   | 三类信号的总端点；Runtime 自动追加 `/v1/traces`、`/v1/logs` 和 `/v1/metrics` | 高于 YAML，低于按信号端点                           |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`、`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`、`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | 单独覆盖一个信号的完整 URL                                                   | 最高                                                |
| `OTEL_EXPORTER_OTLP_HEADERS`                                                                                    | URL 编码的公共请求头，如 `authorization=Bearer%20token`                      | 低于按信号 headers                                  |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS`、`OTEL_EXPORTER_OTLP_LOGS_HEADERS`、`OTEL_EXPORTER_OTLP_METRICS_HEADERS`    | 单独覆盖一个信号的请求头                                                     | 最高                                                |
| `OTEL_EXPORTER_OTLP_TIMEOUT`                                                                                    | 公共请求超时，单位为毫秒，默认 `5000`                                        | 低于按信号 timeout                                  |
| `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`、`OTEL_EXPORTER_OTLP_LOGS_TIMEOUT`、`OTEL_EXPORTER_OTLP_METRICS_TIMEOUT`    | 单独覆盖一个信号的超时                                                       | 最高                                                |
| `OTEL_SERVICE_NAME`                                                                                             | 覆盖默认服务名 `repoctopus-runtime`                                          | 高于 `OTEL_RESOURCE_ATTRIBUTES` 中的 `service.name` |
| `OTEL_RESOURCE_ATTRIBUTES`                                                                                      | 逗号分隔、URL 编码的 Resource 属性                                           | 不能覆盖固定产品名和 schema 版本                    |
| `REPOCTOPUS_ENVIRONMENT`                                                                                        | 设置 `deployment.environment.name` 的默认值，未设置时为 `development`        | 低于 `OTEL_RESOURCE_ATTRIBUTES` 中的同名属性        |

不需要认证或环境覆盖时，YAML 地址就是开启远端上报所需的配置。只设置单信号端点时，仅向该信号端点发送。没有任何远端端点时，工作流继续执行。地址优先级从高到低为按信号环境变量、公共环境变量、Workspace YAML。

## 确认 SigNoz 已收到数据

在已接入的 Workspace 启动一次真实 Change。也可以打开细粒度诊断后执行团队已有的 `verify` Profile，验证三种信号的接收链路。该命令实际执行 Profile 的检查。

```powershell
$env:REPOCTOPUS_OTLP_DIAGNOSTICS = 'full'
repoctopus evidence run --workspace . --profile verify --json
Remove-Item Env:REPOCTOPUS_OTLP_DIAGNOSTICS
```

1. 在 SigNoz 选中覆盖这次执行的时间范围。在 **Logs Explorer** 搜索 `service.name = 'repoctopus-runtime'`。如果团队设置了 `OTEL_SERVICE_NAME`，改用实际服务名。
2. 如果同一服务名下有多种数据，加入 `repoctopus.product.name = 'repoctopus'`。将 `repoctopus.event.type` 加到结果列，检查是否出现此次操作的事件。使用 Change Run 时，可以用 `repoctopus.run.id` 查单次运行，并按 `repoctopus.event.sequence` 读取事件顺序。
3. 开启细粒度诊断后，在 **Traces Explorer** 用同样的服务名确认 Span，在 **Metrics Explorer** 查找 `repoctopus.observation`。Evidence 冒烟能验证接收链路。Build、Skill 使用、归档等数据在执行对应工作流步骤后出现。

如果三个信号都缺失，核对命令运行的 Workspace、Agent 环境里的 OTLP 地址覆盖，以及开发机到 Collector 的 DNS、TLS 和网关认证。只有一种信号缺失时，优先检查该信号的环境覆盖、`/v1/...` 路由与 Collector pipeline。网关返回 `404` 时核对地址和前缀，`401/403` 时核对认证，`415` 时核对 JSON 请求支持。CLI 工作结果成功并不代表远端投递成功。

## 导入工作流健康看板

在 SigNoz v0.135.0 或更新版本打开 **Dashboards → New dashboard → Import JSON**，上传 [workflow-health.json](../deploy/signoz/workflow-health.json)。看板使用 Repoctopus 的规范 OTLP Logs 和 SigNoz 的 ClickHouse 查询，无需为字段改名。团队可用 [SigNoz 导入指南](https://signoz.io/docs/dashboards/import-dashboard/)核对界面步骤。

| 指标                    | 样本与计算                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动 Run 总数和配置分布 | 窗口内启动的唯一 Workspace + Run。按截止时有效的执行、测试及隔离方式分组。两种执行方式、两种测试方式、三种隔离方式共 12 种组合。尚未批准和历史数据未知各自单列。                   |
| 终态失败率              | 窗口内进入 `failed` 的唯一 Run 数除以同期进入 `failed` 或 `completed` 的唯一 Run 数。内置 Change 当前可到达 `completed`，Verify 失败会重试或返工，阻塞和需迁移归入未进入统计终态。 |
| 未进入终态占比          | 窗口内启动且到截止时没有上述两种终态的唯一 Run 数除以同期启动数。分组显示最后观测到的 phase、status、原因，明细显示阶段和状态停留分钟数。                                          |
| 完成 Run 平均回退次数   | 以窗口内完成的 Run 为同一分母，显示总平均、按目标阶段平均和六条来源 → 目标路径平均。计入完成前窗口之外的回退和零回退样本。同阶段重试不计。                                         |

统计窗口包含起点，排除终点。终态面板可计入窗口前启动的 Run。回退汇总随完成事件一起发送，避免日志保留期影响该 Run 的历史回退次数。历史完成事件缺少回退汇总时，覆盖面板会显示缺口，平均值显示无样本。分母为零时，比率显示无样本。

以 `repoctopus.observation.correlation.workspace_id` 和 `repoctopus.run.id` 在 Logs Explorer 下钻。按 `repoctopus.event.sequence` 排序，使用 `repoctopus.event.id` 识别重放。状态字段为 `repoctopus.observation.attribute.health_status`、`health_reason` 和 `health_fact` 共用此前缀，配置字段为 `health_configuration`、`execution_mode`、`tdd_mode`、`isolation`，完成事件使用 `rollback_total` 和 `rollback_*`。表格使用已入库的观测数据。Collector 不可达、超出保留期、拒收或旧版本覆盖不足可能产生未知或缺口。完整名称与类型见 [遥测字段参考](telemetry-reference.md)。

### 看细粒度诊断

短时排查时，在启动 Agent 或 CLI 的环境设置 `REPOCTOPUS_OTLP_DIAGNOSTICS=full`。细粒度模式使用 Trace、Log、Metric 三种信号。单独设置某个信号的完整端点，也会显式启用该信号的细粒度记录。

打开细粒度模式后，Log 从现有确认位置继续，之前过滤掉的 Log 不会补发。首次启用的 Trace 或 Metric 可以发送 outbox 中仍保留的历史。CLI 关闭时的请求超时取信号配置与剩余两秒预算中的较小值。

| 想看什么       | Metric                               | 聚合与分组                                        |
| -------------- | ------------------------------------ | ------------------------------------------------- |
| 工作流事件数量 | `repoctopus.workflow.events`         | Increase / Sum，按 `repoctopus.event.type` 分组   |
| Work 耗时      | `repoctopus.work.execution.duration` | Max / Max，按 phase 和 Work kind 分组，单位为毫秒 |
| Skill 回执     | `repoctopus.skill.usage`             | Increase / Sum，按 Skill category 和 result 分组  |

## Windows Desktop

正常的 Change Run 会尝试启动或激活已安装的 Desktop，Runtime 从受保护的 discovery 获取本地会话端点和短期凭据。以下变量仅用于隔离的 Receiver 冒烟测试。

```powershell
$env:REPOCTOPUS_DESKTOP_OTLP_ENDPOINT = 'http://127.0.0.1:4319'
$env:REPOCTOPUS_DESKTOP_OTLP_TOKEN = '<session-token>'
```

`REPOCTOPUS_DESKTOP_OTLP_MODE=paused` 暂停本地投递并保留有界积压。`removed` 移除本地目的地。桌面不可用时，Change Run 和远端上报继续执行。详见[启动或恢复 Desktop Dashboard](desktop-activation.md)。

## 先落盘，再导出

Trajectory、Attempt、Receipt、Artifact、Bundle、Gate 和轻量 Archive 事实先持久化。之后 Runtime 把允许列表 envelope 原子写入 `.repoctopus/telemetry/observation-envelopes.json`，每个目的地按信号分别推进 cursor。远端在 CLI 关闭时合批，每个请求最多 256 个 envelope、2 MiB，每次关闭最多四批，网络和锁等待共用两秒预算。后端失败时：

- Evidence Run 的结果保持有效；
- 只有仍待确认的目的地和信号重试，其他信号继续发送；
- 后续 CLI 启动会继续投递待确认批次。部分拒收和不可重试拒收记录缺口，旧版单游标之前的逐信号覆盖标为未知；
- 稳定 envelope ID 令重复投递在投影端收敛，但系统不宣称跨目的地 exactly-once。

目的地具有 `enabled`、`paused`、`removed` 三种保留状态。暂停会保留有界积压；移除会停止该目的地积压增长，且不会重置远端 cursor。超过容量时系统保留明确 gap（丢失数量与首个保留序号）和积压健康信息，而不是伪造连续历史。恢复 Desktop 后先追平其独立 cursor，再进入实时接收。

## 关联模型

- Workflow Run 是根关联 ID。
- Evidence Attempt、节点 Receipt、Artifact 引用和 Gate Outcome 使用稳定 ID 相互关联。
- Receipt 复用通过 `sourceReceiptId` 保留来源身份。
- Attempt 和节点映射为 Span；Artifact、恢复、漂移和 Gate 映射为固定名称 Log/Event；耗时与结果映射为低基数 Metric。
- Workflow、Evidence 与 Delivery 事件都携带当前 composition digest，便于把团队审计结果关联到实际生效的 Provider、Contributor 和配置身份。
- App 生命周期记录插件激活、重载与操作排空结果；排空超时只上报服务名、剩余数量和恢复分类，不上报 Journal 或错误正文。
- App 生命周期批次最多导出两次；仍失败时记录 `LIFECYCLE_TELEMETRY_EXPORT_FAILED` 和 `dropped_after_retry`，不保留 OTLP 错误正文，也不改变领域结果。

### Change lifecycle 关联

每个 accepted Trajectory 事实只产生一个规范 envelope，再编码为标准 OTLP Trace、Log 和 Metric。Desktop Receiver 与远端 SigNoz 因而消费相同身份与语义，不扫描 Workspace、Git 或 MR 反推阶段。

| 属性                                                | 含义                                   |
| --------------------------------------------------- | -------------------------------------- |
| `repoctopus.run.id`                                 | 原 Change Run 根关联 ID                |
| `repoctopus.change.id`                              | 通过安全格式检查的 change ID           |
| `repoctopus.change.phase.before` / `.phase`         | accepted transition 前后的 phase       |
| `repoctopus.change.status.before` / `.status`       | transition 前后的 Run status           |
| `repoctopus.change.work.active/id/kind`             | 当前 Work；inactive 事件显式清除旧值   |
| `repoctopus.change.task.id`                         | 当前 Task 的稳定 ID（若有）            |
| `repoctopus.change.validator.id/version/digest`     | 当前 Validator 的版本身份              |
| `repoctopus.change.wait.active/id/kind`             | 当前等待；inactive 事件显式清除旧值    |
| `repoctopus.change.wait.reason_category`            | 有界等待类别，不是自由文本 reason      |
| `repoctopus.evidence.*`                             | Evidence Attempt、Bundle、Gate 关联    |
| `repoctopus.action.receipt.id`                      | Runtime Action Dispatcher Receipt      |
| `repoctopus.runtime.invalidation.classification`    | `semantic` 或 `approval-authority`     |
| `repoctopus.runtime.invalidation.disposition`       | 当前为有界 `invalidate`                |
| `repoctopus.runtime.invalidation.scope`             | `exact`；未知范围使用保守路径          |
| `repoctopus.runtime.invalidation.continuation`      | Runtime 选择的有界后继，如 `design`    |
| `repoctopus.runtime.invalidation.retained_count`    | Trace/Log 中保留的 typed identity 数量 |
| `repoctopus.runtime.invalidation.invalidated_count` | Trace/Log 中失效的 typed identity 数量 |

Build 的每个已提交边界使用同一条 Trajectory 和 OTLP 管道。`work.*` 事件携带有界的 `buildAction`、execution mode、TDD mode、review mode 和 isolation；`change.lifecycle.transitioned` 携带 Configure approval、Plan revision、Plan Evidence、Check 和 invalidation 的稳定身份；`skill-composition.compiled|rejected|drifted`、`skill-binding.resolved` 与 `skill.resolved|delivered|consumed|consumption-rejected` 保留组合、binding/slot、冻结顺序、replacement identity、角色、父 Work 与 invocation 关联。角色区分 Action、内置 augmentation、team guidance 和 team replacement。Host 自述不会合成成功事件，`consumed` 只表示回执摘要属于当前 packet，不代表方法被正确执行；缺失、未知或旧 layer 只生成有界失败类别并阻止 Outcome。事件只在本地 Run 提交后导出。

Build Outcome 的一次接受只产生一个 `work.outcome-accepted` 和一个 `validator.completed` 事实，它们共享 Run、Work、attempt、checkEpoch、低基数 Work kind 与 validator identity。validation、submission 和 candidate digest 只用于本地关联与 guarded commit，不作为 Metric label；candidate payload、路径、诊断正文和自由文本不得进入 OTLP attribute。`work.outcome-rejected`、`work.outcome-processing-error` 与 continuation 分别表达可纠正候选、Runtime 处理故障和下一步，不能从异常字符串推断类别。

恢复决策使用 `recovery.observed`、`recovery.classified`、`recovery.applied` 和按需产生的 `evidence.invalidated` 四个稳定事实。Trace/Log 用同一个 `decision.id` 关联 source observation、最高受影响 authority、Runtime 选择的 action、保留/失效计数；重复应用同一 decision 不会新增第二组逻辑事实。Metric 只暴露 `authority`、`action`、有界 `reason_code` 与事件类型，不包含路径、Requirement 正文、commit、digest、自由摘要或 decision ID。

核心可靠性还使用四个有界事件：`work.packet-stored` 只记录 `created | reused`，`work.packet-recovered` 只记录 `recovered | missing | corrupt | legacy`；`specification.artifacts-observed` 只记录 Proposal、Specs、Design、Tasks 的 `ready | skipped | missing`；`specification.validation-observed` 只记录 valid、最高严重级、三级计数和 contract-conflict。Trace/Log 可以携带 run/work/attempt/epoch 与摘要关联，Metric 只使用上述固定枚举，不使用 changeId、digest、路径、诊断 code/message 或 packet 正文作为 label。遥测提交失败不改变 claim、恢复或 Gate 结果。

Trace 和 Log 可以使用 run、Work、configuration、plan、package、invocation、Skill digest 与 delegation execution identity 进行单次运行重建。Metric 只使用以下有界枚举：

- phase、event type、Work kind 和结果；
- `configure|plan|plan-evidence|execute|check` Build Action；
- `autonomous|subagent-driven-development` execution mode；
- `tdd|direct` TDD mode；
- `current|branch|worktree` isolation。

Metric 不使用 run、Task、package、repository、plan、composition/binding digest、自由 Skill 名称、binding ID、slot ID 或 Agent identity 作为 label。这些高基数值仅进入受允许列表保护的 Trace/Event 关联。未知值统一降级为 `unknown`、`custom` 或 `none`，因此恶意或新插件输入不会产生无界时间序列。

### Runtime 稳定性指标

团队可以从持久 Trajectory fact 复算以下指标；Dashboard 和 SigNoz 不各自解释本地文件：

| 指标                           | 计算                                                                   | 用途                           |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------ |
| 重复批准率                     | 相同 planning semantic identity 的额外 approval request / 全部 request | 发现批准身份过宽或幂等失败     |
| Protocol 重建率                | Design 返工后从空 Configure 重建 / 全部返工                            | 发现失效放大                   |
| 精确失效率                     | `scope=exact` / 全部 invalidation                                      | 判断依赖矩阵覆盖质量           |
| Completion 保留率              | 保留 completion / 返工前 completion                                    | 判断局部返工效率               |
| Checkpoint 恢复率              | `recovered` / 全部恢复尝试                                             | 判断中断恢复健康度             |
| Duplicate dispatch suppression | 被抑制的重复派发 / 重复 pull                                           | 发现 Runner 重试噪声和幂等质量 |

Metric label 只使用 authority、classification、scope、result 和 continuation 等固定枚举。具体 identity、digest、Work ID 和 reason 只进入 Trace/Event 允许列表，不能作为 SigNoz Metric 维度。

OTLP 使用两个稳定 instrument：`repoctopus.runtime.stability.events` 对每个版本化稳定性 fact 计数，`repoctopus.runtime.stability.items` 记录 retained/invalidated identity 与 completion 数量。后者把数量作为 measurement value；`measure` 只取 `retained-identities | invalidated-identities | completion-before | completion-retained`，不会把任意数值变成 label。SigNoz 中按 `kind`、`authority`、`result`、`classification`、`scope` 或 `continuation` 聚合即可复算上表比率。

CLI 与 Desktop 展示的 continuation 也来自已提交 checkpoint。动态 `next`/`resume` 选择先写入 `continuation.selected`，随后 OTLP 才导出同一事实；`run status` 不产生新的恢复事件，因此 Dashboard 刷新频率不会抬高 duplicate pull 或 checkpoint recovery 指标。

受保护写仓修正产生 `authorizedBranchRebind` lifecycle fact。Trace/Event 可以查看入口、分类、结果、是否恢复 matching poison、仓库数量和授权摘要；`repoctopus.workflow.events` 的 Metric 只暴露 `entrypoint=next|resume`、`result=dispatched|idempotent` 与 `poison_recovery` 三个低基数维度。branch、repository、path、remote、Run ID 和 digest 不进入 Metric labels；需要定位单次恢复时使用 Trace/Event。

Archive 仍使用同一 Run 和相同字段；不创建独立 Post-merge Run，不输出 Webhook、等待远端合入或 `repoctopus.post_merge.*` 平行语义。Publication Receipt 被同一 Run 接受时上报完成；后续 consistency reconcile 只上报有界的检查结果、变化类别和审查状态，不回写历史 phase。

Archive 外部副作用恢复通过现有 execution event 上报三个低基数维度：`repoctopus.publication.effect.stage=push|merge-request`、`certainty=not-applied|unknown`、`result=retryable|reconcile`。Trace 继续使用原 Run/Work/attempt/epoch 关联；Metric 不包含 repository、branch、path、平台响应正文或自由错误消息。`not-applied` 表示修正平台拒绝后可重拉同一 Work，`unknown` 表示只能观察、采用或进行有权威证据的 reconciliation。

Log 和 Span 可以携带这些高基数关联 ID。Metric 只使用工作流名、事件类型、动作结果、Evidence Adapter、状态等有界维度；它们不使用 Run、change、Attempt、Bundle、Delivery、Envelope 或 Receipt ID，避免时间序列数量随执行次数增长。

## 隐私边界

Host 人工决定继续复用 `wait.started`、`wait.ended` 与已接受的 lifecycle transition，不增加独立审批遥测或写入入口。渠道、授权依据和答复引用摘要只保存在本地决定权威中；本次不新增 Metric label。问答正文、评论、主体名称和答复引用不进入 OTLP，具体回传与恢复结果用 [人工决定公共入口](human-decision.md#change-生命周期) 查询。

OTel 属性只允许稳定 ID、Adapter、状态、可信等级、耗时，以及 Artifact 的类型、摘要、大小、MIME 和脱敏标记。以下内容不会进入属性：

- 命令输出、服务日志与健康响应正文；
- DOM、截图正文、视觉请求或响应；
- 本机绝对路径；
- token、密码、Cookie、Authorization 或其他敏感值。

原始内容只保存在受本机保留策略管理的 Artifact Store 中。遥测失败诊断也不会被写回领域事实。

Change lifecycle 映射只读取 accepted transition fact 中的枚举、稳定 ID 和摘要；自由文本 wait reason 只映射为有界 category。格式异常、疑似 Token、绝对路径、换行和超长值都会被拒绝。Action summary、规格正文、MR body、commit message、仓库 URL、文件列表和平台响应正文不进入关联属性。

本地 Desktop 与远端 SigNoz 消费同一套 OTLP 事件和属性；Desktop Receiver 不扫描 `.repoctopus/` 或轮询 CLI，因此两个显示端不会因各自推断状态而分叉。Desktop 只负责当前 change 的低延迟视图，SigNoz 负责团队历史、趋势和流程改进。
