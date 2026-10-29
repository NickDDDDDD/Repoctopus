# Tasks

## 1. 固定退化基线与领域模型

- [ ] 1.1 为硬编码 Skill 组合、未进入生产调度的 lifecycle extension、个人 Skill 同名覆盖团队方法增加 characterization tests。
      **Blocked by:** None
      **Acceptance:** 测试分别证明当前实现不能声明 team guidance/check、extension 只被快照未执行、个人 Provider 可影响团队解析；新断言在旧实现上失败
      **Requirements:** skill-integration#团队绑定编译为唯一有效-skill-composition, project-configuration#团队-skill-binding-属于共享配置
- [ ] 1.2 为 `consumed` 冒充方法执行、占位 TDD receipt、Open 零提问但未核对代码事实增加反作弊 red tests。
      **Blocked by:** None
      **Acceptance:** 三类退化均由独立断言捕获，最终测试成功或 Work 成功不能让断言误通过
      **Requirements:** implementation-evidence#关键方法必须提交可机器核对的-method-receipt
- [ ] 1.3 为 Build Configure 重复批准、兼容 Host/checkout 变化触发新决定、Plan 未预检 write scope 增加历史旅程 red tests。
      **Blocked by:** None
      **Acceptance:** fixture 可分别复现重复 Human Decision 与 Execute 前未阻断 scope/report-owner 错误
      **Requirements:** change-lifecycle#build-策略只在语义改变时请求人工决定, managed-work-execution#plan-evidence-在执行前证明完整执行边界
- [ ] 1.4 定义 `TeamSkillBinding`、`EffectiveSkillComposition`、`MethodReceiptEnvelope`、`BuildStrategy` 和 `ExecutionBinding` 的纯领域类型、schema、规范化与稳定摘要。
      **Blocked by:** 1.1, 1.2, 1.3
      **Acceptance:** round-trip、未知字段、上限、顺序规范化、重复 identity、摘要碰撞和路径泄漏测试通过，领域模块不导入 Cordis 或平台 I/O
      **Requirements:** project-configuration#团队-skill-binding-属于共享配置, managed-work-execution#build-strategy-与-execution-binding-使用独立身份

## 2. 编译共享团队 Skill composition

- [ ] 2.1 扩展 `repoctopus.yaml` Schema、类型、示例和 Loader，接纳版本化 `lifecycle.skillBindings`，拒绝原始 Loader/Cordis 字段和任意模块路径。
      **Blocked by:** 1.4
      **Acceptance:** 合法 guidance/replacement/check 配置解析通过；未知 role、Action replacement、个人路径、内嵌代码和额外字段给出逐字段诊断
      **Requirements:** project-configuration#团队-skill-binding-属于共享配置
- [ ] 2.2 实现纯 `SkillCompositionCompiler`，按 definition 白名单验证 target、slot、checkpoint、role、order、依赖和唯一性。
      **Blocked by:** 2.1
      **Acceptance:** 等价声明得到相同摘要；重复 replacement、循环 check、未知 checkpoint、可写 guidance 和缺 Validator check 均 fail closed
      **Requirements:** skill-integration#团队绑定编译为唯一有效-skill-composition
- [ ] 2.3 把 Skill Registry 的唯一 Provider 解析、调用策略、资源摘要、method/evidence contract 接入 Compiler 输出。
      **Blocked by:** 2.2
      **Acceptance:** Workspace/team Provider 可解析，缺失、歧义、能力或 invocation 不兼容在 Work claim 前阻断；配置不依赖 Provider 路径
      **Requirements:** skill-integration#团队绑定编译为唯一有效-skill-composition
- [ ] 2.4 把 effective composition identity 纳入 Cordis composition、Run snapshot、Work input 和恢复兼容检查。
      **Blocked by:** 2.3
      **Acceptance:** 活动 Run 恢复同摘要可继续；语义变化产生明确 drift/migration 诊断；未使用或个人 Skill 变化不影响 Run
      **Requirements:** plugin-composition#团队-skill-contributor-进入活动组合快照, skill-integration#团队绑定编译为唯一有效-skill-composition
