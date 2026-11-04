# implementation-evidence Delta

## MODIFIED Requirements

### Requirement: Evidence 输入必须区分产品与执行控制面

Repoctopus MUST 使用版本化 Repository Input Policy 与仓库角色把输入区分为实现产品内容、规范化规划语义、内容寻址的执行控制面和未知输入。Evidence fingerprint 与 Verification Input MUST 记录各分区identity及当前检查实际声明的依赖；不得把协调仓原始HEAD、Task checkbox或publication provenance冒充规划语义，也不得静默忽略检查真实消费的输入。

#### Scenario: 外部 Host 在仓库中安装执行文件

- **WHEN** 未被 Git 跟踪的 Hook、Agent 指令、Skill 或锁文件匹配当前 composition 提供的受限 Host input rule
- **THEN** Runtime 不把它计为实现产品 dirty file，但以规范路径、类型、内容摘要、owner 和 policy identity 写入 control-plane manifest，并使消费该控制面的 Evidence 绑定该 manifest digest

#### Scenario: 未知未跟踪文件出现

- **WHEN** 一个未跟踪文件不匹配任何受信 Host rule或已登记规划工件规则
- **THEN** 该文件继续按实际内容进入对应仓库的产品dirty fingerprint，不因目录名、点前缀或用户ignore配置被排除

#### Scenario: 控制面文件在采集后变化

- **WHEN** Host Hook、Skill、指令、锁文件集合、内容、类型或输入策略在消费它们的Evidence采集开始后变化
- **THEN** 对应Attempt标记为`superseded`或Gate拒绝旧Bundle；未声明依赖这些输入的其他Evidence保持有效

#### Scenario: Specification 仓只勾选已完成 Task

- **WHEN** Specification Provider确认Task稳定ID、正文、依赖、Acceptance和Requirement mappings未变，只有合法Work导致checkbox状态和协调仓commit变化
- **THEN** planning semantic identity保持不变，未声明读取checkbox或commit的实现与验证Evidence不得失效

### Requirement: 控制面输入分类必须 fail-closed

Repository Input Policy MUST 只把未跟踪、未打包、位于仓库根内且满足版本化精确规则的外部本地执行输入分类为控制面输入。Git tracked 产品路径 MUST 保持产品输入；注册的Specification Authority仓库或路径中的官方规划工件即使被Git跟踪，也 MUST 作为planning semantic输入处理，不得仅因tracked状态被重分类为产品输入或控制面输入。只有external-exclusive路径进入产品面、规则重叠、类型不符、路径逃逸、竞态或无法稳定读取才 MUST 阻断指纹采集。

#### Scenario: 双用途 Host 路径被团队版本化

- **WHEN** 团队把允许版本化的 `AGENTS.md`、Skill 或其他双用途路径提交到 HEAD、index 或 tracked modification
- **THEN** Runtime 把它作为产品 tree 或 dirty 输入取指纹，不再按本地 control-plane rule 排除

#### Scenario: 外部独占路径被提交到产品 tree

- **WHEN** policy 声明为 external-exclusive 的旧 Host 安装路径出现在 HEAD、index 或 tracked modification
- **THEN** Runtime 报告产品与控制面所有权冲突并拒绝 Evidence

#### Scenario: 控制面符号链接逃逸仓库

- **WHEN** 登记路径解析到仓库根外、在读取期间改变对象身份或使用不允许的文件类型
- **THEN** 指纹采集 fail-closed，且诊断不读取或泄露仓库外内容

#### Scenario: 输入枚举顺序不同

- **WHEN** 两次采集观察到相同产品内容、控制面内容和策略，仅 Git 或文件系统返回顺序不同
- **THEN** 规范排序后的 product、control-plane 和最终 Evidence digest 完全相同

## ADDED Requirements

### Requirement: Evidence 失效必须按声明输入面传播

每个Receipt、Bundle、Gate、Plan Evidence、Build Check Evidence和Verification Input MUST保存其规范化依赖集合。Runtime选择`invalidate-evidence`时 MUST沿身份依赖图只退役直接或传递依赖已变化输入的事实，并记录保留项、失效项和原因；phase、commit、checkbox或文件时间变化本身不得成为全量失效依据。

#### Scenario: 一个测试命令的源码输入变化

- **WHEN** 只有命令A声明的实现文件发生变化，命令B的argv、cwd、环境、工具和输入集合均未变化
- **THEN** Runtime只使A的Receipt及其下游Bundle/Gate失效，并可保留B的有效Receipt

#### Scenario: 检查显式依赖 Git identity

- **WHEN** 检查产物包含commit SHA并在策略中声明Git identity为输入
- **THEN** 对应commit变化使该检查Evidence失效，即使文件语义内容等价

#### Scenario: 非语义收尾提交

- **WHEN** 协调仓提交只更新Task checkbox、验证报告引用或publication provenance，且没有改变planning semantic identity或任何检查声明的输入
- **THEN** Runtime保留Design approval、Build Plan、实现completion与Verify Evidence，不返回Design或Verify

### Requirement: Evidence 无效与 Evidence 不可用必须分离

Runtime MUST 区分“既有Evidence因输入变化不再适用”与“Evidence Provider或环境暂时不可用”。前者选择`invalidate-evidence`并重新采集受影响节点；后者保持当前检查blocked/retry，不得通过Plan或Design返工掩盖基础设施问题。

#### Scenario: Receipt 输入已经漂移

- **WHEN** Receipt绑定的源码、规划语义、配置、工具或控制面identity与当前依赖集合不一致
- **THEN** Runtime将其分类为Evidence invalidation并要求当前输入的新Receipt

#### Scenario: 测试服务暂时离线

- **WHEN** 全部输入identity未变但Evidence Contributor无法连接外部测试服务
- **THEN** Runtime记录infrastructure unavailable并保留当前phase、Plan和实现completion等待重试
