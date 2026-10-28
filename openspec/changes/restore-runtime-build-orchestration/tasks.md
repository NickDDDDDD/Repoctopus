# Tasks

## 1. 固定错误基线与领域合同

- [x] 1.1 为当前 Build 直接从 Task 生成 `task.implement`、固定 TDD、缺少 Configure/Plan/Check 的行为增加 characterization tests，并确认旧实现按预期失败。
      **Blocked by:** 无
      **Acceptance:** 测试分别定位五个缺失边界，而不是只断言最终 phase
      **Requirements:** change-lifecycle#build-使用固定的受管内部协议
- [x] 1.2 为 Verify 失败重开 Task、创建特殊 Repair Work 的旧行为增加反向基线，并证明新断言在旧实现上失败。
      **Blocked by:** 1.1
      **Acceptance:** 测试可独立捕获 task reopen、`verify.repair` 与 `implementation.repair` 三类退化
      **Requirements:** change-lifecycle#verify-失败通过-build-plan-revision-返工, managed-work-execution#验证失败必须修订-build-plan-并创建普通-work
- [x] 1.3 定义版本化 `ExecutionWorkspaceIntent/Binding`、`BuildActionKind`、`BuildConfiguration`、`BuildPlan`、`WorkPackage`、`PlanEvidence` 与 `BuildCheckEvidence` 纯领域类型，并实现 canonical digest 与稳定 identity。
      **Blocked by:** 1.1
      **Acceptance:** 类型、冻结、规范化、序列化、顺序规范化、重复项、非法枚举与碰撞测试通过，等价输入摘要一致且领域模块不导入 Cordis 或平台 I/O
      **Requirements:** managed-work-execution#build-configure-产生可批准的不可变配置, managed-work-execution#runtime-buildplan-是-openspec-tasks-的执行投影
- [x] 1.4 升级 lifecycle definition/schema，声明五个 Build Action、固定策略集合、Validator profile 和合法内部转换。
      **Blocked by:** 1.3
      **Acceptance:** definition validation 接受唯一完整协议，拒绝 Hotfix、Tweak、Full Direct、缺步、重排和未声明模式
      **Requirements:** change-lifecycle#build-使用固定的受管内部协议, change-lifecycle#build-configuration-只允许受支持的固定策略
- [x] 1.5 为 Build reducer 建立表驱动测试，覆盖合法 Action 推进、self/retry、非法跳步、Host 指定下一步和 `auto_transition` 边界。
      **Blocked by:** 1.4
      **Acceptance:** Runtime 是唯一 Action 决策者，Agent/Runner 无法跳到 Plan、Execute、Check 或 Verify
      **Requirements:** change-lifecycle#build-使用固定的受管内部协议

## 2. 交付 Autonomous 单仓纵切

- [x] 2.1 扩展 Open decision，要求在四类工件批准前选择 `current|branch|worktree`，持久化不含绝对路径的 `ExecutionWorkspaceIntent`。
      **Blocked by:** 1.5
      **Acceptance:** 三种选择、缺失选择、过期/重放决定和模式变更测试通过；Open approval 语义与 OTLP 不含本机路径
      **Requirements:** change-lifecycle#open-在规划批准前固定执行隔离意图
- [x] 2.2 实现 execution-workspace Service 与 Git facts adapter，验证 Runner/Host 提供的单仓 checkout binding，再生成 Build Configure proposal。
      **Blocked by:** 2.1
      **Acceptance:** current/branch/worktree 的 repository、branch、head、worktree ownership 正向测试通过；Runtime 不创建/切换 checkout，虚假 binding、路径猜测、拓扑漂移与非法枚举阻断
      **Requirements:** managed-work-execution#build-configure-产生可批准的不可变配置
- [x] 2.3 建立配置 Human Decision，批准后冻结 semantic digest 与本地 binding digest，拒绝/修订留在 Configure，过期或重放决定不能推进。
      **Blocked by:** 2.2
      **Acceptance:** 批准、拒绝、篡改、重复响应和冷恢复测试通过，批准后切换 execution/TDD/isolation 被拒绝
      **Requirements:** change-lifecycle#build-configuration-只允许受支持的固定策略
