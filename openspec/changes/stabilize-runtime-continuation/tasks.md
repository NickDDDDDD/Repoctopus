# Tasks

## 1. 锁定缺陷与新状态契约

- [ ] 1.1 增加 planning snapshot 因 composition、完整 project config 和 remote 表示差异而误失效的回归测试，并用 `npx vitest run test/specification-planning-approval.test.ts test/specification-planning-service.test.ts` 证明测试在旧实现下失败
- [ ] 1.2 增加 planning invalidation 全量清空 Build Protocol、重复创建批准和重复派发 Work 的生产服务回归测试，并用对应 `workflow-runs`/change lifecycle 测试证明旧行为被捕获
- [ ] 1.3 定义版本化 Runtime identity graph、节点/边有界枚举和 schema validator，并用单元测试覆盖重复 owner、环、未知依赖和非 SHA-256 identity 拒绝
- [ ] 1.4 定义 Change Run v2 checkpoint 与 suspended Build Protocol 状态，使用序列化 round-trip 和 state invariant 测试证明 current phase/Work 仍是唯一执行权威
- [ ] 1.5 更新 `docs/runtime-state.md` 的身份分层、预发布破坏性边界和旧 Run 只读规则，并用 `npm run format:check` 验证文档格式

## 2. 拆分 Specification Planning 与发布身份

- [ ] 2.1 先为 planning semantic、approval authority、validation observation 和 publication provenance 独立身份编写构造器测试，覆盖 checkbox/OID/composition 不改变语义而工件/metadata/target branch 改变语义
- [ ] 2.2 实现 `PlanningSemanticIdentity` 与 planning policy 配置投影，移除完整 composition/project config/source OID 对 approval semantic identity 的影响，并通过 2.1 测试
- [ ] 2.3 实现 stable repository ID 优先的 remote/base/head 规范化和 platform adapter 保守等价规则，并用 GitHub 大小写、`.git`、分隔符及未知平台不确定性测试验证
- [ ] 2.4 重构 Planning approval request/record/store 使用 semantic 与 authority identity，保证相同 proposal 的请求和决定重放幂等，并运行 approval domain tests
- [ ] 2.5 重构 Specification Planning `observeAuthority` 返回分层 observation 和 `semantic | approval-authority | publication | unknown` 结果，不在只读观察中刷新请求，并运行 service contract tests
- [ ] 2.6 更新 `docs/specification.md` 说明各身份 owner 与 publication-only 更新路径，并运行 `npm run spec:validate`

## 3. 实现依赖感知失效 Planner

- [ ] 3.1 先建立 identity graph 失效矩阵测试，覆盖 semantic、approval、composition、Build input、verification、publication 与 unknown 分类的 retained/invalidated 集合
- [ ] 3.2 实现纯领域 Invalidation Planner 和确定性 reason codes，证明相同输入得到规范化相同输出且不访问 I/O
- [ ] 3.3 扩展 Build Protocol reducer 支持 `suspended-for-design`、invalidation ledger 和不可调度候选状态，并用 reducer tests 验证 Design 中不能领取旧 Build Work
- [ ] 3.4 实现新 Design approval 后 Configuration → Plan → Package completion → Evidence 的逐层兼容重验，使用局部 Task/Plan 变化测试证明只失效依赖后继
- [ ] 3.5 将 planning-authority recovery 改为一次 CAS 提交 Design Work、epoch、execution retirement 和 planner 结果，不再无条件删除 Build Protocol，并运行 transition tests
- [ ] 3.6 为无法证明最小范围的情况实现保守 invalidation/Human Decision 路径，并验证不会静默保留 completion 或重开全部 Task
- [ ] 3.7 更新 `docs/self-hosting.md` 说明 Design 返工、suspended Build 与重新采用流程，并用 `npm run format:check` 验证

## 4. 收敛单一 Continuation 与 checkpoint 恢复

- [ ] 4.1 先增加相同 revision 上 `next/resume`、批准、Outcome 和 transition 重放的幂等测试，断言 Work/request/invalidation/副作用各只出现一次
- [ ] 4.2 实现共享 continuation projector，使 CLI、Runtime、Dashboard 投影只消费已提交 Run checkpoint，并用 projection parity tests 验证结果一致
- [ ] 4.3 为 Human Decision、Build Configuration proposal、Plan candidate、submission 和 invalidation 引入稳定 idempotency key 与 payload conflict 检查，并运行重放测试
- [ ] 4.4 实现 observation 后/CAS 前及 CAS 后/响应前的恢复逻辑，使用 fault injection 验证孤立内容无执行权且已提交 transition 不重复
- [ ] 4.5 实现 unknown invocation reconciliation 状态机，覆盖匹配 Outcome、确定性未执行和仍未知三种结果，并验证未知结果不自动 retry
- [ ] 4.6 统一 lifecycle current Work 与 execution checkpoint 的兼容判定，使无关 publication 变化保留 checkpoint、受保护输入漂移原子退役，并运行 work execution recovery tests
- [ ] 4.7 更新公共 CLI JSON continuation schema/诊断和 `docs/runtime-state.md` 示例，并用 CLI contract tests 与 `npm run typecheck` 验证

