# 场景化 Build 策略验证报告

状态：8 项实施任务、独立审查、实包验收和完整预检已完成。正式阶段结论以同一 Comet Run 的 Build/Verify Guard 收据为准；归档和交付仍须当前授权。

## 最终实现与候选包

Tested implementation commit: `8163338d3916981c5982f8c37f1690ad541d205d`

Package content SHA-256: `b9bec8360c0ef855f4186b1bb94a4e47124c4157c65c97d5cffa692b82cf0d88`

Package files: `488`

Package content bytes: `6621674`

候选包为仓外 `final-package/repoctopus-0.1.3.tgz`，不是已公开 Release。摘要通过 `scripts/package-content-digest.mjs` 对实际归档计算，忽略 tar/gzip 传输元数据。后续仅允许提交 Comet、OpenSpec、验证报告和实施计划等收尾产物；实现或分发内容变化须重新构建及验收。

## 已观察到的证据

- 公开启动路径先复现未指定偏好被补成 autonomous/TDD；修复后缺参、部分输入和完整输入保持原意，非法模式在创建 Run 前被拒绝。
- Design 候选必须包含两轴及可审阅依据。缺项、非法值和非法委派回执保留原 invocation 可纠正；真实 CLI 已观察到非法回执入口缺失的失败，补齐传输后同 invocation 纠正通过。
- `spec approval prepare --run` 与 `run decision` 显示同一候选、请求与隔离意图。过期 Open 答复不能批准 Design；用户请求 B、Host 建议保留 A 时仍展示新意图并要求当前决定，批准后再次提出 B 不会被旧修订吞掉。
- 只读独立审查覆盖候选来源、审批 receipt 与 Run gate 的恢复、显式修订、安全能力边界及回执运输，未发现未解决的 Runtime 重要问题。旧 Configure 文档说明已修正。
- 最终源码前一轮广覆盖回归为 1302 项通过、4 项跳过；公开 Host CLI 完整场景另行通过。重生命周期矩阵的 7 项场景通过；余下单仓场景按合法 repair Work 更新旧断言后，完整复跑通过，实际耗时 268.64 秒。保留所有不得越门进入 Build/Verify 的断言，且精确要求只多执行一次 Design 修正 Work。最终 Host CLI 场景为 120.82 秒通过，包含执行权尚未结清时禁止改选且 epoch 不变的检查。
- 初始候选和本报告绑定的最终候选分别完成 Windows 三仓实包验收，从 Init 走到 Archive，首包完成后换进程续跑同一 Run、规格 PR 响应丢失恢复及终态无副作用检查均通过。最终候选耗时 315.99 秒，实际收据为 `final-package/windows/receipt.json`。
- 初始候选的 subagent-driven-development/direct 实包实验由实际子 Agent 完成两个仓的工作包，各自真实检查、提交并 push，回执绑定各包的父 invocation，最终 Archive 和终态恢复通过。没有把 direct 检查伪装成 RED/GREEN。
- 用户通过宿主原生问题 `call_30eb1aa784c34e8aad6be732d86c4487` 批准实验 Design 和 autonomous/TDD。Host 按原 response template 回传真实答复，绑定原请求 `human-decision:c6660e9a17a63c6d44a615f7`。暂停后的原 Run 完成 Configure、两包实际 RED/GREEN/回归、首包冷恢复、Verify、Archive、PR 响应丢失恢复和终态无重复发布，收据为 `native-lab/evidence/terminal.json`。

## 实验纠正与边界

实包多 Agent 实验脚本最初漏列 direct 的 test/regression 契约，随后复用了子 Agent 名作为两个不同检查的证据 ID。Runtime 分别拒绝了不完整计划和重复的 Build Check 证据；通过公开 Outcome 纠正后继续原 Run，没有修改 Store 或放宽校验。脚本重复读取同一 invocation 的 Skill 记录与实际重复派发分开核对，按 invocation 保留精确顺序。

早期直接从 Node 启动 npm 包测试缺少 `npm_execpath`，改从项目声明的 npm 入口运行后安装包测试通过。隔离 worktree 的依赖已按 lockfile 独立安装，未继续复用主目录中旧版 DSH；Electron 已按项目准备入口配置。

