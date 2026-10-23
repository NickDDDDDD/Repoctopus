# Tasks

## 0. 固定基线与迁移边界

- [x] 0.1 同步并审计 Comet 0.5.0 `aeb1a6598034e28ce46b8422d4dbd8785e607bd7` 与 DSH `dsh-v0.2.1-rc.3` `1f81c047fc48fa190a683e469daa699857e9afe8`，记录采用、拒绝和延后项；执行 `npm run check:upstream`、`npm run check:provenance`、`npm run verify` 与生产依赖审计并推送固定基线。
- [ ] 0.2 为 generic Run、planning approval、Delivery v2/v3 与 Post-merge 状态建立只读 fixture 清单，记录每种状态的 authority、identity、输入、下一动作和外部副作用；用 golden test 证明迁移代码未启用前不会改写 fixture。
- [ ] 0.3 增加架构规则，列出允许拥有 lifecycle transition 的唯一模块，并拒绝新增 phase owner、直接 Run State 写入、独立 Post-merge Run 创建和 caller-selected lifecycle Skill；运行正反 fixture 证明每条规则可定位失败。

## 1. 交付 Open → Design → Build 的首个真实纵切

- [ ] 1.1 定义版本化 `ChangeLifecycleDefinition`、`ChangePhase`、`RunStatus`、`WorkDescriptor`、`WaitCondition` 和 `ChangeRunProjection`，扩展现有 Run snapshot/trajectory schema；用纯领域测试覆盖合法转换、非法跳阶段、phase/status 正交组合和相同输入的确定性结果。
- [ ] 1.2 实现内置五阶段 definition 的规范化、静态验证和 digest，并在 Change Run 创建时固定 id/version/content digest；用恢复测试证明同版本内容漂移进入 `migration_required`，键顺序等非语义差异不漂移。
- [ ] 1.3 在 production `WorkflowRuns` 和公共 CLI 中增加按 Workspace/change create-or-resume 的 Change Run 入口，Open 阶段核对 Specification Provider、目标分支和登记仓库；运行 CLI 进程外测试证明同一 generation 只产生一个活动 Run，Host/CLI 不拥有 phase 规则。
- [ ] 1.4 将当前 Specification Provider 的 planning manifest 和 strict validation 接入 Design，未完成四类产物、校验失败或没有可信 Human Decision 时只产生 `design/waiting|blocked`；运行真实 OpenSpec fixture 证明普通 `succeeded`、分支状态或 Agent 声明都不能进入 Build。
- [ ] 1.5 实现 approval proposal hash / approval hash，并通过公共决策入口记录 approve、revise、reject；用篡改测试证明 decision 只适用于对应 change、Provider、semantic digest、能力集合和目标分支。
- [ ] 1.6 从 Tasks 解析稳定 `taskId`、`taskRevision` 和依赖，生成首个 Build Work；用公共 `run next/status` 验证获批 change 显示唯一 ready Task、固定 Work 和下一步，而未批准 change 没有 Build Work。

## 2. 收敛规划语义摘要与任务失效规则

- [ ] 2.1 在 Specification Service 中定义后端中立 planning manifest 和 semantic digest 契约，由 OpenSpec Provider 映射 Proposal、Delta Specs、Design、Tasks 与受影响能力，不把 Provider 路径泄露给 Engine；执行 Provider contract tests。
- [ ] 2.2 实现 Tasks 规范化：checkbox 状态、换行和声明的格式噪声不影响 planning digest；Task ID、文字、层级、依赖、验收或需求映射变化必须改变 revision；运行 golden fixtures 覆盖每个正反样例。
- [ ] 2.3 将 Change 分支 remote OID 从 Design 语义摘要移到 publication provenance，同时继续要求规划分支公开并核对；测试证明推送非规划 commit 不使 approval 失效，规划语义变化即使同一分支也会失效。
- [ ] 2.4 实现 invalidation：Design 产物语义变化使当前 Build/Verify Work 失效并回到 Design，checkbox 因有效 Task 完成而变化不触发回退；用 trajectory 测试证明旧 approval、claim 和 Outcome 不可复用。
- [ ] 2.5 更新旧 planning approval 的兼容读取和迁移计划；只有重新计算 manifest 且可信用户确认时才成为新 Design decision，其他状态返回 `migration_required`，不静默沿用分支 OID 批准。

