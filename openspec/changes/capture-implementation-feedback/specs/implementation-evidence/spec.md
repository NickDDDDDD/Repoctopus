# Spec Delta

## Purpose

定义 Repoctopus 如何把命令、服务、浏览器和视觉反馈保存为可验证、可失效、可恢复且受隐私约束的实施证据，并据此计算 Verify 门禁结果。

## ADDED Requirements

### Requirement: 正式门禁只接受机器采集证据

Repoctopus MUST 区分由 Runtime Adapter 实际执行或采集的 `verified` 证据与外部进程或人工说明形成的 `observed` 证据；Agent 摘要和手工粘贴内容不得单独满足必需门禁。

#### Scenario: Agent 声明测试已经通过

- **WHEN** 当前 Bundle 没有对应命令的有效 `verified` Receipt
- **THEN** Runtime 保留该说明但把必需检查标记为 `incomplete`

#### Scenario: Attached 服务提供可核对代码身份

- **WHEN** Attached 服务返回的 build identity 与当前输入指纹一致
- **THEN** Runtime 可以按 Profile 规则把该服务证据升级为 `verified`

### Requirement: Artifact 使用内容寻址引用

Repoctopus MUST 把截图、完整日志、测试报告和健康响应等大体积内容存入本地内容寻址 Artifact Store，并在状态、Receipt 和 Bundle 中只保存类型、SHA-256、大小、MIME、脱敏状态和引用。

#### Scenario: 相同制品重复登记

- **WHEN** 两次采集产生字节完全相同的 Artifact
- **THEN** Store 复用相同摘要对象且两个 Receipt 可以引用同一内容

#### Scenario: Artifact 超出容量限制

- **WHEN** 日志超过 Profile 配置的字节、行数或持续时间上限
- **THEN** Runtime 停止继续收集、登记截断事实并按证据必要性计算 `warning` 或 `incomplete`

### Requirement: Evidence 绑定完整输入指纹

Repoctopus MUST 把仓库 HEAD、tree、未提交内容、配置、lockfile、Journey、工具、浏览器、Adapter 和输入 Artifact 摘要绑定到 Bundle 指纹，并在采集开始和结束时重新核对。

#### Scenario: 采集期间源码发生变化

- **WHEN** 结束指纹与开始指纹不同
- **THEN** 当前 Attempt 标记为 `superseded`，保留制品但不得用于 Verify

#### Scenario: 开发阶段存在未提交修改

- **WHEN** Profile 允许在 dirty worktree 收集开发反馈
- **THEN** 指纹包含实际选中文件内容摘要，不能只使用 Git 状态文本

### Requirement: Evidence 复用受指纹和新鲜度约束

Repoctopus MUST 只复用输入指纹完全一致且仍在配置有效期内的确定性命令 Receipt；服务健康、浏览器和 Attached 证据默认重新采集。

#### Scenario: 构建输入没有变化

- **WHEN** 可缓存构建 Receipt 的全部绑定输入与当前运行一致
- **THEN** Runtime 可以复用结果并在 Bundle 中标记 `reused` 及原 Attempt 引用

#### Scenario: 浏览器页面曾经通过

- **WHEN** 新 Evidence Run 到达浏览器节点
- **THEN** Runtime 重新观察页面而不以旧截图代替当前反馈

### Requirement: Bundle 使用明确的门禁结果

Repoctopus MUST 把 Evidence Bundle 聚合为 `passed`、`failed`、`incomplete` 或 `passed_with_warnings`，并列出每个必需检查、可选检查、阻断关系和诊断来源。

#### Scenario: 必需检查全部通过

- **WHEN** 所有必需节点都具有当前指纹下的 `verified` 通过证据且没有阻断诊断
- **THEN** Bundle 结果为 `passed`

#### Scenario: 必需证据只有 observed

- **WHEN** 必需节点仅有未核对代码身份的 Attached 反馈
- **THEN** Bundle 结果为 `incomplete` 而不是 `passed`

#### Scenario: 仅存在允许的警告

- **WHEN** 必需检查通过且 Profile 允许当前零测试或可选检查诊断
- **THEN** Bundle 结果为 `passed_with_warnings` 并保留每项警告

### Requirement: 零测试不得描述为测试通过

Repoctopus MUST 区分命令成功与测试实际执行；可识别测试框架报告零个测试时生成 `no-tests-detected`，其阻断级别由共享 Profile 决定。

#### Scenario: Maven test 没有发现测试

- **WHEN** 命令退出码为零但结构化结果显示执行测试数为零
- **THEN** Receipt 记录命令成功和 `no-tests-detected`，不得写成测试通过

### Requirement: Evidence Attempt 追加保存且可恢复

Repoctopus MUST 为每次采集创建独立 Attempt，使用 Journal 和原子状态转换保存节点结果；重试或恢复不得覆盖之前的失败、超时、截断和漂移证据。

#### Scenario: Runtime 在节点完成后退出

- **WHEN** Receipt 已持久化但 Bundle 尚未更新
- **THEN** 恢复流程重放 Journal 并引用同一 Receipt，不重复执行已经确认的副作用

#### Scenario: 测试失败后重新运行

- **WHEN** Agent 修复代码并显式启动新 Attempt
- **THEN** 新 Attempt 追加到历史，旧失败结果继续可审计

### Requirement: Evidence Gate 只能通过唯一 Runtime 推进工作流

Repoctopus MUST 把当前 Bundle 投影为绑定工作流 Run、Action、Step、状态版本、Profile 和输入指纹的 Gate，并由唯一 Runtime 在持有 Run 转换锁时重新验证；CLI 或 Adapter 不得用普通成功文本替代 Gate。

#### Scenario: Verify 步骤收到普通成功结果

- **WHEN** 当前步骤要求 `verify` Profile 且记录请求没有绑定有效 Gate
- **THEN** Runtime 拒绝推进并返回缺少或失效 Evidence 的诊断

#### Scenario: 当前输入具有有效 Bundle

- **WHEN** Gate 的 Run、Action、Step、状态版本、Profile、Bundle 和输入指纹与锁内重新读取的当前事实一致且状态为 `satisfied`
- **THEN** Runtime 把 Bundle 接受事实、下一 Run State、Trajectory 和 Checkpoint 写入同一可恢复事务

#### Scenario: Gate 校验后出现竞争转换

- **WHEN** 另一个执行者尝试在当前 Gate 校验与状态提交之间推进同一 Run
- **THEN** Runtime 转换锁串行化两个写入，后一个执行者必须基于新的状态版本重新校验证据

### Requirement: Artifact 保留和删除保护证据闭包

Repoctopus MUST 保留当前 Run 已接受 Bundle、每个 Run/Profile 最近成功 Bundle、批准交付快照及归档前全部失败证据，并只按配置期限或容量删除未被活动状态、批准快照或保留 Bundle 引用的 Artifact；存在待恢复 Runtime 转换时 MUST 整体延后清理。

#### Scenario: 清理命令遇到被引用制品

- **WHEN** Artifact 仍属于活动 Attempt 或批准交付快照的证据闭包
- **THEN** 清理命令跳过该对象并报告保留原因

### Requirement: 敏感或不可脱敏内容不得进入有效证据

Repoctopus MUST 在 Artifact、摘要、状态和遥测写入前应用敏感规则；无法可靠脱敏的必需内容 MUST 使采集失败，不得静默保存或上传原文。

#### Scenario: 服务日志包含访问令牌

- **WHEN** 日志匹配 Token、Authorization、Cookie、私钥或项目配置的敏感模式
- **THEN** Artifact 只保存脱敏版本并登记脱敏统计，不保存匹配原值
