# Tasks

## 1. 锁定缺口并交付完整 claim packet 纵切

- [x] 1.1 固定 Comet 0.5.0 `applicationSkillWork`、`skill-executor`、`skill-invocation` 的行为对照和当前 G1 bootstrap Run 身份；增加两个必须先在当前打包实现上失败的历史回归：assembler 有正文但 public claim 只有 identity，以及首次 `run next` 合成 `open-intake-ready` 并把 Open 自动推进到 Design；保存失败命令、旧 definition/commit 和可复现断言，防止后续把缺陷重定义为预期行为。
      **Acceptance:** 两个历史回归在旧实现上按预期失败，并固定 Comet 对照、G1 identity、旧 definition 与被测 commit
- [x] 1.2 定义版本化 `WorkExecutionPacket`、packet identity、Host requirement 和 Host invocation/outcome 类型；用领域测试验证正文与 identity digest 一致、对象深冻结、规范序列化稳定且正文不进入持久 identity。
      **Acceptance:** 领域测试证明 packet 内容与 identity digest 一致、对象深冻结、规范序列化稳定且持久 identity 不含正文
- [x] 1.3 重构 Work claim 为“先持久化不可变 ActionIntent，再由 Run CAS 绑定 identity，最后返回完整 packet”，保留 ActionStore 的 identity-only Schema但移除其 attempt/latest 权威；用 Store/Dispatcher 测试证明孤立 intent 不是 claim、并发 CAS 只有一个获胜 attempt、持久文件不含 Skill/Provider instruction/change input 正文，失败不暴露 packet。
      **Acceptance:** Store 与 Dispatcher 测试覆盖孤立 intent、并发 CAS、持久正文泄漏和失败 packet 暴露，且仅一个 attempt 成为权威 claim
- [x] 1.4 破坏性升级公共 Application/CLI `run work-claim` 协议并仅保留不可执行的 identity-only inspection projection，不提供旧 claim fallback；运行打包 CLI E2E，证明 JSON Host 协议得到完整正文，而普通文本、只读 inspection、日志和诊断不泄漏正文或取得执行能力。
      **Acceptance:** 打包 CLI E2E 证明 Host 协议取得完整 packet，其他公共投影不泄漏正文或获得执行能力，且不存在旧 claim fallback

## 2. 建立真实 Agent Host 执行端口

- [x] 2.1 实现 Cordis `WorkExecutionHosts` registry、唯一选择和 Contributor identity；用注册、撤销、无 Host、双 Host、能力缺失和 composition snapshot 测试验证 fail closed。
      **Acceptance:** Host registry 测试覆盖注册、撤销、无候选、歧义候选、能力不足与 composition snapshot，并全部按契约 fail closed
- [x] 2.2 实现 `ManagedWorkExecutor` 的 claim→preflight→Host invoke→Outcome→Action Receipt 纵切；用捕获 Host 测试证明 Host 收到完整冻结 packet，Host succeeded 仍需 Validator，Host failed 不推进 Task。
      **Acceptance:** 捕获 Host 纵切收到完整冻结 packet，成功 Outcome 仍等待 Validator，失败 Outcome 不推进 Task
- [x] 2.3 实现短生命周期 `WorkExecutionSession` 并把 RuntimeWorkGuard 接到显式 invocation identity；用并发测试验证两个 Run 不串线、session 结束立即失效、首次受保护写入早于 context delivery 会被拒绝。
      **Acceptance:** 并发测试证明 session 按 invocation 隔离、关闭后失效，且 context delivery 前的受保护写入被拒绝
- [x] 2.4 为进程外 Host 增加带 session identity 的受保护操作协议和 Host-bound Outcome 校验；用伪造 Host、错误 packet digest、过期 claim、跨 Work Outcome 与无 session 写入 fixture 证明全部被拒绝。
      **Acceptance:** 伪造 Host、错误 digest、过期 claim、跨 Work Outcome 与无 session 写入 fixture 全部被拒绝
