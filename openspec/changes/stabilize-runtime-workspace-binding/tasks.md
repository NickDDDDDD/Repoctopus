# Tasks

## 1. 启动绑定领域契约

- [ ] 1.1 先写 `ChangeStartBinding` 的失败单元测试，覆盖 detached HEAD、source=target、remote 不一致和 topology 漂移，并运行对应 Vitest 文件确认测试按预期失败
- [ ] 1.2 实现版本化 `ChangeStartBinding` 值对象、稳定摘要与受限错误码，并运行对应 Vitest 文件确认失败用例全部通过
- [ ] 1.3 增加易变 ProjectSnapshot 字段测试，证明 HEAD、worktree、path 与 captured time 不改变 semantic binding identity，并运行对应 Vitest 文件通过
- [ ] 1.4 在 Architecture/类型导出中记录 Runner 准备 checkout、Runtime 只校验绑定的职责边界，并运行 `npm run check:architecture` 通过

## 2. Run 创建前校验与幂等启动

- [ ] 2.1 先写 Service 回归测试，证明 source=target 在 Run Store initialize、Skill composition、`work.created` 和 Desktop activation 前失败，并运行目标测试确认失败
- [ ] 2.2 在 `startChange` 中先解析 target facts并派生启动绑定，把它放入 `change.open` trigger identity，再运行 2.1 的目标测试通过
- [ ] 2.3 为 Coordinator `startOrResume` 增加强类型 `started|resumed` disposition，迁移调用点并运行 Runtime 单元测试通过
- [ ] 2.4 让 Change Service 仅在 `started` 时记录初始 Skill/Work事实，在 `resumed` 时返回 Store 中的 authoritative current Work，并运行等价重放测试证明只有一个 `work.created`
- [ ] 2.5 为 binding identity 漂移返回公共 `workspace-binding-conflict`，让 CLI failure envelope 保留受限 code，并运行 CLI 契约测试确认没有解析错误文本
- [ ] 2.6 增加并发启动测试，证明同一绑定只创建一个 Run，冲突绑定不改变原 stateVersion、checkpoint 或 trajectory，并运行目标测试通过

## 3. Open observation 分类与恢复

- [ ] 3.1 先写 Open gate 回归测试，注入一次 Provider unavailable 并断言原 Outcome/attempt/invocation 被保留、Host reconcile 未调用，运行目标测试确认失败
- [ ] 3.2 引入 typed observation/binding error 分类，把 Provider 暂时不可用投影为同 checkpoint 的 `reobserve`，并运行 3.1 的目标测试通过
- [ ] 3.3 保留 strict invalid 的唯一 Open repair Work 路径，增加重复 `next/resume` 测试证明 repair Work、checkEpoch 和 execution retirement 只提交一次
- [ ] 3.4 增加并发或遗留 branch identity 错误测试，证明它返回 binding/input conflict而不是 `open-observation-unavailable` 或 Host reconciliation

## 4. 启动与重观察遥测

- [ ] 4.1 为创建前拒绝增加 canonical outbox 观测映射和脱敏测试，确认 `run_created=false` 且 payload/Metric labels 不包含 branch、path、remote、digest 或错误正文
- [ ] 4.2 为 idempotent reuse 与 binding conflict 增加持久观测事实，运行映射测试确认 `work_created=false`、`checkpoint_changed=false` 和有界 result/recovery 分类
- [ ] 4.3 为 Open unavailable→reobserved 链路增加 trajectory/OTLP 映射，运行测试确认同一 Run/Work/invocation 且 `host_replayed=false`
- [ ] 4.4 用测试 receiver 对 logs、traces、metrics 与 trajectory/outbox 做关联校验，并运行 Desktop/OTLP codec 目标测试通过

## 5. 生产边界验收

- [ ] 5.1 增加 Windows CLI E2E fixture，从 target branch 执行 `run start`，断言结构化失败且没有 Run Store 目录、Work、Desktop activation 或成功 lifecycle 事件
- [ ] 5.2 在同一 fixture 切换到 feature branch 后启动成功，再以等价输入重放并断言返回同一 Run、Work 和 attempt
- [ ] 5.3 在同一 fixture 启动后切换 source branch，断言 `workspace-binding-conflict` 且原 checkpoint 字节和 trajectory 长度不变
- [ ] 5.4 完成一次真实 Open Host Outcome，模拟 Provider 首次不可用后恢复，断言 Provider 重观察成功、Host invocation 计数不变且未调用 `work-reconcile`
- [ ] 5.5 运行 `npm run verify`、`npx --yes --package=@rpamis/comet@0.5.1 comet classic openspec -- validate stabilize-runtime-workspace-binding --strict` 与 `git diff --check`，保存绑定最终 HEAD/tree/config/tool 输入的正式 Evidence 并清理临时日志和 scratch 输出

## Workflow follow-up

- 在 Open 与 Design 审查通过、实现和 Verify Evidence 完成后归档本 Change。
- 保留原验收中卡死 Run 为只读缺陷证据；使用新 Change identity 重新运行模拟多仓最小验收，不修改旧 Store。
