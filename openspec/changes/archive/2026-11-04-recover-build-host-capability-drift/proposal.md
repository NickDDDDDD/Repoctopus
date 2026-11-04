# Proposal

## Why

真实多仓验收揭示的不是缺少一个 `capability drift` 分支，而是两套能力身份同时存在：`ExecutionBinding` 把 Configure 时观察到的完整 Host capability digest 当作整个 Build 的长期身份，外部 Work claim 又只要求 Host 满足当前 Work。两条规则分别合理，组合后却把合法的只读 `build.plan` claim 错判为 Binding 漂移，并在 Plan submission 已持久化后抛出 `Execution Binding requires process.execute, repository.write`。

这次不能继续增加异常捕获或 Configure 回退。Comet 0.5.1 的成熟边界是：每个 Action 声明自己的 required capabilities，Runtime 在持久化 claim 前完成预检，Outcome 绑定原 claim；未知外部结果恢复原 Action，不用一份全局 capability digest 重新解释已经合法领取的 Action。Repoctopus 应采用这一不变量，同时保留自己的多仓 Workspace Binding、Build Strategy 和 Runtime-authoritative Work。

## Historical Failure Chain

| 历史 Change                                     | 当时解决的问题                                                         | 遗留或引入的冲突                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `separate-build-strategy-and-execution-binding` | 把稳定 Strategy 与机器 Binding 分离，并支持 Binding 自动重验           | 把 Configure 时的完整 capability digest 放进长期 Binding 语义，错误地跨 Work 固定能力集合       |
| `repair-build-configure-capability-contract`    | 防止能力不足的 Configure Host 建立不可执行 Binding                     | 让 Configure Work 声明整个 Build 的完整能力，进一步强化了全局能力快照                           |
| `stabilize-external-host-capabilities`          | 让外部 Host 只以明确声明的能力领取当前 Work，并在 claim 前拒绝缺失能力 | 正确引入 Work-scoped claim，却没有同步删除 Plan、Execute、Check 对全局 capability digest 的依赖 |
| `repair-build-plan-validation-retry`            | 在 candidate 校验失败后保留 claim、packet、invocation 和 submission    | 恢复边界位于 result validator 内；本次异常发生在进入 validator 前，因此无法生效                 |

现有单元测试分别证明了 Configure 需要完整能力、claim 需要当前 Work 能力和 candidate rejection 可以纠正，但没有覆盖“完整能力 Configure → 同 Host ID 的最小只读 Plan claim → Plan submission → `run next`”这一外部 Host 纵向旅程。嵌入式 E2E Host 在每个 Work 都声明同一能力超集，也掩盖了合同冲突。

## What Changes

- 把当前 Work 的 `requiredCapabilities` 设为 claim 能力的唯一权威；Runtime 必须在持久化 claim 和 Host invocation 前完成预检。
- 从 `ExecutionBinding` 的语义身份、Plan Evidence 和漂移判定中移除当前 Host capability digest。Binding 继续拥有 Workspace、repository、branch/worktree ownership、local overlay 和需要时的协调 Host identity。
- Configure 只验证当前 Configure Work、批准 Strategy 与多仓 Workspace Binding，不再要求 Configure claim 重复声明未来 Execute/Check 的全部能力。
- Plan、Execute 和 Check 的 Outcome 只按原 claim、packet、attempt、input digest、invocation 和 submission identity 验收，不因其能力集合不同于 Configure claim 而返回 Configure。
- 当前 Work 缺少能力时保持未 claim 的结构化 blocked continuation；已经 claim 且外部结果未知时只 reconcile 原 Work，不能新建 Work、重配 Binding或重放副作用。
- 增加外部 Host 的完整纵向合同测试、入口对称性测试和未知结果恢复测试，防止 claim、Outcome processor 与 Binding validator 再次形成三套不一致规则。
- 将预发布持久化协议一次性切换到新的 Binding schema；旧 Run 只返回 `migration_required` 诊断，不维护错误模型的双读或兼容层。保留 round4 Run 作为失败证据，并用修复后的产品启动相同验收场景。

## Capabilities

### Modified Capabilities

- `managed-work-execution`：以 Work-scoped capability preflight 取代全局 Binding capability identity，并统一 claim、Outcome 与未知结果恢复边界。
- `change-lifecycle`：限定 Configure 与 Binding 的职责，防止合法 Work capability 变化重建 Build Protocol。
- `development-telemetry`：区分 Work claim capability rejection、Host availability blocked 与真正的 Binding drift。

## Non-Goals

- 不放宽当前 Work 的 capability、write scope、side-effect 或 Host authorization 门禁。
- 不允许 Agent、Runner 或 Host 直接选择 phase、修改 Strategy 或更新 Binding。
- 不实现后台调度器、任意 Host 热迁移或多 Runner 负载均衡。
- 不把 Configure 时“看见过某能力”当作未来能力可用性的保证。
- 不恢复或重放 round4 的旧 Plan candidate；它只作为旧协议失败证据。

## Upstream Reference

固定 Comet 0.5.1（commit `35c9860b77b42bafa0c2d80d8d695889f888a924`）提供以下采用边界：

- `domains/engine/runtime-action.ts`：Action 持有 `requiredCapabilities`，claim/outcome 以 Action identity、attempt、input hash 和 claim token 关联。
- `domains/engine/runtime-service.ts`：Runtime 在写入 claim 前执行 capability 与 executor preflight。
- `domains/workflow-application/skill-executor.ts`：Executor 明确公开能力并只执行 Runtime 已 claim 的当前 Action。
- `test/domains/workflow-application/external-recovery.test.ts`：未知外部结果保留原 Action；只有权威证据证明未执行时才允许重试。

Repoctopus 独立实现这些不变量，不复制 Comet 的单仓状态布局、SDK 源码或 Skill 产物。

## Third-Party and License

本 Change 只参考 Comet 的公开行为不变量，不复制第三方源码、不新增依赖，许可证边界不变。
