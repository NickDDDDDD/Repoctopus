---
change: recover-build-host-capability-drift
status: verified
---

# Build Host 能力漂移恢复验证

## 契约结论

Build 能力权威现在仅属于当前不可变 Work。`ExecutionBinding` schema v3 负责协调 Host
身份与多仓 Workspace 事实，但不再保存能力列表或摘要。Configure、Plan、Execute 和
Check 共用一个由 `WorkDispatcher` 持有的 claim 前校验器。Outcome 处理只绑定原始
claim，并且只重新验证 Binding 自己负责的事实。

## 历史失败证据

保留的 round4 Run 位于本仓库之外，并始终保持只读：

- Run 身份：原样记录在下述有界 fixture 中
- 状态：Build Plan submission 已按 Execution Binding schema v1 持久化
- 外部 Host 能力：`build.autonomous`、`repository.read`、`specification.read`
- 失败边界：claim、packet、invocation 和 Plan submission 均已存在，但 Plan validator 尚未运行
- `run.json` SHA-256：`3c3ebad355ed17ab53a8c8e37aeda6d2f92d0321d22eba0296a57bade0ad07c1`
- `trajectory.jsonl` SHA-256：`ca0bacc0c652406e58138ad00d5542639aa574c76ff028fe8af84fc8583954f2`

有界且可移植的 fixture 为
`test/fixtures/build-host-capability-round4-failure.json`。原始 Store 仅接受只读检查，
没有被迁移或编辑。

## 全新纵向验收

`test/external-build-host-capability.e2e.test.ts` 创建全新的单仓和多仓 Git 拓扑，并通过
公开的外部 Host 服务协议依次执行：

1. Configure 只声明 `build.autonomous + repository.read + specification.read`。
2. Plan 使用相同的只读最小能力，并覆盖重复 pull、重复 submission 与校验前进程重启。
3. 第一次 Execute 缺少 `repository.write`，因此只记录一次有界 claim rejection，且不产生
   claim、packet ownership 或 invocation。
4. 第二次 Execute 精确声明当前 Work 所需能力，并真实执行 commit/push 副作用。
5. Check 只声明 `build.autonomous + process.execute + repository.read`。

两个变体都以一次 Plan revision、零次能力驱动的 Binding revalidation 到达 Verify；
多仓变体真实执行并推进了两个 package。

## 恢复与可观测性

- 重复 pull 返回权威 packet 与 invocation，不会重复投递上下文或创建第二个 claim。
- unknown execution 保留原始 invocation 并使用 `reconcile`；只有权威 `not-executed`
  证据出现后才允许受控 retry。
- `work.claim-capability-rejected` 只携带有界的 `capability-required`、`blocked` 与缺失数量事实；
  Metric 标签不包含能力文本、Host 身份、Work 身份或摘要。
- 真正的 Binding drift 仅限协调 Host、checkout/ownership/isolation 和本地 overlay 事实；
  旧 Binding schema 返回结构化 `migration_required`。

## 验证命令与结果

Build 阶段已经完成：

- `npm run typecheck`
- 领域、Service、恢复、遥测与观察相关的聚焦测试
- 既有受管单仓/多仓 Build E2E 变体
- 全新的外部 Host 单仓/多仓纵向 E2E

最终验证通过 182 个测试文件和 850 项测试，另有 2 项按设计明确跳过。generated、brand、
architecture、provenance、Dashboard salvage 以及全部 18 项 strict OpenSpec 检查均通过。
可复现的打包产品边界和 package 摘要记录在
`verification/recover-build-host-capability-drift/verification-report.md`。
