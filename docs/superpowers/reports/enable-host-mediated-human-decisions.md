# Host 人工决定验证报告

本报告记录已经发生的检查和验收边界，不替代 Comet Guard 收据。当前使用 Comet Classic 开发，Repoctopus 只运行隔离实验。

## 实现与上游采用

固定参考 Comet 0.5.1 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 Design、Build 和 Archive 决定入口：Host 收集真实选择，公开命令核对当前 Wait、提案、来源和分支，Runtime 接受事实并推进。三个来源的精确 Git blob SHA-256 已登记到 `third_party/comet/source-manifest.json`，没有引入 SDK、审批后端或第二份决定 Store。

Repoctopus 新增 `run decision` 与 `run decide --response-file`；Open/Design 仍以原规划批准 Store 为权威，意图修订和 Plan 风险仍使用原 guarded lifecycle transition journal。响应保持真实本机 CLI 主体，宿主渠道与授权依据分开记录，答复引用只保存摘要。此通道信任 Host 对真实用户答复的关联，不提供独立的人类点击认证。

共享规划批准和 Run 参与事实分开。另一个合法 Run 可以复用同语义批准，但仍须确认自己的隔离；读取视图通过 `runParticipation`、`requiresSubmission` 和模板表达这一剩余步骤。终端与 Host 同归提交协调，不重复批准已经接受的决定。

## 已完成检查

原始证据保存在 `C:/Users/User/Desktop/PP/repoctopus-host-decisions-evidence-20261110`。

| 检查                           | 结果与证据                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 原 CLI 公开入口 RED            | `red-open-cli.log`：真实建立 Open 等待后，原版因不识别 `run decision` 失败；前置流程成功，无伪造 TTY 或 Store 写入                    |
| Open → Design → Build 公开命令 | `open-design-cli.log`、`green-public-boundaries.log`：两个请求独立、旧 Open 回传不能批准 Design、接受后须下一次 pull 才推进           |
| 边界校验                       | Schema/kind/phase、未知主体字段、条件 isolation、64 KiB、错误 Run/request/hash、真实规划和 Provider 漂移均有拒绝回归                  |
| 共享批准审查发现               | `red-review-boundaries.log`：补充原 Run 隔离步骤与 enum 数组负例后先红；修复后通过，未转成每 Run 独立规划批准                         |
| 决定与中断恢复                 | `green-authority-recovery.log`：98 项针对性检查通过，含真实 journal 写入后抛错、新 Store 恢复、同一 Work/checkEpoch、原选择及冲突隔离 |
| 四类合同                       | 领域与协调测试覆盖 Open、Design、workspace intent、Build Plan；revise/reject 保留原始选择，不覆盖规范化效果                           |
| 隔离修订真实集成               | `green-managed-decisions.log`：current → worktree 跨进程恢复通过；该次名称过滤仅命中这一项，其余六项跳过，不算完整矩阵                |
| 静态与来源                     | TypeScript、全量 lint、架构与 provenance 审计通过；Telemetry 隐私回归不导出问答正文、主体或答复引用                                   |
| 独立审查                       | 三轮只读审查：共享批准剩余隔离、enum 类型、终端回退三项发现已修复，最终无剩余 P1/P2                                                   |

普通 Work Outcome 完成后仍停在 Human Decision；无实际答复不提交。自动化测试中的 `native` 字符串仅验证协议结构，不算真实 UI 证据。

## 实际包和三仓实验

补充真实多仓 Plan 风险及完整生命周期回归已通过：`green-managed-plan-risk.log` 中 autonomous 两业务仓用例耗时 304 秒，实际接受 Plan 风险决定后完成 Open → Design → Build → Verify → Archive。另六项未选中，不宣称全矩阵通过。

源码实现已提交并推送：`1e9f045`；补充边界和消费者合同检查为 `1366973`。后者仅调整一个 CLI 泛型声明和测试，不改变执行逻辑；最终安装包重新构建。

最终候选的包内容 SHA-256 为 `612ebd11255374c104fd91ad8fa45676567d35cab8572d698667c96f2c9ec802`，476 个文件、6,144,521 字节。运输 archive SHA-256 为 `a00f5763555e30d4055d36fc8f6635252c6ff62a56f889950f55289947c72562`。初始候选独立保留，不混称为最终候选；初次 Git 字节核对覆盖 466 个已跟踪包文件，零差异。

实际安装包已使用公开 OpenSpec CLI 在独立 XDG registry 初始化 Store，建立 Workspace/frontend/backend 三仓和本地 bare 远端，分别立即 push 分支与提交。实验 Run 为 `change-host-decision-lab-verify-host-decisions-ebaa673679b09daa`。

当前实验停在 Open 等待，`requestId=human-decision:6978864ac54bce30d12a40d4`，提案摘要 `sha256:b2884729a6a050af024a246ba283431860135258f2f1c4f45d04b523b25c13e7`。最终包已从新进程恢复原等待并交付原生提问指引；Host 已展示真实问题，尚在等待真实答复，未提交决定。

## 未完成与门禁

真实原生答复、最终包的实验 Open/Design 接受及后继核对尚未完成，不宣称任务 3.2 已通过。当前任务 8/10 完成，3.2 和 4.1 保持未完成。完整 Build/Verify Guard、归档、PR、CI、合入和发布均尚未完成。

正式检查入口保持 check policy 的精确 argv：`npm.cmd run build` 与 `npm.cmd run verify`，后者绑定 `VITEST_MAX_WORKERS=2`。只有实际验收及任务完成后才向同一 Comet Run 提交阶段收据；本 Change 不发布 Release。
