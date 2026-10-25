# implementation-evidence Specification

## Purpose

定义 Repoctopus 如何把命令、服务、浏览器和视觉反馈保存为可验证、可失效、可恢复且受隐私约束的实施证据，并据此计算 Verify 门禁结果。

## Requirements

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

### Requirement: Evidence Gate 只能由 WorkflowRuns 在事务内接受

Repoctopus MUST 由 EvidenceCoordinator 把当前 Bundle 投影为绑定 Workflow Run、Action、Step、状态版本、Evidence Profile、composition digest 和输入指纹的 Gate，并由 WorkflowRuns 在持有 RunStore 转换锁时重新验证；Evidence Provider、CLI 或 Adapter 不得维护独立工作流状态权威，也不得用普通成功文本替代 Gate。

#### Scenario: Verify 步骤收到普通成功结果

- **WHEN** 当前步骤要求 `verify` Profile 且记录请求没有绑定有效 Gate
- **THEN** WorkflowRuns 拒绝推进并返回缺少或失效 Evidence 的诊断

#### Scenario: 当前输入具有有效 Bundle

- **WHEN** Gate 的 Run、Action、Step、状态版本、Profile、composition、Bundle 和输入指纹与锁内重新读取的当前事实一致且状态为 `satisfied`
- **THEN** WorkflowRuns 把 Bundle 接受事实、下一 Run State、Trajectory 和 Checkpoint 写入同一可恢复事务

#### Scenario: Gate 校验后出现竞争转换

- **WHEN** 另一个执行者尝试在当前 Gate 校验与状态提交之间推进同一 Run
- **THEN** RunStore 转换锁串行化两个写入，后一个执行者基于新的状态版本重新校验证据

#### Scenario: Evidence Provider 尝试直接推进

- **WHEN** Evidence Provider 完成 Bundle 并请求改变工作流状态
- **THEN** Provider 只能公开 Gate Projection，不能直接写入 Run State、Trajectory 或 Checkpoint

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

### Requirement: Evidence 保持独立持久化生命周期

EvidenceCoordinator MUST 独立持久化 Attempt、Node Journal、Receipt、Artifact、Bundle 和 Gate Projection，并通过恢复规则完成未结束采集；这些事实不得与 Cordis Fiber 内存或 Run State 合并为一个存储模型。

#### Scenario: 采集进程在节点执行后退出

- **WHEN** Node Journal 已记录执行且 Receipt 尚未完整提交时进程退出
- **THEN** 新进程从 Evidence Journal 恢复或明确重试该节点，不以 Run 状态推断命令已经成功

#### Scenario: Evidence 插件卸载

- **WHEN** Evidence Contributor 被重新加载或关闭
- **THEN** 临时进程和监听器被 Effect 清理，已持久化的 Receipt 与 Artifact 保持可审计

### Requirement: Evidence 类型由 Contributor 提供稳定能力

命令、服务、浏览器、视觉和后续 Evidence 类型 MUST 通过版本化 Contributor 登记配置 Schema、执行端口、Receipt 类型、资源需求和清理逻辑；EvidenceCoordinator 只允许计划引用当前 composition 实际提供的能力。

#### Scenario: Profile 引用未安装的 Evidence 类型

- **WHEN** Evidence Profile 声明一个没有活动 Contributor 的节点类型
- **THEN** 计划在执行任何节点前失败并报告缺失的能力标识

#### Scenario: Contributor 在运行期间卸载

- **WHEN** 一个 Evidence Attempt 已接纳操作后对应 Contributor 开始卸载
- **THEN** 新节点不再分派给该 Contributor，进行中节点取消或完成到可恢复 Journal 边界

### Requirement: Evidence Attempt 绑定采集实现身份

每个 Evidence Attempt 和 Receipt MUST 记录实际采集 Contributor 的稳定标识、版本、配置摘要与代码摘要；采集实现变化后不得把旧 Receipt 当作同一实现产生的当前事实。

