# 已完成 Run 恢复验证记录

本报告记录 Build 验收与正式 Verify；首轮 Build 通过后，最终审查发现两处缺口，已通过正式 verify-fail 返回同一 Run 的 Build 并完成代码修复。当前候选再次通过 Build Guard，最终包全流程及独立终检、最终源码 Linux CI 均已通过。本机完整 Verify 尚待正式执行，不把现场验收或 CI 解释为本机门禁收据。

唯一最终集成 reviewer 为 `/root/completed_recovery_final_verify_review`，独立会话 `codex-completed-recovery-final-review`。审查基线为 `c872b4080d8336d2440410e28e482fce98423464`，候选为 `84fb2c2fc346f4e520503b9a50f40d64d5066e59`；仅生成的 Comet 控制状态在 Build Guard 后更新。Verify 不使用仅允许 Build 的任务协调写入口，最终审查分配与证据在本报告记录，不修改生命周期存储。

该同一会话已对修复后的 `f22e29ff0261a376d9c8e2dc36c0235a5c901781` 源码做局部复查，不重复建立最终审查；原报告与复查记录一并保留。

## 已采用的上游规则

Comet 0.5.1 固定来源为 `35c9860b77b42bafa0c2d80d8d695889f888a924`；本次观察 master 为 `a61a2e5b4766e1ad62377dec598e402560a259b6`，终态调度与 archived selection 两份相关文件未变。采用其可信终态先于调度、普通恢复不能重新激活已完成执行的规则，保留 Repoctopus 的 Cordis Service、coordinator、RunStore 和多仓 Provider 边界，没有引入 SDK 或复制另一套状态机。

完整实现与包身份见 [包验收报告](../../../verification/preserve-completed-run-recovery/verification-report.md)。前两次修复分别处理活动 Build 工作区与 Evidence 输入；此次补上 completed 的完整 status、Service、coordinator 和 CLI envelope 链路。

## RED、GREEN 与独立审查

| 证据                     | 实际结果                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 原状态投影和通用恢复     | 增量 RED 9 失败、1 通过，确认历史 reconciliation 与正常多仓开发漂移覆盖终态                                    |
| reviewer R1/R2           | 复现原始快照丢失、Run/Checkpoint 反向完成冲突；新增 RED 4 失败；修复后 9 项异常回归通过，reviewer 独立复跑通过 |
| 原 Journal 中断          | 两个写边界恢复原 completed 事务，仅补发一次原待导出遥测，重复恢复不增加状态或导出                              |
| 完整 Archive publication | 34 项通过，包括真实两仓 Git、Service/CLI 两种恢复顺序和历史错误标志保留                                        |
| 活动恢复                 | 其余六组 Build workspace、Evidence、Runtime、Work execution、continuation 共 80 项通过                         |
| 生产 CLI 变异            | 仅在生成产物禁用 completed 分派，4 项 CLI 用例因新增状态而失败；原字节恢复后生成物检查通过                     |
| 来源登记                 | 两组测试共 16 项通过；构建脚本和运行时诊断均登记同一固定来源，无放宽                                           |
| 组装与 OTLP              | 更新随源码变化的 composition 固定摘要；两项组装/真实 tracer 用例通过                                           |
| 桌面依赖                 | 新 worktree 原缺锁定 Electron binary，补齐环境后两项真实桌面启动测试通过；不修改桌面源码                       |

独立 Build reviewer 逐项通过 1.1–1.4、2.1；R1/R2 首轮复查关闭。来源登记两行补充另经独立复核。审查原始记录、实际 RED/GREEN 与 CLI 变异日志在独立审计证据目录保留，不以实现者自评替代 reviewer。

## 真实多仓验收

实验 Change 为 `verify-terminal-20261108`，精确 Run ID 保留在外部原始报告。使用全新五仓 checkout、独立 OpenSpec registry 和实际安装包，从公开项目接入开始。接入与两个独立审批、Configure、Plan、两包实际 RED/GREEN/regression、commit/push、独立双轴 Build Check、managed Verify、Provider Close 和实际 publication 均已通过，Run 已 completed。终态矩阵及旧现场哈希核对也已通过。

