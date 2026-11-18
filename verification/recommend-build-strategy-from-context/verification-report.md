# 场景化 Build 策略验证报告

状态：Build 验收进行中。真实宿主 Design 答复和 Comet 正式完整 Verify 尚未完成；本报告不声明 Change 已完成或可交付。

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
- 最终源码前一轮广覆盖回归为 1302 项通过、4 项跳过；公开 Host CLI 完整场景另行通过。重生命周期矩阵有 7 项通过，余下旧 Design 校验失败断言已按合法 repair Work 更新，正在复跑；保留所有不得越门进入 Build/Verify 的断言。
- 初始候选的 Windows 三仓实包验收从 Init 走到 Archive，首包完成后换进程续跑同一 Run、规格 PR 响应丢失恢复及终态无副作用检查通过。最终候选按同一路径另行验收。
- 初始候选的 subagent-driven-development/direct 实包实验由实际子 Agent 完成两个仓的工作包，各自真实检查、提交并 push，回执绑定各包的父 invocation，最终 Archive 和终态恢复通过。没有把 direct 检查伪装成 RED/GREEN。

## 实验纠正与边界

实包多 Agent 实验脚本最初漏列 direct 的 test/regression 契约，随后复用了子 Agent 名作为两个不同检查的证据 ID。Runtime 分别拒绝了不完整计划和重复的 Build Check 证据；通过公开 Outcome 纠正后继续原 Run，没有修改 Store 或放宽校验。脚本重复读取同一 invocation 的 Skill 记录与实际重复派发分开核对，按 invocation 保留精确顺序。

早期直接从 Node 启动 npm 包测试缺少 `npm_execpath`，改从项目声明的 npm 入口运行后安装包测试通过。隔离 worktree 的依赖已按 lockfile 独立安装，未继续复用主目录中旧版 DSH；Electron 已按项目准备入口配置。

初始化、自动化审批与本地 GitHub API 为独立夹具，不能等同真实用户答复。至少一次原生 Design 答复尚待完成；该实验没有业务生产仓、真实远端 PR 或正式 Release。旧开发 checkpoint 不在兼容范围内。

## 原始记录

所有原始命令、真实子 Agent 检查、Git 事实、候选包与发布账本保存在仓外 `C:/Users/User/Desktop/PP/repoctopus-strategy-evidence-20261119/`。其中 `windows-package/receipt.json` 是初始包自动化终态收据；`delegated-lab/evidence/terminal.json` 是实际委派实验终态收据；`native-lab/evidence/native-design-decision.json` 是待真实答复的请求。`final-package/` 绑定本报告的最终候选。

正式 Comet Build Check、Verify 的命令、结果及最终限制将在实际完成后补录，不能用上述分段检查代替。
