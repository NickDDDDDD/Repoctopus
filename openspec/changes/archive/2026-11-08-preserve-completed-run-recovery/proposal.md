# Proposal

## Why

真实多仓验收已经完成规格关闭和全部 MR 发布，Run 返回 `completed + done/terminal`；新进程执行 `resume` 后，却把获准开发产生的分支、HEAD 变化与启动快照比较，写入全局 reconciliation 标志，使后续 `next` 返回 `reconcile/project-drift`。现有终态规则只在底层 continuation 分类中成立，尚未贯穿恢复入口和完整状态投影，需要优先补齐团队工作流的这一核心边界。

## What Changes

- 参考 Comet 已有的终态优先规则，让已完成 Change Run 的 `status`、`resume`、`next` 一致返回 `done/terminal`，不重新激活开发阶段的漂移恢复。
- 终态判断仍以可验证的持久 Run、Checkpoint 和转换 Journal 为依据；不跳过 Store 完整性检查，也不把缺失或损坏状态伪装成成功。
- 全局 reconciliation 标志和历史 continuation 不得覆盖已经接受的完成事实；不手工修改 Store、不回写启动快照、不建立第二份生命周期。
- 保留活动 Run 的多仓 Binding、最新 workspace checkpoint、精确 Evidence 失效和未授权 checkout 拦截。
- 用真实 RED/GREEN、生产 Service 和新进程多仓 CLI 验收覆盖两种恢复调用顺序，核对继续指令、原 Closure/PublicationReceipt、全部工作包、Evidence 和副作用次数。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `runtime-foundation`：明确已完成 Run 的恢复不进入活动项目 reconciliation，保留持久化完整性和中断恢复边界。
- `change-lifecycle`：补齐终态在完整状态投影、两个公开恢复入口及历史 reconciliation 标志上的优先级验收。

## Impact

- 主要涉及 WorkflowRuns Service、Runtime coordinator 的恢复和查询投影，以及对应领域、集成和 CLI 验收；不新增 CLI 参数、配置、状态 schema 或长期运行进程。
- 本次交付是终态恢复一致性的完整修复。Windows 长路径前置检查、包内 doctor 资源、桌面激活及 PR 正文传递分别留作后续问题，不混入本次实现。
- 使用 Comet 0.5.1 固定 commit `35c9860b77b42bafa0c2d80d8d695889f888a924` 的行为方案：`runtime-service.ts` 的终态停止与 command 终态限制、Classic 已归档 Change 的选择限制。已核对上游 master `a61a2e5b4766e1ad62377dec598e402560a259b6`，相关规则与固定版一致；不引入 Comet SDK 或替换 Cordis 架构。
- 上游采用以行为参考为主；沿用 MIT 来源记录，若实施涉及新增复制或实质改写，则同步更新机器可检查来源清单。测试报告和运行证据独立保存，规格与任务仍仅由 OpenSpec 管理。
