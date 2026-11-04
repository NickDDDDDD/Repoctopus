# Tasks

## 1. Freeze the production regressions

- [ ] 1.1 添加 terminal checkpoint + 历史 null-work `continuation.selected` 的 red test，证明 completed Run 当前被错误投影为 `transition-pending`。 <!-- comet-task:6d44c990-5ac0-4cea-95fd-ae0f6e17410f -->
  **Acceptance:** 测试从公开 projector/status API 构造生产形态，修复前稳定失败，且断言 next actions 为空。
- [ ] 1.2 添加 GitHub 4xx create rejection 的 red test，证明当前路径把“确定未执行”错误包装为 unknown。 <!-- comet-task:7af771ba-2368-4867-bca2-cdc1627eaea1 -->
  **Acceptance:** fixture 使用可控 fetch，断言平台 code、effect certainty 和脱敏 message，不访问真实 GitHub。
- [ ] 1.3 添加 Publication Journal red test：4xx 后不应进入永久 `mr-unknown`；网络断开/5xx/2xx invalid JSON 仍必须进入 unknown。 <!-- comet-task:7fdcc054-f3b4-46fe-9901-5f0fa699e30b -->
  **Acceptance:** 断言 Journal item、attempt、operationId、create/observe 调用次数和恢复动作。

## 2. Model external-effect certainty

- [ ] 2.1 在 Delivery 边界定义有界 `not-applied | unknown` contract 和 `PublicationNotAppliedError`，保留现有 unknown 类型的 fail-closed 语义。 <!-- comet-task:d532123d-6d54-4bc0-92ea-a1c263af665b -->
  **Acceptance:** 未知 Error 默认 unknown；领域层不导入 GitHub Adapter 类型；错误不含凭据或任意响应 body。
- [ ] 2.2 扩展 GitHub `PlatformRequestError`：4xx 映射 `not-applied`，5xx/transport/2xx parse failure 映射 `unknown`。 <!-- comet-task:f279aa1e-58f6-4977-b7f7-afc70b26f43c -->
  **Acceptance:** 401、403、404、409/422、429、500、fetch reject 和 invalid JSON 表驱动测试全部通过。
- [ ] 2.3 让 stable create-or-observe 只把真正不确定的结果包装为 unknown，并把明确拒绝转换为 not-applied。 <!-- comet-task:6d0c3bc1-ceb3-4c6c-9927-e43b58b3c753 -->
  **Acceptance:** create 后核验失败仍 unknown；lost response 后观察到精确 MR 仍以 `recovered` 完成。

## 3. Recover the Publication Journal safely

- [ ] 3.1 在 Business Publication Journal 中实现 `mr-invoking -> pushed` 的确定未执行 CAS 转换，保留 intent/operationId/attempt/history 和 bounded diagnostic。 <!-- comet-task:bd2af5eb-851a-4679-8d2a-34d04e0e8280 -->
  **Acceptance:** 当前调用失败且不循环重试；下一次显式执行先观察再最多 create 一次。
- [ ] 3.2 保持 `mr-invoking|mr-unknown` 的 unknown 恢复为 observation-only，覆盖零匹配、唯一精确匹配、歧义和 OID mismatch。 <!-- comet-task:c5de9105-754f-4652-8a95-253cd7ab5f0b -->
  **Acceptance:** unknown 路径任意重复恢复的 create count 不增加；唯一匹配可完成并记录 `recovered`。
- [ ] 3.3 对齐 Specification MR 发布路径的错误分类，确保共享 Adapter contract 不产生相反语义。 <!-- comet-task:5e7a996b-31a8-4521-8071-1ac0a0f98cdd -->
  **Acceptance:** 规格发布的确定拒绝可在同一稳定 intent 上显式重试，未知结果仍只观察；不改变 push unknown 规则。
- [ ] 3.4 更新 WorkflowRuns/Work Execution 映射，只把真正 unknown 标为 external side-effect unknown。 <!-- comet-task:5f6bdcf1-fbd6-4756-9367-dba1fc8e5df7 -->
  **Acceptance:** not-applied 保持同一 Archive Work 可重试；unknown 继续返回 `reconcile/external-result-unknown`。

## 4. Make terminal projection authoritative

- [ ] 4.1 让 `done/terminal` 在 `projectCommittedContinuation()` 中先于 trajectory replay 返回。 <!-- comet-task:46371dc0-6fce-4c46-81f9-5948a71ba78e -->
  **Acceptance:** completed Run 始终返回 null work/attempt、当前 epoch 和空 next actions。
- [ ] 4.2 收紧非终态 `continuation.selected` 的 checkpoint 匹配，避免旧 null-work event 跨 revision/epoch 重放。 <!-- comet-task:64e74557-21e4-4d5b-b5ce-d87f9eaa1c1c -->
  **Acceptance:** 当前活动 Work 的合法 selection 仍可重放；旧 state、epoch、work 或 attempt 被忽略。
- [ ] 4.3 覆盖 Runtime status、CLI 和 Desktop projection 的纵向回归。 <!-- comet-task:86e77841-206d-460e-a92f-032f2da8dded -->
  **Acceptance:** 同一持久 checkpoint 在三个读取面都显示 terminal，不触发 I/O 或状态写入。

## 5. Diagnostics, telemetry, and acceptance

- [ ] 5.1 增加有界恢复诊断：not-applied 指向修正后重拉同一 Archive Work，unknown 指向观察/采用/人工证明未执行。 <!-- comet-task:2fb9d881-fb2d-4366-886b-6b669fac9026 -->
  **Acceptance:** CLI 不建议新建 Run、手改 Store 或盲重试；输出不含 token、header、response body 或绝对路径。
- [ ] 5.2 在现有 telemetry 映射中记录 bounded stage/certainty/result，禁止 repository/branch/path/error message 进入 Metric labels。 <!-- comet-task:7fbadff0-bbc3-40b0-a702-b7f7edcac868 -->
  **Acceptance:** telemetry cardinality/privacy 测试通过，trace 可关联原 publication/work identity。
- [ ] 5.3 使用打包 CLI 和失败注入 adapter 完成 Archive 恢复验收，并重放第五轮 terminal fixture。 <!-- comet-task:ef729e5f-6f32-446f-820e-a8ba4d29afec -->
  **Acceptance:** 4xx 修正后同一 item 完成；unknown 不重放；completed Run 只投影 terminal；不创建真实 MR。
- [ ] 5.4 更新交付恢复/Runtime 文档，记录 Comet 原则、HTTP 分类边界和操作手册。 <!-- comet-task:6062e26f-ad45-4434-b7ad-b4e679867be1 -->
  **Acceptance:** 文档明确 4xx/5xx/transport/parse/status verify 的分类与操作者下一步。
- [ ] 5.5 运行 strict OpenSpec、定向测试、`npm run verify` 和打包验收，清理临时日志/fixture 输出并记录正式验证证据。 <!-- comet-task:e0933926-1174-4887-a632-ce6c82d7bdd0 -->
  **Acceptance:** 工作树只保留本 Change 权威产物；所有必需检查通过或以可定位证据阻断。
