## MODIFIED Requirements

### Requirement: Build Configuration 只允许受支持的固定策略

Repoctopus MUST把Build的稳定人类/团队语义建模为版本化`BuildStrategy`，仅允许`executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard`和`isolationIntent=current|branch|worktree`。Design Human Decision MUST展示Host结合当前场景提出的完整策略、来源与理由，并绑定完整Strategy semantic digest；Build Configure MUST只解析和验证独立ExecutionBinding。Runtime不得因合法Work间required capabilities不同、当前Work暂无兼容Host、进程恢复或同摘要返工而重建Binding或重复请求批准。只有Strategy语义、coordinator Host identity或Binding-owned Workspace facts变化时才能按对应权威失效。

#### Scenario: 兼容Host执行不同Build Action

- **WHEN** 同一coordinator Host依次为Configure、Plan、Execute和Check声明各自Work所需能力，Strategy和Workspace Binding未改变
- **THEN** Runtime保持同一Strategy和ExecutionBinding，逐Work完成claim preflight，不创建额外Human Decision或Configure Work

#### Scenario: 用户批准受支持的配置

- **WHEN** Host根据已批准Open、Design、Tasks、可核对能力和用户偏好提出合法BuildStrategy，当前composition兼容该策略，且可信用户批准Design语义摘要
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

## ADDED Requirements

### Requirement: 未指定的启动偏好不得成为已批准策略

Repoctopus MUST 区分执行模式与 TDD 的明确启动偏好、未指定值、Host 建议和可信批准。缺少任一偏好的新 Run MUST 可以正常完成 Open，并在 Design 决定前补齐建议。默认值、历史 Run、CLI 成功或启动参数本身 MUST NOT 形成 Strategy approval；新请求中的非法值 MUST 在写入 Run 前被拒绝。

#### Scenario: 两个配置均未指定

- **WHEN** 用户通过入口 Skill 或公开 CLI 启动新 Change，没有选择执行模式和 TDD
- **THEN** Runtime 保留两个未指定事实并正常进入 Open，在完成 Design 前要求形成可审查策略，不静默把 `autonomous + tdd` 冻结为用户选择

#### Scenario: 只指定其中一个配置

- **WHEN** 本次启动明确选择了 TDD，但未选择执行模式，或反之
- **THEN** 系统保留明确偏好的来源，仅为缺项生成建议；如建议改变已有偏好，Host 展示差异并取得当前 Design 决定，不以另一项默认值覆盖用户意图

#### Scenario: 明确指定完整配置

- **WHEN** 用户提供受支持的完整执行模式与 TDD 偏好
- **THEN** Design 展示该选择与能力约束，当前可信 Design approval 同时批准该策略，后续 Configure 不重复请求相同配置批准

#### Scenario: 非法启动值

- **WHEN** 启动请求携带未声明的 execution 或 TDD 值
- **THEN** Runtime 返回可定位的参数诊断，且不为该请求创建新 Run 或 Work

### Requirement: 场景建议与策略授权保持可核对且可恢复

Repoctopus MUST 在 Design 决定中展示最终 execution mode、TDD mode、建议理由、明确偏好来源和已知能力限制。Runtime MUST 校验当前提案与决定身份，将策略授权与 Design 授权原子绑定；不完整、陈旧或不属于当前请求的答复不得进入 Build。相同语义的恢复 MUST 复用当前提案或已接受决定，不因建议措辞、进程、Git 提交或任务完成复选框变化重复批准。

#### Scenario: 首次批准可执行配置

- **WHEN** 当前 Design 与完整合法策略通过校验，且可信用户批准展示的同一提案
- **THEN** Runtime 记录同一 Run 的规划授权与策略语义身份，后续按 Configure、Plan、Execute、Check 推进，不增加常规配置决定

#### Scenario: 当前宿主缺少多 Agent 能力

- **WHEN** 配置选择多 Agent，但当前尚无满足所需委派证明的宿主
- **THEN** Runtime 阻断需要该能力的执行并说明缺项，保留有效策略与原 Run，允许兼容宿主继续，不静默降为 autonomous，也不把能力缺席伪装成用户改选

#### Scenario: 显式修改已批准策略

- **WHEN** 用户明确改变 execution 或 TDD 选择，使策略语义摘要变化
- **THEN** Runtime 沿现有策略变更决定和依赖失效路径处理，不复用旧答复授权新选择，也不允许 Host 直接修改 phase 或冻结事实

#### Scenario: 决定响应丢失后冷恢复

- **WHEN** 当前决定已接受但客户端没有收到响应，新进程恢复同一 Run
- **THEN** 系统返回原接受事实及合法后继，Strategy、审批次数和有效完成事实不被重复创建
