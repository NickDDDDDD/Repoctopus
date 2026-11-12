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

接入探测 MUST 只读检查显式范围内的 Git 仓库、Workspace Git 根与 Store，在本地生成最小可审阅候选，正式共享配置保持原状。首次接入 MUST 独立于构建文件识别、测试命令推断和 Verify coverage 配置。已接入 Workspace 的候选 MUST 保留已配置的 Profile 和不在本次更新范围内的共享字段。

#### Scenario: 首次探测项目

- **WHEN** 用户在单仓业务 Git 根或独立的多仓 Workspace 选择接入
- **THEN** Repoctopus 根据所选布局生成含明确 Git 根、仓库及 Store 的接入候选
- **AND** 无可识别的构建文件或 Verify Profile 时仍可准备审批

#### Scenario: 无效 Workspace 布局

- **WHEN** Workspace 是业务仓普通子目录，或扫描范围中无法识别所选 Workspace Git 根
- **THEN** Repoctopus 在审批前报告实际路径、预期布局和恢复操作
- **AND** 不生成缺失 Store binding 的可批准接入请求

#### Scenario: 已存在共享配置

- **WHEN** 用户重新运行接入或补齐受管入口
- **THEN** Repoctopus 输出相关 diff 并保留已有 Verify Profile 和其他未授权修改的配置

### Requirement: 用户确认后才能写入共享配置

Repoctopus MUST 把候选、作用范围及现有配置差异作为 Human Decision 输入，只有可信用户确认后才生成或更新 `repoctopus.yaml`。首次接入 MAY 无 Verify Profile；配置一个 Verify Profile 时 MUST 校验其结构和 required coverage 声明。已选 Profile 的 Run coverage 校验沿用 Evidence 权威。

#### Scenario: 首次调用的接入确认

- **WHEN** Runtime 已形成包含 Workspace、仓库、Store 和入口目标的有效候选
- **THEN** 用户在同一宿主调用中审阅一次计划并选择
- **AND** 可信批准后 Runtime 应用同一请求，无需用户搬运草稿或候选路径

#### Scenario: 没有可信确认通道

- **WHEN** Runtime 未获得可信批准
- **THEN** 接入或配置请求保持待确认，正式配置保持原状

#### Scenario: 传错候选或缺少绑定

- **WHEN** 用户把探测草稿交给候选参数，或请求缺少可验证的 Workspace Store binding
- **THEN** Repoctopus 在审批前报告对应的输入或绑定错误，并引导重新获取正确候选

#### Scenario: Verify Profile 没有 required coverage

- **WHEN** 候选 Verify Profile 没有声明非空 coverage 的 required 验证节点
- **THEN** Repoctopus 在写共享配置前报告缺少 required coverage

#### Scenario: 前置节点不直接覆盖 Acceptance

- **WHEN** Profile 有带 coverage 的 required 验证节点，且有服务或准备节点不直接覆盖 Acceptance
- **THEN** 静态校验接受该结构，精确覆盖由当前 Run 的 preflight 校验

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

### Requirement: 获批项目接入以可恢复事务物化规格根

Repoctopus MUST 在项目配置候选中区分精确已登记、健康未登记、缺失、不健康和登记冲突的 Workspace Specification Root，并把 Root disposition、Provider identity、Store identity 与允许执行的动作绑定到 Human Decision；获批 apply MUST 先以持久 Intent 和重新观察创建或验证健康根，再登记 Store、安装业务仓 pointer，最后发布共享项目配置。apply 不得扩大批准权限、手工拼装 Provider 私有文件、覆盖既有根或在根与登记未验证时提前发布 `repoctopus.yaml`。

#### Scenario: 全新非空 Workspace 获批接入

- **WHEN** 获批候选证明 Workspace 中不存在 `openspec/`，但仓库包含其他项目文件
- **THEN** Repoctopus 通过固定 OpenSpec Provider 的官方初始化入口物化最小健康根，重新验证后登记 Store，并只在两者成功后安装 pointer 与共享配置

#### Scenario: apply 前 Root disposition 发生变化

- **WHEN** 用户批准缺失根方案后，`openspec/` 被其他进程创建或 Store identity 发生变化
- **THEN** Repoctopus 使旧决定失效并返回可定位 reconcile 诊断，不把新目录当成本事务所有、不强制初始化且不发布共享配置

#### Scenario: 初始化结果未知后重启

