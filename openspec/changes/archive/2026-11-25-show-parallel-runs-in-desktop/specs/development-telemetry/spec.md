## ADDED Requirements

### Requirement: 当前受管子 Agent 的活动可以通过本地 OTLP 观测

Repoctopus MUST 将实际发生的受管子 Agent 开始、可证实的进展和结束关联到 Workspace、Change、Run、当前父 Work 尝试与子执行身份。由 Runtime 核验的任务和仓库标识才允许用于显示。进展只包含可证明且有界的里程碑或数量。观测不得授予执行权限或更改工作流权威状态，不得改变现有 SigNoz 指标口径或包含自由文本、路径、凭据与命令输出。

#### Scenario: 宿主派发当前 Work 的子 Agent

- **WHEN** 有权处理当前 Work 的 Host 提交已经发生的子 Agent 活动
- **THEN** Runtime 核验父 invocation、策略、子执行身份及工作范围，将可信的状态变化交付给本地 OTLP Receiver

#### Scenario: 活动重复或对应的 Work 已被替换

- **WHEN** 相同事实重试、迟到或来自过期的执行
- **THEN** 重复投递收敛到同一活动记录，过期执行不能更改当前活跃视图或影响原 Run 的权威进度

#### Scenario: 宿主没有实时活动事实

- **WHEN** 现有 Host 只提交合法的完成回执
- **THEN** 正常接受原回执，保留既有执行结果，且不补造实时开始或中间进展
