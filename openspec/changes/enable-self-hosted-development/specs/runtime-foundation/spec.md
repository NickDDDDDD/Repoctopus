# Spec Delta

## ADDED Requirements

### Requirement: 外部事件通过受保护入口启动 Run

WorkflowRuns MUST 只接受已经持久化且映射到当前项目与 change 的平台投递启动 Post-merge Run，并使用稳定幂等键避免并发事件创建重复 Run；平台 Adapter 不得直接写 Run State。

#### Scenario: 两个合入事件同时满足关闭条件

- **WHEN** 两个 Runner 并发请求为同一 change 和合入事实启动收尾
- **THEN** RunStore 只创建一个逻辑 Post-merge Run，另一请求复用既有身份

### Requirement: Run 绑定方法和规格实现身份

WorkflowRuns MUST 把实际使用的 Skill 快照和 Specification Provider 身份作为 Run 语义输入持久化，并在恢复、Evidence 接受和规格关闭前重新核对兼容性。

#### Scenario: 规格 Provider 在收尾中断期间改变

- **WHEN** Post-merge Run 恢复时当前 Specification Provider 与快照不兼容
- **THEN** Run 进入 `migration_required`，不使用新 Provider 继续关闭

### Requirement: 自举开发使用产品公共能力

Repoctopus MUST 能用已发布或当前工作树构建的产品入口执行自身真实 change 的需求澄清、规格校验、实施 Evidence、交付、合入后验证与关闭，不得使用只存在于测试中的旁路状态转换。

#### Scenario: Repoctopus 交付自身 change

- **WHEN** 维护者以 Repoctopus 仓库作为项目运行自举工作流
- **THEN** Run、Evidence、Delivery、平台事件和规格关闭均通过生产 composition 与公共服务完成，并留下可核对 Trajectory

### Requirement: 人工等待与后台恢复不占用进程

WorkflowRuns MUST 把等待用户决定、等待 MR 合入和等待重试时间表示为持久状态与可唤醒条件，不要求单一进程、IDE 会话或 Fiber 在等待期间持续存活。

#### Scenario: Run 等待 MR 合入时 Runner 重启

- **WHEN** Runner 在等待状态退出并于后续平台事件到来时重新启动
- **THEN** 系统从 Store 恢复等待条件并继续同一 Run，不依赖旧内存回调

### Requirement: Workspace 是版本化的团队工作流入口

Repoctopus MUST 把 Workspace 定义为承载共享配置、规格、Workflow 和长期交付文档的版本化入口，并显式登记 Workspace Repository。Workspace MAY 嵌入单个业务仓，也 MAY 在多仓开发中使用独立仓库；两种拓扑 MUST 使用同一运行模型。旧 `agents-workspace` 产品语义与 DSH Agent/Session/Workspace 子系统不得因此进入产品运行时。

#### Scenario: 单仓使用 Embedded Workspace

- **WHEN** `repoctopus.yaml` 所在 Git 仓同时被登记并选为业务仓
- **THEN** 系统允许该仓同时承担 Workspace 与业务角色，不因其路径为 Workspace 根而排除它

#### Scenario: 多仓使用 Dedicated Workspace

- **WHEN** Workspace Repository 与多个业务仓位于同级目录
- **THEN** 规格和工作流产物保存在 Workspace Repository，业务命令按配置登记路径访问各业务仓

### Requirement: 运行时仓库快照来自版本化登记

Repoctopus MUST 在日常 Run、Evidence、Delivery 和恢复中按 Workspace 配置登记的 repository ID 与有效路径构造仓库快照。目录扫描 MUST 只用于首次接入或显式重新探测，并不得在运行时静默增加、删除或重命名仓库。

#### Scenario: 同级目录出现未登记仓库

- **WHEN** Workspace 同级目录新增一个 Git 仓但配置尚未登记它
- **THEN** 日常 Run 和 Delivery 不把该仓加入快照，只有显式重新探测才把它作为候选交给用户确认
