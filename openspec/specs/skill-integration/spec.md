# skill-integration Specification

## Purpose

定义 Repoctopus 如何发现、选择和加载可替换的 Agent Skill，并把实际使用的方法指令绑定到可恢复 Run，同时隔离团队共享能力与成员个人学习状态。

## Requirements

### Requirement: Skill 通过可替换 Provider 解析

Repoctopus MUST 通过统一 Skill 能力按名称解析多个 Provider 的候选项，并依据声明的作用域和确定性优先级选择唯一实现；工作流不得引用具体 Provider 路径。

#### Scenario: 两个 Provider 提供同名 TDD Skill

- **WHEN** 当前组合中两个 Provider 都提供名为 `tdd` 的 Skill
- **THEN** 系统按作用域和稳定优先级选择唯一实现，并在目录中标明实际 Provider

#### Scenario: 替换默认 TDD Provider

- **WHEN** 项目组合把另一个有效 Provider 配置为 `tdd` 的优先来源
- **THEN** 工作流继续请求 `tdd`，无需修改阶段定义或 Runtime 代码

### Requirement: Skill 调用策略在边界处执行

Repoctopus MUST 为每个 Skill 区分模型调用和用户调用权限，并在列出与加载正文时重新核对策略；未获授权的调用不得返回正文。

#### Scenario: 仅允许用户调用的 Skill

- **WHEN** 模型请求加载一个禁用模型调用但允许用户调用的 Skill
- **THEN** 系统拒绝模型调用，同时保留用户显式调用入口

### Requirement: Run 记录实际 Skill 快照

Repoctopus MUST 由 lifecycle Work 声明 action Skill 与每项 augmentation Skill 的规范名称，使用统一 Skill 能力解析唯一 Provider，并在领取 Work 前记录有序组合、Provider 身份、调用策略、正文/资源摘要、传递依赖与适用 Work；恢复时 Skill 事实变化不得静默改变既有 Run 的方法依据，调用方不得选择替代 Skill 或改变组合绕过 definition。Method Profile 使用独立 snapshot，不得伪装成 SkillUsageSnapshot。

#### Scenario: Skill 正文在 Run 中断期间改变

- **WHEN** Run 恢复时当前 Work 的同名 Skill 正文摘要与已记录快照不同
- **THEN** 系统报告 Skill 漂移并按兼容策略使 Work 失效、进入 `migration_required` 或显式启动新 generation

#### Scenario: 未使用的 Skill 发生变化

- **WHEN** 目录中一个未被当前或历史 Work 加载的 Skill 发生变化
- **THEN** 系统刷新后续发现结果，但不使当前 Run 的既有 Work 失效

#### Scenario: 调用方请求替换 Skill 组合

- **WHEN** 当前 Work 声明一个有序 Skill 组合而调用方请求替换、增删或重排任一绑定来完成同一 Work
- **THEN** Runtime 拒绝变化并返回 definition 声明的组合 identity

### Requirement: 外部 Agent 通过稳定目录协议消费 Skill

Repoctopus MUST 提供版本化的 Skill 列表与正文读取协议，并允许 IDE Adapter 将同一解析结果投影到目标 Agent 支持的项目级目录；Adapter 不得维护独立的 Provider 优先级或依赖 IDE Hook 才能加载 Skill。

#### Scenario: Codex 与 OpenCode 查看同一项目 Skill

- **WHEN** 两个 IDE Adapter 针对同一项目和组合请求 Skill 目录
- **THEN** 两者获得相同的规范名称、描述、调用策略、Provider 和正文摘要，仅输出格式与目标目录不同

#### Scenario: IDE 不支持动态 Skill API

- **WHEN** 目标 IDE 只能从项目目录读取 Skill 文件
- **THEN** Adapter 以可重复生成的方式投影目录，并记录来源摘要以防止把本地编辑误认为 Provider 内容

### Requirement: 团队 Skill 与个人学习状态分离

Repoctopus MUST 允许团队共享 `teach` Skill 定义，同时把每个成员生成的课程、资料索引、笔记和学习记录写入 `.repoctopus/learning/` 本机目录；该目录默认被 Git 忽略。

#### Scenario: 成员启动学习主题

- **WHEN** 成员在一个项目中使用 `teach` 创建学习内容
- **THEN** 内容写入该成员本机的 `.repoctopus/learning/<topic>/`，团队仓库不产生待提交文件

#### Scenario: 团队决定沉淀学习结论

- **WHEN** 成员显式选择把经过整理的结论提升为团队知识
- **THEN** 系统要求通过项目文档、规格或知识库的正常评审路径写入，不直接提交个人学习目录

### Requirement: 个人学习内容默认不进入审计数据

Repoctopus MUST 禁止默认遥测、日志和 Run 事实包含个人学习正文、笔记正文或资料正文，只允许记录经配置允许的 Skill 名称、Provider、摘要和状态。

#### Scenario: 导出 Skill 调用遥测

- **WHEN** `teach` 被调用且 OpenTelemetry 已启用
- **THEN** 遥测可以包含 Skill 名称和内容摘要，但不包含个人课程、笔记或资料正文

### Requirement: Work 分离可执行 Skill 与不可执行 Method Profile