两包只在 web-front、backend 各追加一个唯一 README 标记；Standards 与 Spec 由独立并行 reviewer 实际审查，两个轴均无 finding。Verify 明确复用未变化的真实审查证据，两个实际 Node 验证节点各执行一次。首包完成后两种公开恢复、未授权分支阻断和恢复原分支均保留首包 completion、Binding 与 Plan。

最初候选与最终候选的独立包身份分开记录；最终包公开恢复同一 Run、同一 Plan 决策，不编辑 Store 或重建 Run。候选补充只涉及两条诊断来源登记，不改变恢复或 Binding 实现。

原始 PublicationReceipt 摘要为 `sha256:c54b411c6ba36afc3039170b11ed2da71379a81ed619421735c54a770e60027f`；Closure 为 `sha256:eaff0689f3603d0155a922f48aad938af6999e27ea20dce016be894cc016cc6f`；Bundle 为 `1ae58ced0383d65504580323c860b8e73c90cefeccdbad54e42ad07a6fc8cfff`。Native publisher 一次成功，无人工补建 MR。

| 实验 MR                                                        | Receipt 冻结 OID                           | 基线                           |
| -------------------------------------------------------------- | ------------------------------------------ | ------------------------------ |
| [backend #5](https://github.com/NickDDDDDD/backend/pull/5)     | `840415befd125c58726d92376b377f417031d97e` | `acceptance/terminal-20261108` |
| [web-front #9](https://github.com/NickDDDDDD/web-front/pull/9) | `2dc438e1a598ce01947b830a537233846572edcd` | `acceptance/terminal-20261108` |
| Workspace #3（URL 见原始报告）                                 | `27fd6fd7a06ea1b66df3b22329d22bf699cf2684` | `acceptance/terminal-20261108` |

8 次新进程恢复覆盖正常 source 及完成后的其他 checkout，每次状态查询/continuation/execution/next actions 均一致完成。Run、Checkpoint、Trajectory 字节未变化，stateVersion 244、epoch 17、10 个 Host Work 和 2 个实际验证命令均不增加。

旧 F1 的真实持久记录仅在逐文件验证的副本上补充恢复：独立 registry 公开登记后，4 次恢复仍 done/terminal，原 historical reconciliationRequired=true 保留，原始现场未运行写入口。7 个旧 Store、425 文件、10 份旧报告哈希全部不变，新五仓干净且已 push；实验 MR 仍 OPEN，没有合入。

外部完整独立报告为 `lab-terminal-1108/verification-report.md`，SHA256 `982071711871f05249cb9bf7b1ed00562e913eb4e340485360e8b95a0825d167`；父任务已复核原报告、实际 PublicationReceipt、终态矩阵和哈希清单。

## 完整性、授权与规格一致性

Build 期间曾把原待导出遥测的实施说明追加到已封存 Design；早期只读入口已返回非零，但主会话提取阶段摘要时漏看了 diagnostics。正式推进前复核发现该问题，移走这段说明后，文档 SHA256 恢复为 Runtime 已接受的 `a93a0dc165175c9a2f36d3dd72da7081bd173b938797d7cd32fdd5f4de2d44d8`。该说明已由本报告的 Journal/遥测测试记录完整保留，没有修改 Store、重新批准或删掉需求来绕过。此为 Agent 的产物操作错误，Comet 的漂移拒绝符合预期。

两个 delta requirement 的新增场景已映射到完整 status、两个恢复入口、CLI envelope、异常持久记录、原 Journal 和活动授权负例。Run 或 Checkpoint 任一宣称完成，都必须先验证它们及原始快照/轨迹是否一致；原始快照摘要重算，不以当前 checkout 替代原事实。旧全局错误标志保留作为审计事实，不能要求完成 Run 恢复活动开发。完成 Run 的后续远端变化仍由独立一致性审查处理，不授权新的工作。

没有新增 schema、migration、generation、恢复 Work 或规划文件权威。实现约束在同一 change 的 design.md，使用说明在 docs/runtime-state.md，来源在固定 adoption/manifest 中。

## 检查范围与待执行项

下表为实际执行记录；定向测试中的 skipped 是名称筛选未选择的其他测试，不能计为通过。正式 Guard 是后续独立门禁，表内通过不冒充该收据。

| 实际命令                                                                                                                                                                                                                                                     | exit code | 结果与范围                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------- |
| `node node_modules/vitest/vitest.mjs run test/archive-publication-lifecycle.test.ts`                                                                                                                                                                         | 0         | 34 项通过                                                                                 |
| `node node_modules/vitest/vitest.mjs run test/build-workspace-recovery.test.ts test/evidence-recovery.test.ts test/runtime-recovery.test.ts test/runtime-recovery-application.test.ts test/work-execution-recovery.test.ts test/change-continuation.test.ts` | 0         | 最终源码 6 文件、80 项通过；两个 worker                                                   |
| `node node_modules/vitest/vitest.mjs run test/provenance.test.ts test/comet-provenance.test.ts`                                                                                                                                                              | 0         | 16 项通过，含 reviewer 独立复跑                                                           |
| `node node_modules/vitest/vitest.mjs run test/project-composition.test.ts test/e2e/runtime-tracer.e2e.test.ts`                                                                                                                                               | 0         | 2 项通过                                                                                  |
| `node node_modules/vitest/vitest.mjs run test/e2e/desktop-run-activation.e2e.test.ts`                                                                                                                                                                        | 0         | 补齐依赖后 2 项通过                                                                       |
| `node node_modules/vitest/vitest.mjs run test/evidence-input-integration.test.ts -t 'persists actual DAG proofs'`                                                                                                                                            | 0         | 1 项通过、9 项未选择，约 40 秒                                                            |
| `node node_modules/vitest/vitest.mjs run test/evidence-runtime-binding.test.ts -t 'continues a prepared context that has no Attempt yet'`                                                                                                                    | 0         | 1 项通过、12 项未选择，约 14 秒                                                           |
| `node node_modules/vitest/vitest.mjs run test/e2e/project-onboarding-flow.e2e.test.ts`                                                                                                                                                                       | 0         | 1 项通过，约 22 秒                                                                        |
| `npm.cmd run typecheck`                                                                                                                                                                                                                                      | 0         | 最终源码类型检查                                                                          |
| `npm.cmd run typecheck:desktop`                                                                                                                                                                                                                              | 0         | 完整尝试在进入 lint/build 前已通过的独立类型子命令                                        |
| `npm.cmd run lint`                                                                                                                                                                                                                                           | 0         | 最终源码 lint，通过后才执行 architecture                                                  |
| `npm.cmd run build`                                                                                                                                                                                                                                          | 0         | 最终来源登记补齐后的实际 CLI/Desktop 构建                                                 |
| `npm.cmd run check:architecture`                                                                                                                                                                                                                             | 0         | 300 production sources / 21 capability owners；报告中的实验标识改为引用外部证据后重跑通过 |
| `npm.cmd run check:provenance`                                                                                                                                                                                                                               | 0         | 固定来源、修改目标摘要与依赖核对                                                          |
| `npm.cmd run spec:validate`                                                                                                                                                                                                                                  | 0         | 19 项严格校验通过                                                                         |
| `npm.cmd run check:managed-execution-report`                                                                                                                                                                                                                 | 0         | 467 文件 / 5949608 字节，规范化包身份完全相同                                             |
| `npm.cmd run format:check`                                                                                                                                                                                                                                   | 1         | 172 个未改动历史文件，diff 交集为零；不声明全仓格式通过                                   |
| `npm.cmd run verify`（早期两次全量尝试）                                                                                                                                                                                                                     | 1         | 实际失败后中止，保留原日志；不是最终 Guard，也不记为通过                                  |

最终报告写入后的补充检查：

| 实际命令                                                                                                                                                                                                                                                                                                             | exit code | 结果                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| `npm.cmd run check:generated`                                                                                                                                                                                                                                                                                        | 0         | CLI、Desktop 与遥测引用生成物一致                                      |
| `npm.cmd run check:brand`                                                                                                                                                                                                                                                                                            | 0         | 公开运行面命名通过                                                     |
| `npm.cmd run check:dashboard-salvage`                                                                                                                                                                                                                                                                                | 0         | ledger 通过                                                            |
| `node node_modules/prettier/bin/prettier.cjs --check domains/runtime/workflow-runs.ts services/workflow-runs.ts test/archive-publication-lifecycle.test.ts docs/superpowers/reports/preserve-completed-run-recovery.md verification/preserve-completed-run-recovery/verification-report.md .comet/check-policy.json` | 0         | 当前变更代码、两个报告与环境 policy 格式通过；其余源变更此前同样已通过 |

上述实际输出保存在独立审计目录对应的 `green-terminal-full.txt`、`active-recovery-final.txt`、`green-platform-reference-registry.txt`、`green-reference-consumers.txt`、`desktop-prerequisite-recheck.txt`、各定向 recheck、`typecheck-final.txt`、`package-identity-recheck.txt` 和失败尝试日志中；未单独重定向的子命令保留工具原始执行输出。补充输出来自本次实际运行，不由旧日志推定。

类型、相关 ESLint、生成物、品牌、架构、来源及 19 项严格规格检查已通过。包复现检查确认最终候选规范化摘要 `0621d6bbeb13767f70aa4e415b8a550e5e8a194675d4d8f737c729618bc43e0f`，467 文件、5949608 字节。

两次早期完整套件尝试包含实际失败或中止，不作为通过证据：缺失 Electron 环境、遗漏伴随来源登记及 composition 固定摘要已修复；DAG、prepared Evidence context 和 onboarding 在并发负载下超时，分别单独重跑通过约 40、14、22 秒。正式 Windows 全量将用 Vitest 支持的两个 worker，环境输入已由原 Comet policy 声明。未修改测试超时、断言、产品缓存或恢复规则。

仓库全局格式检查报告 172 个未改动的历史文件；与本次 diff 交集为零，当前变更文件格式通过，未重新格式化已封存归档。此项不能报告为全仓格式通过。

此前候选 `2298096` 的 [Linux CI](https://github.com/NickDDDDDD/Repoctopus/actions/runs/42400952275) 成功仅作为历史证据。当前 C3 的 [Linux CI](https://github.com/NickDDDDDD/Repoctopus/actions/runs/42404778291) 已成功，精确 HEAD `3866f67a4bbac90a335e5d59737482b08603a066`，产品源码为 f22e29f；199 个文件、1090 项测试通过，1 文件/4 项按现有条件跳过。全套 npm run verify 通过，其中测试段实际 697.84 秒，19 项严格规格、来源/架构/生成物和最终包 13fad2c8 的复现检查均通过。原 job 日志与摘要已读取保存；C3 本机正式 Verify 仍待补齐。

## OpenSpec 完整性复核

通过 Comet adapter 实际执行 `classic openspec -- status --change preserve-completed-run-recovery --json` 与 `classic openspec -- instructions apply --change preserve-completed-run-recovery --json`，exit code 均为 0。spec-driven 四类产物均 done，任务 8/8、remaining 0，Provider 明确仍要求验证后再归档。

| 维度   | 当前结果                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 完整性 | 8/8 tasks；两个 MODIFIED requirement 的工件齐全，所有列出的 contextFiles 均已读取                                                     |
| 正确性 | 两个 requirement 的终态、历史诊断、两入口恢复、持久异常、Journal、活动授权场景已有相关回归与真实五仓证据；完整集成检查尚待正式 Verify |
| 一致性 | 实现遵循 approved Design 的可信终态、持久边界与多仓职责分离；未建立第二任务/规划权威；同一最终独立集成 reviewer 已关闭全部 Important  |

没有把未执行的最终综合检查记为通过，也尚不声明 ready for archive。

## 正式 Build 门禁

Runtime 已接受同一 Run 的 complete-build，并派发 full.build.check。实际命令为 `node C:/nvm4w/nodejs/node_modules/@rpamis/comet/bin/comet.js guard preserve-completed-run-recovery build --apply --local -- npm.cmd run build`，exit code 0；Guard 报告 ALL CHECKS PASSED，推进到 Verify。检查程序、argv、cwd 均使用既有 policy。

此前 PowerShell 脚本包装入口两次返回 Usage、exit code 1，尚未执行 Build 检查；直接调用同一已安装 0.5.1 的 Node CLI 入口后保留了原始参数。没有更换 Comet 版本、检查命令、策略或状态。正式 Verify 使用相同的入口形式，保留其完整输出与真实收据。

## 最终集成审查的两项修复

1. `resume` 的 CLI 在 Service 判断持久终态前探测业务 checkout；实际移走业务目录后，status/next 成功而 resume 失败。CLI 现只提交 Run 身份，Service 在非终态时才按已有 projectInput 采集当前 snapshot。没有观察时省略可选 reconciliation；已有真实 snapshot 仍保留其差异，不能传入原 snapshot 伪造当前没有变化。
2. 持久 Workflow 仅比较 digest 标签，正文损坏为 null 或被改写仍可能 done。现用已有 hashWorkflowDefinition 重算正文摘要，再接受可信终态；没有新增通用 schema 验证框架或动态文件观察。

正式 verify-fail 使同一 Run 返回 Build Plan，配置保留；修订原计划后进入 Build Execute，没有重跑 Open/Design 或再次配置审批。新增实际 RED 为 4 项失败；修复后原始命令 `node node_modules/vitest/vitest.mjs run test/archive-publication-lifecycle.test.ts test/runtime.test.ts test/build-workspace-recovery.test.ts test/evidence-recovery.test.ts test/runtime-recovery.test.ts test/runtime-recovery-application.test.ts test/work-execution-recovery.test.ts test/change-continuation.test.ts test/project-composition.test.ts`，exit 0，9 文件/141 项通过，其中 Archive 38 项。

同一独立 reviewer 的外部真实临时 fixture 复查 exit 0、2/2 通过，验证三入口均拒绝损坏 Workflow、三条实际 CLI 在业务目录移走后仍完成。无未解决 Critical/Important；最终审查报告 SHA256 为 `96f366f9af12320342afcbc23f0c36891c963b45498a4554d58b3ce40e5fc0d8`，最终门禁与当前包验收仍是合入条件。

当前 C3 内容摘要 `13fad2c836df214f2baaac6c08c2ecaeb2a31455ef83f53f9e67e0f2ec5655a2`，467 文件/5951541 字节，单一包从新的五仓公开接入开始重跑完整流程；不升级首轮未完成执行或把 C2 完成证明冒充当前字节。详细当前身份与首轮历史身份见包验收报告。

## 最终 C3 真实验收完成

实验 Change `verify-terminal-final-20261108` 从接入到实际 Close/Publish 完整通过，12 个新进程终态操作加各自 status 全部完成。正常 source、完成后切换分支、完成后业务目录暂时退役各 4 次；完整 Run/Checkpoint/Trajectory、stateVersion 242、epoch 17、10 个 Host Work 和 2 条实际验证命令均不增加，CLI 不虚构 reconciliation。

活动目录不可读仍阻断两个入口、返回明确 stderr JSON、保留原持久三元组；恢复后沿原 Plan 与首包完成事实继续。当前包再次恢复 F1 验证副本 4 次，原 raw flag=true 保留。9 个旧 Store/545 文件、14 份报告/摘要哈希完全相同，包含 C2 的 Run、历史副本与成功报告。

| 当前 C3 实验 MR                                                  | Receipt 冻结 OID                           | Base                                 |
| ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| [backend #6](https://github.com/NickDDDDDD/backend/pull/6)       | `147a2c955c3a27406d380da2d7df317b234d1e02` | `acceptance/terminal-final-20261108` |
| [web-front #10](https://github.com/NickDDDDDD/web-front/pull/10) | `1d8464452c705af6a86d27fb95bb11b7f5f6ed7e` | `acceptance/terminal-final-20261108` |
| Workspace #4（URL 见原始报告）                                   | `eac67a67ca61d148f5dd4a5dbb6f5a06e64cc71c` | `acceptance/terminal-final-20261108` |

实际 Receipt `sha256:b7776f946657ea539184dc8b27538cb6082a2350b4f1f9858d333d5fbf7d5c8f`；三个 MR 均唯一且 OPEN，远端 head/base/OID 和归档四类产物/主规格核对通过，没有合入。完整原始报告 `lab-terminal-final-1108/verification-report.md` SHA256 `57fdc6463739536b344d717b1b3428e070e725170b852bd5742cf6e9fe35c6a3`，父任务已复核原文与摘要；与首轮报告各自保留，不静默改写历史。

## 当前候选正式门禁准备

独立 C3 证据 auditor 另行重算最终报告、原 tarball 与规范化内容摘要、9 个旧 Store/545 文件和14份旧记录；逐个解析12个不同 PID的终态响应及12份status，复核真实完整三元组、stderr负例、历史副本与 live REST 三个唯一 MR。结果 PASS，保存为本轮 `reviewer-final-package-acceptance-audit.json` 和简报，没有改写旧现场或产品 Store。

最终 C3 验收和独立终检之后，同一 Run 接受 complete-build，派发 full.build.check Action20；实际精确 `npm.cmd run build` 的 Guard exit code 0，输出 ALL CHECKS PASSED，进入 full.verify.run Action22，入口 healthy=true、无 issue。源码保持 f22e29f，修复后的9文件141项回归、独立review2/2、C3完整现场与当前CI证据都已固定。

当前完整 Verify 将执行 policy 已声明的 `npm.cmd run verify`、cwd `.`、`VITEST_MAX_WORKERS=2`，通过同版本 Node CLI 的正式 Guard 绑定本报告和真实检查收据。完整日志 stdout/stderr 分开保留；本报告在执行前固定，不预先写成功结论，检查结果以同一 Run 的后续实际收据为准。

## 首次正式 Windows Verify 失败与并发诊断

首次正式 Verify 的精确 `npm.cmd run verify` 返回 exit 1：198 文件通过、1 文件失败、1 文件跳过；1085 项通过、4 项失败、5 项跳过。四个失败全部来自 `managed-change-execution.e2e.test.ts` 的完整流程场景，各触及原有 360 秒预算；不是断言失败。Runtime 正式返回同一 Run 的 Build Plan，保留配置、原任务完成事实和前述实际验收，没有手改 Store 或重复审批。该失败日志与原 SDK 检查收据保留，不声明首次 Windows 全量通过。

仓外诊断副本保持测试断言、360 秒预算和相同产品源码，增加调用耗时观察后仅选择最重的单仓 autonomous 场景；单文件 worker=1 时 exit 0，1 项通过、6 项未选择，测试耗时 319.54 秒，完整 Open→Design→Build→Verify→Archive 仍推进完成。CI 中原测试首项约 244.49 秒通过。此结果支持 Windows 并发负载使重流程超时的假设，不能代替原测试和正式门禁。

后续正式检查继续使用原 `npm.cmd run verify`、原全部测试、原超时与断言，只将 policy 已声明的 `VITEST_MAX_WORKERS` 从 2 设为 1，值由真实检查输入绑定。产品源代码仍为 f22e29f，当前包、C3 实际验收和唯一最终 reviewer 的源码结论不变。此处在重跑前记录失败与诊断，第二次正式结果仍以同一 Run 的后续真实收据为准；未修改默认测试配置或扩大产品范围。

## 第二次正式检查及 Windows 有界诊断

第二次正式检查使用 worker=1，原全部测试和 360 秒单例预算不变。重矩阵 7 项中只有多仓 autonomous 场景仍触及 360 秒（361.639 秒），其余场景未报失败；在后续测试仍运行时，外层 1800 秒到期，真实收据 exit 124。没有完整测试汇总，不把未执行完的检查记为通过。该检查结束后已确认对应 Vitest、worker 和子进程退出，再开始唯一仓外多仓诊断，排除测试超时残留工作的叠加负载。

仓外副本保留所有场景逻辑和断言，900 秒仅用于取得诊断，未直接写入正式测试；独立 reviewer 已核对副本差异、透传 CLI wrapper 和计时方法。该单例实际 exit 0，1 项通过、6 项未选择，测试耗时 **368.10 秒**，完整命令耗时 370.57 秒。20 次 next 全部有限返回，中位 4.705 秒，最长 17.865 秒；各 CLI 也都返回成功，Archive 前三次冷恢复分别为 15.181、14.443、14.643 秒。原发布、Work 顺序、最终 Run inspect 和全部断言通过，未发现需要新 Runtime 恢复分支的逻辑失败。原 trace、汇总和日志保存在本轮仓外证据目录，嵌套耗时没有重复相加。

基于实际 PASS 368.10 秒超过旧 360 秒预算，以及原矩阵在并发负载下的超时，本次只为该真实重矩阵在 Windows 设置 600 秒有界预算；非 Windows 仍为 360 秒，全局普通测试超时、断言、场景和 Linux CI 工作流均未改变。Comet 项目检查外层预算从 1800 秒设为 2700 秒，以容纳已观察到超过 30 分钟的完整命令；这是本仓外部自举控制器配置，不是产品生命周期行为。最终完整检查恢复为已声明的两个 worker，避免单 worker 的总时长进一步膨胀，真实环境值继续由 policy 绑定。已取得的产品源码审查与当前 C3 安装包证据保留；新测试预算与报告必须通过原命令的新完整收据，不复用前两次失败。

预算、报告和原始 trace 已由原任务 reviewer 做有界独立复核，无 CRITICAL/IMPORTANT；20 个 next begin/end 编号完全对应，13 次 CLI 全部 ok，无 failed 记录。其 MINOR 统计问题已纠正为标准中位数 4.705 秒。当前改动的格式与 scoped ESLint 通过，批准 Design 的摘要保持不变。

当前正式 Verify 失败计数为 3（最终集成审查一次、Windows 门禁两次）；按 Comet 方法参考的自动修复上限，下一次完整门禁先等待用户明确选择继续修复或停止，不将现有批准解释为无限重试。已复核预算修正可供审查，尚未取得修正后的完整通过收据，未归档、未创建本产品修复 PR。

用户随后明确选择“继续修复并完整验证（推荐）”，批准按已推送 d6ffc43 的 Windows 局部预算与外层预算修正继续同一 Run。该决定只恢复本次完整验证，不重新审批或修改 Open、Design、Build 配置，也不将失败次数清零；最终通过结论仍由后续真实门禁产生。

## 修正预算后的测试通过与报告覆盖补齐

用户批准继续后，第三次正式 Windows 命令使用同一精确 argv、两个 worker 和已复核预算。测试实际为 199 文件通过、1 文件跳过，1089 项通过、5 项跳过，测试部分耗时 1805.56 秒；此前四项重矩阵不再超时。后续生成产物、命名、架构、来源、Dashboard 台账和 19 项严格规格校验均通过，命令仅在最后的 managed execution report 覆盖检查 exit 1。新 Linux CI `42414152819` 的 1090 项测试和 19 项规格同样通过，最终相同覆盖检查失败；不声明整条 CI 或正式 Guard 已通过。

覆盖检查除物理包身份外，还保守要求 tested commit 之后只能有 evidence 路径变化，因此测试预算修改使旧 f22 报告过期。此前只核对 package.files 而未核对该额外约束，是本轮验证准备的遗漏；不修改检查器或添加豁免。按用户已明确允许的继续修复决定，在同一 Run 补齐报告证据，不重走 Open／Design 或修改既有配置决定。

当前 b334 候选在仓外重新 pack 并独立安装，整个 tarball 与原 C3 经独立逐字节比较相同；8 次新进程恢复、9 次 status 全通过，含业务目录退役，完整三元组和副作用计数不变。11 个旧 Store／665 文件和 31 份报告／摘要哈希不变。独立 reviewer 对包、源码边界、17 个 PID、完整事实与报告契约的审计 PASS，无 CRITICAL/IMPORTANT。

新增[当前候选复验报告](../../../verification/preserve-completed-run-recovery-budget-revalidation/verification-report.md)保留真实 b334 打包及冷恢复归属，并明确完整生命周期仍引用原 f22 C3；原 C3 报告、现场和历史源码身份不改写。新报告覆盖的是相同产品字节与当前提交的关系，没有宣称重新执行开发或远端发布。接下来先实际运行原报告检查器验证，再取得同一原完整命令的正式新收据；本报告仍在检查前固定，不预写成功结果。

## 保留的独立事项与清理边界

Windows Git 长路径使用实验 checkout 的局部前置配置，未改全局 Git；发行包 doctor 的源码布局依赖、消费者桌面激活与 PR Skill 正文交接仍为独立事项。已消费的临时 Comet 输入文件已清理；实际验收 Store、安装包和审计证据保留。自动审批审查以 blocked by policy 拒绝外部 Vitest 缓存的递归删除及随后更窄的单文件清理，未给出进一步原因；该生成缓存保留，不改用其他工具绕过拒绝，且不影响产品源码或实际 Store。