- [x] 2.5 实现 Host 调用中断与 reconciliation 语义；故障注入测试覆盖 claim 后崩溃、invoke 结果未知、可核对已执行、可证明未执行和无 reconcile Host，证明不会自动重发未知副作用或猜测成功。
      **Acceptance:** 故障注入覆盖全部 Host 中断窗口，未知副作用不会被自动重发或推断为成功
- [x] 2.6 把 `workExecution` 纳入唯一 Change Run aggregate/checkpoint，由现有 Run CAS 与 transition journal 原子持久化 Work attempt、claim/packet/Host/Outcome/Receipt identity 和 continuation；将 ActionStore 降级为先写的不可变内容库。测试覆盖内容写入后 CAS 前崩溃、CAS 后响应丢失、孤立内容、被引用内容缺失/损坏和并发 claim，证明不会产生第二套权威且恢复能收敛或 fail closed。
      **Acceptance:** 原子性与恢复测试证明 Run aggregate 是唯一推进权威，所有中断、损坏与并发窗口收敛或 fail closed
- [x] 2.7 实现 `execute|ask|wait|reconcile|done` 恢复分类：未 invoke 的原 attempt 可重新交付、活跃 Host 必须等待、未知副作用必须核对、已持久 Outcome 从 Validator 继续、已接受 Validator 幂等完成 transition、Human Decision 保留原 proposal hash。
      **Acceptance:** 恢复矩阵为各持久边界返回唯一合法 continuation，并保持 attempt、Validator 与 Human Decision identity
- [x] 2.8 实现可选 Agent coordination checkpoint，用于上下文压缩、Agent handoff 和子任务进度；验证它不进入 OpenSpec 四类工件、不授权写入、不形成 completion claim，缺失或 stale 时只触发实际工作核对。
      **Acceptance:** coordination checkpoint 缺失、过期或存在时均不改变规格权威、写入授权或 completion claim
- [x] 2.9 将多仓 Project Snapshot reconciliation 接入 Work resume：按 repository identity 重新解析本机路径和 scope，核对 commit/dirty state/definition/composition/Skill/Provider/packet digest，漂移时返回结构化 reconcile 或 migration 而不重复执行。
      **Acceptance:** 多仓恢复测试对路径重绑定和所有身份漂移返回结构化 reconcile 或 migration，且不重复执行 Work
- [x] 2.10 将 `run next` 收敛为 pull-based continuation/dispatch 入口：不得接受目标 phase、Work 或 Skill 选择，只能解析并调度 Runtime 当前 Action；每个写响应直接返回新 continuation，`run status` 保持只读，`run work-*` 只作为 Host 协议。测试覆盖自动连续、manual handoff、Human Decision、unknown、failed 和 cold resume，证明 `auto_transition` 只控制是否消费下一 `execute`，不参与 transition 合法性。
      **Acceptance:** 公共入口测试证明调用方不能选择 phase、Work 或 Skill，所有 continuation 与停止条件由 Runtime 决定

## 3. 提供阶段 Skill 与 Specification Provider 协议

- [x] 3.1 新增内置 `repoctopus-lifecycle` Skill Provider 和五个阶段 action Skills，登记 package/provenance/composition；运行 Skill catalog 与内容摘要测试，证明阶段 Skill 可被模型调用且不复制 OpenSpec 模板或建立第五类工件。
      **Acceptance:** Skill catalog、package、provenance 与 composition 检查通过，五个 action Skills 可解析且不复制 Provider 模板或新增工件
- [x] 3.2 扩展 Specification Provider 的阶段上下文契约，为 Open、Design、Build、Verify、Archive 返回适用工件、官方 instructions/template、允许操作和 identity；用真实 OpenSpec fixture 验证 schema/template 漂移和缺失阶段协议在 claim 前失败。
      **Acceptance:** 真实 OpenSpec fixture 为五阶段返回完整协议，schema、template 或阶段协议漂移均在 claim 前失败
- [x] 3.3 更新上下文装配顺序和冲突检查，使阶段 action、Provider protocol、Matt augmentations、Method Profile 与 change inputs 全部进入 packet；用生产 composition 消费测试断言实际正文和顺序，而非只断言 source/digest。
      **Acceptance:** 生产 composition 测试按固定优先级收到并消费每层真实正文，冲突或重排被拒绝
