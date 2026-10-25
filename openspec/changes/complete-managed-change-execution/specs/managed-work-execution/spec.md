# Spec Delta

## Purpose

定义 Repoctopus 如何把 lifecycle Work 的完整固定指导安全交付给受管 Agent Host，并以可恢复 claim、受控能力和真实 Outcome 证明 Agent 在允许副作用前已经消费正确执行上下文。

## ADDED Requirements

### Requirement: Claim 返回完整且不可变的执行包

Repoctopus MUST 在成功持久化当前 Work claim 后向获授权宿主返回版本化 `WorkExecutionPacket`，包含 ActionIntent、完整有序上下文层、各层 identity、整体 digest、当前 Work 和允许能力；执行包内容不得在 claim 前暴露，也不得由调用方增删、替换或重排。

#### Scenario: 宿主领取 Build Work

- **WHEN** 受管宿主以当前 Run、Work、attempt、Runner identity 和兼容能力领取 Build Work
- **THEN** Runtime 先持久化 claim，再返回包含 action Skill 正文、Specification 指令、augmentations、Method Profile 和 change 输入的冻结执行包

#### Scenario: 调用方请求替换 Skill

- **WHEN** 调用方在领取参数中请求替换 action Skill、删除 TDD augmentation 或改变上下文顺序
- **THEN** Runtime 拒绝请求并保留未领取 Work，不生成降级执行包

### Requirement: 持久事实只保存执行上下文身份

Repoctopus MUST 在 Run、ActionIntent、Receipt、日志和遥测中只持久化执行包 schema、各层 source/digest 和整体 digest；Skill 正文、Provider instructions、Prompt、绝对路径和不受控 change 输入不得写入这些共享事实。

#### Scenario: 进程在交付执行包后退出

- **WHEN** claim 已保存而宿主在提交 Outcome 前退出
- **THEN** 恢复方使用持久 identity 重新解析并核对完整上下文，内容一致才重新交付原 attempt，不从日志或 Run 文件恢复正文

#### Scenario: Skill 正文在恢复前漂移

- **WHEN** 重新解析的任一层 digest 与已持久化执行包 identity 不同
- **THEN** Runtime 阻断执行并报告兼容迁移或新 generation，不把新正文注入旧 claim

### Requirement: Work Execution Host 是唯一受管 Agent 调用端口

Repoctopus MUST 通过版本化 Host Contributor 选择一个与 Work 能力兼容的执行端口；受管执行服务在调用 Host 前核对 claim、composition、完整上下文、能力、授权和写入范围，Host 只能收到冻结 Action、Work 和执行包。

#### Scenario: Host 执行正常 Work

- **WHEN** 当前 Host 支持 Work 所需能力且 preflight 全部通过
- **THEN** 受管执行服务只调用一次该 Host，并把 Host 返回的真实 succeeded 或 failed Outcome 交给现有 Action/Validator 链路

#### Scenario: 没有兼容 Host

- **WHEN** 当前 composition 没有支持 action Skill 或所需能力的 Host
- **THEN** Work 保持未执行并返回可定位诊断，不退化为 manual success 或直接推进阶段

#### Scenario: 两个 Host 声称同一默认执行范围

- **WHEN** composition 对同一 Work 产生多个同优先级且无法唯一选择的 Host
- **THEN** App Boot 或执行前检查 fail closed，并要求配置唯一 Host

### Requirement: 受管工具调用绑定活动执行会话

Repoctopus MUST 为 Host 调用建立短生命周期执行会话，所有受保护的 Specification、repository、process、Git 和平台操作都必须携带当前 claim identity，并由应用边界按 Work capability、side-effect class 与 write scope 核对；会话终结后授权立即失效。

#### Scenario: 首次写入发生在上下文交付之后

- **WHEN** Agent 请求创建测试、修改实现或写 Specification artifact
- **THEN** 应用边界只在对应执行包已交付、Host 调用处于活动状态且目标在当前 Work scope 内时允许操作

#### Scenario: Agent 使用普通外部进程绕过应用边界

- **WHEN** 未受管进程直接修改仓库文件且没有活动执行会话
- **THEN** 该修改只能在后续核对中形成 drift 或 blocker，不能获得受管 Receipt、完成 Task 或推进 phase

### Requirement: Outcome 必须来自原 Host 调用

Repoctopus MUST 让受管 Outcome 绑定执行包 digest、Host identity、执行会话、claim token、attempt 与 input digest；普通 CLI 文本、Agent 自述或另一 Host 的结果不得替代原调用结果。

#### Scenario: Host 返回真实失败

- **WHEN** Host 在当前执行会话中返回 failed Outcome 和有界摘要
- **THEN** Runtime 保存失败尝试但不完成 Work，并按 definition 决定诊断 retry、阻塞或回退

#### Scenario: 伪造成功结果

- **WHEN** 调用方提交缺少执行会话 identity、执行包 digest 不匹配或来自另一 Host 的 succeeded Outcome
- **THEN** Runtime 拒绝结果并保持原 Work 状态

### Requirement: 受管 Work 必须从原执行断点恢复

Repoctopus MUST 把当前 Work attempt、claim、执行包、Host invocation、Outcome、Validator、Human Decision 和 lifecycle transition 的有界 identity 纳入同一个权威 Change Run aggregate/checkpoint，并通过 Run CAS 与可恢复 journal 提交每个执行边界；ActionStore 或其他投影不得拥有 attempt、claim、完成状态或 continuation。进程、Agent 或 Runner 中断后必须从原 Run 边界产生 `execute`、`ask`、`wait`、`reconcile` 或 `done` continuation，不得仅凭 phase、旁路文件存在或会话记忆重新开始。

