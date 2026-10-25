# Tasks

## 1. 锁定缺口并交付完整 claim packet 纵切

- [ ] 1.1 固定 Comet 0.5.0 `applicationSkillWork`、`skill-executor`、`skill-invocation` 的行为对照和当前 G1 bootstrap Run 身份；增加回归测试重现“assembler 有正文、public claim 只有 identity”的缺口，并验证测试在修复前失败。
- [ ] 1.2 定义版本化 `WorkExecutionPacket`、packet identity、Host requirement 和 Host invocation/outcome 类型；用领域测试验证正文与 identity digest 一致、对象深冻结、规范序列化稳定且正文不进入持久 identity。
- [ ] 1.3 重构 Work claim 为“先持久化不可变 ActionIntent，再由 Run CAS 绑定 identity，最后返回完整 packet”，保留 ActionStore 的 identity-only Schema但移除其 attempt/latest 权威；用 Store/Dispatcher 测试证明孤立 intent 不是 claim、并发 CAS 只有一个获胜 attempt、持久文件不含 Skill/Provider instruction/change input 正文，失败不暴露 packet。
- [ ] 1.4 升级公共 Application/CLI `run work-claim` 协议并保留明确的 identity-only 展示；运行打包 CLI E2E，证明 JSON Host 协议得到完整正文而普通文本、日志和诊断不泄漏正文。

## 2. 建立真实 Agent Host 执行端口

- [ ] 2.1 实现 Cordis `WorkExecutionHosts` registry、唯一选择和 Contributor identity；用注册、撤销、无 Host、双 Host、能力缺失和 composition snapshot 测试验证 fail closed。
- [ ] 2.2 实现 `ManagedWorkExecutor` 的 claim→preflight→Host invoke→Outcome→Action Receipt 纵切；用捕获 Host 测试证明 Host 收到完整冻结 packet，Host succeeded 仍需 Validator，Host failed 不推进 Task。
- [ ] 2.3 实现短生命周期 `WorkExecutionSession` 并把 RuntimeWorkGuard 接到显式 invocation identity；用并发测试验证两个 Run 不串线、session 结束立即失效、首次受保护写入早于 context delivery 会被拒绝。
- [ ] 2.4 为进程外 Host 增加带 session identity 的受保护操作协议和 Host-bound Outcome 校验；用伪造 Host、错误 packet digest、过期 claim、跨 Work Outcome 与无 session 写入 fixture 证明全部被拒绝。
- [ ] 2.5 实现 Host 调用中断与 reconciliation 语义；故障注入测试覆盖 claim 后崩溃、invoke 结果未知、可核对已执行、可证明未执行和无 reconcile Host，证明不会自动重发未知副作用或猜测成功。
- [ ] 2.6 把 `workExecution` 纳入唯一 Change Run aggregate/checkpoint，由现有 Run CAS 与 transition journal 原子持久化 Work attempt、claim/packet/Host/Outcome/Receipt identity 和 continuation；将 ActionStore 降级为先写的不可变内容库。测试覆盖内容写入后 CAS 前崩溃、CAS 后响应丢失、孤立内容、被引用内容缺失/损坏和并发 claim，证明不会产生第二套权威且恢复能收敛或 fail closed。
- [ ] 2.7 实现 `execute|ask|wait|reconcile|done` 恢复分类：未 invoke 的原 attempt 可重新交付、活跃 Host 必须等待、未知副作用必须核对、已持久 Outcome 从 Validator 继续、已接受 Validator 幂等完成 transition、Human Decision 保留原 proposal hash。
- [ ] 2.8 实现可选 Agent coordination checkpoint，用于上下文压缩、Agent handoff 和子任务进度；验证它不进入 OpenSpec 四类工件、不授权写入、不形成 completion claim，缺失或 stale 时只触发实际工作核对。
- [ ] 2.9 将多仓 Project Snapshot reconciliation 接入 Work resume：按 repository identity 重新解析本机路径和 scope，核对 commit/dirty state/definition/composition/Skill/Provider/packet digest，漂移时返回结构化 reconcile 或 migration 而不重复执行。

## 3. 提供阶段 Skill 与 Specification Provider 协议

- [ ] 3.1 新增内置 `repoctopus-lifecycle` Skill Provider 和五个阶段 action Skills，登记 package/provenance/composition；运行 Skill catalog 与内容摘要测试，证明阶段 Skill 可被模型调用且不复制 OpenSpec 模板或建立第五类工件。
- [ ] 3.2 扩展 Specification Provider 的阶段上下文契约，为 Open、Design、Build、Verify、Archive 返回适用工件、官方 instructions/template、允许操作和 identity；用真实 OpenSpec fixture 验证 schema/template 漂移和缺失阶段协议在 claim 前失败。
- [ ] 3.3 更新上下文装配顺序和冲突检查，使阶段 action、Provider protocol、Matt augmentations、Method Profile 与 change inputs 全部进入 packet；用生产 composition 消费测试断言实际正文和顺序，而非只断言 source/digest。
- [ ] 3.4 把 Build 组合改为 `repoctopus-build-task + tdd + codebase-design`，retry 条件增加 `diagnosing-bugs`；用首写测试证明三项正文在测试/实现写入前已被 Host 消费，调用方不能增删或重排。
- [ ] 3.5 把 Verify 组合改为 `repoctopus-verify-change + code-review`，Archive close 使用 `repoctopus-archive-change`、发布使用 `pr`；用阶段契约测试证明 action owner 唯一且自动 Evidence/Publication 不冒充 Agent review。

## 4. 让五阶段 Work 全部生产可达

