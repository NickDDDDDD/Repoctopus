# skill-integration Specification

## Purpose

定义 Repoctopus 如何发现、选择和加载可替换的 Agent Skill，并把实际使用的方法指令绑定到可恢复 Run，同时隔离团队共享能力与成员个人学习状态。

## Requirements

### Requirement: Skill 通过可替换 Provider 解析

Repoctopus MUST 通过统一 Skill 能力按名称解析多个 Provider 的候选项，并依据声明的作用域和确定性优先级选择唯一实现；工作流不得引用具体 Provider 路径。

#### Scenario: 两个 Provider 提供同名 TDD Skill

- **WHEN** 当前组合中两个 Provider 都提供名为 `tdd` 的 Skill
- **THEN** 系统按作用域和稳定优先级选择唯一实现，并在目录中标明实际 Provider

#### Scenario: 替换默认 TDD Provider

- **WHEN** 项目组合把另一个有效 Provider 配置为 `tdd` 的优先来源
- **THEN** 工作流继续请求 `tdd`，无需修改阶段定义或 Runtime 代码

### Requirement: Skill 调用策略在边界处执行

Repoctopus MUST 为每个 Skill 区分模型调用和用户调用权限，并在列出与加载正文时重新核对策略；未获授权的调用不得返回正文。

#### Scenario: 仅允许用户调用的 Skill

- **WHEN** 模型请求加载一个禁用模型调用但允许用户调用的 Skill
- **THEN** 系统拒绝模型调用，同时保留用户显式调用入口

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

### Requirement: 外部 Agent 通过稳定目录协议消费 Skill

Repoctopus MUST 提供版本化的 Skill 列表与正文读取协议，并允许 IDE Adapter 将同一解析结果投影到目标 Agent 支持的项目级目录；Adapter 不得维护独立的 Provider 优先级或依赖 IDE Hook 才能加载 Skill。

#### Scenario: Codex 与 OpenCode 查看同一项目 Skill

- **WHEN** 两个 IDE Adapter 针对同一项目和组合请求 Skill 目录
- **THEN** 两者获得相同的规范名称、描述、调用策略、Provider 和正文摘要，仅输出格式与目标目录不同

#### Scenario: IDE 不支持动态 Skill API

- **WHEN** 目标 IDE 只能从项目目录读取 Skill 文件
- **THEN** Adapter 以可重复生成的方式投影目录，并记录来源摘要以防止把本地编辑误认为 Provider 内容

### Requirement: 团队 Skill 与个人学习状态分离

Repoctopus MUST 允许团队共享 `teach` Skill 定义，同时把每个成员生成的课程、资料索引、笔记和学习记录写入 `.repoctopus/learning/` 本机目录；该目录默认被 Git 忽略。

#### Scenario: 成员启动学习主题

- **WHEN** 成员在一个项目中使用 `teach` 创建学习内容
- **THEN** 内容写入该成员本机的 `.repoctopus/learning/<topic>/`，团队仓库不产生待提交文件

#### Scenario: 团队决定沉淀学习结论

- **WHEN** 成员显式选择把经过整理的结论提升为团队知识
- **THEN** 系统要求通过项目文档、规格或知识库的正常评审路径写入，不直接提交个人学习目录

### Requirement: 个人学习内容默认不进入审计数据

Repoctopus MUST 禁止默认遥测、日志和 Run 事实包含个人学习正文、笔记正文或资料正文，只允许记录经配置允许的 Skill 名称、Provider、摘要和状态。

#### Scenario: 导出 Skill 调用遥测

- **WHEN** `teach` 被调用且 OpenTelemetry 已启用
- **THEN** 遥测可以包含 Skill 名称和内容摘要，但不包含个人课程、笔记或资料正文

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

### Requirement: 行为参考与可执行 Skill 物理隔离

Repoctopus MUST 将只用于行为采用的上游文件保存在 Skill Provider roots 之外，并通过 provenance manifest 记录固定 repository、commit、path、source digest、adopted rule IDs 和采用状态；Skill discovery、`skill.get`、managed projection 与 lifecycle binding MUST NOT 返回这些原始参考。架构测试必须证明把参考误放进可发现目录或把其名称加入 Work 会失败。

#### Scenario: 上游参考存在于固定快照

- **WHEN** provenance 检查读取 `to-spec` 或 `to-tickets` 的固定原文以审计采用规则
- **THEN** 它可以核对 source digest 和 rule mapping，但 Skill catalog 与 projection 中不存在该原始 Skill

#### Scenario: 用户环境另行安装同名 Skill

- **WHEN** 用户级 Skill Provider 发现名为 `to-spec` 或 `to-tickets` 的可调用 Skill
- **THEN** 普通显式用户操作 MAY 按宿主策略使用它，但当前 lifecycle Work 不绑定、不自动装填，也不接受其 tracker 产物作为 OpenSpec planning fact

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

### Requirement: 受保护操作必须匹配当前 Work

Repoctopus MUST 在 Application Plugin、Command Router 和平台写入口根据当前已领取 Work 执行能力、side-effect class、repository 与 write scope 策略；没有活动 claim、目标超出范围、terminal artifact 被改写或操作类别不匹配时必须拒绝，Prompt、AGENTS.md 或调用方声明不得代替运行时授权。

#### Scenario: Agent 未领取 Work 直接写业务代码

- **WHEN** Agent 没有当前 Change Run 的有效 claim 却请求写入业务仓
- **THEN** 应用边界拒绝写入并返回需要领取的 Work，不依赖 Agent 是否读取流程说明

#### Scenario: 当前 Work 只允许规格目录

