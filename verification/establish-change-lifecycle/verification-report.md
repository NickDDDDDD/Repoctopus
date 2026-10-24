# establish-change-lifecycle 验证报告

## 结论与边界

- 结论：实现满足已批准的 Proposal、Design、Delta Specs 与 Tasks；一个持久 Change Run 已接管本 change，并从公开 Change 分支执行到 Build 尾部。
- 验证日期：2026-10-24。
- Change 分支：`spec/establish-change-lifecycle`，报告生成前远端 OID 为 `e8831cbfe41ba7b718135c537a8c3737eba01fba`。
- 目标分支：`main`，Run 冻结的远端 OID 为 `01c82b5e508280eca8a8c69f25695abebc112a70`。
- 本报告是 Verify 的输入，不伪造尚未发生的平台事实。Evidence Bundle、Business MR 合入、精确 merge commit、规格归档和最终 Change MR 由同一 Run 在报告提交后继续记录；MR 合并始终由人执行，Runtime 不自动合入。

## Run、Definition 与 Composition

| 身份                 | 值                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Run ID               | `change-repoctopus-establish-change-lifecycle-g1-ed6b91e8cc5763eb`                               |
| Change generation    | `1`                                                                                              |
| Lifecycle Definition | `repoctopus-change@1.1.0`                                                                        |
| Definition digest    | `sha256:75ab3e23642dba9717978cdb6969b6b75704aeb1f3662a5e2cfcde4327e2f67d`                        |
| Frozen composition   | `repoctopus-project` / `sha256:c8984a1f1900a00dd53bfc3d944f73bc2440e99ae2a51d9b7e0ef30821fda179` |
| Project config       | `sha256:631c3b1c60116e72f943f04e21e99563db545ae2d57d60e51f05b0101fe547bb`                        |
| Planning manifest    | `sha256:e2bd00a77a25d95db902dc2b0675f054cfe572ae49f419c27ffc32e008695b78`                        |
| Specification root   | OpenSpec Store `repoctopus`, repository `repoctopus`                                             |

Definition 固定 `Open → Design → Build → Verify → Archive`。业务 phase 与执行 status 分离；CLI、Desktop 和 OTLP 只消费同一个 `ChangeRunProjection`，不各自推断状态。Cordis 仍是唯一组合容器，Lifecycle Definition、Work Contributor、Validator Contributor 与 Lifecycle Extension 分别进入 composition 身份。

## Design 决策与真实自举 Receipt

- Design request：`ec2ddf93-5a55-4cc7-b1d7-d88616837045`。
- Proposal hash：`sha256:fbcf9b856c3cd0f1b61abb56903c554085b354f958512cf022def076c79ac063`。
- Approval hash：`sha256:e44887bcc53b438df6787b32eb00c36d2f9ebe58e26763f1a4344658eaad1eef3`。
- Task 8.2 Work：`build:8.2:3bc5e4fd5146`；input digest：`sha256:3bc5e4fd51460793b7db9365dc073dfea3f45311b0f44ee21b0795668b575a90`。
- Task 8.2 Action Receipt：`b8c1bcd9978868b6a11993b562d5f57f9fa64e85dc664eb69b456f9096b3d0c8`；Validator 已接受，且 checkbox 由 Specification Provider 更新。

自举还补齐了公共 `run work-claim`、`run work-outcome` 与 `run work-validate` 命令。端到端测试通过真实打包 CLI 证明：Adapter 成功或失败只生成 Outcome；Task 在 Validator 接受 Receipt 前不会推进。

## 自动验证与 Evidence

| 验证                                          | 结果                                                   |
| --------------------------------------------- | ------------------------------------------------------ |
| `npm run verify`                              | 通过；115 个测试文件，505 个测试通过，1 个显式条件跳过 |
| TypeScript / Desktop TypeScript               | 通过                                                   |
| ESLint                                        | 通过                                                   |
| CLI / Desktop build                           | 通过                                                   |
| generated / brand / architecture / provenance | 全部通过                                               |
| OpenSpec strict validation                    | 全部通过                                               |
| `npm run test:package-e2e`                    | 通过                                                   |
| `npm run test:tracer-e2e`                     | 通过                                                   |
| 公共 Work CLI 专项 E2E                        | 通过；`change-design-gate-cli.e2e.test.ts`             |

正式 Verify 使用 profile `verify`，不可变输入绑定 52 个 Task revision、Git commit/tree、配置、composition、Skill snapshot 与 Evidence profile。报告固定后由 `run verify` 生成 Attempt、Artifact、Bundle 和 Gate；其权威 ID 保存在 `.repoctopus` Evidence/Run Store，避免把随后生成的 ID 回写到报告并递归改变 verification input。只有相同 input digest 的 `satisfied` Gate 才允许进入 Archive。

