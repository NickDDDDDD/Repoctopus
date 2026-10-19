# project-configuration Specification

## Purpose

定义 Repoctopus 如何发现、确认和加载可移植的团队项目配置，同时隔离本机路径差异并防止本地覆盖削弱共享验证策略。

## Requirements

### Requirement: 团队规则使用共享项目配置

Repoctopus MUST 从 Git 跟踪的 `repoctopus.yaml` 加载仓库身份、Evidence Profile、命令、服务、健康检查、浏览器 Journey、必需检查和保留策略，并使用版本化 Schema 校验全部字段。

#### Scenario: 团队成员加载同一配置

- **WHEN** 两名成员在不同父目录检出同一项目并加载有效共享配置
- **THEN** Runtime 解析出相同逻辑仓库、Profile、依赖关系和门禁规则

#### Scenario: 共享配置缺少必需字段

- **WHEN** Profile 缺少版本、仓库 identity 或必需检查定义
- **THEN** Runtime 返回可定位配置诊断且不启动 Evidence Run

### Requirement: 本机覆盖不得削弱团队门禁

Repoctopus MUST 只允许被忽略的 `.repoctopus/local.yaml` 覆盖机器路径、端口、浏览器位置、视觉反馈交换目录和资源限制，不得删除必需检查、改变证据可信等级或把阻断规则降级为警告。

#### Scenario: 成员手动配置仓库绝对路径

- **WHEN** 本机覆盖把逻辑仓库 identity 映射到一个可验证 Git 工作树
- **THEN** Runtime 使用该路径运行 Profile，同时只在本地状态中保存解析后的绝对路径

#### Scenario: 本机覆盖试图删除必需检查

- **WHEN** 本机覆盖把共享配置中的必需检查设为可选或禁用
- **THEN** 配置合并失败并指出被禁止的覆盖路径

### Requirement: 项目探测只生成候选草稿

`project detect` MUST 只读扫描显式作用域内的仓库和常见构建文件，把候选配置写入 `.repoctopus/drafts/`，不得直接创建或覆盖正式共享配置。

#### Scenario: 首次探测项目

- **WHEN** 工作区尚无 `repoctopus.yaml`
- **THEN** 命令生成带来源和不确定项的候选草稿，并提示由 Agent 补全后交给用户确认

#### Scenario: 已存在共享配置

- **WHEN** 探测结果与当前 `repoctopus.yaml` 不同
- **THEN** 命令输出 reconcile diff 且保持正式配置不变

### Requirement: 用户确认后才能写入共享配置

Repoctopus MUST 把候选配置、Agent 补全内容和现有配置差异作为 Human Decision 输入，只有可信用户确认后才允许生成或更新 `repoctopus.yaml`。

#### Scenario: 没有可信确认通道

- **WHEN** Agent 已补全候选配置但 Runtime 无法获得可信用户决定
- **THEN** 草稿保持待确认状态且正式配置不变

### Requirement: 有效配置具有稳定摘要

Repoctopus MUST 对规范化共享配置和允许的本机覆盖分别计算摘要，并把两者绑定到 Evidence 输入指纹；键顺序或平台路径分隔符差异不得改变语义相同配置的摘要。

#### Scenario: 本机端口覆盖变化

- **WHEN** 成员修改 Evidence Run 使用的端口覆盖
- **THEN** 新运行产生不同有效配置摘要且旧 Evidence 不再满足当前 Profile