- [x] 2.4 实现 `build.plan` Host Work、`build-plan-candidate` Outcome result 与 Plan Validator，让 Agent 把单仓 OpenSpec Tasks 投影为有界 Work Packages。
      **Blocked by:** 2.3
      **Acceptance:** Host 收到固定 Tasks/配置/拓扑/binding/Skill 并返回结构化 candidate；Runtime 规范化 revision 与摘要；依赖顺序、Task coverage、字段上限和非法新增需求测试通过；Plan 随 Run snapshot 保存且 OpenSpec change 目录不产生第五工件
      **Requirements:** managed-work-execution#runtime-buildplan-是-openspec-tasks-的执行投影, specification-authority#openspec-tasks-与-runtime-buildplan-分层而不平行
- [x] 2.5 实现最小 Plan Evidence Validator，验证 Task coverage、依赖、write scope、Host、isolation、Skill 和 acceptance，并支持无风险自动接受。
      **Blocked by:** 2.4
      **Acceptance:** 完整计划生成可复用 Evidence，任一输入漂移使其失效，用户先前批准 Design 不能替代验证
      **Requirements:** managed-work-execution#plan-evidence-在执行前证明计划可行
- [x] 2.6 从计划包派生 autonomous Execute Work，并沿现有 claim/packet/Host/Outcome/Validator 链完成一个真实 Task。
      **Blocked by:** 2.5
      **Acceptance:** 进程级测试证明 Host 收到当前包、真实 Skill 内容和范围，越界或输入漂移 Outcome 不接受
      **Requirements:** managed-work-execution#work-descriptor-只能由已接受计划派生
- [x] 2.7 实现最小 Build Check，汇总 package、Task acceptance、测试与 standard review 后进入 Verify，并完成单仓纵切测试。
      **Blocked by:** 2.6
      **Acceptance:** Configure→Plan→Evidence→Execute→Check→Verify 全链在每个边界可重启，缺任一 Evidence 不能进入 Verify
      **Requirements:** managed-work-execution#build-check-汇总计划和任务完成事实

## 3. 完整 BuildPlan 与多仓边界

- [x] 3.1 扩展 Plan 生成器，支持一个 Task 拆成多个包、多个强耦合 Task 合并包及显式 package dependency DAG。
      **Blocked by:** 2.7
      **Acceptance:** 单 Task 多包、多 Task 单包、依赖环、孤儿包和缺失 Task 引用测试通过
      **Requirements:** managed-work-execution#runtime-buildplan-是-openspec-tasks-的执行投影
- [x] 3.2 将 repository binding、write scope、acceptance refs、expected outcomes 与 validator profile 纳入 WorkPackage 和 Plan digest。
      **Blocked by:** 3.1
      **Acceptance:** 多仓 fixture 的每个包只包含声明仓库与路径，任一边界漂移会失效计划
      **Requirements:** managed-work-execution#runtime-buildplan-是-openspec-tasks-的执行投影
- [x] 3.3 实现 Plan revision reducer，保留历史、递增 revision、失效受影响 Work/Evidence，并允许纯执行调整不触发 Design approval 失效。
      **Blocked by:** 3.2
      **Acceptance:** 顺序/包边界修改留在 Build，Task 语义修改稳定返回 Design
      **Requirements:** specification-authority#openspec-tasks-与-runtime-buildplan-分层而不平行
- [x] 3.4 实现 definition 驱动的 Plan 风险策略和可选 Human Decision，禁止 Agent 自由文本决定是否暂停。
      **Blocked by:** 3.3
      **Acceptance:** 低风险自动通过，高风险建立绑定配置/计划摘要的决定，过期决定不能解锁 Execute
      **Requirements:** managed-work-execution#plan-evidence-在执行前证明计划可行
