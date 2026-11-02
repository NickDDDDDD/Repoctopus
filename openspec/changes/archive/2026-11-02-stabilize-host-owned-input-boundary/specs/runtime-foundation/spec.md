# runtime-foundation Specification Delta

## ADDED Requirements

### Requirement: Host 安装面与产品面必须以所有权隔离

Repoctopus MUST 允许外部 Host 的未跟踪本地安装文件存在于开发仓库，但 MUST 以版本化 policy、Git 跟踪身份、生产源码边界和发布包边界证明这些文件不属于产品；影响执行的 Host 文件 MUST 进入内容寻址的控制面身份，不得因本地存在而被误判为产品采用，也不得被无痕忽略。

#### Scenario: 已登记 Host 目录在验证期间存在

- **WHEN** 本地 `.codex`、`.agents` 或等价 Host 安装路径未被 Git 跟踪、未进入发布包，且匹配当前 composition 的受限 input policy
- **THEN** 架构检查允许其保持原位，同时 Evidence 把影响执行的内容绑定到 control-plane manifest

#### Scenario: 产品提交旧工作流目录

- **WHEN** external-exclusive Host 路径被 Git 跟踪，或任意未登记 Host 内容由生产源码引用、被能力账本覆盖或意外进入发布包
- **THEN** 架构检查失败并报告产品/控制面所有权冲突，即使本机也安装了同名 Host

#### Scenario: 团队版本化双用途 Agent 指令

- **WHEN** `AGENTS.md`、团队 Skill 或等价双用途路径被 Git 跟踪且不违反产品能力、来源和发布边界
- **THEN** 该文件按产品输入验证，控制面规则不把它从 repository fingerprint 中排除

#### Scenario: Host rule 未登记新路径

- **WHEN** 外部 Host 生成一个不属于既有 Runtime ignore 且未被当前 policy 接纳的路径
- **THEN** 该路径保持普通未知仓库输入，不能仅凭 Host 品牌或父目录自动取得控制面所有权

### Requirement: Host 输入策略必须绑定 composition 身份

提供 Repository Input Policy 的 Host integration Contributor MUST 以稳定 id、version、代码摘要和配置摘要进入 composition；Run 恢复、Evidence 接受和规格关闭 MUST 同时核对 Provider identity 与实际 control-plane manifest。

#### Scenario: Host policy 在 Run 中途变化

- **WHEN** Provider 版本、规则或配置摘要在活动 Run 恢复时改变
- **THEN** Runtime 按现有 composition 漂移规则阻断或要求显式兼容决定，不使用新策略重新解释旧 Evidence

#### Scenario: Host 文件内容单独变化

- **WHEN** Provider identity 不变但 Hook、Agent 指令、Skill 或锁文件内容改变
- **THEN** composition 仍表示同一 Provider，而 Verification Input 因 control-plane manifest digest 变化而失效

## MODIFIED Requirements

### Requirement: 能力来源和旧工作流隔离可机器检查

Repoctopus MUST 为全部生产源码声明唯一能力归属和采用方式，登记从 Comet 复制、实质改写或行为重建的边界，并拒绝旧 `agents-workspace` 的 Hook、Skill、阶段常量、批准口令、客户端配置和项目专有路径进入 Git 跟踪产品面、生产源码或发布包；未跟踪且由当前 Host policy 接纳的本地执行文件 MAY 存在，但其影响执行的内容 MUST 进入控制面输入身份。

#### Scenario: 新增生产模块没有能力归属

- **WHEN** `app`、`domains` 或 `platform` 出现未被能力账本唯一覆盖的源码
- **THEN** 架构检查失败并报告缺失或冲突的能力归属

#### Scenario: 旧工作流文件或口令被复制

- **WHEN** Git 跟踪产品路径、生产源码或发布包出现旧 Hook、旧阶段常量、中文动作批准口令或旧模板配置路径
- **THEN** 架构检查失败并定位文件、路径和冲突的所有权

#### Scenario: 外部 Host 安装未跟踪执行文件

- **WHEN** 本地路径未被 Git 跟踪、未被生产代码依赖、未进入发布包并匹配版本化 Host input policy
- **THEN** 架构检查不因物理路径存在而失败，Evidence 仍以 control-plane manifest 绑定其执行身份
