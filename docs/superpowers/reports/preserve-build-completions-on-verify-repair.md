# Verify 实现修复的完成事实保留验证报告

本报告记录已经发生的任务级检查、独立审查及安装包实验。完整阶段门禁由同一 Comet Run 的真实 Guard 收据证明，本报告不替代收据。当前任务以 OpenSpec tasks.md 为唯一完成权威。

## 修复与上游采用

固定参考 Comet 0.5.1 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 Classic Build Plan 续行与 Native `revise-implementation` / `retry-verifier` 分类。来源摘要、行为采用及许可证保持在 `third_party/comet`；没有引入 Comet SDK 或复制新源码。

Repoctopus 的四包选择性保留是对现有多仓包模型的适配：从失败机器 Bundle/Acceptance Trace、冻结 coverage、已接受 Plan 和包依赖推导影响闭包；使用原 passed Receipt 的真实声明输入及 producer 产物证明保留事实。它不是直接复制一个 Comet Classic 四包算法。不能证明范围时保留原失败并有界阻断；真实全局覆盖可以使全部包失效。

相同内容 Plan 复用原对象和身份，真正计划变化才递增 revision。实现修复继续普通 Execute、Check 和 Verify，保留原 Task ID、checkbox 和历史完成事实。Build Protocol 统一使用 schema 3，旧 schema 2 明确拒绝，不提供迁移；Host 四种结果及 Package Completion 仍为原 schema 1。最终通过 Verify 后清除当前修复上下文，历史失败及处置保留。

## 真实 RED / GREEN

外部原始证据目录：`C:/Users/User/Desktop/PP/repoctopus-verify-repair-evidence-20261109`。测试命令及输出保留；没有回退源码制造 RED。

| 检查                                         | 已发生的结果                                                                                                 | 原始证据                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 生产 Verify continuation：四包中 A 失败      | 旧实现实际返回四个 affected package，预期一个，真实 RED；修复后通过                                          | `red-production.log`、`green-slice.log`                                                            |
| 基础设施 incomplete 与畸形 scope 集合        | 独立审查发现后先增加两个失败回归，再修正分类和结构校验                                                       | `red-review-boundaries.log`、`green-boundaries.log`                                                |
| B 的修复同时使其前置 A 的输入失效            | 新提交 B 曾被错误保留，真实 RED；修复后 A、B 都回到普通 Execute，C/D 保留                                    | `red-repair-prerequisite.log`、`green-repair-prerequisite.log`                                     |
| completion identity 损坏与 terminal CAS 漂移 | 两个真实 RED；规范化 completion 校验与 CAS 内复核后通过                                                      | `red-terminal-proof.log`、`green-terminal-complete.log`                                            |
| Action Receipt 创建后输入改变                | 实际 WorkDispatcher 注入点拒绝终态接受，原 pending submission 保留；Plan/Execute/Check 三入口均覆盖 callback | `test/work-execution-submission.test.ts`、`test/build-work-outcome-acceptance-coordinator.test.ts` |

## 依赖、权威与恢复检查

- 领域、Host 身份、旧 epoch、能力、分支及 Outcome 接受边界：10 文件 162 项通过，见 `protected-regressions.log`。
- 实际文件观察覆盖 A 改变但独立 B 仍有效、producer bytes 被篡改导致依赖 C 失效，以及空选择不观察其他节点。原完整输入集成检查 10 项通过、1 项按环境跳过；新增实际跨仓读取和独立输入两项通过，见 `cross-repository-inputs.log`。
- Input snapshot/policy、Acceptance Trace、Verification Input、原 lifecycle 和遥测：6 文件 71 项通过、1 项按环境跳过，见 `evidence-authority-regressions.log`。不把跳过视作执行通过。
- 来源契约与安装环境：27 项通过，见 `provenance-current.log`；运行来源审计、TypeScript、完整 ESLint 和架构检查均通过。
- 新恢复事件使用 Work 权威及 `implementation-failed`，不再把本次 Verify 实现失败虚报为 Plan 约束漂移。OTLP 新增影响/保留包数量，指标维度不包含原始错误、路径或 digest。字段说明由机器目录生成至 `docs/telemetry-reference.md`。

## 真实安装包与多仓实验

可重现操作者为 `verification/preserve-build-completions-on-verify-repair/acceptance.mjs`：仅调用实际安装包的公共 CLI、普通 Git 和仓库文件写入；不编辑 Runtime Store。使用五个独立 Git 仓及本地 bare origins，OpenSpec 根通过公开 init/setup 命令建立。所有分支建立后立即 push，所有测试业务 commit 立即 push。