- [ ] 2.5 强化本机覆盖合并规则，禁止 `.repoctopus/local.yaml` 和用户 Skill 目录新增、删除、替换或重排团队生命周期 binding。
      **Blocked by:** 2.1
      **Acceptance:** 允许机器路径/端口覆盖；任何团队 binding 语义覆盖都在 App Boot 拒绝并指出配置路径
      **Requirements:** project-configuration#个人-skill-不得改变团队生命周期

## 3. 交付三类 binding 纵切

- [ ] 3.1 让 Work Context Assembler 把 team guidance 按稳定顺序加入 augmentation layers，并保留 action/内置/team 角色与来源。
      **Blocked by:** 2.4
      **Acceptance:** 捕获 Host 收到完整正文/资源和正确顺序；guidance 没有额外 capability、write scope、产物或 transition 权限
      **Requirements:** skill-integration#团队绑定编译为唯一有效-skill-composition
- [ ] 3.2 为 definition 增加显式 replaceable augmentation slots，并实现 contract-compatible replacement；Action slot 永远不可替换。
      **Blocked by:** 2.4
      **Acceptance:** team TDD replacement 在合法 slot 生效；Action replacement、未知 slot、method/evidence contract 不兼容均阻断
      **Requirements:** skill-integration#团队绑定编译为唯一有效-skill-composition
- [ ] 3.3 将 required-check 编译为受约束 Lifecycle Extension/Work/Validator Contributor，并接入生产调度而不创建第二 Runtime。
      **Blocked by:** 2.4
      **Acceptance:** 一个团队检查在声明 checkpoint 经过 claim→packet→Host→Outcome→Validator→Evidence；不能直接改 phase、Decision 或 Gate
      **Requirements:** plugin-composition#团队-required-check-复用受管-work-与安全-checkpoint
- [ ] 3.4 完成团队检查插件静态 Descriptor、准入、卸载排空和恢复兼容验证。
      **Blocked by:** 3.3
      **Acceptance:** 未登记/不兼容插件在 import 前拒绝；活动 Work 卸载有界排空；重启只恢复同一逻辑 attempt
      **Requirements:** plugin-composition#团队-required-check-复用受管-work-与安全-checkpoint, plugin-composition#团队-skill-contributor-进入活动组合快照
- [ ] 3.5 建立包含 guidance、TDD replacement 和 required check 的真实单仓纵切。
      **Blocked by:** 3.1, 3.2, 3.4
      **Acceptance:** 打包 Runtime 执行三类 binding，调用方无法增删/重排，失败 check 阻断而通过 check 由核心 Runtime 选择下一 Action
      **Requirements:** skill-integration#团队绑定编译为唯一有效-skill-composition, plugin-composition#团队-required-check-复用受管-work-与安全-checkpoint

## 4. 可审计的方法执行

- [ ] 4.1 实现版本化 `MethodReceiptEnvelope`、内容寻址 payload、Method Validator registry 和 Evidence Store resolver。
      **Blocked by:** 1.4
      **Acceptance:** Receipt 绑定 run/work/invocation/input/packet/layer/validator；缺失内容、旧 input、未知 schema/validator、伪造引用和超限 payload 被拒绝
      **Requirements:** implementation-evidence#关键方法必须提交可机器核对的-method-receipt
- [ ] 4.2 实现 `OpenMethodReceipt` 与 Validator，核对 repository/spec/config facts、frontier、decision references、零提问理由和四件套摘要。
      **Blocked by:** 4.1
      **Acceptance:** 已完整核对时零提问通过；未读可访问代码、把环境事实转问用户、遗漏事实类别或四件套漂移均拒绝
      **Requirements:** implementation-evidence#open-方法验证核对事实覆盖与未决-frontier
- [ ] 4.3 实现 `TddCycleReceipt` 与 Validator，解析真实 RED/GREEN/regression command Evidence 及其输入和时间关系。
      **Blocked by:** 4.1
      **Acceptance:** 真实先红后绿通过；占位/`prior-*`、复制同一成功命令、错误失败原因、实现后补跑 RED、旧 head 回归均拒绝
      **Requirements:** implementation-evidence#tdd-方法验证解析真实-red-green-与回归证据
- [ ] 4.4 将团队 required check 的 receipt schema/validator contract 接入统一方法验证链。
      **Blocked by:** 3.4, 4.1
      **Acceptance:** 登记 schema 的检查产生 method_verified；自由文本或未登记 validator 只能保存发现，不能满足 required Gate
      **Requirements:** implementation-evidence#关键方法必须提交可机器核对的-method-receipt