- [x] 3.4 把 Build 组合改为 `repoctopus-build-task + tdd + codebase-design`，retry 条件增加 `diagnosing-bugs`；用首写测试证明三项正文在测试/实现写入前已被 Host 消费，调用方不能增删或重排。
      **Acceptance:** Build 首写测试证明固定 Skills 在副作用前被消费，retry 条件正确加入 diagnosing-bugs，调用方无法篡改组合
- [x] 3.5 把 Verify 组合改为 `repoctopus-verify-change + code-review`，Archive close 使用 `repoctopus-archive-change`、发布使用 `pr`；用阶段契约测试证明 action owner 唯一且自动 Evidence/Publication 不冒充 Agent review。
      **Acceptance:** 阶段契约测试证明 Verify 与 Archive 的 action owner 和 augmentation 唯一，自动步骤不能伪装 Agent review

## 4. 让五阶段 Work 全部生产可达

- [x] 4.1 破坏性升级 builtin lifecycle definition、Run schema 和 claim 协议，删除不可达 `specification.decision`、Open 自动 observation、ActionStore latest-attempt 权威、旧分支与对应兼容 fixture，并登记每个 Work 的 creator、Host action、Contributor 和 Validator；架构测试遍历 definition 和生产路由，证明不存在仅由测试构造的 Work kind，也不存在旧协议 fallback、双读或双写。
      **Acceptance:** 架构测试遍历 definition 与生产路由，所有 Work 均可达且旧协议、死分支、双读和双写均不存在
- [x] 4.2 实现 Open `change.intake` 的创建、claim、`repoctopus-open-change` Host 执行、最小 Specification 写 scope、Provider validator 和 transition；进程外 fixture 从不存在的 change 开始，证明首次及重复 `run next` 只解析/调度同一 Runtime-selected Work且不能产生完成事实，裸 `open-intake-ready` observation、目录/工件存在和伪造 Outcome 均不能推进，只有原 Host Outcome 与 `open.intake-ready` Validator identity 被同一 Run CAS 接受后才进入 Design，并在同一响应返回 Design continuation。
      **Acceptance:** 进程外 Open fixture 只在原 Host Outcome 与 Validator 被同一 Run 接受后进入 Design，所有伪造或存在性捷径均失败
- [x] 4.3 实现 Design `specification.plan` 的创建、retry、strict validation 和 Human Decision 衔接；fixture 依次覆盖缺失工件、无效工件、Host succeeded 但校验失败、四类工件有效后 waiting，以及可信批准后进入 Build。
      **Acceptance:** Design fixture 覆盖缺失、无效、Host 假成功、等待决定与可信批准，只有完整严格有效规划在批准后进入 Build
- [x] 4.4 将 Build 调度接到 ManagedWorkExecutor，并由 Provider/Validator 唯一更新 Task checkbox；用两个 Task 的 red-green-refactor 纵切证明每个 Task 都有独立 packet、Receipt 和 validation，Agent 直接勾选不能推进。
      **Acceptance:** 两 Task 纵切为每项生成独立 packet、Receipt 与 validation，只有 Provider/Validator 能投影完成，直接勾选不能推进
- [x] 4.5 将 Verify Host Outcome 设为自动 Evidence 执行的前置事实，并保留失败回 Build；测试证明仅测试命令通过、仅 code-review identity 存在或伪造 review Outcome 都不能进入 Archive。
      **Acceptance:** Verify 测试证明真实 review Outcome 与自动 Evidence 缺一不可，失败返回 Build，伪造或单项事实不能进入 Archive
- [x] 4.6 将 Archive 的 specification close 与 delivery publish 都接到真实 Work/Host/Validator 链路；故障注入覆盖 closure candidate、publication journal、PR create-or-recover 和 Host 中断，断言同一 Run 可恢复且终态与 MR state 正交。
      **Acceptance:** Archive 故障注入覆盖关闭、Journal、MR 恢复与 Host 中断，同一 Run 幂等收敛且终态不依赖 MR 合入状态