第一轮实验已经通过：四包 Build 后强验收发现 A 错误；保留 B/C/D 原 completion 对象，同内容 Plan 身份不变；普通 Execute 仅修复 A，再通过新 Check 与 Verify。Execute 和机器检查次数均为 A=2、B/C/D=1，原 Task 完成事实不变。失败后、Plan 接受后、修复后、Check 后四个新进程恢复边界通过；未授权分支的 resume/next 均阻断，切回后继续同一 Run。回执在 `lab/evidence/acceptance-receipt.json`。

最终候选包 SHA-256：`635980c0d5aeee8b60cf78d72da0b71d776c1b87a23dedfa0ffcd3c2c4baf295`；独立安装后 CLI SHA-256 与工作树生成物相同：`9efe3e7390a83aa0c255ce6933783a0c1672f7e13e6f9b49469c217735337358`。最终候选另用全新 `lab-final` 目录复验，完整场景再次通过：Plan 身份 `build-plan:ad2b6d3865bda13ab440ff53` 保持；Execute 与机器检查均为 A=2、B/C/D=1；原 B/C/D completion 对象和原 Task 完成事实不变；四个冷恢复边界通过，两条未授权分支入口均被拒绝，切回后继续并通过新 Check、Verify。

回执已保存到 `verification/preserve-build-completions-on-verify-repair/acceptance-receipt.json`。实验仅完成 Verify 后到达 Archive 待执行 checkpoint，没有执行规格 Close 或发布业务 MR；这不代表本修复 Change 已归档。最终候选构建之后仅整理了本报告、回执及采用说明的标题层级，没有改变 Runtime 实现或 Skill 内容。

安装包 doctor 使用真实 Run 检查通过；未使用缺少必填 `--run` 的错误调用作为通过证据。本次没有修改机器长路径设置，没有启动本地 SigNoz，也不发布 Release。

## 独立集成审查

唯一独立集成 reviewer：`/root/verify_repair_slice_review`，独立上下文 `slice-review-build`。先后发现并关闭 incomplete 根节点误分类、未知范围缺少持久化阻断、选定 Receipt 全局观察、scope 数组形状、新 completion 前置同时失效、completion identity 损坏及最终 CAS 复核缺口。

核心最终复核未发现新的阻断问题，reviewer 独立运行 3 文件 52 项通过。最终来源角色对齐及完整差异审查记录保存为外部 `final-independent-review.md`。独立审查不代替真实完整 Guard 或最终候选安装包验收。

## 完整门禁与交付边界

首轮正式 Build Guard 通过。首轮正式 Verify 完整运行约 18 分 49 秒：203 个测试文件通过、1 个跳过，1171 项测试通过、5 项跳过；唯一失败是 `test/project-composition.test.ts` 仍绑定旧 Runtime 实现的组合摘要。核对后确认 builtin catalog、组装选择、foundation workflow 与项目配置均未改变；本次 Runtime/Skill 源身份改变产生新摘要 `sha256:94ae82c6ce36b21d2007f3a47dd4acf49e8e4135697199efc4acb713b065a8f0`。更新了该精确回归基线，保留所有身份、注册清单、隔离和 daemon 排除断言，单项复测通过；没有增加兼容摘要或放宽 Validator。原始失败在外部 `full-verify-first.log` 保留。源码和最终安装包的 CLI bytes 仍相同。

Comet 按失败收据返回同一 Run 的 Build Plan，原十项任务和执行配置保持完成及批准，沿用原计划修正此测试基线后重新执行完整门禁；没有重开 Open/Design 或修改 Store 绕过。

同一 Run 固定使用 `.comet/check-policy.json` 中的精确命令：

1. Build：`comet guard preserve-build-completions-on-verify-repair build --apply --local -- npm.cmd run build`。
2. Verify：设置已绑定的 `VITEST_MAX_WORKERS=2` 后执行 `comet guard preserve-build-completions-on-verify-repair verify --report docs/superpowers/reports/preserve-build-completions-on-verify-repair.md --apply --local -- npm.cmd run verify`。

完整结果以该 Run 的 Guard 执行记录、原始日志及返回状态为准，不以本报告中的任务级通过数代替。归档、创建 PR、远端 CI、合入 main 和发布 Release 都是后续交付事实；本报告不预先声明它们完成。
