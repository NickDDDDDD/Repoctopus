# skill-integration Delta

## ADDED Requirements

### Requirement: 团队绑定编译为唯一有效 Skill composition

Repoctopus MUST 由纯 Compiler 把固定 lifecycle definition、共享团队 binding、BuildStrategy 与活动 Skill/Extension/Validator catalog 编译为唯一有序 `EffectiveSkillComposition`。第一版只允许 `guidance`、显式 replaceable augmentation slot 的 `augmentation-replacement` 和安全 checkpoint 的 `required-check`；Action Skill 永远不可替换。Runtime MUST 在 Work claim 前解析唯一 Provider、验证 capability/invocation/method/evidence contract、冻结 composition digest，并拒绝调用方、Agent 或 Host 增删、替换、重排或临时加载另一组合。

#### Scenario: 团队追加工程 guidance

- **WHEN** 有效配置把两个只读 guidance Skill 绑定到同一 Work
- **THEN** Runtime 按 `(order,bindingId)` 稳定顺序交付完整正文和资源，保留 action/内置/team 角色，且 guidance 不获得额外 write scope、产物或 transition 权限

#### Scenario: 团队替换 TDD augmentation

- **WHEN** definition 把 `tdd-method` 声明为 replaceable slot，团队 Skill 满足同一 method、capability、invocation 和 evidence contract
- **THEN** Compiler 为该 slot 选择唯一 replacement 并冻结其 Provider/provenance；内置 Action 与其他 augmentation 不变

#### Scenario: 团队尝试替换 Action

- **WHEN** 配置、调用方或 Host 请求替换任一 Repoctopus-owned Action Skill
- **THEN** composition compile 或 Work guard fail closed，并返回不可替换的 definition identity

#### Scenario: 活动 Run 的团队 binding 漂移

- **WHEN** Run 恢复时共享 binding、Provider 内容或 Contributor identity 与冻结 composition 不兼容
- **THEN** Runtime 使尚未接受的 Work 失效并进入显式 drift/migration 诊断，不静默采用新组合或创建第二 Run

### Requirement: Skill 身份消费与方法验证分别冻结

Repoctopus MUST 分别记录 Skill 的 resolved、delivered、consumed 和 method verified 事实。`consumed` 只证明当前 Host invocation 回执匹配 packet/layer digest；`method_verified` 只在版本化 Method Receipt 经登记 Validator 核对当前 Work input、Outcome 与机器证据后产生。Work 成功、文件存在、最终命令通过或 SkillUsageSnapshot MUST NOT 反推 consumed 或 method verified。

#### Scenario: Host 消费 TDD 正文但没有有效循环证据

- **WHEN** Host 回执确认消费当前 TDD layer，但没有可解析的 RED/GREEN/regression Method Receipt
- **THEN** Skill 状态保持 consumed 且 method verified 缺失，要求 TDD 的 Gate 不能通过

#### Scenario: 方法验证通过

- **WHEN** 当前 Method Receipt、Validator、Evidence references 和全部输入摘要匹配冻结 Work
- **THEN** Runtime 追加独立 method verified 事实并保留 consumed 事实，不覆盖或合并二者

### Requirement: 固定 Matt Skills 纳入上游对齐审计

Repoctopus MUST 在每日固定上游对齐中审计 Matt Skills 的 commit/tag、许可证、Skill manifest/content digest、Repoctopus adapter contract 和本地偏差；审计发现不得自动改变活动 Run，采用上游更新 MUST 通过普通 Change 和 Provider/Method Receipt 兼容验证。

#### Scenario: Matt 上游内容变化

- **WHEN** 固定基线之后的 Matt 上游修改了 `tdd` 或 `grilling` 内容
- **THEN** 审计生成可追溯差异和采用建议，但当前 vendored snapshot、活动 composition 与 Run 不被自动替换

## MODIFIED Requirements

### Requirement: 阶段 Work 必须装填固定且唯一的 Skill 组合

Lifecycle definition MUST 声明不可替换的 Action Skill、固定内置 augmentation、允许团队扩展的显式 slot 与安全 checkpoint，并由 Runtime 根据 phase、Action kind、冻结 BuildStrategy 和共享 `EffectiveSkillComposition` 计算唯一有序组合。Open 默认 `repoctopus-open-change + grilling`，Design 默认 `repoctopus-design-change + codebase-design`；Build 使用对应 Configure、Plan、Execute 或 Check Action，Execute 按批准 TDD 策略装填 `tdd-method` slot，Check 默认增加 `code-review`。团队只可追加 guidance、替换 definition 明确开放的 augmentation slot或增加 required check；execution mode 作为 Action input，不作为外部 Skill。Runtime MUST 在 claim 前解析唯一 Provider、资源、调用策略、provenance 与 method/evidence contract，并向 Host 交付真实内容；调用方、Agent 和 Host 不得跳过、替换 Action、重排或额外装填另一规划权威。

#### Scenario: Open 的 grilling 没有未决 frontier

- **WHEN** Open Agent 已从代码、现有规格和输入中验证全部会改变设计的事实，`grilling` 决策树没有未决 frontier
- **THEN** Host 可以零用户问题完成 Open Outcome，但必须提交可验证的 Open Method Receipt；Runtime 记录 `grilling` 的交付、消费和独立方法验证，不把零问题解释为未加载 Skill

#### Scenario: Open 把可验证环境事实转问用户

- **WHEN** Open Receipt 显示 Agent 未检查可访问的代码、配置或现有规格，而把这些事实作为用户决策问题
- **THEN** Open Validator 拒绝 Outcome 并要求在当前 Work 内完成环境验证，不允许借用户回答绕过事实检查

#### Scenario: grilling Provider 缺失或歧义

- **WHEN** composition 无法为某个团队 binding 解析恰好一个满足 contract 的 Provider，或只能依赖未登记的开发机全局安装
- **THEN** Runtime 在领取 Work 前 fail closed 并报告 binding/Provider/provenance 差异，不降级为忽略团队方法

#### Scenario: Execute 请求外部 execution Skill

- **WHEN** 调用方请求为 autonomous 或 subagent 模式装填未绑定的外部 execution Skill
- **THEN** Runtime 拒绝请求并返回 Action 与 effective composition 的冻结 identity，不把外部 Skill 当作隐藏模式实现

#### Scenario: 调用方修改阶段组合

- **WHEN** 调用方请求跳过内置 augmentation、替换 Action、忽略批准 TDD 策略、增删团队 binding 或任意重排
- **THEN** Runtime 拒绝请求并返回 definition、BuildStrategy 与 effective composition 共同冻结的组合 identity
