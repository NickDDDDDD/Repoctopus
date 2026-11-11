# Comet 采用报告

## Host 人工决定

固定参考 Comet 0.5.1 同一提交的 `classic-sdk-design.ts`、`classic-sdk-build.ts` 和 `classic-sdk-archive-decision.ts`。来源 SHA-256 由固定 Git blob 计算，登记在 source-manifest.json。采用其 Host 收集真实答复、公开决定命令匹配当前 Wait/hash、分支与来源重验、Runtime 提交接受事实以及重复选择核对原结果的职责划分；不引入 Comet SDK 或复制新源码。

Repoctopus 的适配使用现有 Cordis WorkflowRuns、共享 PlanningApprovalStore 与 Run guarded transition journal。公开响应文件如实记录本机 CLI 主体与独立的宿主交互来源，不能独立证明一次人类点击。规划批准可以共享；Run 参与关系、原始 isolation 与 Open/Design 请求仍须分别核对。Desktop 和 OTLP 只读展示，不成为批准入口或存储权威。

## 固定基线

- 上游：`https://github.com/rpamis/comet.git`
- 版本：`0.5.1`
- Commit：`35c9860b77b42bafa0c2d80d8d695889f888a924`
- 许可证：MIT，原文保存在同目录 `LICENSE`
- 2026-10-30 复核：采用发布为 `0.5.1`，另行审计 `master` 到 `9208b4beef7a71e45b1bbf734eee50af63e4059b`。0.5.0→0.5.1 及发布后分支尾部的完整增量审计见 `0.5.1-audit.md`。

最初采用发生在 0.4.5 基线；当前来源摘要已经逐文件移动到 0.5.1。目标文件仍按 Repoctopus 的产品边界保持修改版，不能把来源基线移动理解为盲目覆盖本地实现。

## 已采用并改造

| 能力           | 上游来源                                                              | Repoctopus 位置                              | 主要改造                                                                                                   |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Run 循环       | `domains/engine/loop.ts`                                              | `domains/engine/loop.ts`                     | 使用 Repoctopus Workflow Package；增加项目核对硬阻断与可选 Trigger Snapshot；保持确定性动作 ID             |
| Run 编排       | `domains/comet-classic/classic-guard.ts`                              | `domains/runtime/workflow-runs.ts`            | 使用可恢复 Store 与 Trajectory；增加 typed identity、checkpoint 权威续跑、依赖感知失效、精确兼容定义恢复，以及严格身份核对的幂等创建或恢复 |
| Resolver       | `domains/engine/resolver.ts`                                          | `domains/engine/resolver.ts`                 | 通过深拷贝和冻结隔离 Resolver 输入                                                                         |
| Guardrail      | `domains/engine/guardrails.ts`                                        | `domains/engine/guardrails.ts`               | 对接版本化动作类型、引用允许列表和确认输入                                                                 |
| Eval           | `domains/engine/evals.ts`                                             | `domains/engine/evals.ts`                    | 对接 Repoctopus Run State 与可审查证据文本                                                                 |
| Workflow 摘要  | `domains/workflow-contract/hash.ts`                                   | `domains/workflow-contract/hash.ts`          | 对接独立 Workflow Contract 域与规范 JSON                                                                   |
| 结构化进程启动 | `platform/process/spawn-command.ts`                                   | `platform/process/spawn-command.ts`          | 保留跨平台 argv 和 Windows shim 处理；替换产品环境变量命名                                                 |
| 外部命令探测   | `platform/process/external-command.ts`                                | `platform/process/external-command.ts`       | 移除 Comet 运行指标耦合，保留超时、取消和缓冲区边界                                                        |
| 进程创建身份   | `platform/process/process-identity.ts`、`windows-process-identity.ts` | 同名平台文件                                 | 保留 PID 复用防护；替换 Windows 探测缓存与类型命名；所有权核对对瞬时探测失败执行有限重试，仍未知时拒绝终止 |
| 进程树终止     | `platform/process/terminate-process-tree.ts`                          | `platform/process/terminate-process-tree.ts` | 原样采用受控进程树终止机制                                                                                 |
| 文件对象身份   | `platform/fs/file-identity.ts`                                        | `platform/filesystem/file-identity.ts`       | 原样采用跨平台 dev/ino/birthtime 降级比较                                                                  |
| 竞态安全读取   | `platform/fs/race-safe-read.ts`                                       | `platform/filesystem/race-safe-read.ts`      | 原样采用描述符读取、路径身份复核和有界读取/流式哈希                                                        |
| 短暂失败重试   | `platform/fs/transient-retry.ts`                                      | `platform/filesystem/transient-retry.ts`     | 采用 Windows 文件占用短退避，按 Repoctopus Lint 约束做无行为改动                                           |
| 原子文件写入   | `domains/comet-native/native-atomic-file.ts`                          | `platform/filesystem/atomic-write.ts`        | 去除 Native 命名，保留父目录身份、临时文件身份、目录同步和 exclusive publish；Workspace 入口安装用请求专属临时名称识别中断留下的文件                               |
| 资源 Lease     | `domains/comet-native/native-lock.ts`                                 | `platform/runtime/resource-lease.ts`         | 保留 Repoctopus resource key；采用 race-safe owner、文件身份和 rename 前后所有权核对                       |
| 仓库输入 Fence | `domains/comet-native/native-snapshot.ts`                             | `platform/git/evidence-fingerprint.ts`       | 抽取选择前后 Fence、两次内容复核和竞态安全哈希；在上层组合多仓、配置和 Adapter 指纹                        |