- **WHEN** Root 初始化已经落盘但进程结果或 Receipt 尚未持久化
- **THEN** Repoctopus 从同一 request 的 Intent重新观察根身份和受限 manifest，只在可证明属于该初始化且健康时写恢复 Receipt并继续，既不重复创建也不删除用户文件

#### Scenario: 已有根不健康

- **WHEN** Workspace 已存在 `openspec/`，但固定 Provider不能证明它是健康根
- **THEN** Repoctopus 在人工确认前将其标记为 blocker，并在 apply 时继续 fail closed，不自动修复、覆盖或改用另一个规格根

#### Scenario: 中途失败保持配置最后发布

- **WHEN** Root bootstrap、Store registration或任一业务仓 pointer安装失败
- **THEN** Repoctopus 保留可恢复的 Intent/Receipt 和结构化诊断，且不存在声称接入完成的 `repoctopus.yaml` 更新

### Requirement: 获批 Workspace 接入提供本地使用入口

Repoctopus MUST 在可信用户批准的项目接入中，为 Workspace 根提供 `README.md` 和 `AGENTS.md` 引导，并提供 Workspace 内可直接阅读的使用教程。引导 MUST 适用于独立的多仓 Workspace 和业务仓兼任 Workspace 的单仓项目；接入完成前 MUST 核对这些产物已物化。探测、准备审批、拒绝或请求修改不得安装这些共享文件。

#### Scenario: 全新多仓 Workspace 完成接入

- **WHEN** 用户批准有效多仓候选且接入成功
- **THEN** Workspace 根存在 README 和 AGENTS 引导，README 的本地教程链接可解析，教程说明该 Workspace 与已登记业务仓的关系
- **AND** 业务仓的 README 和 Agent 指令保持原样

#### Scenario: 单仓项目完成接入

- **WHEN** 用户批准业务仓兼任 Workspace 的候选
- **THEN** 引导说明规格、配置与业务代码同仓的用法，不要求额外创建一个 Workspace 仓

#### Scenario: 尚未批准项目接入

- **WHEN** 用户只执行 detect 或 prepare，或者选择 reject 或 request_changes
- **THEN** README、AGENTS 和本地教程保持原样，不产生声称已经接入的文档

### Requirement: Workspace 引导保留团队自有内容

Repoctopus MUST 只创建缺失的引导文件或维护明确标记的 Repoctopus 受管区块，保留区块外原始内容及原有换行格式。重复执行 MUST 不产生重复区块。重复、嵌套或残缺的受管标记、非普通文件及不安全的路径 MUST 返回可定位冲突，不覆盖或解引用该目标，也不得返回成功接入。

#### Scenario: 项目已经有说明和 Agent 规则

- **WHEN** 单仓或多仓 Workspace 已有团队 README 与 AGENTS
- **THEN** 引导只追加或更新自身的唯一受管区块，团队原有文本逐字节保留

#### Scenario: 文件中存在有效旧受管区块

- **WHEN** 新的获批接入请求更新引导
- **THEN** 仅该区块被替换，区块外新加入的团队规则不变，相同输入再次应用不增加重复内容

#### Scenario: 受管标记损坏或目标不是安全普通文件

- **WHEN** 引导目标存在重复或不完整标记，或目标及其路径包含不允许写入的目录、符号链接或越界指向
- **THEN** 接入报告具体冲突，不覆盖该文件或外部目标，不把请求标记为 confirmed

### Requirement: 引导安装沿用接入批准与中断恢复边界

Repoctopus MUST 在接入中预先检查引导目标，并在发布新共享配置和完成状态前完成引导写入。中断或写入失败 MUST 保留原批准、已经完成的 Store 与 pointer 事实及团队内容，允许从同一请求安全续接，不重复产生副作用。已确认请求的重放 MUST 保持原有幂等语义；已接入团队补齐或更新引导 MUST 通过现有的重新探测、准备及可信审批入口。

#### Scenario: 写入部分引导文件后中断

- **WHEN** 获批请求在部分引导已写入、接入完成状态尚未保存时退出
- **THEN** 同一请求的重试保留已写入的唯一受管区块，补齐未完成文件后才保存完成状态，不重复登记或改写已完成的 Store 与 pointer

#### Scenario: 写入前文件被并发修改

- **WHEN** 引导目标在规划后、受管写入前发生变化
- **THEN** 接入停止该次写入并保留新内容，报告冲突且不发布新的完成结论

#### Scenario: 已接入团队补齐引导

- **WHEN** 团队以原有共享配置为候选，通过新的 detect、prepare 和 review 请求获批
- **THEN** 接入复用健康规格根与精确 Store 登记，补齐或更新受管引导，不要求删除已有配置、规格或历史 Run

