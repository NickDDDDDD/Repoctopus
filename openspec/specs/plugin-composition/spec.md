# plugin-composition Specification

## Purpose

定义 Repoctopus 如何以 Cordis 作为唯一应用 Runtime，从共享项目配置确定性组合产品 Service、Provider、Contributor 与外部入口，并以可撤销生命周期和可追溯组合支撑长期演进。

## Requirements

### Requirement: App Boot 从领域配置构造 Cordis 插件树

Repoctopus MUST 通过统一 App Boot 加载共享项目配置、选择 bootstrap 或 project composition、生成 Cordis Loader Entry 并启动插件树；公共 CLI、IDE Adapter 和 API 不得自行实例化产品 Service 或维护第二套组合规则。

#### Scenario: 两次启动使用语义相同配置

- **WHEN** App Boot 使用语义相同的共享配置和允许的本机覆盖启动两次
- **THEN** 两次生成相同的 composition digest、插件身份集合和静态准入结果

#### Scenario: 入口尝试绕过插件树

- **WHEN** 公共入口请求一个产品能力
- **THEN** 入口通过当前 Cordis Context 解析对应 Service，不直接构造 WorkflowRuns、Evidence、Delivery 或平台 Adapter

#### Scenario: 缺少正式项目配置

- **WHEN** App Boot 在没有有效 `repoctopus.yaml` 的工作区启动
- **THEN** 系统只加载 bootstrap composition，并明确拒绝 Run、Evidence 与 Delivery 等 project composition 命令

### Requirement: 产品能力使用 Cordis 原生 Service 与 Contributor

Repoctopus MUST 让一对一产品能力直接继承 Cordis `Service`，让一对多扩展通过 Contributor 向所属注册表登记，并由 Cordis Context、Inject、Fiber 与 Effect 管理依赖和生命周期；不得建立第二套容器、通用 Service Adapter 或产品级 Runtime。

#### Scenario: Provider 依赖尚未出现

- **WHEN** Service Provider 声明的必需 Service 尚未注册
- **THEN** Provider 由 Cordis 保持未激活，并在依赖出现后按 Cordis 生命周期激活

#### Scenario: Contributor 插件卸载

- **WHEN** Action、Evidence 或 Command Contributor 所属 Fiber 被卸载
- **THEN** Contributor 通过 Effect 撤销注册，注册表不再向新操作返回该实现

#### Scenario: 产品代码声明第二个 Runtime

- **WHEN** 内置或团队插件尝试提供名为 Repoctopus Runtime 的产品服务或占用 Cordis `ctx.runtime`
- **THEN** 静态架构检查或启动检查拒绝该实现，并要求按产品 Service 边界拆分

### Requirement: 插件资源随生命周期撤销且活动操作有界排空

插件 MUST 通过 Cordis API 或 `ctx.effect()` 持有监听器、注册项、Timer、Watcher、进程、浏览器和其他资源；卸载开始后 Service 必须停止接纳新操作，可安全取消的操作接收 AbortSignal，已越过 Journal 边界的操作完成到可恢复点，有界 disposer 等待已接纳操作排空。

#### Scenario: 普通插件重新加载

- **WHEN** Telemetry 或 Evidence Contributor 因有效配置变化被重新加载
- **THEN** 旧 Fiber 的注册、监听器和资源完成撤销后，新 Fiber 才成为活动贡献者

#### Scenario: 卸载遇到正在提交的操作

- **WHEN** Service 卸载时一个操作已经写入 Intent 或 Transition Journal
- **THEN** Service 不接受新操作，并允许该操作完成提交或留下可由下次启动恢复的状态

#### Scenario: 排空超过关闭期限

- **WHEN** 已接纳操作在有界关闭期限内没有结束
- **THEN** 关闭结果记录可恢复诊断并保留持久事实，不把内存取消描述为业务回滚成功

### Requirement: 插件接纳范围显式且可诊断

Repoctopus MUST 默认只接纳产品内置插件和共享配置显式登记的团队插件，并在导入前验证标识、版本约束、配置 Schema、契约兼容范围、来源和代码摘要；同进程插件不得描述为恶意代码安全隔离。

#### Scenario: 未登记插件出现在本机目录

- **WHEN** 扫描或模块解析发现未被 composition 登记的包
- **THEN** App Boot 不导入或执行该包

#### Scenario: 团队插件版本不兼容

- **WHEN** 已登记团队插件声明的 Repoctopus 或状态契约版本与当前产品不兼容
- **THEN** App Boot 在执行插件模块前拒绝接纳并返回版本诊断

### Requirement: 每次运行绑定实际插件组合

Repoctopus MUST 为规范化 composition 与全部活动 Provider、Contributor 记录稳定标识、版本、配置摘要和代码摘要，并把 composition digest 绑定到 Run、Checkpoint、Evidence、Action Receipt、Delivery Snapshot、Trajectory 与允许列表遥测属性。

#### Scenario: 恢复时组合完全相同

- **WHEN** 当前 composition digest 与 Run 保存的摘要相同
- **THEN** 写操作可以继续按原状态契约执行

#### Scenario: 组合发生兼容变化

- **WHEN** 当前组合变化被所有受影响状态契约明确声明为兼容
- **THEN** 写操作记录 `composition.changed` 后继续执行

#### Scenario: 组合发生不兼容变化

- **WHEN** Engine、RunStore、Evidence Gate 或 Action Adapter 的变化不兼容当前 Run
- **THEN** 只读查询仍可使用，写操作进入 `migration_required` 且不静默推进

### Requirement: 第三方组合内核保持来源完整

Repoctopus MUST 各保存一份固定版本的 Cordis Core 与 Cordis Plugin Loader 上游源码，保留 MIT 许可证、上游提交、原路径和内容摘要；产品代码不得直接修改第三方快照，所有启动与领域扩展必须位于第三方目录之外。

#### Scenario: Cordis 快照被本地修改

- **WHEN** 来源检查发现第三方目录内容与登记摘要不一致
- **THEN** 验证失败并定位漂移文件，不把修改伪装成原始上游源码

#### Scenario: 评估上游新版本

- **WHEN** 维护者准备同步 Cordis 上游变化
- **THEN** 同步通过独立变更记录旧提交、新提交、差异、许可证和兼容性验证，不由普通依赖更新自动替换

### Requirement: 外部入口作为 Application Plugin 接入

CLI、IDE 与 API MUST 作为 Application Plugin 通过同一个版本化应用服务和 Command Router 调用产品能力；命令能力插件通过 Effect 注册 Handler，外部入口只负责协议解析、结果渲染和进程退出语义。

#### Scenario: CLI 与 IDE 查询同一 Run

- **WHEN** CLI 与 IDE 使用相同参数查询同一个 Run
- **THEN** 两者调用同一应用服务并获得语义相同的版本化结果

#### Scenario: 命令插件卸载

- **WHEN** 某个命令能力插件从 composition 卸载
- **THEN** Command Router 不再暴露该 Handler，并返回明确的能力不可用诊断