## 5. 区分 fresh 与 adopt-existing 并完成自举接管

- [x] 5.1 在 Change Run trigger、projection 和 CLI 中加入冻结的 `fresh|adopt-existing` mode；测试默认 fresh、显式 adopt 和 mode 进入 identity。旧预发布 Run 只返回只读 `migration_required/new-generation-required` 诊断，不实现旧 schema 的执行兼容 Adapter，也不在原 generation 下静默重解释。
      **Acceptance:** trigger、projection 与 CLI 测试固定 fresh/adopt identity，旧 Run 只返回迁移诊断且不会被静默重解释
- [x] 5.2 更新 Specification Task 投影：fresh 中预勾选且无当前 Receipt 返回 adoption conflict，adopt-existing 才生成带来源摘要的 imported claims；运行 pending、部分完成、全完成、语义漂移和 Verify 仍必需的矩阵测试。
      **Acceptance:** Task 投影矩阵区分 pending、部分、全部、语义漂移与两种 mode，imported claim 不能跳过 Verify
- [x] 5.3 让旧 G1 bootstrap Run明确报告 definition/composition drift并保持只读，以新 generation `adopt-existing` 接管既有规划和实现；新 Run 必须记录可验证的 Open/Design adoption facts而不伪造旧 Work 历史，从首个未完成 Task 起使用完整 packet 与 Host 执行，Trajectory 必须记录 context delivered 和 host invoked。
      **Acceptance:** 自举证据显示 G1 只读漂移，新 generation 记录真实 adoption facts，并从首个未完成 Task 产生完整 Host trajectory
- [x] 5.4 更新 CLI、self-hosting、Skill、Specification 与架构文档，执行所有文档命令冒烟测试，明确受管 Host 边界、外部进程 drift、fresh/adopt 选择和正文隐私。
      **Acceptance:** 文档命令冒烟测试通过，所有入口对 Host 边界、drift、mode 与正文隐私的描述一致

## 6. 把受管执行事实投影为统一 OTLP 遥测

- [x] 6.1 扩展版本化 Trajectory event schema，为 phase、Work create/claim/context/Host/completion、Skill resolve/deliver/consume、受保护 tool start/complete、Validator、wait、reconcile 和 continuation 建立稳定 identity 与成对时间戳；所有成功事件必须与对应 Run CAS/transition journal 一起持久化，测试证明提交失败不导出成功、重放不改变 event/invocation identity。
      **Acceptance:** Trajectory 测试覆盖全部执行边界、稳定 identity 与时间戳，提交失败不导出成功且重放 identity 不变
- [x] 6.2 扩展 Telemetry mapping 和 OTLP exporter：用同一 Change Run trace identity 生成 phase、Work attempt、Host、tool、Validator 与 wait Span，生成版本化审计 Log/Event，并从同一事件派生 duration histogram 和 attempt/result/retry/reconcile/Skill/tool counters；测试跨进程恢复、未结束边界、重复投递、事件乱序和相同 Run 的唯一关联链。
      **Acceptance:** OTLP mapping 测试在恢复、未结束、重复和乱序下维持同一 Run 关联链，并生成规定的 Log、Span 与 Metric
- [x] 6.3 将 Skill 遥测绑定真实 packet/Host 回执：分别记录 action/augmentation 的 resolved、delivered 与可验证 consumed，不从 Work 成功推断消费；将工具遥测绑定 `WorkExecutionSession` 的受保护 operation identity，只记录 capability/operation kind/result/duration，旁路外部操作只产生 drift。用 Host/tool fixture 覆盖未读正文、部分 augmentation、调用失败、超时和重试。
      **Acceptance:** Host/tool fixture 证明 Skill 消费只来自 packet 回执，工具事件只来自有效 session，旁路、失败、超时与重试分类正确
