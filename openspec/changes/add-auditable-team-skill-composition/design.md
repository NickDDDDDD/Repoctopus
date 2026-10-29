# Design

## Context

当前产品已经具备四块基础：多 Provider Skill Registry、由 Work Context Assembler 交付完整 Skill 内容、不可变 lifecycle Work Descriptor，以及独立的 Lifecycle Extension/Validator Contributor。缺口在于这些能力还没有形成团队可配置的生产闭环：核心 Skill 组合仍由代码硬编码；extension service 只登记和快照；Host 的 `consumed` 回执只能证明协议层消费，不能证明方法规则被执行。

Build Configuration 的领域对象还混合两类生命周期不同的事实：

- 人与团队真正决定的稳定策略：execution mode、TDD mode、review policy、isolation intent、团队方法组合；
- Runtime 可以反复探测的执行绑定：Host、capabilities、checkout、branch、HEAD、worktree identity、Workspace ownership。

二者共享一个 semantic digest 和 Human Decision，导致机器事实变化被误判成人类策略变化。历史自举 Run 已出现配置批准重复、binding 修复后再次等待、Plan 在 Execute 才发现 write scope 不一致等现象。

约束如下：

- Repoctopus Runtime 仍是 Action、Work、phase transition 和 Validator 的唯一权威；团队 Skill 只能增强允许的插槽和安全点。
- OpenSpec 四件套、Tasks 和 Runtime BuildPlan 的现有分层不得改变。
- Engine/Domain 不依赖 Cordis、文件系统、Git、OTLP、Electron 或具体 Agent Host；Cordis Service 组合用例，平台 Adapter 提供 I/O。
- 共享配置可移植且受 Git 评审；绝对路径、个人 Skill 和机器能力只存在本地状态。
- 方法验证必须使用 Runtime 可核对事实，不尝试记录 Agent 内部思考，也不能把 Prompt/回复上传到遥测。
- 规格、设计、配置 Schema 或固定上游参考发生不可消解冲突时停止，不自行选取一个权威。

## Goals / Non-Goals

**Goals:**

- 让团队通过共享配置把已有 Skill 安全接入指定 Work，而不 fork Repoctopus lifecycle 源码。
- 保持 Action Skill 不可替换，并把 guidance、augmentation replacement、required check 三类边界编译成唯一有效 composition。
- 让 Open、TDD 和团队检查产生可验证 Method Receipt，区分“内容被消费”和“方法被证明执行”。
- 把稳定 BuildStrategy 固定在 Design approval，把 ExecutionBinding 留给 Runtime 自动验证，减少重复人工确认。
- 在 Execute 前捕获任务、仓库、write scope、报告归属、能力和方法组合不一致。
- 让本地 Dashboard 与 SigNoz 从同一 OTLP 事实评估方法执行、返工、等待和工作流健康度。

**Non-Goals:**

- Action replacement、Child Workflow、自定义 phase/transition 或通用 Workflow Creator。
- 个人 Skill 自动进入团队 Run，或从开发机全局目录隐式补齐团队配置。
- 证明 Agent 的主观理解、思维过程或所有 Skill 文本逐条被遵循。
- 自动创建/切换 Git branch/worktree，或把本机绑定写进共享规格。
- 兼容执行旧预发布 Build Configuration schema。

## Decisions

### 1. 共享配置声明绑定意图，Compiler 产生唯一有效 composition

`repoctopus.yaml` 增加版本化 `lifecycle.skillBindings`。配置只引用逻辑 Skill 名称、目标 Work/checkpoint 和允许的角色，不包含 Provider 路径：

```yaml
lifecycle:
  skillBindings:
    - id: team-secure-design
      target: design.change
      role: guidance
      skill: secure-design
      order: 200
    - id: team-tdd-policy
      target: build.execute
      role: augmentation-replacement
      slot: tdd-method
      skill: team-tdd
    - id: team-license-check
      target: build.after-check
      role: required-check
      skill: license-check
      validator: license-check/v1
```