#### Scenario: 命令采集器版本变化

- **WHEN** 输入源码未变化但 Command Evidence Contributor 代码摘要发生变化
- **THEN** 新 Attempt 不复用旧 Receipt，并在 composition 差异中说明采集实现已变化

### Requirement: Evidence Profile 编译完整 Acceptance Coverage Plan

用于 Change Verify 的 Evidence Profile MUST 显式声明 required 节点覆盖的 Acceptance selector，并在执行任何节点前解析为绑定完整 Acceptance Set、Profile plan、仓库和配置摘要的不可变 coverage plan；缺失、未知、重复或仅由 optional 节点覆盖的 Acceptance 必须阻断执行。

#### Scenario: Profile 没有覆盖 UI Acceptance

- **WHEN** Verification Input 包含 UI 行为 Acceptance，但 Profile 只有未声明覆盖该 Acceptance 的 typecheck 节点
- **THEN** Runtime 在运行 typecheck 前拒绝计划并报告未覆盖的 Acceptance identity

#### Scenario: 共享 Profile 显式覆盖全部 Acceptance

- **WHEN** required 节点使用 `*` selector 且 Profile、配置和 Acceptance Set 被固定到 Verification Input
- **THEN** Runtime 把该声明解析为每条 Acceptance 到节点的显式映射，并在任一输入变化时使计划失效

### Requirement: Evidence Bundle 保存完整 Acceptance Trace

Change Verify 的 Evidence Bundle MUST 为不可变 Verification Input 中每条 Acceptance 保存恰好一个有序 Trace entry，并只在 entry 引用 coverage plan 允许的全部 required 节点在当前输入下产生的 `verified` 且通过的 Receipt 时标记 passed；未知、重复、缺失、observed、superseded 或失败证据必须 fail-closed。

#### Scenario: 所有命令成功但一条 Acceptance 没有映射

- **WHEN** Profile 节点全部通过但 Bundle 无法为某条 Acceptance 找到允许的 Receipt
- **THEN** Bundle 结果为 `incomplete` 且 Gate blocked，不得用 Profile 总体成功替代 Trace

#### Scenario: Receipt 覆盖完整且当前有效

- **WHEN** 每条 Acceptance 都引用 coverage plan 允许的 required verified Receipt，Receipt 输入指纹与 Verification Input 一致且没有阻断 Finding
- **THEN** Bundle 可以产生 passed Acceptance Trace 并参与 Change Verify Gate

### Requirement: Acceptance Gate 绑定 Trace 与 Verification Input

EvidenceCoordinator MUST 只为 Trace 的 Acceptance Set Hash、Verification Input digest、Profile plan、composition 和输入指纹均与当前 Verify Work 相同的 Bundle 投影 satisfied Gate；独立 Evidence Bundle、旧 schema Bundle 或普通成功摘要不得满足 Change Verify。

#### Scenario: 独立运行完整 Profile

- **WHEN** 用户脱离 Change Run 执行相同 Evidence Profile并得到 passed Bundle
- **THEN** Bundle 保持可审计但因没有当前 Acceptance context 与 Work identity而不能推进 Change Run

#### Scenario: Acceptance 在采集后变化

- **WHEN** Evidence 采集完成后 Tasks Acceptance 或 Requirement mapping 改变
- **THEN** Gate 重新核对发现 Acceptance Set Hash 漂移并拒绝推进

### Requirement: Retention 保留 Acceptance Trace 引用闭包

Evidence retention MUST 把已接受 Bundle 的 Acceptance Trace、所有 entry 引用 Receipt 及其 Artifact 视为同一引用闭包；清理、恢复和验证报告不得产生与 Bundle 不同的 Acceptance 结论。

#### Scenario: 清理已接受 Verify Bundle

- **WHEN** 某个 Receipt 仍被已接受 Bundle 的 Acceptance Trace 引用
- **THEN** 清理保留 Receipt 与 Artifact，即使该节点已超过普通时间期限
