# 2026-11-11 远端分支审计

本记录供维护者查询旧分支的交付去向和原始提交。审计基线为 main 的 `65b6bd463a1cb4fcd5196598f2f9e03fc1f81f0f`，对应 [PR #83](https://github.com/NickDDDDDD/Repoctopus/pull/83)。审计开始时共有 13 条远端工作分支，全部 PR 均已关闭并合入。

六条分支的当前 tip 已属于 main 历史，可以删除。另七条保留早期实验或文档提交，逐条处理见下表。维护者可通过远端 annotated tag `archive/2026-11-11/<原分支名>` 找回这七条分支的完整历史。

## 已完整合入的分支

| 原分支                                              | 交付记录                                                   |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `codex/preserve-build-completions-on-verify-repair` | [PR #82](https://github.com/NickDDDDDD/Repoctopus/pull/82) |
| `comet/enable-host-mediated-human-decisions`        | [PR #83](https://github.com/NickDDDDDD/Repoctopus/pull/83) |
| `comet/fix-packaged-doctor-provenance`              | [PR #79](https://github.com/NickDDDDDD/Repoctopus/pull/79) |
| `comet/fix-windows-default-archive-paths`           | [PR #78](https://github.com/NickDDDDDD/Repoctopus/pull/78) |
| `comet/preserve-completed-run-recovery`             | [PR #77](https://github.com/NickDDDDDD/Repoctopus/pull/77) |
| `comet/repair-evidence-input-identity`              | [PR #76](https://github.com/NickDDDDDD/Repoctopus/pull/76) |

## 早期分支的处置

| 原分支                                                | 原始 tip                                   | 当前处理依据                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex/document-self-host-recovery`                   | `be116db65e0e3020024982b1144932ceead37f7a` | 将仍有价值的自举恢复决策背景更新到本记录。原提交按标签保留。                                                                                                                                                                                                                                       |
| `codex/separate-build-strategy-and-execution-binding` | `ac685108fbf56f59ebc39adc6afcb0513eed9865` | 两项独立提交仅补充旧 Change 的 Design 和 Tasks。当前已归档版本包含对应设计与 Acceptance，并已通过 [PR #50](https://github.com/NickDDDDDD/Repoctopus/pull/50) 交付。                                                                                                                                |
| `codex/lifecycle-repair-experiment-backup-20261028`   | `2771a1501c2173a14a6854fa5bd671d5db2d86f3` | 保留了独立 repair Work 实验。现行 salvage ledger 将该方案列为 reject，当前 Runtime 使用已接受的恢复分类。                                                                                                                                                                                          |
| `codex/revise-dashboard-telemetry`                    | `6baec61b60e1b66e7c1fa465e181a245d604c6a0` | Dashboard 与遥测需求已在 [PR #33](https://github.com/NickDDDDDD/Repoctopus/pull/33)、[PR #34](https://github.com/NickDDDDDD/Repoctopus/pull/34)、[PR #51](https://github.com/NickDDDDDD/Repoctopus/pull/51) 中按现行接口交付。旧 measurement 和直连 exporter 已由 canonical observation 路径替代。 |
| `codex/windows-desktop-dashboard-telemetry`           | `4e0b9df14679d5dcf5026fbac5fc5a1192c617e9` | 现行 salvage ledger 已逐项记录 receiver、journal、launcher、Shell、IPC、Renderer、telemetry 和 packaging 的重写边界。对应 Dashboard Change 已完成全部任务并归档。                                                                                                                                  |
| `feat/windows-desktop-dashboard`                      | `97315a0eb4ecbadd50c2b70b07ddb8563e84e54e` | 早期桌面实现使用旧 projection、activation、platform-event 和 exporter 接口。当前 Dashboard 的 OTLP 接收、五阶段展示、托盘、单实例和安装包已通过后续交付与测试覆盖。                                                                                                                                |
| `spec/add-windows-desktop-dashboard`                  | `0bb9dfa5ba7bda29eb13ed5f67555514ebaa5cc4` | 后续完整四类规划产物和完成事实已进入归档。保存原提交供历史核对。                                                                                                                                                                                                                                   |

现行行为的依据包括 [Dashboard salvage ledger](../../../scripts/dashboard-salvage-ledger.json)、[Dashboard 归档任务](../../../openspec/changes/archive/2026-10-29-add-windows-desktop-dashboard/tasks.md)、[Build Strategy 归档设计](../../../openspec/changes/archive/2026-11-01-separate-build-strategy-and-execution-binding/design.md) 和 [遥测交付报告](integrate-runtime-telemetry-measurements.md)。salvage 检查使用固定提交身份，远端分支名仅作为来源说明。

## 按当前版本保留的自举恢复决策

`be116db` 记录了一个维护风险。Runtime、Run binding 或恢复协议自身故障时，维护者可能无法通过当前 Runtime 完成修复。该记录当时将严格受管流程与显式自举恢复列为后续讨论。

当前版本已经具有唯一 Change Run、Runtime 选择 Action、验证 Outcome、Archive preflight、Publication Journal 和 checkpoint 恢复等能力。维护者应依据[现行 Runtime 恢复约束](../../runtime-state.md)与[自举流程](../../self-hosting.md)判断实际行为。旧提案中的“尚未实现”范围需要按这些已交付能力重新核对。

仍需保留的决策背景是自举故障的处置方式。核心 Runtime 修复已采用外部 Comet controller，真实多仓安装包验收用于验证 Repoctopus 自身。维护者可以继续用这一开发方式避免修复过程依赖故障中的 Runtime。

显式自举恢复入口、独立 Recovery Receipt，以及已有未受管 Change 的接管方式，保留为后续设计问题。如开展实现，应由对应 Change 明确人工授权、证据记录和恢复结果的语义。这份历史记录仅保留决策背景。

## 核对范围

审计交叉检查 GitHub 全部 PR 状态、每条远端 tip、main 祖先关系、独立提交、现行源码路径、salvage ledger 和已归档任务。删除使用预期 tip 的远端 lease，先发布并验证归档标签，再清理对应分支。

本次整合范围为这份开发记录。产品行为的验证基线继续使用 PR #83 的完整 CI 和真实安装包三仓审批验收。旧实验中的测试结果保留在其历史提交中。