#### Scenario: Action 内容写入后 Run claim 前中断

- **WHEN** 不可变 ActionIntent 已写入内容库，但绑定其 identity 的 Run CAS 尚未成功
- **THEN** 该内容是可忽略或可清理的孤立记录，不构成 claim，新 Runner 只按权威 Run 尝试领取且不得把 ActionStore latest 当作当前 attempt

#### Scenario: Run claim 成功后响应丢失

- **WHEN** Run checkpoint 已绑定 claim/packet identity，但领取响应在返回宿主前丢失
- **THEN** 新 Runner 从同一 Run 恢复原 attempt，并在摘要一致时重新交付同一 packet，不创建第二个 claim

#### Scenario: Run 引用的 Action 内容损坏

- **WHEN** 权威 Run 引用的 ActionIntent、Outcome 或 Receipt 内容缺失、损坏或摘要不匹配
- **THEN** Runtime fail closed 并返回 reconcile/repair 诊断，不从其他 Action 文件、最新时间或 checkbox 猜测执行结果

#### Scenario: Host 调用后连接中断

- **WHEN** checkpoint 已记录原 Host invocation，但 Runtime 未取得可验证 Outcome
- **THEN** 新 Runner 保留同一 Work attempt 和 scope，返回 reconcile 或等待原 Host，不自动再次调用 Agent或重发外部副作用

#### Scenario: Outcome 后 Validator 前中断

- **WHEN** 原 Host Outcome 已持久化且 identity 匹配，但 Validator 尚未接受
- **THEN** 恢复从原 Outcome 的 Validator 继续，不重新交付执行包或调用 Agent

#### Scenario: Design Validator 的外部依赖暂时失败后重试

- **WHEN** Design Host Outcome 已持久化，但 Provider 或远端检查暂时失败而使 Design 进入 blocked
- **THEN** Runtime 保留同一 `currentWork` 与权威 claim，后续 `run next` 从原 Outcome 重试 Validator；只有 Validator accepted 后才能清除该 Work 或进入 Human Decision、Build 与后续 phase

#### Scenario: Validator 后 transition 写入中断

- **WHEN** Validator accepted 已持久化而 lifecycle transition 尚未完整提交
- **THEN** Runtime 通过 recoverable journal 幂等完成原 transition，并且 Trajectory 只出现一次对应推进事实

#### Scenario: Verify Validator 后 Evidence gate 投影前中断

- **WHEN** Verify Host review Outcome 与 Validator accepted 已持久化，Evidence attempt 已完成或可恢复，但 gate 尚未投影到 Change Run
- **THEN** 新 Runner 复用同一受验证 review 与 Evidence attempt 完成 gate 投影，不重新调用 Agent、不重复写 Validator 事实，也不把 `validated` 误判为缺少 review Outcome

#### Scenario: 等待用户决定时更换 Agent

- **WHEN** Change Run 在 Human Decision Wait 中断或由新 Agent接管
- **THEN** 恢复展示相同 proposal hash 与 choices，不重新生成提案、不丢失批准边界，也不代替用户选择

#### Scenario: 恢复时多仓或执行组合漂移

- **WHEN** repository commit/path binding、definition、composition、Skill、Specification Provider 或 packet digest 与 checkpoint 不一致
- **THEN** Runtime 返回结构化 reconcile/migration 状态并保留原执行事实，不把漂移解释为未执行后重跑

### Requirement: Agent coordination checkpoint 不得成为完成权威

Repoctopus MAY 保存用于上下文压缩、Agent handoff 或子任务协调的有界 progress checkpoint，但它 MUST 与 Engine checkpoint、OpenSpec 工件和 completion evidence 分离；其存在、缺失或 checkbox 状态不得授权写入、形成 Receipt、完成 Task 或推进 phase。

#### Scenario: Coordination checkpoint 缺失

- **WHEN** 新 Agent恢复 Build 而 coordination checkpoint 不存在或已 stale
- **THEN** Agent按权威 Change Run、其绑定的不可变 Action 内容、实际文件和 Git事实核对进度，不能因为协调记录缺失而假定实现未发生并重复执行

### Requirement: 黑盒验收必须观察真实内容消费

Repoctopus MUST 使用生产 composition 和公共应用协议运行捕获 Host，断言 Host 收到每个阶段的完整正文、固定顺序和当前输入，并观察受保护副作用发生在 claim/context-delivered 之后；只断言 Skill 名称、layer source、digest、Run projection 或 mock 领域函数不得满足该验收。

#### Scenario: 捕获 Host 验收 Build

- **WHEN** 黑盒测试执行一个 fresh Change 的首个 Build Task
- **THEN** 捕获记录包含 action Skill 与 TDD/代码边界正文，事件顺序为 claim persisted、context delivered、host invoked、first protected write、Outcome accepted、Validator accepted

#### Scenario: 上下文正文未送达

- **WHEN** 生产协议只返回 layer identity 或 Host 没有读取完整执行包
- **THEN** 黑盒验收失败，即使 Task、Verify 和 Archive 最终状态均显示成功

#### Scenario: 黑盒只读取最终统一投影

- **WHEN** 验收只断言最终 `ChangeRunProjection`，或测试直接 import coordinator/reducer 来构造 Work、Outcome 或 completion observation
- **THEN** 该测试不得计入生产执行验收；合格验收必须通过独立进程公共协议，并交叉核对每一步 continuation/phase、追加式 trajectory identity 与实际受保护文件结果