## 5. 分离 Composition adoption 与 Planning approval

- [ ] 5.1 先增加 `same | compatible-adoption | migration_required` 矩阵测试，覆盖未使用 Contributor、已 claim packet、definition 直接前驱和不完整 adoption
- [ ] 5.2 实现按 current checkpoint dependency closure 的 composition compatibility authority，替换全局 Skill snapshot 漂移即阻断/返 Design 的路径，并通过 5.1 测试
- [ ] 5.3 实现精确旧新 code/config/definition identity adoption catalog 与一次性 CAS 事实，拒绝通配、多前驱和用新内容重组旧 packet
- [ ] 5.4 让不兼容组合原地进入 `migration_required` 且保持 status/doctor 只读可用，并验证不会创建 Design approval 或第二个 Run
- [ ] 5.5 更新 `docs/plugin-architecture.md` 或现有 composition 文档记录 adoption 边界和 Provider 语义变化的职责分工，并运行 `npm run check:architecture`

## 6. 补齐 Trajectory 与 OTLP 稳定性证据

- [ ] 6.1 为 planner result、retained/invalidated counts、checkpoint recovery、dispatch suppression 和 reconciliation 定义版本化领域事实，并用 schema/allowlist tests 验证无路径、正文或自由错误泄漏
- [ ] 6.2 将新事实映射到规范 OTLP Trace/Event，限制 Metric labels 为有界 authority/classification/scope/result/continuation，并运行 telemetry mapping cardinality tests
- [ ] 6.3 实现重复批准率、Protocol 重建率、精确失效率、completion 保留率、checkpoint 恢复与 duplicate dispatch suppression 指标，并用持久事件复算测试验证
- [ ] 6.4 扩展 OTLP test receiver 纵切验收，证明本地 Desktop 与远端目的地消费同一 envelope 且失败不回滚 Run
- [ ] 6.5 更新 `docs/telemetry.md` 的稳定性指标、解释边界和 SigNoz 查询维度，并运行 `npm run format:check`

## 7. 生产纵切与多仓恢复验收

- [ ] 7.1 将 identity graph、Planner、Planning、Build、Recovery、Composition 和 Telemetry 通过 Cordis production composition 接通，并用公共 CLI 启动 fresh Run 验证无测试旁路
- [ ] 7.2 建立 adapted Comet parity fixtures，验证 checkbox 不改 revision、stable ID 恢复、stale checkpoint reconcile、唯一 continuation、CAS 漂移拒绝和 unknown 不 retry
- [ ] 7.3 运行单仓与多仓黑盒：Design 修改一个仓的 Task/Plan 后只重做受影响 Work Package，其他仓 completion/证据保持有效且 repository binding 不漂移
- [ ] 7.4 运行 Open、Design、Build Configure/Plan/Execute/Check、Verify、Archive 前置的中断恢复矩阵，交叉核对 Run、Trajectory、packet、受保护文件和 OTLP receiver
- [ ] 7.5 运行并发 Runner/CAS 测试，证明相同 checkpoint 只产生一个 claim、一个 Human Decision、一个 invalidation 和一个外部副作用 intent
- [ ] 7.6 通过生产 CLI 验证 composition compatible adoption 不重复批准、不兼容升级进入 `migration_required`、publication-only 更新不返回 Design
- [ ] 7.7 若实施实质复制 Comet 源码则更新第三方来源清单、固定 commit/路径/摘要/许可证并运行 `npm run check:provenance`；若仅行为重建则记录审计结论并验证清单无需新增快照

## 8. 删除旧语义并完成验证

- [ ] 8.1 删除旧 PlanningSnapshot 聚合授权、全量 Build Protocol 清空、跨域 composition→planning drift 和重复 proposal 构造分支，并用 `rg` 与 architecture tests 证明无生产引用
- [ ] 8.2 删除或重写依赖旧预发布 schema/全量失效的 fixtures，不增加 generation、双读、fallback adapter 或 Store 修复命令，并运行 migration/read-only tests
- [ ] 8.3 更新 `docs/specification.md`、`docs/runtime-state.md`、`docs/self-hosting.md`、`docs/telemetry.md` 的最终公共行为，使用文档中的命令执行一次可复现验收
- [ ] 8.4 运行 `npm run typecheck && npm run lint && npm test`，修复所有 Runtime、领域和服务回归
- [ ] 8.5 运行 `npm run verify` 与 `npx --yes --package=@rpamis/comet@0.5.1 comet classic openspec -- validate stabilize-runtime-continuation --strict`，保存正式 Verification Evidence 并确认无临时日志/调试文件残留
- [ ] 8.6 由独立 reviewer 对 identity owner、失效范围、unknown side-effect、CAS 原子性、多仓 binding 和遥测基数做高风险复核，解决全部阻断 finding 后才允许 Archive

## Workflow follow-up

- 在 Open 与 Design 的正式 Human Decision 均通过后才进入 Build。
- Verify 通过并具备完整 Evidence 后，通过 Comet controller 执行 Archive；不要为本次 Runtime 自举创建 Repoctopus Run。
- Archive 后检查分支、提交、PR 与远端状态，并清理仅用于本次审计的固定 Comet 临时源码目录。