机器可检查的上游和目标 SHA-256 记录在 `source-manifest.json`。

0.5.0 复核确认 Workflow Application、Classic SDK 五阶段、proposal/approval hash、稳定 Task ID、Action claim 与写作用域是 Change 生命周期的成熟参考；异步命令进程树清理已立即采用。0.5.1 进一步证明有效 timeout 必须进入可复用检查身份，未知 lock 必须通过精确观察 token 恢复；本次只更新来源身份，相关 Runtime 行为留给独立可靠性 Change。完整增量决定见 `0.5.0-audit.md` 与 `0.5.1-audit.md`，跨上游能力矩阵见 `../upstream-alignment-audit.md`。

2026-10-25 的验收闭包复核继续采用以下行为不变量，但没有复制新源码：Classic `classic-tasks.ts` 的 expected-revision Task 投影只把 checkbox 当作完成声明；Native `native-acceptance.ts` / `native-verification-evidence.ts` 的内容身份、精确 Acceptance Trace、未知/重复/缺失拒绝和 required Receipt 门禁，映射到 `domains/specification/tasks.ts`、`domains/change-lifecycle/verification-input.ts` 与 `domains/evidence/acceptance-trace.ts`；`native-sdk-supervisor-archive.ts` 的 Archive 前重检由 Repoctopus 的 Verify Gate identity 与后续 Archive preflight 分工承担。OpenSpec `tasks.md` 仍是唯一 Task/Acceptance 权威，Evidence Bundle 只保存运行事实；不采用 Comet 产品 shell、Classic/Native 双状态根、verification 文档权威或单仓目录布局。

2026-10-25 的 Archive 恢复复核采用 Comet 0.5.0 archive transaction 与 workspace finish journal 的行为思想：把稳定 Intent 先于副作用持久化，恢复时先观察本地 commit、远端 branch 和 MR，再决定是否继续，并把临时 workspace 的清理放在可证明的终态之后。Repoctopus 将它改造成 OpenSpec 多仓发布协议：Closure Receipt 绑定隔离 checkout/base OID，规格 Journal 明确为 `prepared → committed → pushed → completed`，Business 与 Specification Receipt 最终组合；不复制 Comet 产品命令壳、Classic/Native 双运行时、单仓路径假设或等待远端合入模型。