## 3. 强制固定 Skill、Action claim 与写入边界

- [ ] 3.1 扩展 Action Intent/Receipt/Outcome，使其绑定 `runId + workId + attempt + claimToken + inputDigest`；覆盖重复领取、陈旧版本、跨 Work Outcome、进程崩溃和响应丢失测试，证明副作用不在 RunStore transaction 内执行。
- [ ] 3.2 让 lifecycle definition 为每个 Work 固定 Skill 名称、能力、side-effect class、write scopes、期望产物和 validator profile；Skill Service 解析后把 Provider 与正文 digest 固定到 Run，调用方不能覆盖。
- [ ] 3.3 在 Application Plugin/Command Router 边界增加 runtime work guard，文件、命令、Git、MR 和 Specification 写操作必须来自活动 claim 且匹配能力与范围；用负向 fixture 拒绝无 claim 写入、越仓写入、terminal artifact 改写和错误 Adapter。
- [ ] 3.4 将现有 Manual/Process/Git/Specification Contributor 接到 Work Dispatcher；运行 production composition 纵切证明 Adapter 返回成功只形成 Outcome，缺少 Validator/Evidence 时 Task 和 phase 不推进。
- [ ] 3.5 实现 Build Task validator 和完成投影：验证通过后由 Provider 安全更新 checkbox/任务状态，重复完成幂等；验证失败、输入漂移和任务 revision 变化分别产生可定位状态。
- [ ] 3.6 加入团队协作测试，证明不同成员/Runner 可领取后续修复 Work，identity 仅用于授权和审计，不形成 change owner 或 MR 作者过滤。

## 4. 接入 Verify Gate 与回退循环

- [ ] 4.1 在全部 Task 有有效完成事实时生成不可变 verification input，绑定任务 revisions、仓库 commit/tree、配置、composition、Skill 和 Evidence Profile；任一输入缺失时保持 `build/blocked`。
- [ ] 4.2 复用 Evidence Attempt、Artifact、Gate 和 outbox 执行 Verify Work，只有相同 input digest 下 `satisfied` Gate 才进入 Archive；测试普通成功、旧 Gate 和跨 Run Artifact 均被拒绝。
- [ ] 4.3 实现正式验证报告 artifact 与隐私/大小限制，报告引用命令、结果和证据身份而不嵌入无限输出；运行失败、超时、取消、重试和 supersede 测试。
- [ ] 4.4 实现 Verify 失败或实现漂移返回 Build 的追加式 invalidation，保留旧 Evidence；用恢复测试证明进程中断后不会错误进入 Archive 或重复有效副作用。
- [ ] 4.5 通过真实自举 change 运行 Open→Design→Build→Verify 纵切，核对 CLI projection、Trajectory、Task 和 Evidence 的单一答案，并清理临时日志、scratch artifact 和测试进程。

## 5. 把 Delivery 与 Post-merge 收敛进 Archive

- [ ] 5.1 将现有 Delivery plan 映射为 Archive Work 输入：公开 Change 分支、默认一个或显式完整多个 Business MR、拆分理由、仓库/分支/目标和发布策略；移除与 Design/Verify 重复的独立 lifecycle approval，只保留策略要求的 Action authorization。
- [ ] 5.2 将 branch push 与 Business MR create-or-recover Adapter 接到 Archive Action/Receipt，运行多仓、响应丢失、普通非强制 push、远端 OID 漂移和平台能力不足测试。
- [ ] 5.3 把“等待全部 Business MR 合入”表示为持久 `archive/waiting` condition；Webhook、Inbox Runner、主动核对和开发 Run 前补偿只刷新平台事实并唤醒原 `runId`，测试证明不会创建第二个 Post-merge Run。
- [ ] 5.4 将精确 merge commit 临时检出、合入后 Evidence、MR 集合冻结和多 Runner 远端收敛接到同一 Run；覆盖目标分支继续前进、多个 MR、补充 MR、独立状态卷和并发 Runner。
- [ ] 5.5 将 Specification Provider sync/archive、路径语义审计、closure commit/push 和最终 Change MR create-or-recover 接到 Archive；测试只有 Gate 满足且允许差异发布后才创建最终 MR，Runtime 不自动合入。
- [ ] 5.6 fence 旧 Delivery/PostMergeCoordinator 写入口：公共旧命令返回新 Run projection 或迁移诊断，旧 webhook handler 只能投递事实；架构测试拒绝任何生产路径创建独立 Post-merge Run。
- [ ] 5.7 用中断矩阵验证每个 Archive 边界的 Intent、Receipt、Checkpoint 与 reconciliation，证明 push/MR/close 响应丢失不会重复产生逻辑副作用。