- [x] 6.4 建立遥测隐私与基数 gate：Event/Trace 禁止正文、Prompt/回复、tool 参数/结果、命令、diff、文件/绝对路径、URL、环境变量和凭据；Metric label 禁止 run/change/task/repository、digest、自由 Skill/插件名和 invocation identity，只允许有界 phase/work/tool/role/result/recovery 分类。用恶意 payload、超长 ID、自定义 Skill/工具和 cardinality budget 测试 fail closed/降级为 `custom|unknown`。
      **Acceptance:** 隐私与基数测试拒绝全部敏感字段和高基数 label，并将未知自定义分类稳定降级为 custom 或 unknown
- [x] 6.5 通过真实 OTLP HTTP 测试 receiver 验证日志、Trace 和 Metric payload，与持久 Trajectory 逐事件核对；复用 cursor/outbox 覆盖 Collector 不可用、进程退出、积压重放和重复发送，证明本地 Desktop 与远端 SigNoz 消费同一协议且遥测失败不影响 Work/phase 结果。
      **Acceptance:** 真实 OTLP receiver 与持久 Trajectory 逐事件一致，outbox 故障矩阵可恢复且遥测失败不改变 Work 或 phase

## 7. 用消费者导向的黑盒验收闭包

- [x] 7.1 建立生产 composition 的 `CapturingWorkExecutionHost` 测试插件，只替代模型推理、不替代真实 Skill Registry、OpenSpec Provider、Store、Guard、Validator 或文件操作；架构测试证明它不进入 builtin catalog 和发布包默认组合。
      **Acceptance:** 捕获 Host 仅在测试 composition 注入，生产 catalog 与发布包不包含它，其他生产服务均未被替代
- [x] 7.2 在临时 Git Workspace 用独立进程启动打包 CLI/Application Host 协议，从不存在 change 目录的 fresh Run 执行 `Open → Design → Build → Verify → Archive`；测试不得 import `WorkflowRuns`、coordinator/reducer、直接构造 Work 或 completion observation。每个公共调用后分别断言 continuation/中间 phase、追加式 trajectory identity/顺序、实际受保护文件和 6.x OTLP 记录；尤其证明首次及重复 `run next` 在 Open Host/Validator 完成前保持同一 Work/attempt。最终事件顺序必须为 `claim.persisted → context.delivered → host.invoked → protected-operation.accepted → outcome.persisted → validator.accepted → lifecycle.transitioned`。
      **Acceptance:** 独立进程黑盒从空目录完成五阶段，并同时验证公共状态、文件、Trajectory、OTLP 与规定事件顺序
- [x] 7.3 增加反作弊与验收灵敏度回归：identity-only、Host 未读正文、写入早于 delivery、无 Host、双 Host、Provider/Skill 漂移、session 过期、越仓写入、伪造 Outcome、fresh imported claim 任一出现时黑盒测试必须失败；另用三个受控故障 fixture 分别重新引入 Open 自动 `open-intake-ready`、跳过 Host 正文消费和伪造 Validator acceptance，证明 7.2 的同一 harness 会失败，而不是只验证 happy path 最终成功。
      **Acceptance:** 所有反作弊输入与三个受控退化 fixture 都使同一主黑盒 harness 按预期失败
- [x] 7.4 在 7.2 的每个持久边界故障注入终止进程并由新 Runner 恢复同一 Run；覆盖 waiting decision、Agent handoff、上下文压缩、Host running/unknown、Outcome 后、Validator 后和多仓路径重绑定，证明 continuation 精确且无重复副作用。
      **Acceptance:** 每个持久边界均可由新 Runner 恢复同一 Run，continuation 精确且无重复或遗漏的副作用
- [x] 7.5 执行 `npm run verify`、`npm run test:package-e2e` 和 `npm run test:tracer-e2e`，生成 `verification/complete-managed-change-execution/verification-report.md`，固定被测 Git commit、打包产物 checksum、definition/composition digest、公共命令、runId、事件/Receipt identity、两个历史 red baseline、三个受控故障 fixture 的预期失败、fresh 五阶段黑盒证据、OTLP taxonomy/隐私/基数检查和断点恢复矩阵；报告与待发布 commit/package 不一致时 Verify 必须失败，并记录未实现模型厂商 Host 和所有明确排除项。
      **Acceptance:** 三条正式验证命令通过，报告固定全部声明证据且 commit 或 package 漂移会使检查失败
