# skill-integration Specification

## Purpose

定义 Repoctopus 如何发现、选择和加载可替换的 Agent Skill，并把实际使用的方法指令绑定到可恢复 Run，同时隔离团队共享能力与成员个人学习状态。

## Requirements

### Requirement: Skill 通过可替换 Provider 解析

Repoctopus MUST 通过统一 Skill 能力按名称解析多个 Provider 的候选项，并依据声明的作用域和确定性优先级选择唯一实现；工作流不得引用具体 Provider 路径。

#### Scenario: 两个 Provider 提供同名 TDD Skill

- **WHEN** 当前组合中两个 Provider 都提供名为 `tdd` 的 Skill
- **THEN** 系统按作用域和稳定优先级选择唯一实现，并在目录中标明实际 Provider

#### Scenario: 替换默认 TDD Provider

- **WHEN** 项目组合把另一个有效 Provider 配置为 `tdd` 的优先来源
- **THEN** 工作流继续请求 `tdd`，无需修改阶段定义或 Runtime 代码

### Requirement: Skill 调用策略在边界处执行

Repoctopus MUST 为每个 Skill 区分模型调用和用户调用权限，并在列出与加载正文时重新核对策略；未获授权的调用不得返回正文。

#### Scenario: 仅允许用户调用的 Skill

- **WHEN** 模型请求加载一个禁用模型调用但允许用户调用的 Skill
- **THEN** 系统拒绝模型调用，同时保留用户显式调用入口

### Requirement: Run 记录实际 Skill 快照

Repoctopus MUST 在 Run 首次使用一个 Skill 时记录其规范名称、Provider 身份、调用策略和正文内容摘要；恢复时 Skill 事实发生变化不得静默改变既有 Run 的方法依据。

#### Scenario: Skill 正文在 Run 中断期间改变

- **WHEN** Run 恢复时同名 Skill 的正文摘要与已记录快照不同
- **THEN** 系统报告 Skill 漂移并要求按兼容策略重新确认或启动新 Run

#### Scenario: 未使用的 Skill 发生变化

- **WHEN** 目录中一个未被当前 Run 加载的 Skill 发生变化
- **THEN** 系统刷新后续发现结果，但不使当前 Run 的既有步骤失效

### Requirement: 外部 Agent 通过稳定目录协议消费 Skill

Repoctopus MUST 提供版本化的 Skill 列表与正文读取协议，并允许 IDE Adapter 将同一解析结果投影到目标 Agent 支持的项目级目录；Adapter 不得维护独立的 Provider 优先级或依赖 IDE Hook 才能加载 Skill。

#### Scenario: Codex 与 OpenCode 查看同一项目 Skill

- **WHEN** 两个 IDE Adapter 针对同一项目和组合请求 Skill 目录
- **THEN** 两者获得相同的规范名称、描述、调用策略、Provider 和正文摘要，仅输出格式与目标目录不同

#### Scenario: IDE 不支持动态 Skill API

- **WHEN** 目标 IDE 只能从项目目录读取 Skill 文件
- **THEN** Adapter 以可重复生成的方式投影目录，并记录来源摘要以防止把本地编辑误认为 Provider 内容

### Requirement: 团队 Skill 与个人学习状态分离

Repoctopus MUST 允许团队共享 `teach` Skill 定义，同时把每个成员生成的课程、资料索引、笔记和学习记录写入 `.repoctopus/learning/` 本机目录；该目录默认被 Git 忽略。

#### Scenario: 成员启动学习主题

- **WHEN** 成员在一个项目中使用 `teach` 创建学习内容
- **THEN** 内容写入该成员本机的 `.repoctopus/learning/<topic>/`，团队仓库不产生待提交文件

#### Scenario: 团队决定沉淀学习结论

- **WHEN** 成员显式选择把经过整理的结论提升为团队知识
- **THEN** 系统要求通过项目文档、规格或知识库的正常评审路径写入，不直接提交个人学习目录

### Requirement: 个人学习内容默认不进入审计数据

Repoctopus MUST 禁止默认遥测、日志和 Run 事实包含个人学习正文、笔记正文或资料正文，只允许记录经配置允许的 Skill 名称、Provider、摘要和状态。

#### Scenario: 导出 Skill 调用遥测

- **WHEN** `teach` 被调用且 OpenTelemetry 已启用
- **THEN** 遥测可以包含 Skill 名称和内容摘要，但不包含个人课程、笔记或资料正文