## 迁移矩阵

迁移 planner 对六类真实旧状态 fixture 只读分类；规划阶段 `storeWrites=[]` 且 `platformCalls=[]`。

| 旧状态                       | 结果                       | 目标/处理                                         |
| ---------------------------- | -------------------------- | ------------------------------------------------- |
| generic Run / waiting        | `manual_decision_required` | 人工选择生命周期阶段，不猜测                      |
| planning approval / approved | `manual_decision_required` | 回到 Design，重算 manifest 并重新取得可信决定     |
| Delivery v2 / in review      | `migration_required`       | 保留旧 MR/Receipt，人工处理冲突权威               |
| Delivery v3 / in review      | `migratable`               | 映射到同一 Change Run 的 Archive                  |
| active Post-merge Run        | `migratable`               | 精确 merge facts 映射到 Archive，不创建第二个 Run |
| completed Post-merge Run     | `completed_history`        | 只保留历史，不重放任何副作用                      |

受控迁移在“目标 Run 已创建、Receipt 写入前中断”后重试，始终收敛到同一个 generation 和 target runId；旧文件摘要不变，第三次调用复用同一 Receipt，未出现双 coordinator 推进。

## 并发、恢复与不确定副作用实验

- 相同 change/generation 的并发 start-or-resume 收敛为一个逻辑 Run；并发 writer 只有一个 transition 能提交，陈旧 stateVersion 被拒绝。
- Work claim 绑定 `runId + workId + attempt + claimToken + inputDigest`；重复领取可恢复，跨 Work、陈旧 revision 或错误 Adapter 的 Outcome 被拒绝。
- Evidence Journal 在命令成功而 Receipt 未落盘的崩溃点恢复时复用已提交 Receipt，不重复执行命令；并发 append 串行化。
- Store/onboarding pointer 写入、迁移 Receipt、平台 Inbox lease、目标分支精确 merge commit 和 Archive publication 都覆盖中断/响应丢失；重试执行 reconcile 或 create-or-recover，不把未知结果当成功。
- 多 Runner 只按 claim、lease 和持久平台事实竞争；MR 作者和最初 change 提交者不构成 owner。独立状态卷通过远端 MR 与 merge commit 收敛。

## 上游采用原则

- Comet 0.5.0 / `aeb1a6598034e28ce46b8422d4dbd8785e607bd7`：采用固定 Definition、五阶段、Action claim、proposal/approval hash、稳定 Task revision、Validator/Evidence、安全 extension checkpoint 与同一 Run Archive；按 Repoctopus 多仓、持久 Inbox 和 Business MR 集合重新实现。
- DSH `dsh-v0.2.1-rc.3` / `1f81c047fc48fa190a683e469daa699857e9afe8`：采用 Cordis、Loader 与 Skill Registry 的发布边界，并吸收安全重载和 watcher 关闭修复。
- Matt Skills / `49dd158d1076134a641b33efb035946536778336`：`tdd`、`codebase-design` 等作为可执行方法；`to-spec`/`to-tickets` 只作为非执行 provenance reference，将审核后的规则编码进 OpenSpec 四类工件、Method Profile 与 Validator。
- OpenSpec 1.14.3：Store 和官方 spec-driven 四类工件是唯一规格/任务权威；Provider 可替换，但当前 change 不 fork 模板或建立并行 tracker。

## 明确排除

- 不引入 Comet Native/Classic 产品 shell、动态 workflow generator、单仓目录假设或第二套插件系统。
- 不引入 DSH Agent、Session、Workspace 或 fire-and-forget Webhook Runtime，也不使用未发布源码冒充发布依赖。
- 不让 Matt 原始 `to-spec`/`to-tickets` 进入 Skill catalog、Agent 上下文或外部 tracker 发布路径。
- 不新增 implementation notes、ADR 或第五类 OpenSpec 规划工件；普通决定留在 `design.md`，架构变更本身使用专门 Change。
- 不把 Delivery、Webhook、Post-merge、Dashboard 或 OTLP 投影变成第二个状态机；它们分别是 Archive 动作、事实入口和只读投影。
- 不自动合并 Business MR 或最终 Change MR；任何平台授权都不能替代人的 merge 决定。

## Archive 验收口径

Archive 必须在这个 Run 中依次满足：发布完整 Business MR 集合、等待全部人工合入、冻结并核对精确 merge commit、在临时检出上通过合入后 Evidence、执行 OpenSpec sync/archive、只发布允许的规格收尾差异、create-or-recover 最终 Change MR。最终 Change MR 已创建后 Run 才能标记 completed；进程、IDE 会话或原提交者是否在线不影响恢复。