- [x] 3.5 让 Task 首次 completion 只由全部 required package 与 acceptance Evidence 投影，并保持 checkbox completion claim 单调；当前有效性由最新 Plan/Check Evidence 决定。
      **Blocked by:** 3.3
      **Acceptance:** 部分包成功、重复 completion、跨 revision completion、已勾选 Task 的后续返工包和全部满足测试通过；Verify 返工不取消 checkbox
      **Requirements:** specification-authority#openspec-tasks-与-runtime-buildplan-分层而不平行
- [x] 3.6 增加真实多仓纵切，验证 Workspace Store、两个业务仓、隔离 binding 与包依赖在进程重启后保持一致。
      **Blocked by:** 3.4, 3.5
      **Acceptance:** 打包 Runtime 在临时多仓 Workspace 完成 Build 协议，越仓写入和拓扑漂移 fail closed
      **Requirements:** managed-work-execution#runtime-buildplan-是-openspec-tasks-的执行投影

## 4. Execution Mode、Skill 与受管委派

- [x] 4.1 将 Skill 组合从 phase 静态数组改为由 definition、Build Action 和冻结配置确定的纯函数，并覆盖唯一 Provider 解析。
      **Blocked by:** 2.7
      **Acceptance:** 每个 Action 的有序组合有快照测试；execution mode 作为 Repoctopus action input，不解析 Superpowers 或不存在的 Matt Skill；调用方无法增删、替换或重排
      **Requirements:** skill-integration#阶段-work-必须装填固定且唯一的-skill-组合
- [x] 4.2 新增 Configure、Plan、Execute、Check action Skills，更新内置 Skill Provider 与真实内容交付检查。
      **Blocked by:** 4.1
      **Acceptance:** Host packet 含完整 action/augmentation 正文与资源，只有名称或 digest 时 invocation 被拒绝
      **Requirements:** skill-integration#核心阶段提供固定默认方法组合
- [x] 4.3 实现 `tddMode=tdd|direct` 装填和 Validator 差异，确保 direct 不要求 RED/GREEN 但仍要求相关测试、回归与 Check。
      **Blocked by:** 4.2
      **Acceptance:** 两种模式的正负测试通过，direct 不加载 TDD 且不能绕过测试或 Verify
      **Requirements:** change-lifecycle#build-configuration-只允许受支持的固定策略, skill-integration#核心阶段提供固定默认方法组合
- [x] 4.4 为 autonomous Host 增加明确 capability contract 与配置/能力/binding 漂移矩阵，证明它只能执行当前包且不能修改 Plan、Action、配置或静默降级。
      **Blocked by:** 4.2
      **Acceptance:** 兼容 Host 正常执行；越包、越仓、返回目标 Action、Host 更换、capability 消失、binding 漂移和模式切换请求只产生拒绝、blocked、decision 或 `migration_required`
      **Requirements:** managed-work-execution#work-descriptor-只能由已接受计划派生
- [x] 4.5 扩展 Host packet/outcome，定义 `subagent.dispatch.attested` coordinator capability 与结构化 delegation receipt，不把子调用变成新 Run 或并行 currentWork。
      **Blocked by:** 4.2
      **Acceptance:** 合法父子 execution identity、role、包范围和 Outcome 可验证；自由文本身份、同 execution 换角色、未知、重复、越界和脱离父 invocation 的 receipt 被拒绝
      **Requirements:** managed-work-execution#work-descriptor-只能由已接受计划派生
- [x] 4.6 在 `repoctopus-build-execute` action 中实现 subagent-driven-development 协调协议，并让所有子调用通过受保护工具 session 回到父 claim。
      **Blocked by:** 4.5
      **Acceptance:** 捕获 Host 测试证明 Repoctopus action 与 Matt augmentation 真实内容被消费、委派可恢复、无 Superpowers 依赖且子 Agent 无 phase/Action 决策权
      **Requirements:** skill-integration#核心阶段提供固定默认方法组合, managed-work-execution#work-descriptor-只能由已接受计划派生

## 5. Build Check 与统一返工

