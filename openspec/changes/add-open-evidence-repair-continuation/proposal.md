# Proposal

## Why

Repoctopus 自举运行暴露了 Open 阶段的真实死路：`change.intake` Host 已成功提交 Outcome 后，Specification Provider 才发现 Tasks 缺少规范 Acceptance；Runtime 随即执行 `open.invalid`，清空 `currentWork` 并退役 execution，但只在投影中显示没有生产命令承载的 `open.repair` 标签。修复规划文件后，同一 Run 无法重新观察 Provider、重新派发 Open Work 或进入人工审查，只能手改 Store、重建 Run 或绕过状态机。

Comet 0.5.1 的成熟语义不是引入 Repair lifecycle：Classic SDK 把 Open Skill、Open Evidence、人工确认和确认后重验建模为真实 checkpoint；确定性无效时保留 Open 并继续受影响步骤，批准后的摘要变化通过显式边返回 Open Action。Repoctopus 应把该不变量适配到冻结 Work packet、OpenSpec Provider、多仓 Project Snapshot 与 Run CAS，而不是给 Dashboard 标签补一个旁路命令。

## What Changes

- 把 Open Host 执行成功与 Provider/Validator 接受分为不同事实；只有当前 Provider Evidence 被接受后才允许建立 Human Decision。
- Open 产物确定性无效时，在一次 revision-bound Run CAS 中保留 `phase=open`、安装新的 `change.intake` repair Work、递增 `checkEpoch`、退役旧 execution checkpoint并保留完整历史。
- Provider、Store、Skill 或未分类程序错误不得伪装成可修复产物；Runtime 保留原 Work/Outcome并返回可重试的 reconciliation 诊断，不重新调用 Host。
- 人工确认后、进入 Design 前重新观察当前 planning snapshot；摘要变化或严格校验失效时使旧批准不可用于推进，并回到真实 Open Work，而不是直接生成另一份审批或只显示 repair 标签。
- `run next/resume`、冷启动和重复 pull 必须从当前 Run 恢复相同 repair Work或原验证步骤；不得创建新 Run、lifecycle generation、第五种 OpenSpec 工件或第二套规格权威。
- 让 status、Dashboard、Trajectory 与 OTLP 只投影持久化的 Work、Evidence、Human Decision 和 transition，移除没有生产入口的推断式 `open.repair`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`: Open 校验失败与批准后漂移必须形成可执行的同阶段恢复回环。
- `specification-authority`: Open Evidence 必须区分确定性无效与观察基础设施故障，并在批准后重验。
- `managed-work-execution`: Open repair Work 与旧 execution 的替换必须由同一 Run CAS 原子提交并可恢复。
- `development-telemetry`: Open Evidence 拒绝、repair 派发、批准后漂移与恢复必须可观测。

## Impact

- 主要影响 `domains/change-lifecycle`、`domains/runtime`、`services/workflow-runs`、`services/specification-planning`、`services/work-execution-authority`、Open continuation 投影、Telemetry 和相关测试。
- 不引入 Comet SDK、Classic 状态文件、后台 daemon、Webhook、轮询、独立 Repair phase 或新的 OpenSpec 文档。
- Comet 仅作为固定 `0.5.1` / `35c9860b77b42bafa0c2d80d8d695889f888a924` 的行为参考；实现继续服从 Repoctopus 的 Cordis、多仓与 Provider 边界，不复制上游源码，因此不增加许可证义务。

## 非目标

- 统一重构 Design、Build、Verify 或 Archive 的全部失败恢复。
- 把任何 Provider 异常都解释为 Agent 可修复的规格错误。
- 为旧 `open.planning-invalid/currentWork=null` 持久状态保留兼容分支；产品尚未正式发布，旧错误状态只提供明确诊断和重新开始提示。
- 允许 status、Dashboard、Agent 或 Host 直接选择 phase、创建批准或修改 Run Store。
