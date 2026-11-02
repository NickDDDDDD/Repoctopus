# project-configuration Specification

## Purpose

定义 Repoctopus 如何发现、确认和加载可移植的团队项目配置，同时隔离本机路径差异并防止本地覆盖削弱共享验证策略。

## Requirements

### Requirement: 团队规则使用共享项目配置

Repoctopus MUST 从 Git 跟踪的 `repoctopus.yaml` 加载仓库身份、composition、Evidence Profile、命令、服务、健康检查、浏览器 Journey、必需检查和保留策略，并使用版本化 Schema 校验全部字段；团队成员不得为了使用插件系统而直接维护 Cordis Loader 内部配置。

#### Scenario: 团队成员加载同一配置

- **WHEN** 两名成员在不同父目录检出同一项目并加载有效共享配置
- **THEN** 两端解析出相同逻辑仓库、composition、Evidence Profile 和门禁规则

#### Scenario: 共享配置缺少必需字段

- **WHEN** project composition 缺少版本、仓库 identity 或必需检查定义
- **THEN** App Boot 返回可定位配置诊断且不启动对应产品能力

#### Scenario: 用户配置包含 Cordis 内部配置

- **WHEN** 共享配置尝试注入未被 Repoctopus Schema 接纳的原始 Loader Entry 或 Cordis 内部字段
- **THEN** 配置校验拒绝该字段并保持领域配置与组合内核实现边界

### Requirement: 本机覆盖不得削弱团队门禁

Repoctopus MUST 只允许被忽略的 `.repoctopus/local.yaml` 覆盖机器路径、端口、浏览器位置、视觉反馈交换目录和资源限制，不得删除必需检查、改变证据可信等级或把阻断规则降级为警告。

#### Scenario: 成员手动配置仓库绝对路径

- **WHEN** 本机覆盖把逻辑仓库 identity 映射到一个可验证 Git 工作树
- **THEN** Runtime 使用该路径运行 Profile，同时只在本地状态中保存解析后的绝对路径

#### Scenario: 本机覆盖试图删除必需检查

- **WHEN** 本机覆盖把共享配置中的必需检查设为可选或禁用
- **THEN** 配置合并失败并指出被禁止的覆盖路径

### Requirement: 项目探测只生成候选草稿

`project detect` MUST 只读扫描显式作用域内的仓库和常见构建文件，把候选配置写入 `.repoctopus/drafts/`，不得直接创建或覆盖正式共享配置。为探测出的 Change Verify 命令生成候选时，required 节点 MUST 使用显式、保守的 workspace-wide Acceptance selector，并 MUST 把该 coverage 选择登记为待人工复核项；Runtime MUST NOT 猜测未来 Task 或 Requirement selector。

#### Scenario: 首次探测项目

- **WHEN** 工作区尚无 `repoctopus.yaml`
- **THEN** 命令生成带来源和不确定项的候选草稿，并提示由 Agent 补全后交给用户确认
- **AND** 每个探测出的 required Verify 命令显式声明 `covers: ['*']`，其 workspace-wide coverage 被标记为需要确认或收窄

#### Scenario: 已存在共享配置

- **WHEN** 探测结果与当前 `repoctopus.yaml` 不同
- **THEN** 命令输出 reconcile diff 且保持正式配置不变

### Requirement: 用户确认后才能写入共享配置

Repoctopus MUST 把候选配置、Agent 补全内容和现有配置差异作为 Human Decision 输入，只有可信用户确认后才允许生成或更新 `repoctopus.yaml`。约定的默认 Change `verify` Profile MUST 在建立审批请求前存在，并至少包含一个声明非空 Acceptance coverage 的 required 节点；完全无 coverage 或只有 optional coverage 的候选 MUST 被拒绝。具体 Run 显式选择的其他 `verificationProfileId` MUST 由该 Run 的 Design preflight 精确校验。

#### Scenario: 没有可信确认通道

- **WHEN** Agent 已补全候选配置但 Runtime 无法获得可信用户决定
- **THEN** 草稿保持待确认状态且正式配置不变

#### Scenario: Verify Profile 没有 required coverage

- **WHEN** 候选 `verify` Profile 的节点全部未声明 coverage，或 coverage 只存在于 optional 节点
- **THEN** Repoctopus 在创建可批准请求和写正式配置前拒绝候选，并指出需要 `*`、`task:`、`requirement:` 或精确 Acceptance selector

#### Scenario: 前置节点不直接覆盖 Acceptance

- **WHEN** Profile 至少有一个 required 验证节点声明 coverage，另有 service 或准备节点不直接覆盖 Acceptance
- **THEN** 静态可用性检查允许该结构，精确覆盖关系交给 Change Design preflight 判断

### Requirement: 有效配置具有稳定摘要

Repoctopus MUST 对规范化共享配置、编译后的 composition 和允许的本机覆盖分别计算摘要，并把三者绑定到 Run 与 Evidence 输入指纹；键顺序、声明顺序或平台路径分隔符差异不得改变语义相同配置的摘要。

