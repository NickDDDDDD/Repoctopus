# skill-integration Delta

## ADDED Requirements

### Requirement: 团队绑定编译为唯一有效 Skill composition

Repoctopus MUST 由纯 Compiler 把固定 lifecycle definition、共享团队 binding 与活动 Skill catalog 编译为唯一有序 `EffectiveSkillComposition`。第一版只允许 `guidance` 和 definition 显式 replaceable augmentation slot 的 `augmentation-replacement`；Action Skill 永远不可替换。Runtime MUST 在 Work claim 前解析唯一 Provider、验证 capability/invocation/resource contract、冻结 composition digest，并拒绝调用方、Agent 或 Host 增删、替换、重排或临时加载另一组合。

#### Scenario: 团队追加工程 guidance

- **WHEN** 有效配置把两个只读 guidance Skill 绑定到同一 Work
- **THEN** Runtime 按 `(order,bindingId)` 稳定顺序交付完整正文和资源，保留 action、内置 augmentation 与 team guidance 角色，且 guidance 不获得额外 write scope、产物或 transition 权限

#### Scenario: 团队替换 augmentation

- **WHEN** definition 把某 augmentation 声明为 replaceable slot，团队 Skill 满足同一 capability、invocation 和 resource contract
- **THEN** Compiler 为该 slot 选择唯一 replacement 并冻结其 Provider/provenance；内置 Action 与其他 augmentation 不变

#### Scenario: 团队尝试替换 Action

- **WHEN** 配置、调用方或 Host 请求替换任一 Repoctopus-owned Action Skill
- **THEN** composition compile 或 Work guard fail closed，并返回不可替换的 definition identity

#### Scenario: 活动 Run 的团队 binding 漂移

- **WHEN** Run 恢复时共享 binding 或实际使用的 Provider 内容与冻结 composition 不兼容
- **THEN** Runtime 使尚未接受的 Work 失效并进入显式 drift/migration 诊断，不静默采用新组合或创建第二 Run

### Requirement: 团队 Skill 消费只依据当前 packet 回执

Repoctopus MUST 分别记录团队 Skill 的 resolved、delivered 和 consumed 事实。`consumed` 只有在当前 Host invocation 的回执包含匹配 packet/layer digest 时产生；Work 成功、文件存在、最终命令通过或 SkillUsageSnapshot MUST NOT 反推 consumed，也 MUST NOT 把 consumed 表述为方法已执行。

#### Scenario: Host 未消费 team guidance

- **WHEN** packet 包含 team guidance，但 Host outcome 没有确认其当前 layer digest
- **THEN** 该层保持 delivered，Work 的其他成功结果不得补写 consumed

#### Scenario: Host 回报旧层摘要

- **WHEN** Host outcome 引用上一 revision 或另一个 Work 的 layer digest
- **THEN** Runtime 拒绝该消费声明并保留可定位诊断，不污染当前组合状态

## MODIFIED Requirements

### Requirement: 阶段 Work 必须装填固定且唯一的 Skill 组合

Lifecycle definition MUST 声明不可替换的 Action Skill、固定内置 augmentation 与允许团队扩展的显式 augmentation slot，并由 Runtime 根据 phase、Action kind 和共享 `EffectiveSkillComposition` 计算唯一有序组合。Open 默认 `repoctopus-open-change + grilling`，Design 默认 `repoctopus-design-change + codebase-design`；Build 使用对应 Configure、Plan、Execute 或 Check Action。团队只可追加 guidance 或替换 definition 明确开放的 augmentation slot；execution mode 作为 Action input，不作为外部 Skill。Runtime MUST 在 claim 前解析唯一 Provider、资源、调用策略和 provenance，并向 Host 交付真实内容；调用方、Agent 和 Host 不得跳过、替换 Action、重排或额外装填另一规划权威。

#### Scenario: Open 的 grilling 没有未决 frontier

- **WHEN** Open Agent 已从代码、现有规格和输入中验证全部会改变设计的事实，`grilling` 决策树没有未决 frontier
- **THEN** Host 可以零用户问题完成 Open Outcome；Runtime 仍记录 `grilling` 的真实交付与消费，不把零问题解释为未加载 Skill

#### Scenario: Open 把可验证环境事实转问用户

- **WHEN** Open Outcome 显示 Agent 未检查可访问的代码、配置或现有规格，而把这些事实作为用户决策问题
- **THEN** Open Validator 拒绝 Outcome并要求在当前 Work 内完成环境验证，不允许借用户回答绕过事实检查

#### Scenario: grilling Provider 缺失或歧义

- **WHEN** composition 无法为某个团队 binding 解析恰好一个满足 contract 的 Provider，或只能依赖未登记的开发机全局安装
- **THEN** Runtime 在领取 Work 前 fail closed 并报告 binding、Provider 和 provenance 差异，不降级为忽略团队方法

#### Scenario: Execute 请求外部 execution Skill

- **WHEN** 调用方请求为 autonomous 或 subagent 模式装填未绑定的外部 execution Skill
- **THEN** Runtime 拒绝请求并返回核心 Execute Action 与有效 composition 的冻结 identity，不把外部 Skill 当作隐藏模式实现

#### Scenario: 调用方修改阶段组合

- **WHEN** 调用方请求跳过内置 augmentation、替换 Action、增删团队 binding 或任意重排
- **THEN** Runtime 拒绝请求并返回 definition 与 effective composition 共同冻结的组合 identity
