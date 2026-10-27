# skill-integration Specification Delta

## MODIFIED Requirements

### Requirement: 核心阶段提供固定默认方法组合

Repoctopus MUST 为内置 lifecycle 的每个受管 Action 固定方法组合：Open 使用 action Skill 与 `grilling`；Design 使用 action Skill 与 `codebase-design`；Build Configure、Plan、Execute 和 Check 使用各自 Repoctopus-owned action Skill，Execute 从冻结配置读取 autonomous 或 subagent 协调协议并仅在 `tddMode=tdd` 时加载 Matt `tdd`；Build Check 固定加载 Matt `code-review`；Verify 使用 action Skill 与 `code-review`；Archive 使用 action Skill，发布 Work 使用 `pr`。`diagnosing-bugs` 只能由声明的失败事实触发，调用方不得任意选择，系统不得把 Superpowers 或不存在于固定 Matt 快照的 Skill 变成隐式依赖。

#### Scenario: Build 首次写入尚未加载 TDD

- **WHEN** 配置为 `tddMode=tdd`，但当前 Execute Work 尚未向 Host 交付兼容的 action 与 TDD Skill 正文却请求写测试或实现
- **THEN** 应用边界拒绝写入，Runtime 先完成固定方法装填和 Host preflight 再允许执行

#### Scenario: direct TDD 模式不装填 TDD

- **WHEN** 配置为 `tddMode=direct`
- **THEN** Execute Work 不加载 `tdd` augmentation，但 action contract 仍要求相关测试与回归 Evidence，Build Check 和 Verify 不得降级

#### Scenario: 故障触发诊断方法

- **WHEN** Build Validator 返回 definition 声明的可诊断失败事实
- **THEN** Runtime 为同一逻辑 Work 的后续 attempt 加载固定 `diagnosing-bugs` augmentation，而不是让 Agent 自选另一流程或 execution mode

#### Scenario: Verify 只有代码审查身份

- **WHEN** Verify Work 只记录 `code-review` snapshot 而没有向 Host 交付阶段 action 与审查正文
- **THEN** Runtime 保持 Verify 未执行，不把后续自动命令成功当作 Agent 已完成规格核对和代码审查

### Requirement: 阶段 Work 必须装填固定且唯一的 Skill 组合

Lifecycle definition MUST 声明并由 Runtime 根据 phase、Action kind 和冻结 Build Configuration 计算唯一有序组合。Open 固定 `repoctopus-open-change + grilling`，Design 固定 `repoctopus-design-change + codebase-design`；Build 必须使用对应 Configure、Plan、Execute 或 Check action Skill，Execute 仅按 TDD 配置有条件增加 Matt `tdd`，Check 固定增加 Matt `code-review`。execution mode 作为 action input 决定 Repoctopus 协调协议，不作为外部 augmentation Skill。Runtime MUST 在 claim 前解析唯一 Provider、资源、调用策略与 provenance，并向 Host 交付真实内容；调用方、Agent 和 Host不得跳过、替换、重排或额外装填另一规划权威。

#### Scenario: Open 的 grilling 没有未决 frontier

- **WHEN** Open Agent 已从代码、现有规格和输入中验证全部会改变设计的事实，`grilling` 决策树没有未决 frontier
- **THEN** Host 可以零用户问题完成 Open Outcome；Runtime 仍记录 `grilling` 的真实交付与消费，不把零问题解释为未加载 Skill

#### Scenario: Open 把可验证环境事实转问用户

- **WHEN** Open Outcome 显示 Agent 未检查可访问的代码、配置或现有规格，而把这些事实作为用户决策问题
- **THEN** Open Validator 拒绝 Outcome并要求在当前 Work 内完成环境验证，不允许借用户回答绕过事实检查

#### Scenario: grilling Provider 缺失或歧义

- **WHEN** composition 无法为规范名 `grilling` 解析恰好一个满足约束的 Provider，或只能依赖未声明的开发机全局安装
- **THEN** Runtime 在领取 Open Work 前 fail closed并报告 Provider/provenance 差异，不降级成无 augmentation 的 Open

#### Scenario: Execute 请求外部 execution Skill

- **WHEN** 调用方请求为 autonomous 或 subagent 模式装填 Superpowers `subagent-driven-development`、`executing-plans` 或其他未固定 execution Skill
- **THEN** Runtime 拒绝请求并返回 Repoctopus Execute action 与 Matt augmentation 的冻结组合 identity，不把外部 Skill 当作隐藏的模式实现

#### Scenario: 调用方修改阶段组合

- **WHEN** 调用方请求 Open 不加载 `grilling`、Design 跳过 `codebase-design`、Build Execute 额外加载 `codebase-design`、忽略配置中的 TDD/subagent 选择或任意重排
- **THEN** Runtime 拒绝请求并返回 definition 与配置共同冻结的组合 identity

### Requirement: OpenSpec 四类工件必须保持唯一规划权威

Open 和 Design MUST 共同维护同一 Change 下的 proposal、delta specs、design、tasks 四类 OpenSpec 工件。Design MAY 深化已有内容但 MUST NOT 新建或要求 Superpowers Design Doc、ADR、implementation notes、第二套 ticket 或其他并行规划权威；长期架构决定必须记录在该架构 Change 的 `design.md`。Runtime MAY 在 Build 中生成引用稳定 Task IDs 的 Build Configuration 与 BuildPlan，但二者只能是受管执行状态，不得位于 Specification Provider 产物目录、包含第二套 checkbox、修改 Task 语义或参与 OpenSpec 的四工件完成判定。

#### Scenario: Design 尝试创建第五规划工件

- **WHEN** Design Outcome 提交独立 Design Doc、ADR 或 implementation notes，或提交不引用 OpenSpec Tasks 的 Build Plan作为进入 Build 的依据
- **THEN** Validator 拒绝该并行权威并要求把规格、设计和任务内容归并到四类 OpenSpec 工件

#### Scenario: Runtime 根据批准 Tasks 创建 BuildPlan

- **WHEN** Design 已批准且 Build Plan action 把稳定 Task IDs 投影为 Work Packages
- **THEN** Runtime 把该计划保存在 Run 执行状态并以 planning digest 校验，不将它写成第五类 OpenSpec 工件或独立任务权威

#### Scenario: 多仓 Change 使用 OpenSpec Store

- **WHEN** Workspace 通过 OpenSpec Store 管理多个业务仓的同一 Change
- **THEN** Open 与 Design 仍只更新 Store 中该 Change 的四类权威工件；BuildPlan 可记录各包的 repository binding，但不得产生每仓第二套 spec/ticket
