## MODIFIED Requirements

### Requirement: Evidence 绑定完整输入指纹

Repoctopus MUST 把检查实际声明的产品内容、规划语义、执行控制面、输入策略、配置、lockfile、Journey、工具、浏览器、Adapter 和输入 Artifact 身份绑定到证据依赖指纹，并在采集开始和结束时重新核对选中输入。原始 HEAD、tree、index 和工作树状态 MUST 保留为授权或审计来源；只有检查显式消费 Git 身份时才把对应 Git 身份作为证据有效性依赖，不得用原始仓库状态替代有效内容身份。

#### Scenario: 采集期间源码发生变化

- **WHEN** 结束时的产品指纹、控制面 manifest 或策略摘要与开始时不同
- **THEN** 当前 Attempt 标记为 `superseded`，保留制品但不得用于 Verify

#### Scenario: 开发阶段存在未提交修改

- **WHEN** Profile 允许在 dirty worktree 收集开发反馈
- **THEN** 产品 dirty 集包含实际选中文件内容摘要，已登记控制面输入包含独立内容摘要，不能只使用 Git 状态文本或忽略 Host 执行输入

#### Scenario: 相同有效内容经过暂存和提交

- **WHEN** 已验证文件从未暂存变为暂存或提交，选中的实际内容、规范化规划语义及其他依赖未变，检查没有声明消费 Git 身份
- **THEN** 该检查的依赖指纹保持一致，原始 Git 来源可以更新而不使成功证据失效

#### Scenario: 检查直接读取提交身份

- **WHEN** 检查显式声明读取 Git 身份，并在内容等价时观察到新的提交或声明绑定的 index
- **THEN** 对应依赖指纹变化，旧证据不能证明新输入，即使其他检查的内容依赖保持相同

#### Scenario: 规划文件不能可靠归一化

- **WHEN** Specification Provider 无法证明官方规划工件、Task 完成变化和当前批准语义之间的关系
- **THEN** Runtime 阻断归一化或使用明确的保守输入，不得按目录名称忽略文件，也不得声称旧证据仍有效

### Requirement: Evidence 失效必须按声明输入面传播

每个 Receipt、Bundle、Gate、Plan Evidence、Build Check Evidence 和 Verification Input MUST 保存实际采集形成的规范化依赖集合。Runtime 选择 `invalidate-evidence` 时 MUST 沿身份依赖图只退役直接或传递依赖已变化输入的事实，并记录保留项、失效项和原因；采集、恢复、复用和门禁 MUST 消费同一依赖权威，phase、commit、checkbox 或文件时间变化本身不得成为全量失效依据。

#### Scenario: 一个测试命令的源码输入变化

- **WHEN** 只有命令A声明的实现文件发生变化，命令B的argv、cwd、环境、工具和输入集合均未变化
- **THEN** Runtime只使A的Receipt及其下游Bundle/Gate失效，并可保留B的有效Receipt

#### Scenario: 检查显式依赖 Git identity

- **WHEN** 检查产物包含commit SHA并在策略中声明Git identity为输入
- **THEN** 对应commit变化使该检查Evidence失效，即使文件语义内容等价

#### Scenario: 非语义收尾提交

- **WHEN** Workspace 中的提交只更新Task checkbox、验证报告引用或publication provenance，且没有改变planning semantic identity或任何检查声明的输入
- **THEN** Runtime保留Design approval、Build Plan、实现completion与Verify Evidence，不返回Design或Verify

#### Scenario: 新进程恢复已采集依赖

- **WHEN** 一个进程保存 Receipt 和 Bundle 后退出，另一个进程重新核对对应 Gate 或准备 Archive
- **THEN** 新进程从持久化事实获得同一依赖及原始来源，只复用当前仍有效且满足新鲜度规则的证据，不从聚合 HEAD 差异重建全部检查

#### Scenario: 缺失或无法识别的依赖记录

- **WHEN** 证据缺少当前协议要求的依赖记录，或引用的输入身份不能可靠读取与比较
- **THEN** Runtime 返回明确的证据不可复用或暂时不可判定诊断，保持受保护 checkpoint，不伪造依赖、不把旧成功记录提升为当前有效证据
