# Spec Delta

## ADDED Requirements

### Requirement: Agent Host 通过独立 Contributor 接入

Repoctopus MUST 把 Work Execution Host 定义为独立 Cordis Contributor，由受管执行 Service 按 action 类型、能力和稳定优先级选择；Host 的 identity、版本、代码摘要和配置摘要必须进入 composition snapshot，Engine 与 lifecycle domain 不得依赖 IDE、模型厂商或进程协议。

#### Scenario: 团队安装 IDE Host

- **WHEN** 团队插件登记一个兼容的 IDE Work Execution Host
- **THEN** Cordis 激活 Contributor，受管执行 Service 可按能力选择它，核心 lifecycle 与 Work 数据结构无需引用 IDE 包

#### Scenario: Host 在活动 Work 中卸载

- **WHEN** 已领取 Work 的 Host Contributor 开始卸载
- **THEN** Service 停止新调用并让当前调用到达有界 Outcome 或可恢复未知状态，不能把卸载当作成功

### Requirement: Host 与 Work Contributor 职责分离

Repoctopus MUST 让 Work Contributor 声明能力和副作用适配边界，让 Work Execution Host 负责调用 Agent；一个组件可以由同一插件提供，但 registry、identity、选择规则和错误诊断不得合并成无法区分的单一 adapter。

#### Scenario: Contributor 支持写入但没有 Agent Host

- **WHEN** composition 具有 repository-write Work Contributor，却没有可调用 action Skill 的 Host
- **THEN** Work 可以被描述但不能执行，Runtime 返回 Host unavailable，而不是让 Contributor 伪造 Agent Outcome

#### Scenario: Host 缺少受保护写入能力

- **WHEN** Host 能调用模型但没有当前 Work 所需的受保护工具能力
- **THEN** preflight 在模型调用前失败，不允许 Host 通过外部 shell 绕过声明能力

### Requirement: 生产组合暴露完整受管执行纵切

Project composition MUST 同时组合阶段 Skill Provider、上下文装配、Work claim、Host registry、受管执行、Runtime work guard、Outcome 与 Validator，并把这些服务列为生产所需能力；测试专用 Host 不得成为默认产品 Host。

#### Scenario: 普通项目组合启动

- **WHEN** App Boot 编译默认 project composition
- **THEN** 架构检查能从 lifecycle Work 追踪到阶段 Skill Provider、Host 端口、guard 和 Validator，任一缺失都使 composition 无效

#### Scenario: 测试捕获 Host 泄漏到产品目录

- **WHEN** builtin catalog 或默认项目配置尝试注册测试专用捕获 Host
- **THEN** 来源与架构检查失败，并要求只在测试 composition 显式注入