- [x] 7.6 清理临时 Workspace、捕获正文、OTLP receiver payload、测试状态卷、日志、进程和 scratch artifacts；复查 Git 状态、公开分支远端 OID、运行进程和 package contents，证明没有泄漏执行包正文或遗留未推送提交。
      **Acceptance:** 清理后无临时进程、状态卷、日志、捕获正文或 scratch 文件，公开分支同步且 package 不含敏感内容

## 8. 闭合 Design Acceptance 合同

- [x] 8.1 统一 Design Skill、Method Profile、Task parser 与 OpenSpec Provider 的结构化 Acceptance 合同；给全部既有 tracked Tasks 补齐显式 Acceptance，并用领域、Provider 和进程外 Design gate 回归证明缺失项在 Human Decision 前 fail-closed、完整项可进入审批且 Verify 能建立非空 coverage plan。
      **Acceptance:** 真实 `complete-managed-change-execution` Tasks 的每个 tracked Task 都投影至少一个稳定 Acceptance；无元数据 fixture 在 Design blocked，完整 fixture 保持原五阶段行为；相关定向测试和 OpenSpec strict validation 通过
      **Requirements:** specification-authority#design-在批准前验证结构化-acceptance

- [x] 8.2 修复 Verify code review 发现的 Acceptance 合同缺口：Parser 只接受层级正确的规范 `**Acceptance:**` 元数据，Provider 只把完整性断言映射为 missing-Acceptance diagnostic，并保留其他 Tasks 投影失败的真实身份。
      **Acceptance:** 无缩进、无粗体和旧别名 fixture 均在 Design blocked；重复 Task 等非 Acceptance 错误不会被误报；领域、Provider、进程外 Design gate 和全量回归通过
      **Requirements:** specification-authority#design-在批准前验证结构化-acceptance

- [x] 8.3 补齐 Verify 发现的进程外 Acceptance 负向矩阵：让 packaged CLI Design gate 分别执行无缩进、无粗体和旧别名 fixture，而不是只在领域测试覆盖其中两类。
      **Acceptance:** 三种畸形 Acceptance fixture 都通过真实 CLI/Runtime/OpenSpec Provider 链路在 Human Decision 前 blocked；完整 fixture 仍可进入审批；定向与全量回归通过
      **Requirements:** specification-authority#design-在批准前验证结构化-acceptance

- [x] 8.4 修复自举发现的 Verify 恢复缺口：Validator accepted 后允许新 Runner 复用同一 succeeded Host review 与 Evidence attempt 继续 gate 投影，不重复 Agent review 或 Validator 事实。
      **Acceptance:** production composition 在 Verify Validator 后模拟进程中断，由新 Application Host 使用原 Evidence attempt 恢复到 Archive；错误 Work、失败 Outcome 或不匹配 Validator 仍 fail closed
      **Requirements:** managed-work-execution#受管-work-必须可断点恢复且不重复副作用

- [x] 8.5 修复独立审查发现的恢复身份缺口：Runtime 确定性绑定 Evidence attempt，`run next` 从 `validated` 自动恢复，并让 Evidence Coordinator 拒绝覆盖和补偿已完成 attempt 的上下文落盘窗口。
      **Acceptance:** production composition 通过真实 Verify Validator 后在 Evidence 完成、gate 投影前中断；新 Application Host 仅调用 `run next` 即复用原 attempt 到 Archive，不由测试直接写 Validator、不要求调用方传 attemptId；context-only、journaled running、terminal Attempt 缺 Bundle、completed context 和跨 profile 重复 attempt 的恢复/互斥测试通过
      **Requirements:** managed-work-execution#受管-work-必须可断点恢复且不重复副作用

## Workflow follow-up

- Build 与 Verify 满足后，由同一 Change Run 执行规格关闭和发布 Work；实际 MR 合入仍由人决定，Run 不等待 MR 合入。
- 本 Change 完成并验证前暂停 `add-windows-desktop-dashboard` 的新实现；完成后从其现有规划继续，不把 Dashboard 状态机与 Host 执行状态分叉。