Repoctopus MUST 由 lifecycle definition 为每项 Work 分别声明至多一个 `actionSkill`、有序 `augmentationSkills` 和一个版本化 `methodProfile`。可执行 Skill 必须记录规范名称、Provider、正文/资源摘要和调用策略；action Skill 独占产物协议，augmentation Skill 不得建立第二份产物或执行未声明发布副作用。Method Profile MUST 记录 Repoctopus-owned 规则、适用 phase/artifact、enforcement 与固定上游来源摘要，但不得作为 Skill 被发现或调用。Runtime MUST 在 Work 开始前解析完整组合及传递依赖，缺项、歧义、漂移、双产物所有者或违反调用策略时 fail closed。

#### Scenario: OpenSpec action 与 Matt 方法组合

- **WHEN** Design Work 使用 OpenSpec action Skill 产生四类官方工件，并使用采用自 Matt 方法的 Method Profile 增强测试缝或任务质量
- **THEN** OpenSpec action 保持唯一产物协议，Method Profile 规则只作用于声明的官方工件、Validator、review rubric 或 Human Decision

#### Scenario: 自动调用仅允许用户触发的 Skill

- **WHEN** definition、Skill catalog、projection 或调用方尝试发现、装填或绑定原始 `to-spec` 或 `to-tickets`
- **THEN** Runtime 拒绝该路径，并提示使用已审核的 Method Profile 而不是执行原始 tracker 工作流

#### Scenario: TDD Work 缺少传递方法依赖

- **WHEN** Build Work 要求在首次测试或代码写入前加载 `tdd`，但固定快照缺少其 `codebase-design` 依赖
- **THEN** Runtime 在允许写入前阻塞 Work，并返回缺少的固定 provenance identity

#### Scenario: Method Profile 来源或规则发生漂移

- **WHEN** Run 恢复时 Method Profile digest、采用规则或任一固定上游 source digest 与 Work 快照不同
- **THEN** Runtime 使 Work 失效并要求兼容迁移或新 generation，不把新规则静默注入活动 Run

### Requirement: 行为参考与可执行 Skill 物理隔离

Repoctopus MUST 将只用于行为采用的上游文件保存在 Skill Provider roots 之外，并通过 provenance manifest 记录固定 repository、commit、path、source digest、adopted rule IDs 和采用状态；Skill discovery、`skill.get`、managed projection 与 lifecycle binding MUST NOT 返回这些原始参考。架构测试必须证明把参考误放进可发现目录或把其名称加入 Work 会失败。

#### Scenario: 上游参考存在于固定快照

- **WHEN** provenance 检查读取 `to-spec` 或 `to-tickets` 的固定原文以审计采用规则
- **THEN** 它可以核对 source digest 和 rule mapping，但 Skill catalog 与 projection 中不存在该原始 Skill

#### Scenario: 用户环境另行安装同名 Skill

- **WHEN** 用户级 Skill Provider 发现名为 `to-spec` 或 `to-tickets` 的可调用 Skill
- **THEN** 普通显式用户操作 MAY 按宿主策略使用它，但当前 lifecycle Work 不绑定、不自动装填，也不接受其 tracker 产物作为 OpenSpec planning fact

### Requirement: 核心阶段提供固定默认方法组合

Repoctopus MUST 为内置生命周期固定阶段方法：Open 负责探索和创建 change，Design 负责继续官方工件和解决未决策项，Build 在首次写入前启用 TDD 并在故障时启用诊断，Verify 执行规格验证与代码审查，Archive 执行规格归档与受控 PR 发布；条件 Skill 只能由 definition 声明的事实触发，调用方不得任意选择。

#### Scenario: Build 首次写入尚未加载 TDD

- **WHEN** 当前 Task 的 Build Work 尚未记录兼容的 TDD/代码边界 Skill 快照却请求写测试或实现
- **THEN** 应用边界拒绝写入，Runtime 先完成固定方法装填再允许执行

#### Scenario: 故障触发诊断方法

- **WHEN** Build Validator 返回 definition 声明的可诊断失败事实
- **THEN** Runtime 为同一 Work attempt 加载固定 `diagnosing-bugs` augmentation，而不是让 Agent 自选另一流程

### Requirement: 受保护操作必须匹配当前 Work

Repoctopus MUST 在 Application Plugin、Command Router 和平台写入口根据当前已领取 Work 执行能力、side-effect class、repository 与 write scope 策略；没有活动 claim、目标超出范围、terminal artifact 被改写或操作类别不匹配时必须拒绝，Prompt、AGENTS.md 或调用方声明不得代替运行时授权。

#### Scenario: Agent 未领取 Work 直接写业务代码

- **WHEN** Agent 没有当前 Change Run 的有效 claim 却请求写入业务仓
- **THEN** 应用边界拒绝写入并返回需要领取的 Work，不依赖 Agent 是否读取流程说明

#### Scenario: 当前 Work 只允许规格目录

- **WHEN** Design Work 的 write scope 只允许 Provider 规划产物而执行者请求修改业务源码
- **THEN** 应用边界拒绝越界路径并记录 Work、capability 和目标摘要

#### Scenario: Design Work 尝试发布 tracker

- **WHEN** 当前 Work 的 output contract 只允许 Specification Provider artifact，而执行者请求创建 issue、写本地 ticket 目录或调用 tracker publish
- **THEN** 应用边界在副作用前拒绝操作，并且任何未受管外部写入只能形成 drift/blocker，不能形成成功 Receipt 或推进事实
