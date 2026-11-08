# 规格归档长路径与执行恢复

## ADDED Requirements

### Requirement: Windows 受管规格归档支持长路径

Repoctopus MUST 在 Git for Windows 支持的文件名与路径范围内完成受管规格 checkout 的创建、观察、清理及规格发布的变更检查、索引和提交，即使 Windows 未开启系统长路径设置且 Git 持久配置未启用长路径；归档自身增加目录层级不得要求用户缩短 Workspace 或 Change 名称。非 Windows 平台 MUST 保持原有 Git 行为。

#### Scenario: 隔离 checkout 的路径超过默认目录边界

- **WHEN** 已冻结的规格树位于合法 Workspace，受管 checkout 增加的目录层级使 Git for Windows 默认路径处理失败
- **THEN** Runtime 使用自身的长路径支持创建 checkout，并继续按同一冻结 OID 进行规格关闭

#### Scenario: 归档文件超过默认完整路径边界

- **WHEN** 主规格同步及 Change 归档后的文件路径超过默认边界，但仍属于受管允许路径且可由底层 Git 和文件系统访问
- **THEN** Runtime 能完成真实索引、提交、普通 push 和精确发布核验，并只在原 Journal 完成后清理 checkout

#### Scenario: 非 Windows 平台执行相同归档

- **WHEN** 相同规格归档在非 Windows 平台执行
- **THEN** Runtime 保持既有 Git 参数语义及发布结果，不要求额外平台设置

### Requirement: 长路径支持不得修改宿主配置与检查契约

Repoctopus MUST 将长路径适配限制在自身管理的规格归档 Git 子进程内，不修改仓库本地、全局、系统 Git 配置或操作系统设置，不污染父进程环境，也不改写 check policy 的精确命令。长路径支持 MUST 保留冻结 OID、允许路径、受管根目录和调用者工作树隔离检查。

#### Scenario: 归档成功或失败后配置保持不变

- **WHEN** 受管规格归档使用长路径支持成功、失败或被中断
- **THEN** 用户的持久 Git 配置、系统设置和父进程环境保持原值，调用者 branch、HEAD 和 index 不因规格提交而改变

#### Scenario: 路径支持不扩大授权

- **WHEN** checkout identity、冻结 OID 或待提交路径不满足原授权约束
- **THEN** Runtime 仍拒绝对应操作，不以长路径支持放行越权 checkout 或提交

#### Scenario: 用户检查命令显式调用 Git

- **WHEN** check policy 指定一个包含 Git 的验证命令
- **THEN** 验证仍使用已派发的精确 argv 和环境契约，不因归档适配被隐式添加 Git 参数或环境覆盖

### Requirement: 归档路径失败沿原交付身份恢复

Repoctopus MUST 在路径操作失败时保留原 Run、有效完成事实、已接受验证证据和已存在的关闭或发布 Journal，不签发虚假完成结果。修复实现经现有组合权威精确采纳后，MUST 从公开 Archive 入口继续采用原冻结交付身份并按现有观察与采纳规则处理已发生的副作用，不通过新建 Run、重复审批或重放已确认发布来绕过失败。

#### Scenario: checkout 创建失败后修复并恢复

- **WHEN** 路径失败发生在规格关闭及远端发布之前，且修复后原冻结输入仍有效
- **THEN** 同一 Run 可从公开入口继续，保留原工作包和 Verify 证据，不伪造失败时尚不存在的 Closure 或 Publication Receipt

#### Scenario: 已提交或部分发布后重新进入

- **WHEN** 恢复的 Journal 已保存规格提交或部分远端发布事实
- **THEN** Runtime 先核验并采用精确匹配结果，只执行尚未确认的步骤，不重复创建 commit、业务 MR 或规格 MR

#### Scenario: 底层仍无法处理路径

- **WHEN** 底层工具或文件系统仍拒绝路径，或原冻结输入已经漂移
- **THEN** Runtime 保留失败与已发生的副作用，返回可操作诊断，不报告归档完成、不自动更改用户配置或选择新发布身份

### Requirement: Archive 执行组合与冻结交付来源分离

Runtime MUST 由既有组合兼容性权威决定当前实现能否接续 Archive，并在受保护副作用入口核对已采纳 Run 与实际执行组合一致。冻结 Archive 来源、原审批、Verify Input、Bundle 和 Journal MUST 保留原身份，不得以历史来源摘要要求当前实现完全相同，也不得用未经 Runtime 核验的当前摘要、Host 声明或人工重复审批替代兼容性证明。

#### Scenario: 受保护实现兼容更新后继续原归档

- **WHEN** Archive 已冻结输入，新的 Runtime 或 Delivery 实现精确匹配允许的前驱且状态、配置、authority 和当前 checkpoint 契约兼容
- **THEN** Runtime 记录既有组合采纳事实，保留原规划审批、完成工作包、验证证据、Archive 输入和发布身份，经公开入口继续关闭及发布；不重跑无变化的 Verify 或追加相同审批

#### Scenario: 当前关闭 Work 尚未调用发布端口

- **WHEN** 当前 Work 是规格关闭，但同一已冻结 Archive 还依赖后续受保护 Delivery 发布实现
- **THEN** Runtime 在采纳与副作用前检查这组真实 Archive 执行依赖，不因当前 Work 的 capability 名称与插件 authority 名称不同而漏掉发布实现；不兼容时先阻断

#### Scenario: 执行入口使用伪造或过期组合

- **WHEN** 调用方提交自述的兼容结论、另一 Run 的执行上下文，或已观察组合在副作用前再次改变
- **THEN** Runtime 在任何受管 checkout 写入、commit、push 或 MR 创建前拒绝执行，不覆盖原输入或执行未知结果的盲重试

#### Scenario: 真实交付输入发生漂移

- **WHEN** 规划语义、仓库身份、精确 OID、发布集合、策略或证据实际依赖发生变化
- **THEN** Runtime 继续执行现有依赖校验与恢复规则，不能因实现兼容而忽略漂移或扩大交付授权

#### Scenario: 发布部分完成后兼容接续

- **WHEN** 已有规格关闭、提交、push 或 MR 事实，而兼容更新后重新进入 Archive
- **THEN** Runtime 沿同一 Journal 先观察并采用匹配结果，不重新创建已确认项；结果未知仍保持观察或协调，不由兼容采纳赋予重放权限
