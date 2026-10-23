# Spec Delta

## Purpose

定义 Repoctopus 桌面观测应用如何接收标准 OTLP、实时呈现当前 change 的可信工作状态，并在本地中断、重复投递和窗口生命周期变化时保持可恢复且不影响团队遥测。

## ADDED Requirements

### Requirement: Windows 开发 Run 自动激活单实例桌面应用

Repoctopus MUST 在受支持的 Windows 环境开始开发 Run 时启动或激活一个桌面应用实例，并把对应 Workspace、change 与 Run 上下文交给该实例；同一用户会话不得因并发 Run 启动重复 Electron Shell、有效 Desktop Host 或接收器。

#### Scenario: 首个开发 Run 启动

- **WHEN** 受支持的 Windows 用户会话中没有运行桌面应用且开发 Run 开始
- **THEN** Repoctopus 启动桌面应用并显示该 Run 所属 change

#### Scenario: 第二个 change 开始运行

- **WHEN** 桌面应用已经运行且另一个开发 Run 开始
- **THEN** 既有 Shell 把新的 change 上下文交给当前 Desktop Host，且不创建第二个有效 Host 或接收器

#### Scenario: 未正式支持的平台启动 Run

- **WHEN** 用户在未正式支持的平台开始开发 Run
- **THEN** Runtime 保持可用并返回明确的桌面能力不可用诊断，不把该平台报告为受支持

### Requirement: 桌面接收器接纳标准 OTLP 上报

桌面应用 MUST 通过仅绑定本机回环地址的 OTLP/HTTP 接口接收 Trace、Log 和 Metric，并验证请求协议、体积与本机会话凭据；格式错误或未授权请求不得改变桌面投影。

#### Scenario: 接收合法 OTLP 批次

- **WHEN** Repoctopus 使用有效会话凭据向本机接收器上报合法 OTLP Trace、Log 或 Metric
- **THEN** 接收器确认该批次并把其中允许的观测记录交给状态投影

#### Scenario: 本机其他进程发送未授权请求

- **WHEN** 回环地址上的请求没有有效会话凭据
- **THEN** 接收器拒绝请求且不暴露既有 change、Run 或遥测内容

#### Scenario: 接收器未运行

- **WHEN** Runtime 无法连接桌面接收器
- **THEN** 开发 Run 与其他 OTLP 目的地继续工作且本地目的地保留可重试状态

### Requirement: 桌面状态只由接收到的观测数据投影

桌面应用 MUST 从接收到的 OTLP 观测记录投影 Workspace、change、Run、阶段、执行主体、任务进度、验证、Artifact 安全元数据、阻塞和下一步动作；不得通过扫描 OpenSpec、Git、领域 Store 或查询 SigNoZ 补造状态，缺失信息必须显示为未知或尚未上报。

#### Scenario: 当前 change 具有完整状态事件

- **WHEN** 接收器收到可关联的 change、Run、阶段、任务、验证和阻塞观测记录
- **THEN** 桌面应用按稳定身份显示当前状态、最近更新时间和下一步动作

#### Scenario: 当前验证包含 Artifact 和人工阻塞

- **WHEN** 接收器收到可关联的 Evidence Attempt、Bundle、Gate、Artifact 与 Human Decision 元数据
- **THEN** 桌面应用显示验证状态、Gate 结果、Artifact 的摘要、类型、MIME、大小、脱敏标记以及已上报的 blocker 和下一步动作，但不显示正文、绝对路径、Prompt、回复或命令输出

#### Scenario: Agent 或下一步动作未上报

- **WHEN** 当前 Run 的 OTLP 记录没有可信的执行主体或下一步动作
- **THEN** 桌面应用标记对应字段尚未上报且不从本地文件或其他字段推断

#### Scenario: 同时运行多个 change

- **WHEN** 接收器收到多个 Workspace 或 change 的活动 Run
- **THEN** 用户可以在保持当前查看上下文的同时选择其他 change，新的上报不得无条件抢占当前视图

### Requirement: 接收驱动桌面实时更新

桌面应用 MUST 在接受观测记录后主动向可见界面发送有序增量，并在界面重新连接时先提供一致快照再继续增量；界面不得通过周期轮询本地或远端后端维持实时状态。

