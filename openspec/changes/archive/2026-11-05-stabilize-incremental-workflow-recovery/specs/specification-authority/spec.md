# specification-authority Delta

## ADDED Requirements

### Requirement: Task Requirement 映射必须在规划批准前解析

Specification Provider MUST 在Open与Design严格校验中把每个Task和Acceptance的Requirement metadata解析为规范化稳定引用，并确认引用存在于当前主规格或change delta。Provider MUST拒绝歧义分隔、空引用、重复冲突与未知Requirement；Runtime、Build Plan和Host不得重新解析自由文本或在Build阶段猜测映射。

#### Scenario: 多个 Requirement 使用受支持分隔符

- **WHEN** Tasks用Provider声明的逗号、分号或对应全角形式列出多个Requirement引用
- **THEN** Provider规范化为有序、去重的独立引用并为每个引用解析稳定Requirement identity

#### Scenario: 未知 Requirement 引用

- **WHEN** Task metadata引用当前主规格与delta均不存在的Requirement
- **THEN** Open或Design严格校验失败并定位Task与原始token，不创建Human Decision、Build Plan或Evidence Attempt

#### Scenario: 映射文本存在歧义

- **WHEN** Requirement metadata包含空token、未闭合标记或无法按声明语法唯一解析的内容
- **THEN** Provider fail closed并要求修正规划工件，不把整行静默当作一个Requirement identity

### Requirement: 新 Capability 的关闭前置条件必须早期验证

Specification Provider MUST 在规划批准前计算当前change可静态确定的关闭前置条件。每个新增capability MUST具有满足官方schema与严格校验的规范Purpose来源，且delta操作、退役声明和受影响主规格关系必须可形成唯一关闭计划；这些错误不得延迟到Archive候选创建后才报告。

#### Scenario: 新 Capability 缺少 Purpose

- **WHEN** delta新增capability但没有可归档为主规格Purpose的有效内容
- **THEN** Open或Design严格校验失败并指向对应delta，不允许进入Build

#### Scenario: Purpose 在规划时有效

- **WHEN** 每个新增capability均提供有效Purpose，操作集合与主规格现状可形成唯一关闭计划
- **THEN** Provider记录绑定planning semantic identity的closure preflight evidence，Archive仍重新观察当前输入但不重新发明Purpose

#### Scenario: Archive 前规划语义未变化

- **WHEN** Archive观察到planning semantic identity与获批closure preflight完全一致
- **THEN** Provider可复用静态关闭结论并只执行当前文件与候选checkout验证，不因更晚发现同一可预判错误返回Design

### Requirement: 规划语义与发布身份必须分别参与恢复分类

Specification Provider MUST分别公开规划语义identity、完成状态投影和publication provenance。Runtime MUST只用规划语义identity与trusted approval判定`revise-design`；checkbox、协调仓commit、分支发布OID和实现报告不得被折叠进该identity，除非它们改变Provider声明的规划语义字段。

#### Scenario: 实现提交推进 source OID

- **WHEN** source branch因实现或测试commit变化，但四类规划工件语义与Change metadata未变
- **THEN** Runtime只更新publication或workspace progress事实，不选择`revise-design`

#### Scenario: Task Acceptance 正文改变

- **WHEN** Task的Acceptance、Requirement mapping、依赖或正文在批准后改变
- **THEN** planning semantic identity改变，Runtime选择`revise-design`并精确失效依赖旧语义的Plan与Evidence
