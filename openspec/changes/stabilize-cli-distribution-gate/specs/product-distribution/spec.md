# Spec Delta

## Purpose

定义 Repoctopus 源码 checkout、持续验证、生成产物与安装包之间的权威边界，使维护者和自动化能够证明实际执行的是当前源码，而不是历史本地产物。

## ADDED Requirements

### Requirement: 干净 checkout 持续验证

Repoctopus MUST 在 pull request、默认分支 push 和人工触发时，从干净 checkout 使用受支持的 Node 版本与锁定依赖执行完整仓库验证，并以稳定的检查结果公开成功或失败。

#### Scenario: Pull request 更新源码

- **WHEN** pull request 被创建、重新打开或同步新的提交
- **THEN** CI 从该提交的干净 checkout 安装锁定依赖并执行完整验证，任一必要步骤失败时检查结果为失败

#### Scenario: 默认分支接收提交

- **WHEN** 提交到达默认分支
- **THEN** CI 对默认分支上的精确提交重新执行同一完整验证并保留检查结果

#### Scenario: 维护者人工复验

- **WHEN** 维护者从代码托管平台人工触发验证 workflow
- **THEN** workflow 对所选提交执行与 pull request 相同的验证契约

### Requirement: 本地与 CI 共享验证命令权威

Repoctopus MUST 让 CI 调用仓库声明的标准完整验证命令，而不是在 workflow 中复制一套逐渐漂移的构建、测试和规格校验步骤。

#### Scenario: 仓库验证清单发生变化

- **WHEN** 维护者在标准完整验证命令中增加或调整必要检查
- **THEN** 后续本地完整验证和 CI 自动采用同一更新，无需同步修改重复的命令清单

#### Scenario: 标准验证中的任一检查失败

- **WHEN** 类型检查、Lint、构建、测试、生成物检查、架构检查、来源检查或规格校验返回失败
- **THEN** 标准完整验证和消费它的 CI 都返回失败，不把部分成功描述为可交付

### Requirement: 源码运行绑定当前构建产物

Repoctopus MUST 把 `dist` 视为源码 checkout 的可重建本地产物；源码自举或验收在启动 CLI 前必须用当前 checkout 的标准构建命令生成所需 artifact，历史、缺失或来自另一提交的本地 `dist` 不得作为当前源码通过验证的证据。

#### Scenario: 更新源码后开始自举

- **WHEN** 维护者切换、拉取或合入新的源码提交并准备从源码入口启动 Repoctopus
- **THEN** 自举顺序先从当前 checkout 生成 CLI 与所需桌面 artifact，再启动源码入口

#### Scenario: 工作目录残留历史 dist

- **WHEN** 当前 checkout 中存在 Git 未跟踪且由较早源码生成的 `dist`
- **THEN** 验收不得仅凭该目录存在就认定当前源码已构建，必须重新执行标准构建或使用由当前提交生成并验证的安装包

#### Scenario: 干净 clone 没有 dist

- **WHEN** 维护者或 CI 得到不包含忽略产物的干净 clone
- **THEN** 标准构建能够从已提交源码与锁定依赖生成完整运行 artifact，而不要求从 Git 恢复 `dist`

### Requirement: 安装包经过独立消费验证

Repoctopus MUST 从当前源码构建发布候选包，在临时消费者环境安装其生产依赖并通过打包后的公共 CLI 执行协议级验收；源码目录中的本地 `dist` 成功不能替代安装包验收。

#### Scenario: 构建 npm 发布候选

- **WHEN** 仓库执行安装包端到端验证
- **THEN** 验收从当前源码生成 tarball、安装到隔离消费者目录，并通过安装后的 `bin` 验证公共 JSON 协议和必要资源

#### Scenario: 包缺少运行资源

- **WHEN** 发布候选未包含 CLI artifact、Schema、工作流、许可证或运行所需资源
- **THEN** 安装包端到端验证失败，即使源码目录中的测试或本地 CLI 已通过

### Requirement: CI 状态不伪装成服务端合入保护

Repoctopus MUST 区分 workflow 产生的检查状态与代码托管平台实际启用的 required-check/branch-protection 策略；仓库内验证不得在未观察平台配置时声称失败检查一定阻止合入。

#### Scenario: CI workflow 已存在但 required check 未配置

- **WHEN** 仓库能够产生验证检查但平台分支保护未配置、不可观察或套餐不支持
- **THEN** 项目把 CI 描述为可用验证而不是已生效的服务端合入保护，并给出需要管理员完成的平台配置边界

#### Scenario: 平台把验证检查设为 required

- **WHEN** 托管平台确认默认分支规则要求当前稳定检查成功
- **THEN** 团队可以把失败检查视为服务端合入阻断事实，同时仍保留仓库验证结果与平台策略两份独立证据