- [x] 5.1 完整实现 Build Check Validator，覆盖 package completion、Task acceptance、测试、独立 standard review、仓库漂移和未解决 finding。
      **Blocked by:** 3.6, 4.6
      **Acceptance:** 每一失败维度都有独立诊断与测试；reviewer execution 必须不同于被审查 implementation execution；只有绑定当前配置/计划/仓库摘要的 Check 可进入 Verify
      **Requirements:** managed-work-execution#build-check-汇总计划和任务完成事实
- [x] 5.2 将 Build/Verify finding 规范化为有界 classification 与 requirement/Task/package references，拒绝 Host 自选 phase。
      **Blocked by:** 5.1
      **Acceptance:** implementation、planning、evidence/infrastructure 与未知分类路由表测试通过
      **Requirements:** managed-work-execution#验证失败必须修订-build-plan-并创建普通-work
- [x] 5.3 实现 Verify→Build Plan revision，递增 checkEpoch、精确失效受影响 Evidence 并保留仍有效 completion。
      **Blocked by:** 5.2
      **Acceptance:** 单包返工、多包依赖返工和无法证明最小集合三条恢复测试通过
      **Requirements:** change-lifecycle#verify-失败通过-build-plan-revision-返工
- [x] 5.4 删除 Task reopen、Repair Work、`verify.repair`、`implementation.repair` 及其 production continuation，返工只生成普通 Execute/Check。
      **Blocked by:** 5.3
      **Acceptance:** production source 负向扫描和反作弊测试均无特殊 repair 生命周期，旧 fixture 仅保留为历史输入
      **Requirements:** managed-work-execution#验证失败必须修订-build-plan-并创建普通-work
- [x] 5.5 完成 Build Check 失败、Verify→Build、Verify→Design、基础设施 retry 与未知副作用 reconcile 的完整旅程测试。
      **Blocked by:** 5.4
      **Acceptance:** 所有旅程保持同一 runId、epoch 单调、Runtime 选择下一 Action且不重开 Task
      **Requirements:** change-lifecycle#verify-失败通过-build-plan-revision-返工

## 6. 持久化、恢复与公共投影

- [x] 6.1 升级 Change Run/trajectory schema，持久化配置、计划 revisions、Action、Plan/Check Evidence 与 invalidation，并保持大型正文内容寻址。
      **Blocked by:** 5.5
      **Acceptance:** schema round-trip、CAS、损坏、未知字段和内容缺失测试通过
      **Requirements:** change-lifecycle#build-使用固定的受管内部协议
- [x] 6.2 为 Configure、Plan、Evidence、Execute、Check 的每个提交边界增加 crash/restart 参数化测试和 Host reconciliation。
      **Blocked by:** 6.1
      **Acceptance:** 在任一边界终止进程后只恢复同一逻辑 attempt，不重复已确认副作用或跳 Action
      **Requirements:** managed-work-execution#plan-evidence-在执行前证明计划可行
- [x] 6.3 更新 Workflow Service、CLI continuation 与 JSON/text projection，展示当前 Build Action、冻结配置、计划 revision、包与阻塞依据，且不允许调用方选择下一 Action。
      **Blocked by:** 6.2
      **Acceptance:** 打包 CLI 的快照和进程测试通过，旧 repair/mode 参数被拒绝
      **Requirements:** change-lifecycle#build-使用固定的受管内部协议
- [x] 6.4 将旧预发布 Run 保持为只读 legacy audit，删除新旧 Build 协议的双读、双写和自动迁移分支。
      **Blocked by:** 6.1
      **Acceptance:** legacy fixture 字节不变且不能继续执行，新 Run 不读取旧 configuration/plan/repair 状态
      **Requirements:** change-lifecycle#build-configuration-只允许受支持的固定策略

## 7. Trajectory、OTLP 与文档

- [x] 7.1 为 Configure、Plan、Plan Evidence、Execute、Check、批准、revision、delegation、Skill 和 Validator 定义版本化 Trajectory 事件。
      **Blocked by:** 6.1
      **Acceptance:** 事件 schema、顺序、去重、隐私与只在本地提交后生成的测试通过
      **Requirements:** development-telemetry#build-协议的配置计划执行检查必须可观测
