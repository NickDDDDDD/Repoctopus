# change-lifecycle Specification Delta

## ADDED Requirements

### Requirement: Build 使用固定的受管内部协议

Repoctopus MUST 在唯一的 Build phase 内按 `Configure → Plan → Plan Evidence → Execute → Check` 推进受管工作，并仅在 Check 接受当前输入后请求进入 Verify。上述步骤 MUST 是 Runtime definition 中可恢复、可审计的 Action，而不是新增 lifecycle phase；调用方与 Host 不得跳步、选择下一步或用最终代码状态补写缺失步骤。

#### Scenario: 首次进入 Build

- **WHEN** Design approval 有效且 Runtime 准备开始实现
- **THEN** 下一 Action 是 Build Configure；Runtime 在配置获得可信批准前不得创建可执行实现 Work

#### Scenario: 调用方请求跳过计划

- **WHEN** Agent 或 Runner 请求从 Build Configure 直接执行代码，或从 Execute 直接进入 Verify
- **THEN** Runtime 拒绝请求并返回固定协议中尚未满足的 Action、Validator 或 Evidence

#### Scenario: Build Check 发现实现失败

- **WHEN** 当前计划的实现 Work 已完成但 Build Check 不接受结果
- **THEN** Runtime 在同一 Build phase 中使相关 Check 失效并回到 Plan revision 或 Execute，不创建新 phase 或替代 Run

### Requirement: Build Configuration 只允许受支持的固定策略

Build Configure MUST 生成并冻结版本化配置，且本版本仅允许 `executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard` 与 `isolation=current|branch|worktree`。Repoctopus MUST NOT 提供 Hotfix、Tweak、Direct execution、Executing Plans、review off/thorough 或运行中模式切换；`tddMode=direct` 只放宽 RED/GREEN 顺序，不得绕过相关测试、Build Check 或 Verify。

#### Scenario: 用户批准受支持的配置

- **WHEN** Runtime 根据仓库拓扑、任务依赖、Host 能力和用户选择提出合法 Build Configuration，且可信用户批准其语义摘要
- **THEN** Run 固定配置 identity 与 digest，后续 Plan、Work、Check 和遥测都必须引用该配置

#### Scenario: 请求 Hotfix profile

- **WHEN** 调用方请求 Hotfix、Tweak 或任一未声明 workflow profile
- **THEN** Runtime 拒绝请求并保持唯一完整 Change lifecycle，不把 profile 映射成隐藏的快捷路径

#### Scenario: 批准后请求切换执行模式

- **WHEN** 已批准配置为 autonomous，而 Agent 请求在当前 Run 中切换为 subagent-driven-development，或反向切换
- **THEN** Runtime 拒绝切换并建立 Human Decision 或要求以新的普通 Change 表达，不静默重写当前配置

#### Scenario: direct TDD 模式执行任务

- **WHEN** 配置选择 `tddMode=direct`
- **THEN** Work 可以不强制逐任务先红后绿，但仍必须声明相关测试、执行回归检查并通过 Build Check 与 Verify

### Requirement: Verify 失败通过 Build Plan revision 返工

当 Verify 接受实现缺陷时，Runtime MUST 在同一 Run 记录失败 Evidence、递增 `checkEpoch`、返回 Build Plan revision，并由修订计划产生普通 Execute Work 和新的 Check。Runtime MUST 保留仍有效的 OpenSpec Task completion 与 Work Evidence，只使受影响输入失效；不得重新打开 Task、创建 Repair lifecycle、特殊 `implementation.repair` Work kind 或并行修复权威。

#### Scenario: 缺陷只影响一个工作包

- **WHEN** Verify finding 可追溯到一个 Work Package 且不改变批准规格或 Task 语义
- **THEN** Plan revision 只替换受影响包及其依赖的 Evidence，并保留其他已接受 Task completion

#### Scenario: 缺陷改变设计语义

- **WHEN** Verify finding 证明批准设计或 Task 语义本身无效
- **THEN** Runtime 按既有语义漂移规则返回 Design，而不是把设计修改伪装成 Build repair

#### Scenario: 无法确定最小影响范围

- **WHEN** finding 缺少 requirement、Task 或 Work Package 关联，Runtime 无法安全计算返工范围
- **THEN** Runtime 建立 Human Decision 或使用 definition 声明的保守 plan invalidation，并记录依据
