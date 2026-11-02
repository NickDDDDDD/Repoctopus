# Tasks

## 1. 启动绑定领域契约

- [x] 1.1 先写 `ChangeStartBinding` 的失败单元测试，覆盖 detached HEAD、source=target、remote 不一致和 topology 漂移，并运行对应 Vitest 文件确认测试按预期失败 <!-- comet-task:6ebd1e88-c261-4cc0-8dd8-bb41c10d01c0 -->
- [x] 1.2 实现版本化 `ChangeStartBinding` 值对象、稳定摘要与受限错误码，并运行对应 Vitest 文件确认失败用例全部通过 <!-- comet-task:d345a9a3-da8d-47bd-b660-01c25702d4a6 -->
- [x] 1.3 增加易变 ProjectSnapshot 字段测试，证明 HEAD、worktree、path 与 captured time 不改变 semantic binding identity，并运行对应 Vitest 文件通过 <!-- comet-task:acb74feb-a8f2-4c98-95f5-dbf269bf458a -->
- [x] 1.4 在 Architecture/类型导出中记录 Runner 准备 checkout、Runtime 只校验绑定的职责边界，并运行 `npm run check:architecture` 通过 <!-- comet-task:8a4d1616-423b-4c3a-9770-e92d73256789 -->

## 2. Run 创建前校验与幂等启动

- [x] 2.1 先写 Service 回归测试，证明 source=target 在 Run Store initialize、Skill composition、`work.created` 和 Desktop activation 前失败，并运行目标测试确认失败 <!-- comet-task:042d5607-afd4-4632-85dd-72901142e5de -->
- [x] 2.2 在 `startChange` 中先解析 target facts并派生启动绑定，把它放入 `change.open` trigger identity，再运行 2.1 的目标测试通过 <!-- comet-task:8d7047db-948a-4952-acad-0e02eb0230a2 -->
- [x] 2.3 为 Coordinator `startOrResume` 增加强类型 `started|resumed` disposition，迁移调用点并运行 Runtime 单元测试通过 <!-- comet-task:6ba049a5-f60a-4141-aea3-05d74fb78fd9 -->
- [x] 2.4 让 Change Service 仅在 `started` 时记录初始 Skill/Work事实，在 `resumed` 时返回 Store 中的 authoritative current Work，并运行等价重放测试证明只有一个 `work.created` <!-- comet-task:8f61b0f2-826e-4ce6-b5ab-a638a0d900d0 -->
- [x] 2.5 为 binding identity 漂移返回公共 `workspace-binding-conflict`，让 CLI failure envelope 保留受限 code，并运行 CLI 契约测试确认没有解析错误文本 <!-- comet-task:dd44a603-49e1-43e9-8ee4-7eb85f1e3e9e -->
- [x] 2.6 增加并发启动测试，证明同一绑定只创建一个 Run，冲突绑定不改变原 stateVersion、checkpoint 或 trajectory，并运行目标测试通过 <!-- comet-task:ac73f079-6beb-423c-b5d8-ded547b20efe -->

## 3. Open observation 分类与恢复

- [x] 3.1 先写 Open gate 回归测试，注入一次 Provider unavailable 并断言原 Outcome/attempt/invocation 被保留、Host reconcile 未调用，运行目标测试确认失败 <!-- comet-task:8c1c9504-77ee-43b5-a84f-d6996e4da634 -->
- [x] 3.2 引入 typed observation/binding error 分类，把 Provider 暂时不可用投影为同 checkpoint 的 `reobserve`，并运行 3.1 的目标测试通过 <!-- comet-task:03d5f36e-6c18-4556-9d4d-ffdbb11bc3aa -->
- [x] 3.3 保留 strict invalid 的唯一 Open repair Work 路径，增加重复 `next/resume` 测试证明 repair Work、checkEpoch 和 execution retirement 只提交一次 <!-- comet-task:4b76a843-38bc-431e-b7ff-5934ea318a87 -->
- [x] 3.4 增加并发或遗留 branch identity 错误测试，证明它返回 binding/input conflict而不是 `open-observation-unavailable` 或 Host reconciliation <!-- comet-task:62c788f2-5d3f-483a-b70c-910019a81876 -->

## 4. 启动与重观察遥测

- [x] 4.1 为创建前拒绝增加 canonical outbox 观测映射和脱敏测试，确认 `run_created=false` 且 payload/Metric labels 不包含 branch、path、remote、digest 或错误正文 <!-- comet-task:f8cd6ff4-2203-4fcd-a45d-7a5628186234 -->
- [x] 4.2 为 idempotent reuse 与 binding conflict 增加持久观测事实，运行映射测试确认 `work_created=false`、`checkpoint_changed=false` 和有界 result/recovery 分类 <!-- comet-task:758a4242-8b21-4afd-91e6-9470c8d14dc2 -->
- [x] 4.3 为 Open unavailable→reobserved 链路增加 trajectory/OTLP 映射，运行测试确认同一 Run/Work/invocation 且 `host_replayed=false` <!-- comet-task:fdaf9ade-e9d9-4e23-b53d-27c3e1789f31 -->
- [x] 4.4 用测试 receiver 对 logs、traces、metrics 与 trajectory/outbox 做关联校验，并运行 Desktop/OTLP codec 目标测试通过 <!-- comet-task:8916a520-f614-4de7-bc06-f74c1fca3a30 -->

## 5. 生产边界验收

- [x] 5.1 增加 Windows CLI E2E fixture，从 target branch 执行 `run start`，断言结构化失败且没有 Run Store 目录、Work、Desktop activation 或成功 lifecycle 事件 <!-- comet-task:b60a56e3-d3fa-45d2-a156-f1c5064b0436 -->
- [x] 5.2 在同一 fixture 切换到 feature branch 后启动成功，再以等价输入重放并断言返回同一 Run、Work 和 attempt <!-- comet-task:84aef510-8809-4098-ab15-ba40c18e5530 -->
- [x] 5.3 在同一 fixture 启动后切换 source branch，断言 `workspace-binding-conflict` 且原 checkpoint 字节和 trajectory 长度不变 <!-- comet-task:9d135c5f-11ef-4de9-9320-bb821a1ee8aa -->
- [x] 5.4 完成一次真实 Open Host Outcome，模拟 Provider 首次不可用后恢复，断言 Provider 重观察成功、Host invocation 计数不变且未调用 `work-reconcile` <!-- comet-task:7c47368c-02da-48d8-b6c1-7f4dff74b6b8 -->
- [x] 5.5 运行 `npm run verify`、`npx --yes --package=@rpamis/comet@0.5.1 comet classic openspec -- validate stabilize-runtime-workspace-binding --strict` 与 `git diff --check`，保存绑定最终 HEAD/tree/config/tool 输入的正式 Evidence 并清理临时日志和 scratch 输出 <!-- comet-task:0f85079e-eb93-4724-8642-ad0e29facd4c -->

## Workflow follow-up

- 在 Open 与 Design 审查通过、实现和 Verify Evidence 完成后归档本 Change。
- 保留原验收中卡死 Run 为只读缺陷证据；使用新 Change identity 重新运行模拟多仓最小验收，不修改旧 Store。