领域层定义 `TeamSkillBinding` 与 `EffectiveSkillComposition`。Compiler 输入为共享配置、固定 lifecycle definition、Skill catalog、Extension/Validator catalog 和 BuildStrategy；输出为规范化有序绑定、解析约束、Contributor identities 和 `compositionDigest`。它只做纯映射与校验，不读取磁盘或调用 Provider。

解析与编译分两步：Compiler 先验证 target/role/slot/checkpoint 是否由 definition 明确开放；Skill Registry 再解析唯一 Provider、正文/资源摘要和调用策略。任何缺失、歧义、能力不兼容或未登记 Contributor 都在 Run/claim 前 fail closed。Run 冻结 effective composition；未开始的 Run 可以加载新配置，活动 Run 恢复必须比较摘要和声明兼容性，不能静默换方法。

选择共享配置而不是动态 Creator，是因为团队需要可评审、可复制、可摘要的少量扩展点，不需要第二套通用 workflow 语言。Comet 的 binding/adapter/validator/checkpoint 思想保留，但不复制它的完整 Application package。

### 2. 三类 binding 使用不同执行语义

第一版只接受以下角色：

1. `guidance`：按稳定 order 追加到 action packet 的 augmentation 层；可读取当前 Work 输入，不能拥有核心产物、工具权限、transition 或 validator。
2. `augmentation-replacement`：只替换 definition 显式命名为 replaceable 的 augmentation slot，例如 `tdd-method`；替换项必须满足 slot 的 method profile、capability、invocation 和 evidence contract。Action slot 永远不可替换。
3. `required-check`：在 definition 声明的安全 checkpoint 物化一个独立普通 Work，绑定团队 Skill、capability、write scope、output contract 和 Validator；成功/失败作为 Gate 输入，不能自行推进 phase。

同一 slot 最多一个 replacement；guidance 以 `(order, bindingId)` 稳定排序；required check 以 definition checkpoint、依赖和 bindingId 形成无环序列。重复 ID、循环依赖、未知 slot/checkpoint、Action replacement、可写 guidance 或缺 Validator 的 required check 都在 composition compile 时拒绝。

个人目录可以继续用于发现、试用和学习，但不参与 `EffectiveSkillComposition`。团队若要采用个人 Skill，必须先把定义/Provider 以正常代码与配置评审路径纳入项目。

### 3. Required check 复用现有 Work/Host/Evidence 链

不建立 `TeamCheckRuntime`。Compiler 把 `required-check` 转成受约束 `LifecycleExtensionContribution`，由现有 definition service 物化 `WorkDescriptor`，经 claim → packet → Host → Outcome → Validator → Evidence 推进。Extension 只能返回检查 Outcome；WorkflowRuns 根据核心 definition 处理 Gate 和下一 Action。

团队检查插件必须经过现有项目插件准入，Descriptor 静态声明实现身份、契约版本、配置 Schema、capabilities、side-effect class、output schema、Validator profile 和兼容范围。配置不能内嵌脚本或任意模块路径。这样既允许团队方法扩展，又保留 Cordis 插件边界、恢复、卸载排空和 composition snapshot。

### 4. `consumed` 与 `method_verified` 是两个独立事实

Skill 链路保持：

```text
resolved → delivered → consumed
                         └─ Method Receipt + Validator → method_verified
```

`consumed` 仍由 Host invocation 回执产生，证明匹配 packet/layer digest 的内容被交给并由 Host 声明消费。`method_verified` 必须有版本化 `MethodReceipt`，并由对应 Method Validator 对当前 Work 输入、Outcome 和 Evidence Store 中的真实 Receipt 核对后产生。Work 成功、文件存在或最终测试通过都不能反推任一状态。

通用 envelope 只保存：`methodId/version`、run/work/invocation、input/packet/layer digest、evidence refs、validator identity/result、有限原因分类和时间；方法专属 payload 由版本化 schema 定义并内容寻址。失败或不完整 Receipt 不阻止保存发现，但 required 方法 Gate 不能通过。

### 5. Open、TDD 与团队检查使用专属 Receipt

