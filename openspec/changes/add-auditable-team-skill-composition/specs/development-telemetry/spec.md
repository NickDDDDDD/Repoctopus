# development-telemetry Delta

## ADDED Requirements

### Requirement: 团队 Skill composition 必须形成可重放观测事实

Repoctopus MUST 在本地 Trajectory 持久化后，为 effective composition compile/reject/drift、team binding resolution 和 Skill resolved/delivered/consumed 生成版本化 Event/Span。记录 MUST 关联 Run、Work、Host invocation、binding role、结果和有界原因分类；Skill/binding 自由名称、Run/Work/repository、digest 只能作为 Trace/Event 属性，不得成为 Metric label。Skill 正文、Prompt、回复、本机路径和个人身份不得导出。

#### Scenario: team guidance 已交付但未消费

- **WHEN** Runtime 已把团队 guidance 放入 packet，而 Host outcome 没有确认对应 layer digest
- **THEN** envelope 分别表示 delivered 与 consumed missing，远端和桌面不得显示为已使用或方法已执行

#### Scenario: composition 在恢复时漂移

- **WHEN** 活动 Run 恢复发现 effective composition 与冻结摘要不兼容
- **THEN** Trajectory 与 OTLP 记录 drift 和阻断结果，不上传配置正文或 Skill 内容，也不合成后续 Work 成功

## MODIFIED Requirements

### Requirement: Skill 遥测必须区分解析、交付和可验证消费

Repoctopus MUST 分别记录 Action、内置 augmentation 与团队 binding Skill 的 resolved、delivered 和 consumed 事实；resolved/delivered 不得冒充 Host 消费，consumed 不得冒充方法执行，Work 成功也不得反推任一状态。`consumed` 只有在当前 Host invocation 以匹配 packet/layer digest 的协议回执确认后产生。允许列表属性仅包含 Skill identity、role、binding identity、Run/Work/invocation 关联、结果和耗时，不包含正文、Prompt、模型回复、命令输出或本机路径。

#### Scenario: Host 未读取 augmentation

- **WHEN** packet 包含 Action、内置 augmentation 和 team guidance，但 Host 回执只确认前两层
- **THEN** 遥测只为已确认层产生 consumed，team guidance 保持 delivered；Work 最终成功不得补写 consumed

#### Scenario: Skill 正文包含敏感内容

- **WHEN** Skill、团队 binding 或 Provider layer 包含路径、凭据样例、Prompt 或其他正文
- **THEN** Event、Trace 和 Metric 只保留允许列表 identity/digest/role/result，不导出正文或其片段