- [x] 7.2 实现 OTLP Trace/Event 映射和父子关联，让 autonomous 与 subagent 使用相同语义并可重放返工链。
      **Blocked by:** 7.1
      **Acceptance:** 捕获 exporter 可从乱序/重试事件重建唯一 Action 链，缺事实时不合成成功
      **Requirements:** development-telemetry#受管-change-执行必须产生完整可重放遥测
- [x] 7.3 更新有界 Metric 与基数/脱敏 gate，禁止 run、Task、package、repository、digest、自由 Skill 或 Agent identity 成为 label。
      **Blocked by:** 7.2
      **Acceptance:** 正常与恶意 fixture 证明指标可复算且未知/高基数值被拒绝或降级
      **Requirements:** development-telemetry#build-协议的配置计划执行检查必须可观测
- [x] 7.4 更新 runtime-state、telemetry、self-hosting、Skill 与 CLI 文档，解释唯一工作流、Runner 提供的 isolation binding、两种 execution mode、TDD direct 语义和 Tasks/BuildPlan 分层。
      **Blocked by:** 6.3, 7.3
      **Acceptance:** 文档示例命令可运行，明确 Runtime 本版不创建 checkout 且无 Superpowers 依赖；负向扫描无 Hotfix/Tweak/Full Direct/Repair lifecycle 或第五 OpenSpec 工件指导
      **Requirements:** specification-authority#openspec-tasks-与-runtime-buildplan-分层而不平行

## 8. 集成验收与自举证明

- [x] 8.1 用打包 Runtime 在临时单仓 Workspace 执行完整 Open→Design→Build→Verify→Archive，并在每个 Build Action 后重启。
      **Blocked by:** 7.4
      **Acceptance:** 全程一个 runId，两个规划批准、配置批准、计划 Evidence、Check 与 Archive 可从 Trajectory 核对
      **Requirements:** change-lifecycle#build-使用固定的受管内部协议
- [x] 8.2 在多仓 Workspace 分别执行 autonomous 与 subagent-driven-development，注入 topology/isolation/capability 漂移和子调用响应丢失。
      **Blocked by:** 8.1
      **Acceptance:** 正常路径完成，漂移 fail closed，委派 reconcile 不重复写入且没有并行 currentWork
      **Requirements:** managed-work-execution#work-descriptor-只能由已接受计划派生
- [x] 8.3 运行 Verify 返工和反作弊验收，覆盖 Task reopen、特殊 repair、跳 Plan、切换 mode、关闭 Review、越界 Skill 与第五规划工件。
      **Blocked by:** 8.2
      **Acceptance:** 每类退化均被正式 harness 捕获，合法 plan revision 保留仍有效 completion
      **Requirements:** change-lifecycle#verify-失败通过-build-plan-revision-返工, skill-integration#openspec-四类工件必须保持唯一规划权威
- [x] 8.4 执行 `npm run verify`、OpenSpec strict、package/tracer E2E 与 provenance 校验，生成绑定 commit、definition、configuration、plan 和 runId 的验证报告。
      **Blocked by:** 8.3
      **Acceptance:** 全部正式检查通过，报告可复现并证明验收对受控退化敏感
      **Requirements:** development-telemetry#受管-change-执行必须产生完整可重放遥测
- [x] 8.5 清理临时 Workspace、receiver、状态卷、日志和 payload，推送全部提交并确认远端分支与被验证 HEAD 一致。
      **Blocked by:** 8.4
      **Acceptance:** 无临时进程或调试残留，工作树干净且远端包含验证提交
      **Requirements:** change-lifecycle#build-使用固定的受管内部协议

## Workflow follow-up

- 本 Change 通过 Verify 后按普通 Archive 流程关闭，不等待 MR 合入。
- Desktop Dashboard Change 在本 Change 合入后适配新的 Build Action 与 OTLP 事件，再重新 Verify 和 Archive。
