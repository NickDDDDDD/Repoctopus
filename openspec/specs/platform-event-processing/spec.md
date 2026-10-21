# platform-event-processing Specification

## Purpose
定义 Repoctopus 如何安全接收代码平台事件、形成平台无关投递事实并持久化处理进度，使重复、乱序、重启和暂时故障不会丢失或重复执行交付动作。

## Requirements

### Requirement: 平台 Adapter 在解析前验证请求

Repoctopus MUST 限制请求方法、内容类型和原始请求体大小，使用 Credential Provider 取得秘密并验证平台签名后才解析载荷；秘密和签名不得进入持久状态、日志或遥测。

#### Scenario: GitHub 签名无效

- **WHEN** GitHub webhook 的签名与配置的共享秘密不匹配
- **THEN** Adapter 返回未授权响应，不解析业务事件且不写入 Event Inbox

#### Scenario: 请求体超过上限

- **WHEN** webhook 原始请求体超过配置的字节上限
- **THEN** Adapter 终止读取并返回明确的请求错误，不分配无界缓冲区

### Requirement: 已验证投递先持久化再确认接收

Repoctopus MUST 把已验证事件规范化为包含 Provider、Source、Delivery ID、事件类型、接收时间和无损载荷的 Delivery Envelope，并在 Event Inbox 原子持久化成功后才返回接收成功。

#### Scenario: Inbox 写入失败

- **WHEN** 平台事件已通过验签但持久存储不可用
- **THEN** Adapter 返回可重试失败，不返回已接收状态

#### Scenario: Inbox 写入成功

- **WHEN** 已验证事件完成原子持久化
- **THEN** Adapter 可以立即返回已接收状态，不等待后续验证、规格同步或 Git 操作完成

### Requirement: 平台投递幂等且允许乱序

Repoctopus MUST 使用 Provider、Source 与 Delivery ID 的稳定组合去重，并用持久状态记录处理尝试、结果与下次重试；重复或乱序投递不得重复创建逻辑任务或回退较新的事实。

#### Scenario: 平台重发同一 Delivery

- **WHEN** Event Inbox 收到已经持久化的同一 Delivery ID
- **THEN** 系统返回既有投递身份，不创建第二个处理任务

#### Scenario: 较旧事件晚于较新事件到达

- **WHEN** 一个 MR 的旧状态事件在合入事件之后到达
- **THEN** Coordinator 重新读取平台权威状态，不把交付状态从已合入回退

### Requirement: Webhook 只作为唤醒信号

Repoctopus MUST 在处理影响交付状态的事件时通过代码平台端口重新读取 MR、CI、评审和 merge commit 等权威事实，不把 webhook 载荷单独作为关闭依据。

#### Scenario: Webhook 载荷声称 MR 已合入

- **WHEN** 合入事件唤醒 Post-merge Coordinator
- **THEN** Coordinator 通过配置的代码平台 Adapter 核对 MR 当前状态和 merge commit 后才推进

### Requirement: Event Inbox 支持崩溃恢复和死信诊断

Repoctopus MUST 把领取、处理、完成、重试和终止状态持久化，并在 Runner 重启后恢复未完成投递；超过策略上限或遇到不可恢复输入时保留死信事实和可操作诊断。

#### Scenario: Runner 在领取后退出

- **WHEN** 投递被领取但处理结果尚未提交时进程退出
- **THEN** 新 Runner 在租约失效后重新领取同一逻辑投递并从持久事实恢复

#### Scenario: 载荷与项目配置不匹配

- **WHEN** 已验证事件无法映射到任何配置的仓库或 change
- **THEN** 系统把投递标记为终止诊断，不修改项目状态

### Requirement: 代码平台 Adapter 可替换

Repoctopus MUST 让 Provider 专有验签、事件解析和 API 调用停留在 Adapter 内，并向 Coordinator 提供相同 Delivery Envelope 与平台事实契约。

#### Scenario: 项目从 GitHub 切换到其他代码平台

- **WHEN** 项目组合启用另一个兼容的代码平台 Adapter
- **THEN** Event Inbox 和 Post-merge Coordinator 不需要修改状态机或持久格式
