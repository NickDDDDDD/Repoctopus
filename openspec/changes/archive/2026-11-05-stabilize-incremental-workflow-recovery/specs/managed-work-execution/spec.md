# managed-work-execution Delta

## MODIFIED Requirements

### Requirement: Host 只能报告发现而不能选择阶段

Repoctopus MUST 让 Host Outcome 只表达当前 Work 的结果、产物、工具事实、受影响 Requirement/Task/Package identities与 definition允许的有界事实分类；Outcome schema MUST NOT接受`targetPhase`、恢复动作、任意 continuation或伪造Human Decision。Runtime MUST独立读取当前权威与checkpoint、验证finding关联和事实后选择下一Action；Host finding名称本身不得等价于Design、Build、Verify或Archive转换。

#### Scenario: Host 报告设计假设无效

- **WHEN** Build Host提交绑定当前Work、Requirement和Task的设计冲突事实
- **THEN** Runtime重新观察当前规格与批准身份；只有其证明批准设计语义无效时才选择`revise-design`，否则按Plan、实现或Evidence层处理

#### Scenario: Host 指定目标 phase

- **WHEN** Host Outcome或调用方字段尝试指定phase、`revise-design`、`revise-plan`、`continue-build`、`invalidate-evidence`或done
- **THEN** Runtime拒绝该Outcome并记录协议错误，不据此修改lifecycle或失效任何checkpoint

#### Scenario: 普通 Build 失败重复发生

- **WHEN** 同一逻辑 Build Work连续返回可重试 implementation failure且当前输入仍有效
- **THEN** Runtime仅按有界retry policy选择`continue-build`并创建后续attempt；达到上限时进入稳定blocked/Human Decision，不无限重派、不重建Plan或创建另一Run

## ADDED Requirements

### Requirement: Finding 必须先验证再形成恢复处置

Runtime MUST 验证每个 Host finding 的 schema、分类、Requirement/Task/Package关联、当前Work输入和可观察证据，并把通过验证的事实规范化为稳定 finding identity。未知引用、互相矛盾的分类或无法证明影响层级的 finding MUST fail closed，不能自动升级为 Design返工。

#### Scenario: Plan finding 引用当前 Work Package

- **WHEN** finding证明当前包的依赖、顺序、测试切面或命令形态不可执行，且引用的Task与Requirement均属于已批准范围
- **THEN** Runtime把它分类到Plan层并选择`revise-plan`，保留Design approval与不受影响的package completion

#### Scenario: Finding 引用未知 Requirement

- **WHEN** Host提交的Requirement、Task或Package identity不属于当前批准规划或当前Build Plan
- **THEN** Runtime拒绝submission并保持当前Work可纠正，不创建Design Human Decision或Plan revision

#### Scenario: 无法确定事实影响层级

- **WHEN** finding只有自由文本且没有足够的身份或证据证明受影响权威
- **THEN** Runtime保持blocked并请求可核对事实或Human Decision，不默认回到Design

### Requirement: Continue Build 保留当前执行身份

`continue-build` MUST 沿用当前Work、Plan revision、packet、claim、Host invocation与已提交结果的审计链，只创建definition允许的下一attempt或重新派发同一未确认attempt。已经确定执行过且结果未知的副作用 MUST 先reconcile；旧candidate不得作为新attempt结果重放。

#### Scenario: Host 在提交结果前退出

- **WHEN** Runtime能证明副作用未执行或当前Work是无副作用计算，且Plan与Work input仍有效
- **THEN** Runtime选择`continue-build`并按同一Work identity恢复，不创建新的Plan或Design Work

#### Scenario: Submission 被 Validator 拒绝

- **WHEN** Host submission已持久化但因输出schema或候选内容不合法被拒绝
- **THEN** Runtime保留claim、packet、invocation、submission与rejection，继续当前Work的纠正attempt，不把拒绝冒充Planning语义变化

#### Scenario: 外部结果未知

- **WHEN** Work可能已经执行不可重放的外部副作用但没有确定Receipt
- **THEN** Runtime选择reconcile而不是`continue-build`，直到结果被观察为executed或not-executed

### Requirement: Plan Evidence 必须证明每个 Package 可独立完成

Plan Validator MUST 在Execute前证明每个required Work Package都能在自身边界内产出其Validator要求的完整Outcome与Evidence。TDD策略下，每个可完成Package MUST拥有同一行为切片的失败基线、实现结果、转绿结果与相关回归证据，除非definition显式把多个步骤建模为一个不可分割Package；不得把RED和GREEN拆到彼此可以独立完成的不同Package。

#### Scenario: RED 与实现被拆成两个可完成 Package

- **WHEN** TDD Build Plan让一个Package只产生失败测试，另一个Package才实现并转绿，而前者仍声明可独立完成
- **THEN** Plan Evidence在派发Execute前拒绝该计划并返回Plan finding，不等到Package completion才失败或返回Design

#### Scenario: 一个 Package 覆盖完整 TDD 切片

- **WHEN** Package为同一行为保存RED、实现、GREEN和相关回归命令，且其依赖与write scope合法
- **THEN** Plan Evidence可以接受该Package并允许Runtime创建Execute Work

#### Scenario: Direct TDD 模式

- **WHEN** 已批准Strategy使用`tddMode=direct`
- **THEN** Plan Validator不要求RED证据，但仍要求实现结果、相关检查、回归Evidence和可完成的Validator合同

### Requirement: Plan revision 只在授权范围扩大时请求决定

Runtime MUST自动接受仍处于已批准Task、仓库、write scope、风险和外部副作用授权包络内的确定性Plan revision；包络扩大、风险升级或影响范围无法证明时才建立Human Decision。Plan digest、包数量、执行顺序或测试命令变化本身不得触发重复批准。

#### Scenario: 调整同一范围内的测试切面

- **WHEN** 修订只合并TDD Package、调整依赖或更换等价检查命令，且没有扩大仓库、write scope、风险与副作用
- **THEN** Runtime验证新Plan Evidence后继续Build，不建立新的配置或Plan批准Wait

#### Scenario: 修订扩大可写仓库

- **WHEN** 新Plan请求原批准包络之外的repository或write scope
- **THEN** Runtime阻断自动接受并建立绑定增量授权的Human Decision，不以旧批准覆盖新增权限
