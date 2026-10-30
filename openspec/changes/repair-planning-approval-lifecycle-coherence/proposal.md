# Proposal

## Why

当前 Change Run 的 phase/current Work 与 Specification planning approval、`workExecution` checkpoint 不是始终按同一权威边界推进。已经出现两种真实故障：

1. Verify 收尾提交改变规划语义后，Design approval 已刷新为 `awaiting_approval`，但 lifecycle 仍处于 Archive；Archive preflight 正确阻止副作用，却只能抛出“缺少有效批准”，没有把 Run 恢复到 Design。
2. lifecycle 已回到 Design 且 `currentWork` 为空，但 `workExecution` 仍保留旧 `build.plan` checkpoint，恢复投影因而报告旧 Work、旧 `checkEpoch` 和 `validator-pending` continuation。

Comet 0.5.1 的成熟恢复语义是：Classic 修订命令绑定 `expectedRevision/fromPhase`，Native continuation 绑定 `stateVersion/expectedAction`；阶段回退、下游证据失效和下一 Action 在同一次 CAS 中发布，查询只诊断、不暗中推进。Repoctopus 已有 lifecycle transition 时通用退役不匹配 execution checkpoint 的 CAS 能力，但规划返工尚未在该 transition 中提供下一 Work，遗留 checkpoint 的读取也尚未 fail closed。需要把 Comet 的 revision fencing 与 same-CAS next Action 不变量适配到 OpenSpec Provider、多仓 Change Run 与 Work Descriptor，而不是分别修补 Archive 和 Desktop。

## What Changes

- 让规划语义或批准授权失效成为受保护 lifecycle observation；Build、Verify 和 Archive 在继续受保护工作前先以只读方式观察当前 Provider 语义。
- 回到 Design 时在一次 revision-bound Run CAS 中同时发布 Design phase、替代 `specification.plan` Work、新 `checkEpoch`、下游证据失效，并复用已有通用规则退役旧 execution checkpoint。
- `workExecution` 只有在 `workId` 与 `checkEpoch` 同时匹配 lifecycle current Work 时才可作为当前 checkpoint 或 continuation；历史事实继续保存在 trajectory。
- Archive 在规格关闭、Git 发布或 MR 创建前发现漂移时返回显式 `planning-revision-required`，而不是只抛出缺少批准。
- status/Dashboard 保持只读并只投影 lifecycle 当前 Work；旧 checkpoint 或跨 Store 中断由下一次 `run next/resume` 受保护 pull 通过 CAS 幂等退役，不由查询偷偷改变 phase，也不让后续 claim 撞上遗留 checkpoint。
- 增加状态机、Service、Archive、冷启动恢复和 OTLP 回归测试，并用两个真实故障形态作为验收夹具。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`: 规划授权失效必须原子回到带当前 Work 的 Design checkpoint。
- `managed-work-execution`: execution checkpoint 与 lifecycle Work/epoch 不匹配时必须退役，不能生成 continuation。
- `specification-authority`: later phase 必须只读观察规划语义，并在受保护副作用前收敛失效批准。
- `development-telemetry`: 必须可观测规划失效、checkpoint 退役和恢复结果。

## Impact

- 主要影响 `domains/change-lifecycle`、`domains/work-execution`、`domains/runtime`、`services/specification-planning`、`services/workflow-runs`、`services/work-execution-authority`、Archive 命令路径、RunStore/trajectory 投影与相关测试。
- 不增加 lifecycle generation、后台 daemon、Webhook、轮询、第二套 approval phase 或第五份 OpenSpec 工件。
- Comet 仅作为恢复不变量和 CAS 边界参考，不复制其单仓 Classic 命令或产品目录，不产生新的许可证影响。

## 非目标

- 让 status、Dashboard 或普通文件 watcher 自动推进 lifecycle。
- 把任意文件改动都解释为规格变更；只有 Provider 严格语义摘要或有效批准身份变化才触发恢复。
- 保留旧 Runtime checkpoint 的兼容妥协；当前尚未正式发布，错误状态直接收敛为唯一新模型。
- 修改 Build Configure、Build Plan、TDD、Verify Evidence 或 Archive Publication Receipt 的业务规则。
