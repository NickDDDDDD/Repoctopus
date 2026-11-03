# Tasks

## 1. Freeze the production regression

- [x] 1.1 添加生产多仓 E2E：Plan 因精确 write scopes 位于 protected branch 被拒绝，Runner 切换并 push 合法 source branches，composition 重建后 `run resume` 必须恢复同一 Run。   <!-- comet-task:55a7c1ec-4856-458a-8496-2313fcd5a4d9 -->
  **Acceptance:** 测试在修复前稳定失败于 `reconciliationRequired`，并保留 Run、Work、submission 与 project snapshot 证据。
  **Requirements:** 不用 Store 手改、`run next` 替代或第二个 Run 隐藏失败。
- [x] 1.2 添加当前 poison 形态回归：错误 resume 已写入 branch-only reconciliation 后，后续 resume 可在相同证据下恢复。   <!-- comet-task:26bfacd4-7a32-469a-abac-c0ce4a20f491 -->
  **Acceptance:** 恢复后只存在一个新的 Configure Work，原 rejected Plan outcome 仍可审计。
  **Requirements:** 测试必须从公开 API 构造状态，不直接伪造最终 lifecycle phase。
- [x] 1.3 固定负例矩阵：无关仓 branch、path、remote、topology、repository add/remove、detached/unpublished branch 及 Host/capability drift。   <!-- comet-task:d0ac9b0e-9f86-4ef0-bc57-8501382a9d70 -->
  **Acceptance:** 每类差异继续产生 reconciliation/fail-closed，且不派发 Configure。
  **Requirements:** 使用结构化 finding/error code 断言，不匹配人类 message 文本。

## 2. Model authorized branch correction

- [x] 2.1 定义 typed authorized-rebind evidence 与稳定 digest，覆盖 rejected candidate、protected finding、旧 Binding、policy 和 snapshot diff。   <!-- comet-task:551566e4-bc42-4e6d-b603-309cebea481d -->
  **Acceptance:** 相同语义输入产生相同 digest；高基数本地路径不进入可移植语义摘要。
  **Requirements:** 授权不得是裸 boolean，也不得依赖 branch 命名约定。
- [x] 2.2 实现纯 classifier，只允许当前 `build.plan`、`awaiting-correction` 和精确 protected write-set 的 branch-only 修正。   <!-- comet-task:d2b91160-d8da-457a-aeb8-d4868217437c -->
  **Acceptance:** 领域单测覆盖全通过、部分修正、空修正、额外修正及非 branch identity drift。
  **Requirements:** classifier 不访问 Git、不写 Store、不选择 Action。
- [x] 2.3 将现有 `run next` recovery 改为消费共享 classifier。   <!-- comet-task:34fa7c09-6ce7-4e05-9287-928c0772528e -->
  **Acceptance:** 现有 next 回归继续通过，行为和 finding taxonomy 不退化。
  **Requirements:** 删除重复判断，避免两条恢复规则再次漂移。

## 3. Repair resume orchestration

- [x] 3.1 在通用 reconciliation 终态化前，让 `run resume` 观察并分类 authorized protected-branch correction。   <!-- comet-task:5a45aa37-3c45-432f-8527-5ad277254079 -->
  **Acceptance:** 命中时不设置新的全局 reconciliation poison，直接进入受管 rebind 转换。
  **Requirements:** 未命中时完全保留现有通用 reconciliation 行为。
- [x] 3.2 实现同一 Run 的原子 rebind：记录授权事实、精确失效旧 Plan checkpoint、提升 epoch 并派发 `build.configure`。   <!-- comet-task:ad3f80d2-d23b-448a-926c-86e0729865ca -->
  **Acceptance:** Design approval、Build Strategy、Tasks 与 rejected outcome 保留；没有 Execute Work 被提前创建。
  **Requirements:** Runtime 选择 Action，Agent/Runner 不得直接改 phase。
- [x] 3.3 仅在授权 digest 与既有 branch-only reconciliation evidence 精确匹配时清除 poison。   <!-- comet-task:24f580b5-7f31-42a1-a2b9-64eea6db1e47 -->
  **Acceptance:** 当前失败验收的状态形态可恢复；任意额外差异都会阻止清除。
  **Requirements:** 不重写历史 snapshot/outcome，不增加 schema fallback。