- [ ] 4.5 扩展 Host packet/outcome 和 Work Validator，严格区分 resolved、delivered、consumed、method_verified。
      **Blocked by:** 4.2, 4.3, 4.4
      **Acceptance:** 每个状态可独立缺失/失败；Work 成功不反推 consumed 或 method_verified；`tddMode=direct` 不虚构 TDD Receipt
      **Requirements:** skill-integration#skill-身份消费与方法验证分别冻结, implementation-evidence#关键方法必须提交可机器核对的-method-receipt

## 5. 精简 Build 决策与提前验证计划

- [ ] 5.1 用 `BuildStrategy + ExecutionBinding` 替换预发布 `BuildConfiguration` 领域和持久化 schema，删除旧执行兼容路径。
      **Blocked by:** 1.4
      **Acceptance:** Strategy 仅含稳定团队语义；Binding 包含 Host/checkout facts 且绝对路径仅在 local overlay；旧状态只读诊断、不能继续执行
      **Requirements:** managed-work-execution#build-strategy-与-execution-binding-使用独立身份
- [ ] 5.2 将 BuildStrategy 与 effective composition 摘要纳入 Design proposal/approval，复用用户已明确的完整选择。
      **Blocked by:** 2.4, 5.1
      **Acceptance:** 正常 Open/Design 流只产生两个固定审批；Design 决定绑定策略与 binding composition，未决字段才请求补充
      **Requirements:** change-lifecycle#build-策略只在语义改变时请求人工决定
- [ ] 5.3 重写 Build Configure，使其只解析、验证和冻结当前 ExecutionBinding，不建立独立常规批准。
      **Blocked by:** 5.2
      **Acceptance:** 兼容 Host 更换、同 isolation binding 修复、正常 HEAD 变化和进程恢复自动重验；策略不匹配或不可证明 binding 阻断
      **Requirements:** managed-work-execution#build-strategy-与-execution-binding-使用独立身份
- [ ] 5.4 实现按 semantic digest 去重/复用 Human Decision，以及策略改变、composition 改变和真实未知结果的 reason 分类。
      **Blocked by:** 5.3
      **Acceptance:** 同摘要 retry/re-entry 不新增请求；策略/composition 语义变化使旧批准失效；外部授权和未知副作用仍停止
      **Requirements:** change-lifecycle#build-策略只在语义改变时请求人工决定
- [ ] 5.5 扩展 Plan Evidence 预检 Task/acceptance、repository/write scope、terminal report owner、Host capability、Skill/check composition 和 ExecutionBinding。
      **Blocked by:** 3.5, 5.3
      **Acceptance:** 历史 scope/report-owner 失败在 Execute 前被结构化 planning finding 捕获；改变规格语义才回 Design，否则留在 Plan revision
      **Requirements:** managed-work-execution#plan-evidence-在执行前证明完整执行边界
- [ ] 5.6 建立恢复/返工矩阵测试，覆盖 Configure、Plan、Execute、Check、Verify→Build 和同摘要 fallback。
      **Blocked by:** 5.4, 5.5
      **Acceptance:** 每条路径保持同一 Run 与策略，机器事实自动重验，除 Open/Design 和声明高风险 Plan 外不产生重复确认
      **Requirements:** change-lifecycle#build-策略只在语义改变时请求人工决定, managed-work-execution#plan-evidence-在执行前证明完整执行边界

## 6. Trajectory、OTLP 与桌面投影

- [ ] 6.1 定义 composition、binding、method receipt、strategy/binding、decision reuse 和 team check 的版本化 Trajectory 事件。
      **Blocked by:** 4.5, 5.6
      **Acceptance:** schema、顺序、幂等键、恢复重放、原因枚举和本地提交先于导出测试通过
      **Requirements:** development-telemetry#团队-skill-与方法验证必须形成可重放观测事实