`OpenMethodReceipt` 记录：已检查的 repository/spec/config fact categories 及摘要、事实来源、未决 frontier、向用户提出的 decision references、零提问时的有界理由、四件套摘要和当前输入摘要。Validator 要求所有 definition 声明的事实类别已覆盖；可从仓库获得的事实若被转问用户则拒绝。它不保存自由 Prompt、问答正文或思考过程。

`TddCycleReceipt` 针对当前 Task/package 和实现输入，引用 Evidence Store 中实际存在的 RED command Receipt、GREEN command Receipt 和 regression Receipt。Validator 核对：RED 在相应实现变化之前执行且因预期行为失败；GREEN 使用相容输入并通过；回归覆盖当前 head。占位 ID、`prior-*` 字符串、Agent 摘要或同一成功命令复制为 RED/GREEN 都拒绝。`tddMode=direct` 不要求 TDD Receipt，但仍要求相关测试和 Build/Verify Evidence。

团队 required check 使用其插件 Descriptor 声明的 receipt schema 与 validator。Repoctopus 只接受登记过的 schema/validator identity，并统一投影验证结果，不解释团队自由文本。

### 6. BuildStrategy 与 ExecutionBinding 分离

现有 `BuildConfiguration` 拆成两个对象：

```ts
interface BuildStrategy {
  schemaVersion: 1;
  executionMode: 'autonomous' | 'subagent-driven-development';
  tddMode: 'tdd' | 'direct';
  reviewMode: 'standard';
  isolationIntent: 'current' | 'branch' | 'worktree';
  skillCompositionDigest: Sha256;
  semanticDigest: Sha256;
}

interface ExecutionBinding {
  schemaVersion: 1;
  hostId: string;
  capabilityDigest: Sha256;
  repositories: readonly ExecutionRepositoryBinding[];
  localDigest: Sha256;
  semanticDigest: Sha256;
}
```

Open 可以收集尚缺的 isolation intent；Design 在深化四件套时根据任务/拓扑提出完整 BuildStrategy，并把其摘要和 effective skill composition 摘要纳入 Design Human Decision。若用户已经明确全部选择，Runtime 直接把同一摘要加入 Design approval，不再创建独立 Build Configuration approval。

进入 Build 后，Configure 只解析并验证 ExecutionBinding 是否满足批准 Strategy。绝对路径只进入本地 overlay；可移植 Run 事实保存 repository/branch/head/worktree ownership 的规范摘要。正常 HEAD 推进会使旧 Plan/Evidence 失效并重新验证，但不改变 Strategy。

仅以下情况建立新的策略决定：必需策略字段仍未知；用户显式要求改变已批准策略；团队 binding/slot 变化导致 `skillCompositionDigest` 改变；变化无法证明与现有批准语义兼容。Host 更换、兼容 capability 重探测、同 isolation 下修复 checkout、进程恢复、同摘要 Build/Verify 返工不需要人工确认。

### 7. Human Decision 由语义差异触发，不按步骤固定重复

正常路径保留两个固定审查边界：Open approval 审查需求/范围/四件套初稿；Design approval 审查深化设计、Tasks、BuildStrategy 和团队方法 composition。Build 内只有 definition 风险策略命中高风险 Plan 时可选暂停。外部授权、未知副作用和无法自动消解的真实语义冲突继续停止。

每个 decision 保存 `decisionKind + semanticDigest + supersedes`。Runtime 在创建决定前查询同 Run 当前已接受决定：摘要相同则复用；仅机器绑定变化则走 Validator；语义摘要变化才创建新请求。CLI、Dashboard 和遥测必须显示“为什么需要人处理”的有界 reason，而不是把每次重试都表示成新批准。

### 8. Plan Evidence 在副作用前验证执行边界

Plan Evidence 除现有 Task coverage、DAG、Host、isolation、Skill 和 acceptance 外，必须验证：

- 每个 package 的 repositoryIds 与 writeScopes 被任务和 definition 允许；
- 终端报告/协调结果由正确的 owner Work 产生，不把协调器摘要冒充子 Work Outcome；
- required team checks 已在正确 checkpoint 排入计划，依赖无环；
- BuildStrategy、EffectiveSkillComposition 与 ExecutionBinding 的摘要一致；
- TDD/review/validator 要求能由选定 Host 与 Evidence Adapter 实现。

