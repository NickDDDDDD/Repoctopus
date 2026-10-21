# Spec Delta

## Purpose

定义 Repoctopus 如何通过单一、可替换的规格权威读取变更事实、执行验证并完成基线同步，使工作流不依赖某个规格工具的目录、命令或产物格式。

## ADDED Requirements

### Requirement: 每个 Run 使用唯一规格权威

Repoctopus MUST 为每个项目组合选择一个活动 Specification Provider，并在 Run 中记录 Provider 身份与版本；同一 Run 不得同时从多个规格体系推断权威需求。

#### Scenario: 项目选择 OpenSpec Provider

- **WHEN** 项目组合把 OpenSpec 配置为规格权威
- **THEN** Workflow 通过统一规格能力读取 change、产物和校验结果，不直接读取工具目录

#### Scenario: 多个 Provider 声称权威

- **WHEN** 一个项目组合同时配置两个活动 Specification Provider
- **THEN** App Boot 拒绝 project composition，并报告权威冲突

### Requirement: 规格操作使用稳定领域契约

Repoctopus MUST 通过规范化的 change 身份、产物引用、校验结果、同步结果和关闭结果表达规格操作；Provider 专有路径与 CLI 输出不得泄露为 Workflow 状态规则。

#### Scenario: 更换规格 Provider

- **WHEN** 项目在新的 Run 中选择另一个兼容 Specification Provider
- **THEN** Workflow 继续使用相同领域操作，已有 Run 仍保持原 Provider 快照

### Requirement: 规格校验是推进前置事实

Repoctopus MUST 在进入实施、交付和合入后关闭等受保护阶段前请求当前 Specification Provider 校验所需产物，并把结果作为 Evidence；调用方自述成功不得替代该事实。

#### Scenario: Delta Spec 严格校验失败

- **WHEN** 规格 Provider 报告当前 change 校验失败
- **THEN** 受保护阶段不得推进，并返回可定位的规格诊断

### Requirement: 规格资料冲突产生人工决定

Repoctopus MUST 在规格、设计图、接口契约或其他权威资料存在实质冲突时停止受影响工作，生成结构化 Human Decision，并在用户决定同步到权威资料后才继续。

#### Scenario: 设计图与规格行为不一致

- **WHEN** Agent 或验证 Adapter 发现设计图要求与规格要求冲突
- **THEN** 系统记录双方来源和影响范围，阻断受影响步骤，不自动选择设计图或规格

### Requirement: 同步和关闭可重试且幂等

Repoctopus MUST 让 Specification Provider 对同一 change、同一合入事实和同一目标基线重复执行同步与关闭时返回同一逻辑结果，不重复归档或覆盖不同内容。

#### Scenario: 关闭成功后的投递重放

- **WHEN** 相同的合入后任务因超时再次请求关闭已关闭 change
- **THEN** Provider 返回既有关闭身份和结果，不创建第二份归档

### Requirement: OpenSpec Provider 遵循官方产物生命周期

OpenSpec Provider MUST 使用 OpenSpec 官方命令和状态模型创建、校验、同步与归档产物，并保留 Proposal、Design、Delta Specs、Tasks 和验证记录之间的可追溯关系；Provider 不得把 schema 未声明的实施笔记推断成额外规划产物。

#### Scenario: Change 满足关闭条件

- **WHEN** 合入后验证通过且 delta specs 可以同步到主规格
- **THEN** Provider 使用官方生命周期同步主规格并归档 change，再返回变更文件清单和归档身份

#### Scenario: Change 目录包含非 schema 文档

- **WHEN** OpenSpec 状态没有把某个 Markdown 文件声明为产物
- **THEN** Provider 不把该文件映射成额外的规格或验证产物

### Requirement: 架构决定由规格 change 的设计产物记录

Repoctopus 开发工作流 MUST 把当前 change 内的普通设计决定、实施约束和偏差记录到当前 Provider 声明的设计产物，把测试事实记录到 Evidence 和正式验证报告；长期、难回退或跨边界的架构变更必须为该工作单独建立一个普通 change，并由其设计产物保留背景、备选方案、取舍、迁移与回退方式。工作流不得建立特殊的架构 change 类型、独立 ADR 或实施日志作为第二套决策权威。

#### Scenario: 局部实现约束不跨越当前 change

- **WHEN** 实施发现只影响当前 change 且可在同一设计边界内回退的约束
- **THEN** Agent 更新当前 Provider 声明的设计产物，不创建额外实施笔记或独立决策台账

#### Scenario: 决定具有长期架构影响

- **WHEN** 决定跨越 change、难以回退或影响公共契约、持久数据、安全或团队边界
- **THEN** Agent 为该工作单独建立一个普通 change，在其设计产物中说明背景、备选方案、取舍、迁移与回退方式，并通过正常评审取得确认

#### Scenario: 纯内部架构调整不改变行为契约

- **WHEN** OpenSpec change 只改变内部架构且没有规格级行为变化
- **THEN** change 使用 `skip_specs: true` 并在 `design.md` 记录决定，不为满足流程而虚构 delta spec

#### Scenario: 项目替换 Specification Provider

- **WHEN** 新 Run 选择实现稳定 Specification 契约的另一个 Provider
- **THEN** 工作流使用该 Provider 声明的设计产物和生命周期，不依赖 OpenSpec 的路径、文件名或独立 ADR
