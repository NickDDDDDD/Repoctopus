# skill-integration Specification

## ADDED Requirements

### Requirement: 受保护操作必须匹配当前 Work

Repoctopus MUST 在 Application Plugin、Command Router 和平台写入口根据当前已领取 Work 执行能力、side-effect class、repository 与 write scope 策略；没有活动 claim、目标超出范围、terminal artifact 被改写或操作类别不匹配时必须拒绝，Prompt、AGENTS.md 或调用方声明不得代替运行时授权。

#### Scenario: Agent 未领取 Work 直接写业务代码

- **WHEN** Agent 没有当前 Change Run 的有效 claim 却请求写入业务仓
- **THEN** 应用边界拒绝写入并返回需要领取的 Work，不依赖 Agent 是否读取流程说明

#### Scenario: 当前 Work 只允许规格目录

- **WHEN** Design Work 的 write scope 只允许 Provider 规划产物而执行者请求修改业务源码
- **THEN** 应用边界拒绝越界路径并记录 Work、capability 和目标摘要

## MODIFIED Requirements

### Requirement: Run 记录实际 Skill 快照

Repoctopus MUST 由 lifecycle Work 声明 required Skill 的规范名称，使用统一 Skill 能力解析唯一 Provider，并在领取 Work 前记录 Provider 身份、调用策略、正文内容摘要与适用 Work；恢复时 Skill 事实变化不得静默改变既有 Run 的方法依据，调用方不得选择替代 Skill 绕过 definition。

#### Scenario: Skill 正文在 Run 中断期间改变

- **WHEN** Run 恢复时当前 Work 的同名 Skill 正文摘要与已记录快照不同
- **THEN** 系统报告 Skill 漂移并按兼容策略使 Work 失效、进入 `migration_required` 或显式启动新 generation

#### Scenario: 未使用的 Skill 发生变化

- **WHEN** 目录中一个未被当前或历史 Work 加载的 Skill 发生变化
- **THEN** 系统刷新后续发现结果，但不使当前 Run 的既有 Work 失效

#### Scenario: 调用方请求替换 Skill

- **WHEN** 当前 Work 声明一个 required Skill 而调用方请求加载另一个 Skill 来完成同一 Work
- **THEN** Runtime 拒绝替换并返回 definition 声明的 Skill identity
