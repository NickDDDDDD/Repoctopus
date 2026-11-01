# development-telemetry Specification Delta

## ADDED Requirements

### Requirement: 候选度量必须声明可信来源和覆盖状态

Repoctopus MUST 为纳入评估的每项候选度量声明 `direct`、`derived`、`optional-evaluator` 或 `out-of-scope` 覆盖状态、所需权威事实、聚合公式和缺失语义；Runtime 不得把不可观察事实推断为零值或成功值。

#### Scenario: 度量依赖外部系统

- **WHEN** 一项度量依赖 RAG 黄金集、IDE 采纳、代码归因、人员名册、培训或认证系统
- **THEN** 覆盖矩阵将其标记为 `out-of-scope` 并说明所需数据源，Runtime 不产生冒充该度量的事件或 Metric

#### Scenario: 度量由已有事件聚合

- **WHEN** 一项度量可由同一规范事件中的计数、结果或持续时间计算
- **THEN** 覆盖矩阵将其标记为 `derived`，记录分子、分母、时间窗口和未知值处理，而不重复建立第二份事实

### Requirement: Skill 效果度量必须绑定可验证执行事实

Repoctopus MUST 只从同一 Run、Work attempt 和 Host invocation 中已持久化的 Skill consumed 回执、Work 结果、人工决定与正式返工事实计算 Skill 完成、错误、人工修正和复用数据；这些结果只表达相关性，不宣称 Skill 导致成功或失败。

#### Scenario: 使用 Skill 的 Work 成功完成

- **WHEN** Host 以匹配 digest 的回执确认消费 Skill，且同一 Work attempt 的 Outcome 和 Validator 均被接受
- **THEN** 审计事件可以把该次使用计入 Skill 任务完成分子和调用分母，并保留 Run/Work 关联供查询核对

#### Scenario: Work 成功但 Skill 未被确认消费

- **WHEN** Skill 仅处于 resolved 或 delivered，Host 没有提交匹配的 consumed 回执
- **THEN** 该 Work 不计入该 Skill 的完成、错误、人工修正或复用统计

#### Scenario: Skill 使用后发生人工修正

- **WHEN** 已确认消费 Skill 的 Work 随后出现绑定同一结果的 changes-requested、Outcome rejection、Task reopen 或 Repair Work
- **THEN** 遥测记录有界修正类别并允许计算人工修正率，不导出审批正文、代码差异或自由文本原因

### Requirement: Rule 度量只接受机器可验证评估

Repoctopus MUST 只为具有稳定 Rule identity、版本、适用性判定和 Evaluator receipt 的规则记录 expected、triggered、passed 或 violated 结果；Skill 正文、AGENTS 文本或模型自述不得单独证明规则命中或违规。

#### Scenario: 结构化规则在适用场景触发

- **WHEN** 版本化 Evaluator 判定规则适用并提交该规则已触发且通过的持久 Receipt
- **THEN** 遥测允许把该记录计入规则应触发次数、正确触发次数和通过次数

#### Scenario: 自由文本规则没有 Evaluator

- **WHEN** 当前上下文包含规则文本但不存在适用性判定和结构化验证结果
- **THEN** 规则命中率与违规生成率保持未知，不从最终 Work 成功、Skill 加载或 Agent 声明反推

### Requirement: 工作流健康和效率度量必须可复算

Repoctopus MUST 从权威 Run 的开始、终态、workflow identity、阶段边界和有效周期导出工作流执行、失败、复用和持续时间事实；效率提升率由查询端使用相同口径的当前周期与明确基线周期计算。

#### Scenario: 工作流执行失败

- **WHEN** Run 进入持久化失败终态
- **THEN** 同一 Run 贡献一次执行分母和一次失败分子，重放、进程重启或临时导出错误不增加逻辑执行次数

#### Scenario: 团队比较交付周期

- **WHEN** SigNoz 使用同一 workflow/version 和周期定义比较当前窗口与明确基线窗口
- **THEN** 查询可以从权威持续时间计算效率提升率，并把缺少基线或未完成 Run 表示为未知而不是零

### Requirement: 标准 OTLP 部署配置必须完整生效

Telemetry Adapter MUST 支持标准 OTLP 总端点、按信号端点、请求头、服务名和 Resource Attributes 配置，并以确定优先级合并 Repoctopus 默认资源身份；配置缺失或后端不可用不得改变领域结果。

#### Scenario: 团队配置统一 OTLP 端点

- **WHEN** 部署环境提供 `OTEL_EXPORTER_OTLP_ENDPOINT` 和认证请求头
- **THEN** Trace、Log 与 Metric 使用该配置发送到兼容 Collector，凭据不进入配置摘要、领域状态、诊断正文或普通遥测属性

#### Scenario: 部署覆盖 Resource Attributes

- **WHEN** 部署环境提供合法的 `OTEL_SERVICE_NAME` 或 `OTEL_RESOURCE_ATTRIBUTES`
- **THEN** 所有 Repoctopus exporter 使用同一合并规则输出资源属性，并保留规范产品和 schema 身份以支持跨信号关联

#### Scenario: 未配置远端端点

- **WHEN** 进程没有任何 OTLP 端点配置
- **THEN** 远端导出保持禁用，Run、Evidence 与 Delivery 继续工作且不产生连接重试

### Requirement: 遥测公开契约必须完整可发现并防止漂移

Repoctopus MUST 发布与机器可校验遥测目录一致的数据字典，覆盖全部 Resource、Span、Log/Event、Metric、属性、类型、单位、允许值、必填性、来源、基数、隐私和聚合公式；新增、删除或改名必须作为协议变更评审。

#### Scenario: 团队建设 SigNoz Dashboard

- **WHEN** Dashboard 作者查阅公开遥测参考手册
- **THEN** 可以直接使用 Repoctopus 上报的规范名称构造查询，无需读取源码、重命名字段或依赖未公开推断

#### Scenario: 实现增加新遥测字段

- **WHEN** 代码增加、删除或修改公开事件、指标、属性、类型、单位或枚举
- **THEN** 契约检查要求机器目录、映射测试和参考手册同步更新，否则验证失败

#### Scenario: 公司使用不同字段命名

- **WHEN** 部署环境已有组织级字段命名约定
- **THEN** Repoctopus 仍输出规范字段，本 Change 不提供 Runtime 字段改名、公司别名或 Collector Transform 配置

### Requirement: Metric 标签必须保持有界且身份可下钻

新增 Skill、Rule、工作流和效率 Metric MUST 只使用有界角色、类别、结果、phase 和内置 kind；精确 Skill/Rule/Run/Work identity 只进入允许列表 Event 或 Span，使聚合保持低基数且异常可下钻。

#### Scenario: 团队使用自定义 Skill 或 Rule

- **WHEN** 精确 Skill 或 Rule 名称不属于内置有界目录
- **THEN** Metric label 使用 `custom` 或角色类别，关联 Event/Span 保留通过安全检查的精确 identity，时间序列不按自由名称扩张

#### Scenario: 身份值包含敏感或无界内容

- **WHEN** 候选 identity 包含路径、换行、疑似凭据、超长内容或未登记枚举
- **THEN** 属性允许列表拒绝或降级该值，并记录不含原值的本地诊断
