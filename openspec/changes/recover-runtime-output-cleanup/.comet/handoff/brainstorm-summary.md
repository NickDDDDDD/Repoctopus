# Design 候选讨论摘要

## 已确认

- GitHub #93 的原问题已经用三仓安装包复现。`resume` 和 `next` 均阻塞，`work-reconcile` 提示无待核对 Host invocation。
- 用户已批准 Open 四类产物以及当前的独立 worktree。冻结前检查及已绑定后的受限恢复均在批准范围内。
- Comet Classic 提供同一 Run 的 checkout 归属核对、未决调用保护和版本化提交。逐仓前向进度证明属于 Repoctopus 的既有 Runtime、Git 和 Evidence 合同。

## 候选技术方案

- 在 Build Configure 的正常接受与受保护复核边界使用当前仓库输入策略，检查将绑定的 HEAD 和 index。
- 选择单父直接子提交的纯运行时输出解除跟踪证明，在待执行包进入 Host 前采纳。合法 Workspace 身份、证据有效性和其他登记仓的 checkpoint 是前置条件。
- 在原 Run 上推进已有 Build checkpoint。待执行 Work 的稳定输入包含旧 checkpoint 摘要，采纳后为同一包生成绑定新输入的 Work，保留有效 Plan、完成事实和旧执行历史。异常采用既有 blocker 和原执行恢复。
- 使用现有精确前驱组合采纳验证旧候选的合法活动状态。真实 Git 与 CLI 验收含待执行首包和已有完成包、混合提交、冷恢复及重放。

## 可实施性复核

独立 Builder Check 核对了现有 Work 的 checkpoint 输入、已阻塞 Run 的接受事务和 Configure 的两次提交。设计补齐了同一包重建 Work、原 blocker 专项归因、精确定义前驱与最终 Binding 提交复查。复核后的边界可通过公开入口验证。

## Spec Patch

当前候选细化 Open 已确认的约束。delta spec 保持原文，任务验收具体说明同一包的 Work 如何重新绑定 checkpoint。
