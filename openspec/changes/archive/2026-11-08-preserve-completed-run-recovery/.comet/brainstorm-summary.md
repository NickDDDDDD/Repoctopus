# Design 候选摘要

状态：用户已批准本次 Comet Design 提案及 autonomous + TDD + thorough 执行配置。唯一正式技术设计为同一 Change 的 design.md；本文件仅保存 Comet 设计讨论的恢复摘要，不建立规格或任务权威。

- Open 范围已批准：仅修复 completed Run 的恢复一致性；8 项任务及验收未变化，无 Spec Patch。
- 方案：沿用现有终态分类，在完整查询、coordinator、Service 和 CLI 输出边界一致应用；先取得可信持久状态，再决定终态，不触发活动执行恢复。
- 历史诊断：保留原 reconciliation 标志和完成回执，不篡改 Store；该标志不能成为已完成 Run 的待办要求。
- 完整性：必要文件缺失、损坏、跨版本不一致或未结 Journal 必须沿既有 Store 边界处理，不能仅凭一个 completed 字段成功返回。
- 备选方案：更新启动快照、增设终态 recovery Work、只放宽 branch drift、只修 UI，均不能同时守住原身份和跨入口一致性，未采用。
- 来源：固定 Comet 0.5.1 的 runtime-service 终态停止/命令限制与 Classic archived selection；已核对当前 master 对应文件无差异。
- 验证：真实 RED/GREEN；完整 Runtime/Service/CLI；两种新进程恢复顺序；原完成身份、事件和调用次数；活动未授权 checkout、未知结果和损坏持久状态的负向回归。
- 执行配置：autonomous + TDD + thorough，沿用已批准 worktree；依据用户对 Design 和完整执行配置的本次明确批准，通过 Runtime 配置入口保存，不再追加重复确认。