### Requirement: 人与 Agent 的本地引导使用真实工作流接口

Repoctopus MUST 为团队成员提供可移植的本地教程，覆盖安装入口、新成员接入、启动与恢复 Change、审批、共享与本机配置、SigNoz OTLP 地址以及共享文件提交范围。AGENTS 引导 MUST 使用现有公共 CLI 获取同一 Run 的 continuation、领取 Work 和消费真实 Skill 内容，并保持 Runtime 的阶段、能力与审批权威；不得靠指令文件直接授权阶段推进。

#### Scenario: 新 Agent 进入团队 Workspace

- **WHEN** Agent 读取根 AGENTS 且用户提供了待恢复的 Run 身份
- **THEN** 引导使其使用该 Run 的公共状态与恢复入口，按 Runtime 返回的当前 Work 执行，遇到可信人工决定或未知副作用时按返回结果处理
- **AND** 未提供 Run 身份时先核对新建或恢复意图，不虚构不存在的自动探针、枚举命令或阶段状态

#### Scenario: 团队成员在产品源码之外阅读教程

- **WHEN** 成员仅拥有团队 Workspace、业务仓和已安装 CLI
- **THEN** 可以通过 Workspace 的本地链接找到首次任务、恢复和配置说明，不需要读取产品 checkout 或打开产品 README 才能执行基本操作
- **AND** 示例不包含安装机器的绝对路径、发布凭据、Collector Header 值或维护产品源码用的 Comet 自举指令

### Requirement: 获批接入安装 Workspace 工作流入口 Skill

Repoctopus MUST 在项目接入候选中显示支持的宿主及入口安装目标。接入获批后，Repoctopus MUST 在 Workspace 内为批准的宿主安装可发现的 `repoctopus` 入口 Skill，并在报告接入完成前验证安装结果。安装 MUST 限定到受管入口及其资源，不修改用户级 Skill 目录、独立业务仓的宿主配置或其他 Skill。

#### Scenario: 新团队获批接入

- **WHEN** 团队从已安装 CLI 完成包含受支持宿主的单仓或多仓接入
- **THEN** 从 Workspace 打开的对应宿主新会话能发现并显式调用 `repoctopus`，无需执行完整 Skill 目录投影或检出产品源码
- **AND** 多仓接入仅在 Workspace 安装入口，单仓接入在兼任 Workspace 的业务仓安装入口

#### Scenario: 预览或未批准接入

- **WHEN** 接入处于探测、准备、待批准、拒绝或请求修改
- **THEN** 入口路径及管理记录保持原状

### Requirement: 入口安装保留团队文件并可恢复

Repoctopus MUST 在入口写入前校验目标、所有权和已有内容。对同名的非受管 Skill、受管文件的本地修改或不安全路径，Repoctopus MUST 报告可定位冲突、保留原文件且不宣布本次接入完成。重复应用同一获批请求 MUST 幂等；中断后 MUST 能在同一请求上继续并保留已确认的接入事实。

#### Scenario: 已接入团队补齐入口

- **WHEN** 团队用现有共享配置重新准备并批准接入
- **THEN** Repoctopus 补齐入口并复用健康的 Store 和既有登记，不要求重新初始化业务仓或 Run

#### Scenario: 团队已有同名 Skill

- **WHEN** 安装目标由团队维护、存在本地修改或指向不安全位置
- **THEN** Repoctopus 报告冲突路径及解决方式，原内容不变，且不报告接入完成

#### Scenario: 多个安装目标之间中断

- **WHEN** 获批请求已完成部分入口安装，但尚未报告接入完成
- **THEN** 续接同一请求时核对已完成目标，仅补齐剩余目标，并在全部通过校验后报告完成

### Requirement: Verify Profile 可按需独立配置

Repoctopus MUST 提供独立 Verify 配置流程，在用户选定范围内检查实际命令和 Acceptance coverage，展示 Profile 变更，经可信批准后更新共享配置。生成的 required 检查 MUST 明确声明 coverage，推断的 coverage MUST 作为待确认内容。此流程 MUST 保留 Workspace、Store、其他共享配置和既有 Run。

#### Scenario: 初始化后补配 Verify

- **WHEN** 已接入 Workspace 的用户调用 Verify 配置流程
- **THEN** Repoctopus 展示拟用的命令、仓库和覆盖范围
- **AND** 仅获批后更新相关 Profile，返回当前 Run 的继续方式（如有）
