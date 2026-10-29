# change-lifecycle Delta

## MODIFIED Requirements

### Requirement: Build Configuration 只允许受支持的固定策略

Repoctopus MUST 把 Build 的稳定人类/团队语义建模为版本化 `BuildStrategy`，仅允许 `executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard`、`isolationIntent=current|branch|worktree` 和冻结的团队 Skill composition identity。Design Human Decision MUST 绑定完整 Strategy semantic digest；Build Configure MUST 只解析和验证独立 `ExecutionBinding`，不得因兼容 Host 更换、能力重探测、正常 HEAD 变化、同 isolation 下修复 checkout、进程恢复或同摘要返工而重复请求批准。Repoctopus MUST NOT 提供 Hotfix、Tweak、Direct execution、Executing Plans、review off/thorough 或运行中模式切换；`tddMode=direct` 只放宽 RED/GREEN 顺序，不得绕过相关测试、Build Check 或 Verify。

#### Scenario: 用户批准受支持的配置

- **WHEN** Runtime 根据已批准 Open、仓库拓扑、Tasks、团队 composition 和用户选择提出合法 BuildStrategy，且可信用户批准 Design 语义摘要
- **THEN** Run 固定 Strategy identity/digest，后续 Configure、Plan、Work、Check 和遥测都引用该 Strategy，不再创建常规 Build Configuration approval

#### Scenario: 实际隔离没有可信 binding

- **WHEN** Runner 或 Host 只声明 isolation 名称，但没有为受影响仓库提供可验证 checkout、branch、head、worktree ownership 与 Workspace facts
- **THEN** Build Configure 阻断并报告 ExecutionBinding 诊断，不从路径或当前进程目录猜测，也不要求用户批准一个无法验证的机器事实

#### Scenario: 兼容 Host 或 checkout 变化

- **WHEN** 恢复时 Host 或本地 checkout 变化，但 capability、isolation intent、repository ownership 和全部 Strategy 语义仍满足
- **THEN** Runtime 重新验证并冻结新的 ExecutionBinding，使依赖旧输入的 Plan/Evidence 失效，但复用已批准 Strategy 且不建立新 Human Decision

#### Scenario: 请求 Hotfix profile

- **WHEN** 调用方请求 Hotfix、Tweak 或任一未声明 workflow profile
- **THEN** Runtime 拒绝请求并保持唯一完整 Change lifecycle，不把 profile 映射成隐藏快捷路径

#### Scenario: 批准后请求切换执行模式

- **WHEN** 已批准 Strategy 为 autonomous，而用户显式请求切换为 subagent-driven-development，或反向切换
- **THEN** Runtime 使旧 Strategy approval 失效并建立绑定新语义摘要的 Human Decision，不静默重写或把机器 binding 重验冒充策略批准

#### Scenario: direct TDD 模式执行任务

- **WHEN** Strategy 选择 `tddMode=direct`
- **THEN** Work 可以不强制逐任务先红后绿，但仍必须声明相关测试、执行回归检查并通过 Build Check 与 Verify

## ADDED Requirements

### Requirement: Build 策略只在语义改变时请求人工决定

Repoctopus MUST 以 `decisionKind + semanticDigest` 判定 Human Decision 的创建、复用和失效。正常 Change 固定保留 Open 与 Design 两个审查边界；Design approval 同时绑定 BuildStrategy 与 effective skill composition。只有必需策略字段未知、用户显式改变已批准语义、团队 binding 语义变化、definition 风险策略命中高风险计划、外部授权或未知副作用时，Runtime 才 MAY 建立额外决定。相同摘要的重试、re-entry、恢复和机器事实变化 MUST NOT 产生重复待处理请求。

#### Scenario: 用户已明确全部策略

- **WHEN** Open/Design 输入已包含合法 execution、TDD、review、isolation 选择且团队 composition 已编译
- **THEN** Runtime 把完整 Strategy 摘要纳入 Design approval，不在 Build Configure 再询问相同选择

#### Scenario: 同摘要返工重新进入 Build

- **WHEN** Verify finding 返回 Build，而 Strategy 和 effective composition 摘要均未改变
- **THEN** Runtime 复用原批准并从 Plan revision/ExecutionBinding 验证继续，不创建新的配置确认

#### Scenario: 团队 binding 语义改变

- **WHEN** Design approval 后 required check 或 augmentation replacement 使 effective composition digest 改变且无法证明兼容
- **THEN** Runtime 停止副作用、使旧 Strategy decision 失效并说明需要重新审查的方法语义

#### Scenario: 高风险 Plan 命中暂停规则

- **WHEN** Plan Evidence 命中 definition 声明的跨仓不可逆或高风险副作用条件
- **THEN** Runtime 建立绑定 Strategy、Plan 和风险分类的可选决定；低风险计划不得创建虚假人工暂停
