# change-lifecycle Delta

## MODIFIED Requirements

### Requirement: Build Configuration 只允许受支持的固定策略

Repoctopus MUST把Build的稳定人类/团队语义建模为版本化`BuildStrategy`，仅允许`executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard`和`isolationIntent=current|branch|worktree`。Design Human Decision MUST绑定完整Strategy semantic digest；Build Configure MUST只解析和验证独立ExecutionBinding。Runtime不得因合法Work间required capabilities不同、当前Work暂无兼容Host、进程恢复或同摘要返工而重建Binding或重复请求批准。只有Strategy语义、coordinator Host identity或Binding-owned Workspace facts变化时才能按对应权威失效。

#### Scenario: 兼容Host执行不同Build Action

- **WHEN** 同一coordinator Host依次为Configure、Plan、Execute和Check声明各自Work所需能力，Strategy和Workspace Binding未改变
- **THEN** Runtime保持同一Strategy和ExecutionBinding，逐Work完成claim preflight，不创建额外Human Decision或Configure Work

#### Scenario: 用户批准受支持的配置

- **WHEN** Runtime根据已批准Open、仓库拓扑、Tasks和用户选择提出合法BuildStrategy，当前composition兼容该策略，且可信用户批准Design语义摘要
- **THEN** Run固定Strategy identity/digest，后续Configure、Plan、Work、Check和遥测都引用该Strategy，不再创建常规Build Configuration approval

#### Scenario: 兼容 Host 或 checkout 变化

- **WHEN** 恢复时coordinator Host identity或本地checkout变化，但isolation intent、repository ownership和全部Strategy语义仍满足
- **THEN** Runtime重新验证并冻结新的ExecutionBinding，使依赖旧Binding-owned输入的Plan/Evidence失效，但复用已批准Strategy且不建立新Human Decision

#### Scenario: 实际隔离没有可信 binding

- **WHEN** Runner或Host只声明isolation名称，但没有为受影响仓库提供可验证checkout、branch、head、worktree ownership与Workspace facts
- **THEN** Build Configure阻断并报告ExecutionBinding诊断，不从路径或当前进程目录猜测，也不要求用户批准无法验证的机器事实

#### Scenario: 请求 Hotfix profile

- **WHEN** 调用方请求Hotfix、Tweak或任一未声明workflow profile
- **THEN** Runtime拒绝请求并保持唯一完整Change lifecycle，不把profile映射成隐藏快捷路径

#### Scenario: 批准后请求切换执行模式

- **WHEN** 已批准Strategy的execution/TDD/isolation语义被显式改变
- **THEN** Runtime使旧Strategy approval失效并建立绑定新语义摘要的Human Decision，不静默重写或把机器Binding重验冒充策略批准

#### Scenario: direct TDD 模式执行任务

- **WHEN** Strategy选择`tddMode=direct`
- **THEN** Work可以不强制逐任务先红后绿，但仍必须声明相关测试、执行回归检查并通过Build Check与Verify

#### Scenario: 当前Work缺少兼容Host

- **WHEN** Strategy和ExecutionBinding仍有效，但没有Host声明当前Work的完整capabilities
- **THEN** Runtime保持当前phase、Work和checkEpoch并返回结构化blocked continuation；它不得把Host availability误分类为Strategy或Binding变化

#### Scenario: 协调Host或Workspace事实变化

- **WHEN** coordinator Host identity、repository topology、branch/worktree ownership、isolation或local overlay与当前Binding不一致
- **THEN** Runtime派发唯一Build Configure revalidation并精确失效依赖旧Binding的后继事实，不重放旧Host Outcome