#### Scenario: 当前阶段发生变化

- **WHEN** 接收器接受到当前 change 的后续阶段事件
- **THEN** 已打开界面无需用户刷新或等待轮询周期即可收到有序更新

#### Scenario: 界面进程重新加载

- **WHEN** Desktop Host 仍在运行但 Renderer 重新加载或窗口重新打开
- **THEN** 界面先得到同一投影版本的一致快照，再从后续序列继续接收增量

### Requirement: 重放和重复投递收敛为一致投影

桌面应用 MUST 使用稳定事件身份和投影序列处理至少一次投递，在启动、恢复或本地目的地追平时收敛重复记录，并明确显示正在追平、数据新鲜或检测到缺口的状态。

#### Scenario: Dashboard 晚于 Run 启动

- **WHEN** 本地目的地已经积压观测 envelope 且桌面接收器随后可用
- **THEN** 投递器重放未确认 envelope，桌面应用显示追平状态并在完成后转为实时状态

#### Scenario: 确认响应丢失导致重复发送

- **WHEN** 同一稳定事件身份的观测记录被再次投递
- **THEN** 桌面投影不重复增加任务、进度或失败次数

#### Scenario: 投影检测到序列缺口

- **WHEN** 桌面应用无法证明已连续接收当前投影所需的记录
- **THEN** 界面标记数据不完整或过期且不把当前状态表示为精确实时状态

### Requirement: 用户可以选择窗口关闭行为

桌面应用 MUST 提供直接退出、最小化到系统托盘和每次询问三种关闭偏好，并把选择保存为用户级设置；托盘菜单中的完全退出动作必须终止 Electron Shell 与 Desktop Host，本地接收停止不得影响远端遥测。

#### Scenario: 用户选择最小化到托盘

- **WHEN** 关闭偏好为最小化到系统托盘且用户关闭最后一个窗口
- **THEN** 窗口隐藏而桌面接收器继续运行，用户可以从托盘重新打开窗口

#### Scenario: 用户选择直接退出

- **WHEN** 关闭偏好为直接退出且用户关闭最后一个窗口
- **THEN** Electron Shell、Desktop Host 与本地接收器退出，其他遥测目的地和开发 Run 不受影响

#### Scenario: 用户尚未保存偏好

- **WHEN** 关闭偏好为每次询问或尚未选择且用户关闭最后一个窗口
- **THEN** 应用提供本次关闭选择并允许用户保存后续默认值

#### Scenario: 用户从托盘完全退出

- **WHEN** 用户选择托盘中的完全退出动作
- **THEN** 应用终止窗口、接收器与托盘进程而不受窗口关闭偏好影响

### Requirement: 桌面界面保持最小权限边界

桌面应用 MUST 隔离具有本机能力的 Electron Main、承载产品服务的 Desktop Host 与展示界面，只通过经校验的私有 IPC 和 Preload 向界面公开版本化只读投影与有界用户动作；普通遥测属性的脱敏规则同样适用于本地投影、诊断和系统通知。

#### Scenario: 界面请求未声明的本机能力

- **WHEN** 展示界面尝试访问未在桌面契约中声明的文件、进程或系统接口
- **THEN** 请求被拒绝且不扩大界面权限

#### Scenario: 遥测事件包含受限内容

- **WHEN** 接收批次包含不在允许列表中的命令输出、凭据、绝对路径或 Artifact 正文
- **THEN** 桌面投影和系统通知不显示或持久化该内容

### Requirement: 首个发布只承诺 Windows x64 支持

桌面应用首个正式发布 MUST 验证 Windows 10/11 x64 的安装、启动、单实例、系统托盘、完全退出和本地 OTLP 接收；平台中立代码不得被描述为其他平台已经获得正式支持。

#### Scenario: Windows x64 发布验收

- **WHEN** 项目生成首个桌面发布候选
- **THEN** 候选在 Windows x64 完成安装与桌面生命周期端到端验证后才标记为受支持

#### Scenario: 其他平台构建实验

- **WHEN** macOS、Linux 或 Windows ARM64 能够编译或启动平台中立代码
- **THEN** 项目仍把该结果标记为实验性且不纳入本 change 的发布承诺