- [x] 3.4 固定部分修正语义并让 next/resume 一致。   <!-- comet-task:48cda826-dc40-400c-86cf-02dcc514ddf1 -->
  **Acceptance:** 未修正的 protected write repo 仍无写权限，已修正 repo 不被误判为未知漂移。
  **Requirements:** 文档、实现与结构化诊断使用同一规则。

## 4. Prove idempotency and observability

- [x] 4.1 增加重复 `resume` 与并发/重放测试。   <!-- comet-task:f555d22c-0902-477c-900f-06c64dc35a0d -->
  **Acceptance:** 同一 epoch 最多产生一个 Configure Work 和一个成功 rebind transition。
  **Requirements:** 通过 identity/checkpoint 幂等，不靠捕获 duplicate-key 异常兜底。
- [x] 4.2 增加授权 rebind 的 Span/Event 与低基数 Metric 投影。   <!-- comet-task:a800b1d9-afe9-4836-aeea-30c1da1f066d -->
  **Acceptance:** 可区分 next、resume、poison-recovery、rejected/idempotent 结果。
  **Requirements:** Metric labels 不含 branch、repo、path、remote、Run ID 或 digest。
- [x] 4.3 添加 telemetry 安全与 cardinality 测试。   <!-- comet-task:a983be7f-45f8-49a5-b145-a6cddb49dc2a -->
  **Acceptance:** allowlist、敏感值扫描和聚合维度测试全部通过。
  **Requirements:** 不通过字符串清洗掩盖错误字段设计。

## 5. Real multi-repository acceptance

- [x] 5.1 用修复分支产品恢复保留的 `add-compact-task-status-v2` Run。   <!-- comet-task:b8d7524d-4025-4758-b0f2-e9023663153a -->
  **Acceptance:** 原 Run 从 matching reconciliation poison 回到 Build Configure，无 Store 手改或第二 Run。
  **Requirements:** 三个 source branches 已公开；backend 只读仓继续允许停留在 `main`。
- [x] 5.2 完成 Configure 与重新 Plan，证明新 Binding 只接受非 protected 写仓。   <!-- comet-task:a0737be6-885d-401f-8b81-b27c0c377626 -->
  **Acceptance:** 旧 Plan checkpoint 已失效，新 Plan 可追踪到新 Binding revision。
  **Requirements:** 不跳过 Human Decision、TDD、Review 或 Verify 门禁。
- [x] 5.3 继续该小型 Change 至 Verify/Archive 或记录独立非本 Change 阻塞。   <!-- comet-task:7743b0fd-80dd-49ff-bfd4-29c8fa181cdf -->
  **Acceptance:** 恢复路径不再产生 reconciliation/重复 Work；后续问题具有独立结构化诊断。
  **Requirements:** 优先修复核心阻塞，不把无关功能扩进本 Change。

## 6. Documentation and full verification

- [x] 6.1 更新 Runtime/断点恢复文档，说明 `next`、`resume`、authorized rebind 与通用 reconciliation 的边界。   <!-- comet-task:769a70b3-cd49-409f-9ccf-8dff5a447c87 -->
  **Acceptance:** 文档包含 Runner Git 责任、同一 Run 恢复和未知漂移 fail-closed 示例。
  **Requirements:** 不承诺 Runtime 自动建/推 branch。
- [x] 6.2 记录 Comet rebind/checkpoint 原则及 Repoctopus 多仓差异。   <!-- comet-task:7550d8cd-94e0-49c6-8410-b97c2f9a7b5d -->
  **Acceptance:** provenance 指向固定 upstream baseline/公开资料，说明采用的行为而非复制源码。
  **Requirements:** 不引入第二套 spec、plan 或 skill authority。
- [x] 6.3 运行定向测试、strict OpenSpec、architecture/provenance/generated 检查和完整 `npm run verify`。   <!-- comet-task:516b03b6-2a9f-4a2c-9964-9ba3be920e2a -->
  **Acceptance:** 所有必需检查通过，Windows 生产 CLI E2E 无 flaky 重试。
  **Requirements:** 失败必须修复根因，不降低门禁或删除负例。
- [x] 6.4 清理临时 clone、验收日志和 scratch 输出，保留正式 Run、规格、测试与结构化诊断证据。   <!-- comet-task:5cad9452-0ead-4d67-9b1c-86a12df1c983 -->
  **Acceptance:** worktree 仅保留有意源码/文档变更，清理内容在最终报告列明。
  **Requirements:** 不删除用户数据、正式 evidence 或未合入分支。
