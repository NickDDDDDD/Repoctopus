# Spec Delta

## Purpose

定义 Repoctopus 如何按可审查的依赖图执行命令、管理或观察服务、采集浏览器与视觉反馈，并在多 Agent 环境中安全恢复和释放资源。

## ADDED Requirements

### Requirement: Evidence Profile 编译为依赖图

Repoctopus MUST 把共享 Profile 编译为可验证的有向无环图，节点显式声明依赖、仓库、Adapter、必要性、超时和输出；上游失败只阻断依赖节点，独立节点可以继续。

#### Scenario: 前端组件库构建失败

- **WHEN** 应用构建依赖的组件库节点失败
- **THEN** 应用构建和浏览器节点标记为 `blocked`，不依赖该组件库的后端节点继续执行

#### Scenario: Profile 含循环依赖

- **WHEN** 配置形成不可拓扑排序的节点环
- **THEN** Runtime 在启动进程或命令前拒绝 Profile

### Requirement: 正式命令使用结构化参数

Repoctopus MUST 使用 `executable`、`args`、仓库 identity、工作目录、环境引用和超时执行正式命令，默认不通过 shell 解析字符串；显式 shell 命令 MUST 记录 shell 身份并产生安全诊断。

#### Scenario: 命令参数包含空格

- **WHEN** 一个 argv 参数包含空格或平台特殊字符
- **THEN** Adapter 把它作为单个参数传递且不发生二次 shell 展开

#### Scenario: Agent 临时拼接验证命令

- **WHEN** 命令不属于已确认共享 Profile
- **THEN** Runtime 可以把结果保存为补充观察，但不得生成满足正式门禁的 Receipt

### Requirement: Managed 模式只管理自有进程

Repoctopus MUST 为 Managed 服务保存进程 identity、启动时间、命令摘要、进程组、日志引用和停止策略，并只终止能够核对为当前 lease 所有的进程树。

#### Scenario: Managed 服务完成验证

- **WHEN** Profile 节点及其依赖 Journey 全部结束
- **THEN** Runtime 按反向依赖顺序停止自己启动的进程并记录退出结果

#### Scenario: PID 已被系统复用

- **WHEN** 恢复时 PID 存在但创建身份与登记值不同
- **THEN** Runtime 报告 orphan 诊断且不终止该进程

### Requirement: Attached 模式默认产生 observed 反馈

Repoctopus MUST 允许连接开发者或 IDE 已启动的服务，但在无法证明其代码身份、启动参数和环境与当前指纹一致时只生成 `observed` Evidence，且不得关闭外部进程。

#### Scenario: Attached 服务没有 build identity

- **WHEN** 健康检查成功但服务没有返回可核对代码身份
- **THEN** 反馈可用于开发诊断但不能满足 `verified` 交付门禁

### Requirement: 服务就绪条件由共享配置声明

Repoctopus MUST 支持 HTTP 健康、端口与日志正则组合的就绪条件，并记录每次探测、超时、提前退出和最终状态；端口开放不得自动等同业务健康。

#### Scenario: 端口已开放但健康响应失败

- **WHEN** Profile 同时要求端口与 HTTP 健康且健康端点返回失败
- **THEN** 服务节点保持未就绪并最终按超时或失败规则结束

### Requirement: 浏览器 Journey 使用声明式动作

Repoctopus MUST 只把共享 Profile 中版本化的 `navigate`、`waitFor`、`assertVisible`、`assertText`、`assertUrl`、`screenshot`、`collectConsole` 和 `collectFailedRequests` 动作作为内建正式 Journey；Agent 临时脚本不能获得相同信任等级。

#### Scenario: 页面出现未处理异常

- **WHEN** Journey 运行期间捕获 page error、console error 或配置为关键的失败请求
- **THEN** Browser Receipt 保存结构化 finding、页面和 Artifact 引用，并按 Profile 规则失败

#### Scenario: 关键元素不可见

- **WHEN** `assertVisible` 在超时内未满足
- **THEN** Journey 失败并保存当时截图和有界 DOM 摘要

### Requirement: 浏览器来源决定证据可信等级

Repoctopus MUST 记录 Playwright 与实际浏览器身份；系统 Chrome 或 Edge 默认用于开发反馈，只有 Profile 允许的固定 Chromium revision 才能生成正式 `verified` 浏览器证据。

#### Scenario: 固定 Chromium 尚未安装

- **WHEN** 必需浏览器节点要求 managed Chromium 但版本化缓存缺失
- **THEN** Runtime 返回显式安装命令且不在普通验证过程中自动下载

### Requirement: 视觉检查通过版本化协议接入

Repoctopus MUST 生成包含截图引用、viewport、页面身份、验收标准和可选设计参考的 `VisualInspectionRequest`，并只接受引用当前请求与 Artifact 摘要的结构化 `VisualInspectionResponse`。

#### Scenario: 当前客户端没有视觉能力

- **WHEN** Profile 把视觉检查设为必需且没有 Adapter 接受请求
- **THEN** Bundle 结果为 `incomplete` 且截图继续保留

#### Scenario: 视觉模型发现布局问题

- **WHEN** Adapter 返回带区域、严重级别、说明和证据引用的 finding
- **THEN** Runtime 保存 finding，并只按共享 Profile 中显式确定性规则决定是否阻断

### Requirement: 权威资料冲突进入人工决定

Repoctopus MUST 在视觉结果、OpenSpec、设计图、接口契约或其他权威资料存在实质冲突时生成 `requirements-conflict` Human Decision，暂停受影响节点且不得按时间、来源类型或 Agent 推断自动选择。

#### Scenario: 页面符合设计图但违反 Spec

- **WHEN** Visual Adapter 或 Agent 报告两份依据对同一行为要求不同
- **THEN** Runtime 展示冲突位置、两种结果与影响，并等待可信用户决定

### Requirement: 瞬时故障和业务失败使用不同重试规则

Repoctopus MUST 只按 Profile 对进程启动、健康探测和页面导航的瞬时故障进行有界重试；测试、构建和业务断言失败 MUST 结束当前节点并由新的显式 Attempt 重试。

#### Scenario: 测试首次失败后再次成功

- **WHEN** 用户或 Agent 未修改代码却显式重新运行测试
- **THEN** Runtime 保留两次 Receipt 并报告潜在 flaky finding，不覆盖首次失败

### Requirement: Managed 资源使用可恢复租约

Repoctopus MUST 为端口、服务、浏览器上下文和临时 Artifact 目录取得带进程身份的本地 lease；同一 Profile 不得并发取得冲突资源，陈旧 lease 只能在所有者身份失效后回收。

#### Scenario: 两个 Agent 同时启动同一 Profile

- **WHEN** 第一个 Run 持有仍存活的 Managed 资源 lease
- **THEN** 第二个 Run 等待或失败并返回持有者诊断，不启动重复服务