失败返回结构化 planning finding，留在 Plan 修订；只有改变 OpenSpec 规划语义时才返回 Design。这样把历史上 Execute 才暴露的 write-scope 和报告归属错误提前到无副作用边界。

### 9. 遥测和 Dashboard 展示可验证方法，不猜测执行

Trajectory 增加版本化事实：composition compiled/rejected/drifted、team binding resolved、method receipt submitted/accepted/rejected、strategy proposed/approved/reused/changed、binding validated/drifted、decision created/reused、team check started/completed。所有事实先本地提交，再映射到规范 OTLP envelope。

Trace/Event 可以携带稳定 run/work/binding/method/validator 关联和有界结果；Metric 只使用 phase、action、role、method kind、result、reason class 等低基数标签。Skill 名称、bindingId、Task/package/repository、digest 和 Run identity 不能成为 Metric label；正文、Prompt、回复、命令输出、用户名和路径不得导出。

Desktop 当前 Work 区域分别展示 action、内置 augmentation、团队 guidance/replacement、required check，以及 resolved/delivered/consumed/method verified。Human Decision 区只展示当前有效请求及 reason；相同摘要的重试不能形成多个待处理卡片。SigNoz 与桌面仍消费同一 OTLP 语义，不增加本地查询旁路。

### 10. 上游对齐覆盖 Matt Skills

现有每日 Comet/DSH 固定上游审计增加 Matt Skills 快照：记录固定 commit/tag、许可证、Skill manifest/content digest、Repoctopus adapter contract 和本地偏差。上游变化只生成审计发现，不自动替换活动 Run 的 Skill；采用更新必须走普通 Change、测试 Provider/Receipt 兼容性并刷新 provenance。

## Risks / Trade-offs

- **[风险] 配置语言膨胀成第二套 workflow DSL** → 第一版固定三种 role 和 definition 白名单，不允许自定义 phase、condition、脚本或 transition。
- **[风险] Method Receipt 变成 Agent 自填表** → 关键字段引用机器采集 Evidence，Validator 独立解析时间与输入关系；自由摘要不满足 Gate。
- **[风险] 团队 Skill 破坏核心方法** → Action 不可替换，replacement 只作用于显式 slot 且必须满足同一 contract；个人 Skill 不参与编译。
- **[风险] 减少审批导致策略被静默改变** → Design decision 绑定 Strategy 与 composition digest，任何语义改变都会使旧批准失效；只自动重验机器 binding。
- **[风险] required check 增加恢复复杂度** → 复用唯一 Work/Host/Evidence 协议和 checkpoint，不建立特殊运行时。
- **[取舍] 不支持 Child Workflow 限制复杂团队流程** → 先验证常见 guidance/replacement/check 纵切；出现真实重复需求后再以独立 Change 设计。

## Migration Plan

1. 先用 red/characterization tests 固定硬编码组合、虚假 TDD receipt、重复配置批准和 Execute 才发现 scope 错误的当前行为。
2. 增加配置 Schema、纯 Compiler、Contributor descriptor 和 effective composition snapshot；尚未接入执行前保持现有内置组合可用。
3. 接入 Work Context、required check、Method Receipt/Evidence resolver 与 Validator，完成单仓纵切后再覆盖多仓和恢复。
4. 引入 BuildStrategy/ExecutionBinding 新 schema，切换 Design/Configure/Plan Evidence/Human Decision；删除旧 Build Configuration approval 生产路径和兼容执行分支。
5. 接入 Trajectory、OTLP、Desktop projection、文档和 Matt 上游审计。
6. 用打包 Runtime 完成 Open→Design→Build→Verify→Archive 自举验收，验证正常路径只有 Open/Design 两个固定人工停点。

回退只允许回退尚未发布的代码提交。已创建的新 schema Run 保留为只读审计，不降级给旧 Runtime；若发现阻断缺陷，停止副作用并通过新的普通 Change 修复。

## Open Questions

无。团队 binding 边界、Action 不可替换、Child Workflow 延后、个人 Skill 不参与团队生命周期，以及 Build Configuration 审批简化均已确认。