#### Scenario: 本机端口覆盖变化

- **WHEN** 成员修改 Evidence Run 使用的端口覆盖
- **THEN** 新运行产生不同有效配置摘要且旧 Evidence 不再满足当前 Profile

#### Scenario: 插件声明顺序变化但语义相同

- **WHEN** 团队只调整不影响插件身份和配置值的列表顺序
- **THEN** 编译后的 composition digest 保持相同

### Requirement: 配置翻译器只承担领域到 Loader 的确定性映射

Repoctopus MUST 由薄配置翻译器选择 bootstrap 或 project composition、执行领域 Schema 校验、静态 Descriptor 准入、权威能力唯一性检查和摘要计算，再生成 Cordis Loader Entry；翻译器不得复制 Cordis 的通用 Service 依赖图、激活顺序或 Fiber 状态机。

#### Scenario: 仓库尚未完成接入

- **WHEN** 工作区没有经过用户确认的 `repoctopus.yaml`
- **THEN** 翻译器选择 bootstrap composition，只生成项目探测、配置接入、来源检查和浏览器诊断 Entry

#### Scenario: 项目配置有效

- **WHEN** 工作区存在经过 Schema 校验的 `repoctopus.yaml`
- **THEN** 翻译器生成 project composition，并由 Cordis 管理 Service 依赖与激活

### Requirement: 团队插件准入先于模块执行

Repoctopus MUST 在导入团队插件前验证共享配置登记及静态 Descriptor 中的包身份、Repoctopus 契约版本、配置 Schema、能力、来源、代码摘要与状态兼容范围；无效组合不得通过模块求值副作用部分启动。

#### Scenario: 未登记包位于项目依赖中

- **WHEN** 项目安装了带 Repoctopus 插件入口的包但共享配置没有登记它
- **THEN** 配置翻译器忽略该包且不执行其模块代码

#### Scenario: Descriptor 不兼容

- **WHEN** 已登记插件的契约或状态版本与当前 composition 不兼容
- **THEN** App Boot 在 import 前拒绝接纳并返回逐字段诊断

### Requirement: 本机覆盖不得改变插件信任边界

`.repoctopus/local.yaml` MUST 不得新增团队插件、替换共享 Provider、降低版本约束、改变插件必需性或扩大权限类别；机器路径、端口与资源参数覆盖仍须遵循共享配置声明的允许字段。

#### Scenario: 本机覆盖启用额外 Provider

- **WHEN** 本机覆盖尝试加入共享配置未登记的 Service Provider
- **THEN** 配置合并失败并指出该字段超出本机覆盖权限

### Requirement: 团队 Skill binding 属于共享配置

Repoctopus MUST 在 Git 跟踪的 `repoctopus.yaml` 中用版本化 Schema 声明团队 lifecycle Skill binding，并把 binding identity、目标 Work、角色、逻辑 Skill 名、顺序和 replaceable slot 纳入共享配置摘要。第一版 MUST 只允许 `guidance` 和 `augmentation-replacement`；配置 MUST NOT 包含 Provider 文件路径、任意模块路径、内嵌代码、Cordis Loader 内部字段或本机绝对路径。

#### Scenario: 团队为 Design 增加 guidance

- **WHEN** 共享配置把已登记团队 Skill 以 `guidance` 绑定到 definition 允许的 Design Work
- **THEN** 两名成员在不同父目录检出项目后编译出相同 binding identity、顺序和共享摘要，不需要修改 lifecycle 源码

#### Scenario: 配置尝试替换 Action

- **WHEN** 团队配置把 Skill 绑定到 Action、未知 Work/slot 或内嵌任意执行代码
- **THEN** Schema 或 composition validation 在 Work claim 前拒绝配置并返回可定位字段诊断

#### Scenario: 配置声明尚未支持的 required check

- **WHEN** 当前版本的共享配置声明 `required-check` 角色
- **THEN** Schema 明确拒绝该角色，不把它静默解释为 guidance 或普通 augmentation

### Requirement: 个人 Skill 不得改变团队生命周期组合

Repoctopus MUST 把用户级 Skill、个人学习目录和 `.repoctopus/local.yaml` 排除在团队 `EffectiveSkillComposition` 的语义输入之外；本机覆盖不得新增、删除、替换或重排团队 binding。团队采用个人 Skill 时 MUST 先通过项目 Provider 和共享配置的正常评审路径登记。

#### Scenario: 个人目录存在同名 Skill

- **WHEN** 开发机用户目录提供与团队 binding 逻辑名相同的 Skill，但该 Provider 未进入项目共享 composition
- **THEN** 团队 Run 不解析该个人实现，且另一台没有该目录的机器得到相同 effective composition

#### Scenario: 本机覆盖删除团队 guidance

- **WHEN** `.repoctopus/local.yaml` 试图删除、替换或重排团队 binding
- **THEN** 配置合并失败并指出禁止的覆盖路径，团队共享配置保持不变