- **WHEN** Design Work 的 write scope 只允许 Provider 规划产物而执行者请求修改业务源码
- **THEN** 应用边界拒绝越界路径并记录 Work、capability 和目标摘要

#### Scenario: Design Work 尝试发布 tracker

- **WHEN** 当前 Work 的 output contract 只允许 Specification Provider artifact，而执行者请求创建 issue、写本地 ticket 目录或调用 tracker publish
- **THEN** 应用边界在副作用前拒绝操作，并且任何未受管外部写入只能形成 drift/blocker，不能形成成功 Receipt 或推进事实

### Requirement: Skill 正文必须由当前 Work 的 Host 实际消费

Repoctopus MUST 在 Work claim 后从已固定 Provider 解析 action 与 augmentation Skill 的完整正文和资源，并通过受管执行包交给唯一 Host；SkillUsageSnapshot、名称、source 或 digest 只能证明身份，不能单独证明 Skill 已加载或执行。

#### Scenario: Build Skill 已绑定但正文未交付

- **WHEN** Run 含 `tdd` 与代码边界 Skill snapshot，但 Host 只收到名称和 digest
- **THEN** Runtime 不得调用 Agent或接受 Outcome，并报告执行上下文未完整交付

#### Scenario: Host 收到固定组合

- **WHEN** 当前 Work 的所有 Skill 和 Specification 指令均与冻结 identity 一致
- **THEN** Host 按 definition 顺序收到完整内容，消费事实绑定执行包 digest 和当前 claim

### Requirement: Repoctopus 提供阶段 action Skill

Repoctopus MUST 通过独立内置 Skill Provider 提供 Open、Design、Build、Verify 和 Archive 的版本化 action Skill；阶段 Skill 负责当前 Work 的执行协议，Specification Provider 负责官方工件指令，方法 Skill 只能增强该协议且不得成为规划或任务权威。

#### Scenario: OpenSpec Provider 参与 Design

- **WHEN** 内置 Design Work 使用当前 OpenSpec Specification Provider
- **THEN** Host 同时收到 Repoctopus Design action Skill 与 Provider 返回的官方四类工件 instructions/template，产物仍由 OpenSpec 校验

#### Scenario: Specification Provider 被替换

- **WHEN** 项目组合选择兼容的另一 Specification Provider
- **THEN** lifecycle 仍使用同一阶段 action Skill 语义，并装填新 Provider 的工件协议，不引用 OpenSpec 安装路径或私有命令

### Requirement: 阶段 Work 必须装填固定且唯一的 Skill 组合

Lifecycle definition MUST 声明不可替换的 Action Skill、固定内置 augmentation 与显式 augmentation slot；Runtime MUST 根据 phase、Action kind 和共享 `EffectiveSkillComposition` 计算唯一有序组合，并在 claim 前解析 Provider、资源、调用策略和 provenance，向 Host 交付真实内容。Open 默认 `repoctopus-open-change + grilling`，Design 默认 `repoctopus-design-change + codebase-design`，Build 使用对应 Configure、Plan、Execute 或 Check Action。execution mode 只能作为 Action input；调用方、Agent 和 Host 不得跳过或替换 Action、重排组合或装填未绑定的 execution Skill。

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

### Requirement: 宿主通过 Repoctopus Skill 进入工作流

Workspace 的 `repoctopus` 入口 Skill MUST 通过公开接口按明确用户意图启动 Change 或恢复已识别的 Run。入口 MUST 以 Runtime 返回的 continuation 为准；无法确定目标时 MUST 提示用户补足身份或意图，不得猜测并创建第二个 Run。入口 Skill 不持有阶段、审批或写入授权。

#### Scenario: 在宿主显式调用入口

- **WHEN** 用户在已接入 Workspace 的宿主里调用 `repoctopus`，并给出启动所需的 Change 和目标信息
- **THEN** 宿主经公开 CLI 启动该 Change，沿 Runtime 返回的 Run 和当前 continuation 执行
- **AND** 不要求宿主预先发现全部阶段 Skill

#### Scenario: 从新会话恢复已有 Run

- **WHEN** 用户调用入口并给出已有 Run 的身份
- **THEN** 宿主恢复原 Run，并按当前 continuation 处理，不基于本地文档重建阶段或新建 Run

### Requirement: 宿主仅装填 Runtime 指定的当前 Action Skill

对已领取的可执行 Action，Runtime MUST 交付当前 claim 绑定的固定 Skill 正文和所需资源；宿主 MUST 在执行前装填该内容及按序交付的其他受管层，并只对实际装填的层回报消费。宿主 MUST 按 Runtime 指示处理人工决定、等待、待核对或完成状态；不可从阶段名称、同名 Skill 或旧执行包自行选择执行内容。

#### Scenario: 从 Open 推进到 Design

- **WHEN** 宿主从同一 Run 取得并领取 Open Action，随后当前 Open Outcome 被接受且人工批准完成，Runtime 返回 Design Action
- **THEN** 宿主先装填 Open 的受管内容；审批前不装填 Design；领取 Design 后装填该 Action 自己的受管内容
- **AND** 消费回执与各自的 claim 及执行包绑定

#### Scenario: 当前内容无法装填

- **WHEN** 所需内容缺失、宿主无法加载，或拿到的是其他 Action、旧 attempt 的执行包
- **THEN** 宿主报告缺口并停止该 Action，不回报未消费内容、不改用同名 Skill，不让 Runtime 将其视为成功

#### Scenario: 恢复时存在待决定项或未知结果

- **WHEN** Runtime 返回人工决定、等待、待核对或已完成
- **THEN** 宿主处理该返回状态，不以入口调用为由重新领取或重放已执行的 Action