- [ ] 6.2 扩展 OTLP 映射与隐私/基数门禁，区分 consumed 与 method_verified，并关联 Strategy、Binding、Validator 和 Decision。
      **Blocked by:** 6.1
      **Acceptance:** 捕获 exporter 可从乱序/重复 envelope 重建唯一链路；正文、Prompt、回复、命令输出、路径和高基数 Metric label 被拒绝
      **Requirements:** development-telemetry#团队-skill-与方法验证必须形成可重放观测事实, development-telemetry#build-策略绑定与人工等待必须可观测
- [ ] 6.3 更新 Desktop projection 和界面，展示内置/团队 Skill 角色、四段状态、required checks、当前有效决定及 reason。
      **Blocked by:** 6.2
      **Acceptance:** 同摘要重试只有一张决定卡；消费未验证、方法失败、检查阻断和正常状态视觉/文本可区分，且 UI 不查询本地 Run 旁路
      **Requirements:** desktop-observability-dashboard#当前-work-展示团队-skill-与方法验证, desktop-observability-dashboard#人工等待只展示当前有效语义决定
- [ ] 6.4 增加工作流健康度指标与离线复算测试，覆盖方法执行率、Receipt 拒绝、重复决定避免、Plan 提前拦截和团队 check 失败率。
      **Blocked by:** 6.2
      **Acceptance:** 指标可由 Trajectory/Event 复算，标签集合有界，未知团队 Skill 不生成新 Metric label
      **Requirements:** development-telemetry#团队-skill-与方法验证必须形成可重放观测事实

## 7. 上游、文档与完整验收

- [ ] 7.1 把 Matt Skills 固定版本、许可证、manifest/content digest 和 adapter contract 纳入每日上游对齐审计。
      **Blocked by:** 2.3, 4.3
      **Acceptance:** 无变化审计幂等；上游漂移生成发现但不改活动 Run；采用更新必须通过 Provider/Receipt contract 测试
      **Requirements:** skill-integration#固定-matt-skills-纳入上游对齐审计
- [ ] 7.2 更新项目配置、Skill、lifecycle、Build、telemetry、Dashboard 和 self-hosting 文档及示例。
      **Blocked by:** 6.3, 7.1
      **Acceptance:** 文档明确三类 binding、Action/个人边界、Method Receipt、两个固定审批点和机器 binding 自动重验；示例通过 Schema 校验且无第五规划工件
      **Requirements:** project-configuration#团队-skill-binding-属于共享配置, change-lifecycle#build-策略只在语义改变时请求人工决定
- [ ] 7.3 用打包 Runtime 在临时单仓 Workspace 执行含 team guidance/replacement/check、TDD 和 Desktop OTLP 的完整生命周期。
      **Blocked by:** 7.2
      **Acceptance:** 一个 Run 完成 Open→Design→Build→Verify→Archive；只有 Open/Design 两个固定人工停点；Dashboard 与捕获 exporter 对四段 Skill 状态一致
      **Requirements:** implementation-evidence#关键方法必须提交可机器核对的-method-receipt, development-telemetry#团队-skill-与方法验证必须形成可重放观测事实
- [ ] 7.4 执行真实多仓、重启和退化验收，覆盖 provider drift、个人覆盖、Action replacement、伪造 TDD、check 绕过、scope 错误和重复决定。
      **Blocked by:** 7.3
      **Acceptance:** 每类退化由正式 harness fail closed；多仓 repository/write scope 与 OpenSpec Store identity 保持正确，恢复不重复副作用
      **Requirements:** skill-integration#团队绑定编译为唯一有效-skill-composition, managed-work-execution#plan-evidence-在执行前证明完整执行边界
- [ ] 7.5 运行 `npm run verify`、OpenSpec strict、package/tracer E2E、provenance 和 Windows Desktop 测试，生成绑定 commit/run/configuration/composition 的验证报告。
      **Blocked by:** 7.4
      **Acceptance:** 全部正式检查通过，报告证明测试对受控退化敏感且没有 Prompt、路径或 Skill 正文泄漏
      **Requirements:** development-telemetry#团队-skill-与方法验证必须形成可重放观测事实
- [ ] 7.6 清理临时 Workspace、receiver、状态卷、日志和 payload，推送全部提交并确认远端分支与验证 HEAD 一致。
      **Blocked by:** 7.5
      **Acceptance:** 无临时进程或调试残留，工作树干净，远端包含被验证提交
      **Requirements:** change-lifecycle#build-策略只在语义改变时请求人工决定
