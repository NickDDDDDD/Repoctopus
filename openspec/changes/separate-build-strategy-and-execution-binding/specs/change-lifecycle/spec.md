# change-lifecycle Delta

## MODIFIED Requirements

### Requirement: Build Configuration 只允许受支持的固定策略

Repoctopus MUST 把 Build 的稳定人类/团队语义建模为版本化 `BuildStrategy`，仅允许 `executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard` 和 `isolationIntent=current|branch|worktree`。Design Human Decision MUST 绑定完整 Strategy semantic digest，但不得把实际 Skill composition 的代码、版本或配置身份并入批准摘要；Build Configure MUST 只解析和验证独立 `ExecutionBinding`，不得因兼容 Host 更换、能力重探测、正常 HEAD 变化、同 isolation 下修复 checkout、兼容 composition adoption、进程恢复或同摘要返工而重复请求批准。

#### Scenario: 用户批准受支持的配置

- **WHEN** Runtime 根据已批准 Open、仓库拓扑、Tasks 和用户选择提出合法 BuildStrategy，当前 composition 能兼容执行该策略，且可信用户批准 Design 语义摘要
- **THEN** Run 固定 Strategy identity/digest，后续 Configure、Plan、Work、Check 和遥测都引用该 Strategy，不再创建常规 Build Configuration approval

#### Scenario: 兼容 Host 或 checkout 变化

- **WHEN** 恢复时 Host 或本地 checkout 变化，但 capability、isolation intent、repository ownership 和全部 Strategy 语义仍满足
- **THEN** Runtime 重新验证并冻结新的 ExecutionBinding，使依赖旧输入的 Plan/Evidence 失效，但复用已批准 Strategy且不建立新 Human Decision

#### Scenario: 实际隔离没有可信 binding

- **WHEN** Runner 或 Host 只声明 isolation 名称，但没有为受影响仓库提供可验证 checkout、branch、head、worktree ownership 与 Workspace facts
- **THEN** Build Configure 阻断并报告 ExecutionBinding 诊断，不从路径或当前进程目录猜测，也不要求用户批准无法验证的机器事实

#### Scenario: 请求 Hotfix profile

- **WHEN** 调用方请求 Hotfix、Tweak 或任一未声明 workflow profile
- **THEN** Runtime 拒绝请求并保持唯一完整 Change lifecycle，不把 profile 映射成隐藏快捷路径

#### Scenario: 批准后请求切换执行模式

- **WHEN** 已批准 Strategy 的 execution/TDD/isolation 语义被显式改变
- **THEN** Runtime 使旧 Strategy approval 失效并建立绑定新语义摘要的 Human Decision，不静默重写或把机器 binding 重验冒充策略批准

#### Scenario: direct TDD 模式执行任务

- **WHEN** Strategy 选择 `tddMode=direct`
- **THEN** Work 可以不强制逐任务先红后绿，但仍必须声明相关测试、执行回归检查并通过 Build Check 与 Verify

## ADDED Requirements

### Requirement: Build 策略只在语义改变时请求人工决定

Repoctopus MUST 以 `decisionKind + semanticDigest` 判定 Human Decision 的创建、复用和失效。正常 Change 固定保留 Open 与 Design 两个审查边界；Design approval 绑定 BuildStrategy，但实际 Skill composition identity 只能由独立 compatibility authority 处理。相同摘要的重试、re-entry、恢复、兼容 composition adoption 和机器事实变化 MUST NOT 产生重复待处理请求。

#### Scenario: 同摘要返工重新进入 Build

- **WHEN** Verify finding 返回 Build，Strategy 摘要未改变且当前 composition 与既有 checkpoint 兼容
- **THEN** Runtime 复用原批准并从 Plan revision/ExecutionBinding 验证继续，不创建新的配置确认