- [ ] 4.1 破坏性升级 builtin lifecycle definition、Run schema 和 claim 协议，删除不可达 `specification.decision`、Open 自动 observation、ActionStore latest-attempt 权威、旧分支与对应兼容 fixture，并登记每个 Work 的 creator、Host action、Contributor 和 Validator；架构测试遍历 definition 和生产路由，证明不存在仅由测试构造的 Work kind，也不存在旧协议 fallback、双读或双写。
- [ ] 4.2 实现 Open `change.intake` 的创建、claim、`repoctopus-open-change` Host 执行、最小 Specification 写 scope、Provider validator 和 transition；进程外 fixture 从不存在的 change 开始，证明首次及重复 `run next` 都保持 Open 并返回同一 Work/attempt，裸 `open-intake-ready` observation、目录/工件存在和伪造 Outcome 均不能推进，只有原 Host Outcome 与 `open.intake-ready` Validator identity 被同一 Run CAS 接受后才进入 Design。
- [ ] 4.3 实现 Design `specification.plan` 的创建、retry、strict validation 和 Human Decision 衔接；fixture 依次覆盖缺失工件、无效工件、Host succeeded 但校验失败、四类工件有效后 waiting，以及可信批准后进入 Build。
- [ ] 4.4 将 Build 调度接到 ManagedWorkExecutor，并由 Provider/Validator 唯一更新 Task checkbox；用两个 Task 的 red-green-refactor 纵切证明每个 Task 都有独立 packet、Receipt 和 validation，Agent 直接勾选不能推进。
- [ ] 4.5 将 Verify Host Outcome 设为自动 Evidence 执行的前置事实，并保留失败回 Build；测试证明仅测试命令通过、仅 code-review identity 存在或伪造 review Outcome 都不能进入 Archive。
- [ ] 4.6 将 Archive 的 specification close 与 delivery publish 都接到真实 Work/Host/Validator 链路；故障注入覆盖 closure candidate、publication journal、PR create-or-recover 和 Host 中断，断言同一 Run 可恢复且终态与 MR state 正交。

## 5. 区分 fresh 与 adopt-existing 并完成自举接管

- [ ] 5.1 在 Change Run trigger、projection 和 CLI 中加入冻结的 `fresh|adopt-existing` mode；测试默认 fresh、显式 adopt 和 mode 进入 identity。旧预发布 Run 只返回只读 `migration_required/new-generation-required` 诊断，不实现旧 schema 的执行兼容 Adapter，也不在原 generation 下静默重解释。
- [ ] 5.2 更新 Specification Task 投影：fresh 中预勾选且无当前 Receipt 返回 adoption conflict，adopt-existing 才生成带来源摘要的 imported claims；运行 pending、部分完成、全完成、语义漂移和 Verify 仍必需的矩阵测试。
- [ ] 5.3 让旧 G1 bootstrap Run明确报告 definition/composition drift并保持只读，以新 generation `adopt-existing` 接管既有规划和实现；新 Run 必须记录可验证的 Open/Design adoption facts而不伪造旧 Work 历史，从首个未完成 Task 起使用完整 packet 与 Host 执行，Trajectory 必须记录 context delivered 和 host invoked。
- [ ] 5.4 更新 CLI、self-hosting、Skill、Specification 与架构文档，执行所有文档命令冒烟测试，明确受管 Host 边界、外部进程 drift、fresh/adopt 选择和正文隐私。

## 6. 用消费者导向的黑盒验收闭包

- [ ] 6.1 建立生产 composition 的 `CapturingWorkExecutionHost` 测试插件，只替代模型推理、不替代真实 Skill Registry、OpenSpec Provider、Store、Guard、Validator 或文件操作；架构测试证明它不进入 builtin catalog 和发布包默认组合。
- [ ] 6.2 在临时 Git Workspace 用打包 CLI/Application 协议从零运行 fresh `Open → Design → Build → Verify → Archive`，断言每阶段完整正文、当前输入、受保护文件结果和事件顺序 `claim.persisted → context.delivered → host.invoked → protected-operation.accepted → outcome.persisted → validator.accepted → lifecycle.transitioned`。
- [ ] 6.3 增加反作弊回归：identity-only、Host 未读正文、写入早于 delivery、无 Host、双 Host、Provider/Skill 漂移、session 过期、越仓写入、伪造 Outcome、fresh imported claim 任一出现时黑盒测试必须失败。
- [ ] 6.4 在 6.2 的每个持久边界故障注入终止进程并由新 Runner 恢复同一 Run；覆盖 waiting decision、Agent handoff、上下文压缩、Host running/unknown、Outcome 后、Validator 后和多仓路径重绑定，证明 continuation 精确且无重复副作用。
- [ ] 6.5 执行 `npm run verify`、`npm run test:package-e2e` 和 `npm run test:tracer-e2e`，生成正式验证报告，记录 G1 bootstrap 限制、新 generation 自举证据、fresh 五阶段黑盒 Receipt、断点恢复矩阵、未实现模型厂商 Host 和所有明确排除项。
- [ ] 6.6 清理临时 Workspace、捕获正文、测试状态卷、日志、进程和 scratch artifacts；复查 Git 状态、公开分支远端 OID、运行进程和 package contents，证明没有泄漏执行包正文或遗留未推送提交。

## Workflow follow-up

- Build 与 Verify 满足后，由同一 Change Run 执行规格关闭和发布 Work；实际 MR 合入仍由人决定，Run 不等待 MR 合入。
- 本 Change 完成并验证前暂停 `add-windows-desktop-dashboard` 的新实现；完成后从其现有规划继续，不把 Dashboard 状态机与 Host 执行状态分叉。