2026-11-03 的首次项目接入修复采用 Comet 0.5.1 `project-activation.js`、`integrations/openspec.js` 与 `classic-layout-initialization.js` 的行为不变量：先声明初始化所有权，通过官方 OpenSpec 入口物化健康根，外部结果未知时重新观察 checkpoint，最后才发布项目配置。Repoctopus 没有复制这些源码或 Comet 状态文件；本地实现复用 request-scoped Store binding Intent/Receipt、固定 `SpecificationProcessPort`、OpenSpec Store registry 和多仓 pointer 顺序，并拒绝把 Comet 的单仓 Classic layout、自动删除/rollback 或第二套生命周期带入产品。真实 Windows CLI 测试使用隔离 XDG data/config 证明该采用结果。

## 未直接采用

- 上游 Engine 内的文件存储和手动运行封装没有复制。它们依赖 Skill 和平台文件系统，会破坏 Repoctopus 的纯 Engine 边界。
- 上游完整 CLI、Dashboard、Skill 文案、模板、用户级 Runtime 目录和产品命名没有复制。
- Workflow Application 与 Classic SDK 不整块复制；其五阶段、固定定义、审批绑定、稳定任务身份和 Hook 写作用域进入 `establish-change-lifecycle` 的产品设计，由 Repoctopus 的 Cordis、团队 Workspace 和多仓模型实现。
- Comet Native Evidence、Receipt、Retention 与 Checkpoint 文件没有整块复制。依赖闭包显示它们同时引用 Change、Transaction、Portable、Doctor 和 Comet Native 配置等产品域；Repoctopus 按独立 Evidence 领域重新实现。Snapshot 和 Lock 仍不整块复制，但其通用 Fence、文件身份和所有权算法已经按目标文件登记为实质改写。详细分析见 `implementation-feedback-adoption.md`。

这些决定保留上游成熟算法，又避免把无关模块和耦合一并带入。后续采用新的上游文件时，必须先更新来源清单、许可证评估、采用报告和行为测试。

## Verify 实现修复的完成事实保留

本次固定参考同一 Comet 0.5.1 commit 的 `native-sdk-verify-decision.ts`：区分 `revise-implementation` 与 `retry-verifier`；Classic `classic-application.ts` 保留 Verify 后重新进入 Build Plan 的步骤。来源内容摘要登记在 source-manifest.json。本次没有引入 Comet SDK、复制新源码或切换上游版本。

Repoctopus 将上述分类和依赖有效性原则应用于现有多仓 Build Protocol：失败的机器 Bundle/Acceptance Trace 与已接受 Plan 决定影响闭包，未受影响完成凭证仍由真实声明输入和 producer 产物证明。四包选择性保留算法是对 Repoctopus 现有包模型的适配，并非声称 Comet Classic 存在同构的四包实现。同内容 Plan 复用原身份，真正的实现修复保留原 Task 完成事实，继续普通 Execute、Check、Verify。未知范围不猜测全局影响；schema 3 的修复事实不是另一个生命周期或 generation。

## 已完成 Run 的恢复边界

固定参考 Comet 0.5.1（35c9860b77b42bafa0c2d80d8d695889f888a924）的 domains/engine/runtime-service.ts 和 domains/comet-classic/classic-current-change.ts，来源摘要登记在 source-manifest.json。执行循环先停止 completed，普通命令不能隐式重新激活完成 Run，Classic 先识别归档再检查活动分支。

Repoctopus 将这些规则应用于现有 continuation、完整 Runtime status、coordinator、Cordis Service 和 CLI 输出；保留 RunStore/Journal 的完整性边界和活动多仓授权校验，不引入 Comet SDK 或第二份状态。终态保留原 Closure、PublicationReceipt、Evidence 和历史诊断，只补发原 Cursor 尚未确认的已提交遥测。验收覆盖完整状态与两个新进程顺序，记录在 preserve-completed-run-recovery 的规格、任务和验证报告中。
