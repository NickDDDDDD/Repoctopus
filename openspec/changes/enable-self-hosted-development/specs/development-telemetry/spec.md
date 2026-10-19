# Spec Delta

## ADDED Requirements

### Requirement: Skill 使用只导出允许列表身份

Repoctopus MUST 为 Skill 发现、选择、加载和漂移输出低基数事件，允许属性仅包含 Skill 名称、Provider、版本或摘要、调用类型、Run 和结果，不包含正文、绝对路径或个人学习内容。

#### Scenario: TDD Skill 成功加载

- **WHEN** Run 加载 `tdd` Skill
- **THEN** 遥测记录所选 Provider 和正文摘要，不记录 Skill Markdown 正文

### Requirement: 平台事件处理可追踪但不泄露载荷秘密

Repoctopus MUST 为平台投递的接收、去重、领取、重试、完成和死信输出关联事件，并使用 Delivery ID、Source、事件类型、change、Run 与状态关联；签名、Token、Header、Cookie 和原始载荷默认不得导出。

#### Scenario: 重复 GitHub Delivery 被去重

- **WHEN** Event Inbox 识别到重复 Delivery ID
- **THEN** 遥测记录去重结果和原投递关联，不输出签名或请求正文

### Requirement: Post-merge Run 输出阶段与证据关联

Repoctopus MUST 为合入事实核对、临时检出、Evidence Gate、规格同步、路径审计、commit、push 和 MR 更新输出可关联状态，并引用持久 Receipt 或 Artifact 身份而非嵌入完整内容。

#### Scenario: 规格同步因冲突停止

- **WHEN** Post-merge Run 生成 Human Decision
- **THEN** 遥测记录冲突类别、change、Run 和请求身份，不记录设计图或规格正文

### Requirement: 个人学习遥测默认关闭

Repoctopus MUST 把 `.repoctopus/learning/` 视为个人数据边界，默认不扫描、不建立 Artifact 且不输出文件数量、主题名称或内容摘要；只有用户显式配置的团队知识提升动作可以进入普通审计链。

#### Scenario: Teach 写入个人笔记

- **WHEN** Skill 在个人学习目录新增或修改文件
- **THEN** 开发遥测不产生针对这些文件的采集事件
