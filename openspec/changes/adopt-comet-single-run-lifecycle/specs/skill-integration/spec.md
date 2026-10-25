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

- **WHEN** Design Work 使用 OpenSpec action Skill 产生四类官方工件，并使用采用自 Matt 方法的 Method Profile 增强测试缝或任务质量
- **THEN** OpenSpec action 保持唯一产物协议，Method Profile 规则只作用于声明的官方工件、Validator、review rubric 或 Human Decision

#### Scenario: 自动调用仅允许用户触发的 Skill

- **WHEN** definition、Skill catalog、projection 或调用方尝试发现、装填或绑定原始 `to-spec` 或 `to-tickets`
- **THEN** Runtime 拒绝该路径，并提示使用已审核的 Method Profile 而不是执行原始 tracker 工作流

#### Scenario: TDD Work 缺少传递方法依赖

- **WHEN** Build Work 要求在首次测试或代码写入前加载 `tdd`，但固定快照缺少其 `codebase-design` 依赖
- **THEN** Runtime 在允许写入前阻塞 Work，并返回缺少的固定 provenance identity

#### Scenario: Method Profile 来源或规则发生漂移

- **WHEN** Run 恢复时已领取 Work 的 Method Profile digest、采用规则或任一固定上游 source digest 与快照不同
- **THEN** Runtime 在同一 Run 使 Work 失效并按兼容声明恢复，或进入 `migration_required`；不得把新规则静默注入旧 Work，也不得创建新 generation