最终源码的 lint、两套 TypeScript 检查、build、生成物一致性、品牌、架构、来源、Dashboard 账本和验证报告包内容绑定检查已分别通过；候选契约的最终 57 项定向回归通过。额外运行的全仓 `format:check` 仍有 302 个格式提示，包括 296 个未在本次修改的文件及 6 个 Comet 管理/规划文档；用基线 `e27e836` 中未改动的主规格复核也不能通过格式检查。本次修改的产品源码没有格式提示，未批量重排既有文件或改写已批准文档及 Runtime 管理状态。`format:check` 不在项目声明的 `npm run verify` 或 CI 检查链内，此结果保留为明确限制。

初始化、自动化审批与本地 GitHub API 为独立夹具，不能等同真实用户答复；上述 native 实验的 Design 则使用实际用户回答，已与自动化决定分开记录。该实验没有业务生产仓、真实远端 PR 或正式 Release。旧开发 checkpoint 不在兼容范围内。

## 完整验证与规格一致性

在最终实现上实际执行 `npm.cmd run verify`，退出码为 0。Vitest 为 214 个文件通过、1 个文件跳过；1312 项测试通过、4 项跳过，测试耗时 1409.24 秒。两套 TypeScript、lint、build、生成物一致性、品牌、架构、provenance、Dashboard salvage、19 项严格规格校验及验证报告包身份检查均通过。完整日志为仓外 `full-verify-preflight.log`。

独立集成审查覆盖 `e27e836..f56ef02`，并增量复核至最终实现 `8163338`。无未解决 IMPORTANT/CRITICAL；最后修正的 Configure 文档行、Design repair 精确次数和在途改选负向断言均已复核。

| 规格要求                           | 实现与验证依据                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build Configuration 仅支持固定策略 | `strategy-selection.ts`、现有 Build Protocol/逐 Work capability 校验；四种合法两轴组合、缺能力和委派证据回归，及实际多 Agent/direct 实验                   |
| 未指定偏好不得成为批准             | `WorkflowRuns.startChange`、公开 CLI 显式 flags；真实启动 RED/GREEN、非法值零 Run 写入、原生实验无模式参数启动                                             |
| 建议与授权可核对、可恢复           | 当前已接受 Design submission 派生 proposal；同一 gate CAS、实际 snapshot 的 scoped 决定、历史修订来源保留；真实 CLI 的纠正、过期答复、反复修订和冷恢复回归 |
| Skill 按实际场景建议两轴           | 入口、Design、Configure/Execute Action Skill、Workspace 教程；冻结 Skill 消费检查，native autonomous/TDD 与实际子 Agent/direct 的完整三仓实验              |

复核了 4 条要求和 23 个场景，未发现实现与已批准设计的矛盾。唯一任务权威仍是本 Change 的 tasks.md，没有额外 spec/ticket/ADR 或实现笔记权威。

## 原始记录

所有原始命令、真实子 Agent 检查、Git 事实、候选包与发布账本保存在仓外 `C:/Users/User/Desktop/PP/repoctopus-strategy-evidence-20261119/`。其中 `windows-package/receipt.json` 是初始包自动化终态收据；`delegated-lab/evidence/terminal.json` 是实际委派实验终态收据；`native-lab/evidence/native-design-decision.json` 和 `native-answer.json` 分别是原请求及真实答复。等待期间停止了 native 实验临时进程，收到答复后用仓外 `resume-native.mjs` 恢复同一 Run；完成后本地服务已停止。`final-package/` 绑定本报告的最终候选。

正式 Build Guard 已实际执行 `comet.cmd guard recommend-build-strategy-from-context build --apply --local -- npm.cmd run build`，通过并由 Runtime 推进至 Verify，原始记录为 `comet-build-guard-cmd.log`。Windows PowerShell 须选公开的 `.cmd` 入口保留 `--`；默认 `.ps1` 包装的解析拒绝已保留，没有产生检查收据或推进阶段。

正式 Verify 使用 `comet.cmd guard recommend-build-strategy-from-context verify --report verification/recommend-build-strategy-from-context/verification-report.md --apply -- npm.cmd run verify`。实际结果由同一 Run 保存，不以手工声明代替；本报告的预检结果不能自行推进 phase。
