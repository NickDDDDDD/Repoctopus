# skill-integration Delta

## MODIFIED Requirements

### Requirement: Run 记录实际 Skill 快照

Repoctopus MUST 由 lifecycle Work 声明 action Skill 与每项 augmentation Skill 的规范名称，使用统一 Skill 能力解析唯一 Provider，并在领取 Work 前记录有序组合、Provider 身份、调用策略、正文/资源摘要、传递依赖、适用 Work、runId、attempt 和 checkEpoch；恢复时 Skill 事实变化不得静默改变既有 Run 的方法依据，调用方不得选择替代 Skill 或改变组合绕过 definition。Method Profile 使用独立 snapshot，不得伪装成 SkillUsageSnapshot。

#### Scenario: Skill 正文在 Run 中断期间改变

- **WHEN** Run 恢复时当前或已领取 Work 的同名 Skill 正文摘要与已记录快照不同
- **THEN** 系统在同一 Run 报告 Skill 漂移，并按声明兼容性使 Work 失效、重新解析尚未开始的 Work 或进入 `migration_required`，不得创建新 generation

#### Scenario: 未使用的 Skill 发生变化

- **WHEN** 目录中一个未被当前或历史 Work 加载的 Skill 发生变化
- **THEN** 系统刷新后续发现结果，但不使当前 Run 的既有 Work 失效

#### Scenario: 调用方请求替换 Skill 组合

- **WHEN** 当前 Work 声明一个有序 Skill 组合而调用方请求替换、增删或重排任一绑定来完成同一 Work
- **THEN** Runtime 拒绝变化并返回 definition 声明的组合 identity

### Requirement: Work 分离可执行 Skill 与不可执行 Method Profile

Repoctopus MUST 由 lifecycle definition 为每项 Work 分别声明至多一个 `actionSkill`、有序 `augmentationSkills` 和一个版本化 `methodProfile`。可执行 Skill 必须记录规范名称、Provider、正文/资源摘要和调用策略；action Skill 独占产物协议，augmentation Skill 不得建立第二份产物或执行未声明发布副作用。Method Profile MUST 记录 Repoctopus-owned 规则、适用 phase/artifact、enforcement 与固定上游来源摘要，但不得作为 Skill 被发现或调用。Runtime MUST 在 Work 开始前解析完整组合及传递依赖，缺项、歧义、漂移、双产物所有者或违反调用策略时 fail closed。

#### Scenario: OpenSpec action 与 Matt 方法组合

- **WHEN** Open 或 Design Work 使用 OpenSpec action Skill维护四类官方工件，并使用已审核的方法增强需求澄清、代码库设计或任务质量
- **THEN** OpenSpec action 保持唯一产物协议，augmentation 或 Method Profile 只作用于同一官方工件、Validator、review rubric 或 Human Decision，不创建第二套 spec/ticket

#### Scenario: 自动调用仅允许用户触发的 Skill

- **WHEN** definition、Skill catalog、projection 或调用方尝试发现、装填或绑定原始 `to-spec` 或 `to-tickets`
- **THEN** Runtime 拒绝该路径，并提示使用已审核的 Method Profile 而不是执行原始 tracker 工作流

#### Scenario: TDD Work 缺少传递方法依赖

- **WHEN** Build Work 在首次测试或产品代码写入前领取执行包
- **THEN** Runtime 固定装填 `repoctopus-build-task + tdd`，不重复固定装填 `codebase-design` 或 `design.public-test-seams`；若 TDD 暴露设计级问题，Host 只返回结构化 finding 供 Runtime 决策

#### Scenario: Method Profile 来源或规则发生漂移

- **WHEN** Run 恢复时已领取 Work 的 Method Profile digest、采用规则或任一固定上游 source digest 与快照不同
- **THEN** Runtime 在同一 Run 使 Work 失效并按兼容声明恢复，或进入 `migration_required`；不得把新规则静默注入旧 Work，也不得创建新 generation

## ADDED Requirements

### Requirement: 阶段 Work 必须装填固定且唯一的 Skill 组合

Lifecycle definition MUST 声明并由 Runtime 强制执行以下有序组合：Open 使用 `repoctopus-open-change` 与 augmentation `grilling`；Design 使用 `repoctopus-design-change` 与 augmentation `codebase-design`；Build 使用 `repoctopus-build-task` 与 augmentation `tdd`。Runtime MUST 在 claim 前解析每个规范 Skill 名的唯一 Provider、传递资源、调用策略和 provenance，向 Host 交付真实内容而不只记录名称；调用方、Agent 和 Host 不得跳过、替换、重排或额外装填另一规划权威。

#### Scenario: Open 的 grilling 没有未决 frontier

- **WHEN** Open Agent 已从代码、现有规格和输入中验证全部会改变设计的事实，`grilling` 决策树没有未决 frontier
- **THEN** Host 可以零用户问题完成 Open Outcome；Runtime 仍记录 `grilling` 的真实交付与消费，不把零问题解释为未加载 Skill

#### Scenario: Open 把可验证环境事实转问用户

- **WHEN** Open Outcome 显示 Agent 未检查可访问的代码、配置或现有规格，而把这些事实作为用户决策问题
- **THEN** Open Validator 拒绝 Outcome并要求在当前 Work 内完成环境验证，不允许借用户回答绕过事实检查

#### Scenario: grilling Provider 缺失或歧义

- **WHEN** composition 无法为规范名 `grilling` 解析恰好一个满足约束的 Provider，或只能依赖未声明的开发机全局安装
- **THEN** Runtime 在领取 Open Work 前 fail closed并报告 Provider/provenance 差异，不降级成无 augmentation 的 Open

#### Scenario: 调用方修改阶段组合

- **WHEN** 调用方请求 Open 不加载 `grilling`、Design 跳过 `codebase-design`、Build 额外加载 `codebase-design` 或任意重排
- **THEN** Runtime 拒绝请求并返回 definition 中冻结的组合 identity

### Requirement: OpenSpec 四类工件必须保持唯一规划权威

Open 和 Design MUST 共同维护同一 Change 下的 proposal、delta specs、design、tasks 四类 OpenSpec 工件。Design MAY 深化已有内容但 MUST NOT 新建或要求 Superpowers Design Doc、Build Plan、ADR、implementation notes、第二套 ticket 或其他并行规划权威；长期架构决定必须记录在该架构 Change 的 `design.md`，测试要求与验收映射必须进入 delta specs、design 或 tasks 的既有职责位置。

#### Scenario: Design 尝试创建第五规划工件

- **WHEN** Design Outcome 提交独立 Design Doc、Build Plan、ADR 或 implementation notes 作为进入 Build 的依据
- **THEN** Validator 拒绝该并行权威并要求把有效内容归并到四类 OpenSpec 工件

#### Scenario: 多仓 Change 使用 OpenSpec Store

- **WHEN** Workspace 通过 OpenSpec Store 管理多个业务仓的同一 Change
- **THEN** Open 与 Design 仍只更新 Store 中该 Change 的四类权威工件；业务仓映射和 task repository binding 不产生每仓第二套 spec/ticket
