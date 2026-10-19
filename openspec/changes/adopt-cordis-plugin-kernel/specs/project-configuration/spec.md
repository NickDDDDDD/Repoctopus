# Spec Delta

## MODIFIED Requirements

### Requirement: 团队规则使用共享项目配置

Repoctopus MUST 从 Git 跟踪的 `repoctopus.yaml` 加载仓库身份、composition、Evidence Profile、命令、服务、健康检查、浏览器 Journey、必需检查和保留策略，并使用版本化 Schema 校验全部字段；团队成员不得为了使用插件系统而直接维护 Cordis Loader 内部配置。

#### Scenario: 团队成员加载同一配置

- **WHEN** 两名成员在不同父目录检出同一项目并加载有效共享配置
- **THEN** 两端解析出相同逻辑仓库、composition、Evidence Profile 和门禁规则

#### Scenario: 共享配置缺少必需字段

- **WHEN** project composition 缺少版本、仓库 identity 或必需检查定义
- **THEN** App Boot 返回可定位配置诊断且不启动对应产品能力

#### Scenario: 用户配置包含 Cordis 内部配置

- **WHEN** 共享配置尝试注入未被 Repoctopus Schema 接纳的原始 Loader Entry 或 Cordis 内部字段
- **THEN** 配置校验拒绝该字段并保持领域配置与组合内核实现边界

### Requirement: 有效配置具有稳定摘要

Repoctopus MUST 对规范化共享配置、编译后的 composition 和允许的本机覆盖分别计算摘要，并把三者绑定到 Run 与 Evidence 输入指纹；键顺序、声明顺序或平台路径分隔符差异不得改变语义相同配置的摘要。

#### Scenario: 本机端口覆盖变化

- **WHEN** 成员修改 Evidence Run 使用的端口覆盖
- **THEN** 新运行产生不同有效配置摘要且旧 Evidence 不再满足当前 Profile

#### Scenario: 插件声明顺序变化但语义相同

- **WHEN** 团队只调整不影响插件身份和配置值的列表顺序
- **THEN** 编译后的 composition digest 保持相同

## ADDED Requirements

### Requirement: 配置翻译器只承担领域到 Loader 的确定性映射

Repoctopus MUST 由薄配置翻译器选择 bootstrap 或 project composition、执行领域 Schema 校验、静态 Descriptor 准入、权威能力唯一性检查和摘要计算，再生成 Cordis Loader Entry；翻译器不得复制 Cordis 的通用 Service 依赖图、激活顺序或 Fiber 状态机。

#### Scenario: 仓库尚未完成接入

- **WHEN** 工作区没有经过用户确认的 `repoctopus.yaml`
- **THEN** 翻译器选择 bootstrap composition，只生成项目探测、配置接入、来源检查和浏览器诊断 Entry

#### Scenario: 项目配置有效

- **WHEN** 工作区存在经过 Schema 校验的 `repoctopus.yaml`
- **THEN** 翻译器生成 project composition，并由 Cordis 管理 Service 依赖与激活

### Requirement: 团队插件准入先于模块执行

Repoctopus MUST 在导入团队插件前验证共享配置登记及静态 Descriptor 中的包身份、Repoctopus 契约版本、配置 Schema、能力、来源、代码摘要与状态兼容范围；无效组合不得通过模块求值副作用部分启动。

#### Scenario: 未登记包位于项目依赖中

- **WHEN** 项目安装了带 Repoctopus 插件入口的包但共享配置没有登记它
- **THEN** 配置翻译器忽略该包且不执行其模块代码

#### Scenario: Descriptor 不兼容

- **WHEN** 已登记插件的契约或状态版本与当前 composition 不兼容
- **THEN** App Boot 在 import 前拒绝接纳并返回逐字段诊断

### Requirement: 本机覆盖不得改变插件信任边界

`.repoctopus/local.yaml` MUST 不得新增团队插件、替换共享 Provider、降低版本约束、改变插件必需性或扩大权限类别；机器路径、端口与资源参数覆盖仍须遵循共享配置声明的允许字段。

#### Scenario: 本机覆盖启用额外 Provider

- **WHEN** 本机覆盖尝试加入共享配置未登记的 Service Provider
- **THEN** 配置合并失败并指出该字段超出本机覆盖权限