## 6. 完成 Cordis 扩展和组合治理

- [ ] 6.1 为 Lifecycle Definition、Work Contributor、Validator Contributor 与 Lifecycle Extension 定义独立 Cordis Service/Contributor 契约，加入 builtin catalog、依赖图和 composition snapshot；运行安装、卸载、依赖缺失与有界排空测试。
- [ ] 6.2 实现声明式安全 checkpoint 和 extension validation，拒绝扩展移动核心 transition、绕过 Design approval/Verify Gate、提前归档或扩大未声明写入范围；用恶意 fixture 验证 fail closed。
- [ ] 6.3 将 definition、Contributor、Validator、Extension、Skill 与 Specification 身份纳入 Run 恢复兼容检查，分别测试兼容升级、非语义排序变化和不兼容漂移。
- [ ] 6.4 更新能力账本、架构依赖规则与第三方采用记录，证明未引入第二套容器、通用 Capability Resolver、Comet 产品 shell 或 DSH 未发布源码。

## 7. 迁移、投影与运维可见性

- [ ] 7.1 实现只读 migration planner，按已记录 fixture 输出 `migratable`、`completed_history`、`manual_decision_required` 或 `migration_required`，不得在 plan 阶段写 Store 或调用平台。
- [ ] 7.2 实现受控迁移事务和旧写入口 fence，迁移后保存旧 identity/audit link 与新 Run generation；用崩溃注入证明重复执行幂等且不会双 coordinator 推进。
- [ ] 7.3 让 CLI 文本/JSON、Application Service 与开发工具统一消费 `ChangeRunProjection`，加入 `phase`、`status`、current Work、Task progress、wait、blocker、Evidence 和 next actions；运行协议兼容测试。
- [ ] 7.4 从 accepted trajectory 生成 OTLP phase/status/work/wait 事件，移除独立 Post-merge Run 遥测语义；用 golden fixture 证明 Desktop 与远端目的地可从同一事件得到一致状态且不泄露正文、路径或凭据。
- [ ] 7.5 更新 Runtime、Specification、Skill、Delivery、Post-merge、Plugin 和 Telemetry 文档；文档命令冒烟测试必须使用生产 composition 和公共 CLI，而不是测试旁路。

## 8. 全量验证与自举交付

- [ ] 8.1 执行领域、contract、Provider、process、platform、migration、architecture 和 telemetry 套件，修复 flaky/竞态后运行 `npm run verify`、`npm run test:package-e2e` 与 `npm run test:tracer-e2e`。
- [ ] 8.2 使用新 lifecycle 从公开 Change 分支完成本 change 的 Build、Verify 和 Archive，自举核对同一 Run 经 Business MR 合入、精确 merge commit 验证、规格同步、归档和最终 Change MR 后才 completed。
- [ ] 8.3 生成正式验证报告，记录 definition/composition 摘要、迁移矩阵、并发恢复实验、Evidence、平台 Receipt、已采用上游原则和明确排除项。
- [ ] 8.4 清理临时检出、审计 clone、日志、mock server、端口监听、scratch Artifact 和测试状态卷；复查 Git 状态、运行进程、公开分支与远端 OID，证明没有遗留调试产物或未推送 commit。

## Workflow follow-up

- 四类规划产物严格校验并经用户批准后才开始实施；当前 Change 分支保持公开，每次 commit 同步 push。
- 本 change 原则上使用一个 Business MR；只有多仓或独立可验证的必要拆分才登记多个，并冻结完整集合。
- 实现完成前不创建最终 Change MR；Business MR 合入后由同一 Change Run 的 Archive 阶段完成精确验证、规格同步、归档和最终 Change MR。
