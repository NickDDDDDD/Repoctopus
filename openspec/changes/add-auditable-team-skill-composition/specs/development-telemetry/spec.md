# development-telemetry Delta

## ADDED Requirements

### Requirement: 团队 Skill 与方法验证必须形成可重放观测事实

Repoctopus MUST 在本地 Trajectory 持久化后，为 effective composition compile/reject/drift、team binding resolution、required check、Method Receipt submit/accept/reject 和 Skill resolved/delivered/consumed/method verified 生成版本化 Event/Span。记录 MUST 关联 Run、Work、Host invocation、binding role、method/validator identity、结果和有界原因分类；Skill/binding/method 自由名称、Run/Task/package/repository、digest 和 Evidence identity 只能作为 Trace/Event 属性，不得成为 Metric label。Skill 正文、Prompt、回复、命令输出、内部思考、本机路径和个人身份不得导出。

#### Scenario: TDD 正文已消费但方法未验证

- **WHEN** Runtime 接受 consumed 回执但 TDD Receipt 缺失或被 Validator 拒绝
- **THEN** envelope 分别表示 consumed 与 method verification incomplete/rejected，远端和桌面不得把 Skill 显示为方法已通过

#### Scenario: 团队 required check 失败

- **WHEN** 团队检查 Work 完成但 Method Validator 或 Gate 拒绝其 Receipt
- **THEN** Trace 关联 binding、checkpoint、Work、Validator 和有界失败分类，Metric 使用固定 `role=required_check,result=failed` 而不是团队 Skill 名

#### Scenario: composition 在恢复时漂移

- **WHEN** 活动 Run 恢复发现 effective composition 与冻结摘要不兼容
- **THEN** Trajectory 与 OTLP 记录 drift 和阻断结果，不上传配置正文或 Skill 内容，也不合成后续 Work 成功

### Requirement: Build 策略绑定与人工等待必须可观测

Repoctopus MUST 分别记录 BuildStrategy proposed/approved/reused/invalidated、ExecutionBinding validated/drifted、Human Decision created/reused/superseded 和 Plan preflight finding，并保留 phase、Build action、strategy revision、binding revision、composition identity、reason class 与 duration 关联。相同 semantic digest 的恢复或返工 MUST 产生 decision reused 而不是新的 approval request；Metric labels MUST 只使用有界策略、结果和原因枚举。

#### Scenario: Configure 自动重验 binding

- **WHEN** Host 或 checkout 变化但批准 Strategy 语义未变，Runtime 接受新 ExecutionBinding
- **THEN** Trace 表示 binding revision 和受影响 Evidence invalidation，approval count 不增加且不导出 checkout 路径

#### Scenario: 相同策略返工

- **WHEN** Verify 返回 Build 且 Strategy/composition semantic digest 未变
- **THEN** 遥测记录 decision reused 与 Plan revision，不生成新的人工等待开始事件

#### Scenario: Plan 提前阻断越界写入

- **WHEN** Plan Evidence 发现 package write scope 超出任务或仓库边界
- **THEN** Trace 在 Execute 前记录有界 planning finding，使团队可计算 preflight catch rate，Metric 不使用路径文本作为 label

## MODIFIED Requirements

### Requirement: Skill 遥测必须区分解析、交付和可验证消费

Repoctopus MUST 分别记录 action、内置 augmentation 与团队 binding Skill 的 resolved、delivered、consumed 和 method verified 事实；resolved/delivered 不得冒充 Host 消费，consumed 不得冒充方法执行，Work 成功也不得反推任一状态。`consumed` 只有在当前 Host invocation 以匹配 packet/layer digest 的协议回执确认后产生；`method_verified` 只有登记 Method Validator 接受当前 Receipt/Evidence 后产生。允许列表属性仅包含 Skill identity、role、binding/method/validator identity、Run/Work/invocation 关联、结果和耗时，不包含正文、Prompt、模型回复、命令输出或本机路径。

#### Scenario: Host 未读取 augmentation

- **WHEN** packet 包含 Action、内置 augmentation 和 team guidance，但 Host 回执只确认消费前两层
- **THEN** 遥测只为已确认层产生 consumed，team guidance 保持 delivered；Work 最终成功不得补写 consumed 或 method verified

#### Scenario: consumed 没有 Method Receipt

- **WHEN** Host 消费 required TDD layer，但没有提交有效 Method Receipt
- **THEN** envelope 保留 consumed 并把 method verification 表示为 incomplete，不把二者折叠为一个成功状态

#### Scenario: Skill 正文包含敏感内容

- **WHEN** Skill、团队 binding 或 Provider layer 包含路径、凭据样例、Prompt 或其他正文
- **THEN** Event、Trace 和 Metric 只保留允许列表 identity/digest/role/result，不导出正文或其片段

### Requirement: Build 协议的配置计划执行检查必须可观测

Repoctopus MUST 在本地 Trajectory 持久化后，为 Strategy、ExecutionBinding、Plan、Plan Evidence、Execute 与 Check 输出版本化 Span/Event，并关联 runId、phase、action kind、attempt、checkEpoch、strategy/binding/plan revision/digest、execution/TDD/review/isolation 的有界枚举、effective composition、Work Package identity、Task references、repository role、Skill delivery/consumption/method verification、Validator result 和 duration。Metric labels MUST 使用有界枚举；run、Task、package、仓库、binding、Skill 和 digest 只能作为 Trace/Event attributes 或关联资源，不得成为高基数 Metric labels。

#### Scenario: Build Configuration 获得批准

- **WHEN** Runtime 持久化 Design Human Decision、Strategy identity 和 effective composition
- **THEN** OTLP 表示选择的有界策略、approval latency 和结果；Build Configure 后续只记录 Binding validation，不重复计算配置批准

#### Scenario: isolation binding 被接受

- **WHEN** Runtime 接受 Runner/Host 提供的多仓 ExecutionBinding
- **THEN** Trajectory 记录 repository role、isolation 枚举、binding semantic digest 和验证结果；OTLP 不导出 checkout 绝对路径、用户名或本机 worktree 名称

#### Scenario: Plan revision 修复 Verify finding

- **WHEN** Verify failure 使当前计划部分失效而 Strategy/composition 未变
- **THEN** Trajectory 与 OTLP 关联 finding、Plan revision、decision reuse、Execute 与 Check，使团队能计算返工率而不误计新批准

#### Scenario: subagent 包被委派

- **WHEN** Strategy 为 subagent-driven-development 且协调 Host 执行一个 Work Package
- **THEN** Trace 以父子 Span 关联协调调用、受管执行者调用、Skill/method 状态、受保护工具与 Outcome；Metric 不使用 Agent、package 或 Task ID 作为 label

#### Scenario: autonomous Work 完成

- **WHEN** autonomous Host 完成当前 Work Package 并通过 Validator
- **THEN** Trace 保留与 subagent 模式相同的 Strategy、Binding、Action、package、Task、测试、Review、方法验证和 Check 语义
