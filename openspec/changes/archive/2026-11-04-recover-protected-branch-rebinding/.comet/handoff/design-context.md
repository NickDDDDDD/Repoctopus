# Comet Design Handoff

- Change: recover-protected-branch-rebinding
- Phase: design
- Mode: compact
- Context hash: 1f22d59118a3244a6c5cc702ba8d7d7103471c4224ffebdb29882c1f6aade5e6

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/recover-protected-branch-rebinding/proposal.md

- Source: openspec/changes/recover-protected-branch-rebinding/proposal.md
- Lines: 1-36
- SHA256: 8574e8bd817dc7d3954376a4daa1824edd5717abd3adc0ac3b6ae2e86babc2b4

```md
# Proposal

## Why

真实多仓验收在 Build Plan 正确拒绝受保护分支后暴露了一个阻塞恢复缺陷：Runner 按 Runtime 的结构化 finding 为精确 write scopes 准备并公开合法 source branch，但进程重启后调用 `run resume` 时，通用 project reconciliation 把这些预期 branch 变化重新分类为未知 identity drift，并永久设置 `reconciliationRequired`。同一修正通过 `run next` 可以进入 Binding revalidation，通过 `run resume` 却要求恢复旧 checkout 或启动第二个 Run。

这违背现有规范中“同一 Run 建立新 Binding revision、精确失效旧 Plan”的要求，也破坏了 Comet 成熟恢复模型的关键原则：被 lifecycle 明确要求的 workspace 修正应通过显式 rebind/checkpoint 恢复；只有未知漂移才 fail closed。

## What Changes

- 建立单一、领域化的 protected-branch correction classifier，从 rejected Plan candidate、旧 Execution Binding、protected policy 和前后 project snapshots 证明一次 branch 修正是否被当前 lifecycle 精确授权。
- 让 `run next` 与 `run resume` 复用同一 classifier；命中时在同一 Run 派发既有 `build.configure` revalidation，而不是进入通用 reconciliation。
- 允许 Runtime 仅在相同证据仍成立时清除由该缺陷写入的 `reconciliationRequired`，保留拒绝结果、Design approval、Build Strategy、Tasks 和审计轨迹。
- 为进程重启、重复 resume、部分修正及未知 branch/path/remote/topology 漂移增加生产回归，并增加低基数 telemetry 事实。
- 更新 Runtime 恢复文档，明确 Runner 负责 Git 副作用，Runtime 只验证并重绑定。

## Capabilities

### Modified Capabilities

- `managed-work-execution`：使受保护分支修正后的 `resume` 与 `next` 具有相同的同一 Run Binding revalidation 语义。

## Non-Goals

- Runtime 不自动创建、切换或推送 branch/worktree。
- 不放宽 protected branch policy，也不接受任意 branch drift。
- 不把 path、remote、topology、repository add/remove 或无关仓 branch 变化归类为合法修正。
- 不新建 Change Run，不编辑 Store 绕过门禁，也不增加旧版本双读或长期兼容层。

## Upstream Reference

参考 Comet 0.5.1 及其后续公开恢复语义：workspace isolation/binding 是权威身份，预期的人工 workspace 修正通过显式 rebind 恢复既有 workflow/checkpoint，未知漂移继续阻断。Repoctopus 不复制 Comet 的单仓实现，而是在自身多仓、延迟 write-scope 和不可变 Work 模型中用 rejected Plan 证据限定可重绑定仓集合。

## Third-Party and License

本 Change 仅参考 Comet 的公开行为与恢复边界，在 Repoctopus 架构中独立实现，不复制第三方源码或新增依赖。

```

## openspec/changes/recover-protected-branch-rebinding/design.md

- Source: openspec/changes/recover-protected-branch-rebinding/design.md
- Lines: 1-136
- SHA256: ad04e5dbf5f21d30707bf7a26158b63146e5617806e31cc45362f7643bac78b1

[TRUNCATED]

```md
---
comet_change: recover-protected-branch-rebinding
role: technical-design
canonical_spec: openspec
status: draft
---

# Design

## Context

Build Plan 只有在形成精确 package write scopes 后，才能判断哪些仓库必须离开受保护分支。现有 Runtime 在 Plan rejection 后把当前 invocation 标记为 `awaiting-correction`，`run next` 也已有专用分支：重新观察 checkout、发现 Binding drift，并派发 `build.configure` 重新绑定。

但 `run resume` 先进入通用 project reconciliation。该层只知道原始与当前 project snapshot 不同，不知道 branch 变化正是 Runtime 前一条 finding 要求的修正，因此立即设置全局 `reconciliationRequired`。服务层随后再也到不了 Build 的专用 revalidation。结果是相同证据、相同 Run、相同 checkout，恢复行为仅因调用入口不同而相反。

更严重的是，一次错误的 `resume` 已把真实验收 Run 标记为需要 reconciliation。修复若只能保护未来调用，仍不能证明 checkpoint 恢复模型完整。

## Goals / Non-Goals

**Goals:**

- 用不可伪造的生命周期证据识别 Runtime 已要求的精确 protected-branch correction。
- 让 `next`、首次 `resume` 和进程重启后的重复 `resume` 共享同一恢复判定与转换。
- 在同一 Run 中建立新 Binding revision、精确废弃旧 Plan checkpoint 并返回 Configure。
- 对任何超出授权集合或身份维度的变化继续 fail closed。
- 保持恢复幂等、可审计，并提供低基数 telemetry。

**Non-Goals:**

- 自动执行 Git 操作或推断应创建的 branch 名。
- 让 Agent 自选 phase/action 或直接清除 reconciliation 状态。
- 通过诊断 message 文本、CLI argv 或 branch 命名约定推断授权。
- 为任意旧 Run 建立迁移/fallback。

## Decisions

### 1. 授权来自冻结证据，不来自当前 checkout 的外观

新增纯领域 classifier，输入至少包括：

- 当前 lifecycle phase、current Work、execution status 与 continuation；
- rejected submission 中冻结的 `build-plan-candidate` 及其精确 repository write scopes；
- rejection outcome 中的 protected-branch findings；
- rejection 时使用的 Execution Binding 与 protected branch policy；
- baseline/current project snapshots 及当前可观察 Binding facts。

只有同时满足以下条件才返回 typed `authorized-protected-branch-rebind`：

1. phase 为 Build，current Work 为 `build.plan`，invocation 正在等待修正；
2. rejection 确由 candidate write scopes 中仓库绑定受保护分支产生；
3. 发生 branch 变化的仓库集合非空，且是该 protected write-set 的子集；
4. 每个已修正仓当前使用 attached、非受保护、已公开的 source branch；
5. checkout path、remote、repository identity、topology、worktree ownership、Host/capability 均未变化；
6. 不存在无关仓 branch 变化、repository add/remove 或无法分类的 snapshot 差异。

classifier 返回结构化授权对象与稳定 digest，不返回宽泛 boolean。它不得解析人类诊断字符串，也不得仅凭 branch 名包含 Change ID 就放行。

### 2. `next` 与 `resume` 只保留一个恢复规则

把现有 `next` 中的 protected-branch recovery 判定提取为共享应用服务/领域函数。两个入口都先重新观察 project facts，再调用同一 classifier：

- 命中授权：派发既有 `build.configure` revalidation；
- 未命中且无漂移：按各入口原有幂等语义继续；
- 未命中且有漂移：交给通用 reconciliation，继续 fail closed。

这样 Runtime 仍选择 Action，Agent/Runner 只能拉取下一合法 Work，不能用 `resume` 或 `next` 绕过 phase 规则。

### 3. 授权重绑定是原子 lifecycle 转换

命中后，在一个受管转换中：

- 记录 authorized rebind fact、授权 digest 与 previous/current Binding identity；
- 使旧 Plan execution checkpoint 精确失效并提升 check epoch；
- 保留 rejected submission/outcome 作为审计历史；
- 保留 Open/Design approval、Build Strategy 和 OpenSpec Tasks；
- 创建且只创建一个新的 `build.configure` Work；
- 清除与同一授权 digest 对应的 branch-only reconciliation poison。

不得伪造旧 snapshot、重写历史 outcome 或直接跳到 Plan/Execute。Configure 必须重新验证 Host、capability 与新 Binding，然后 Runtime 才能重新派发 Plan。


```

Full source: openspec/changes/recover-protected-branch-rebinding/design.md

## openspec/changes/recover-protected-branch-rebinding/tasks.md

- Source: openspec/changes/recover-protected-branch-rebinding/tasks.md
- Lines: 1-79
- SHA256: 790c5152deba550ef91a8c4838b6d013b785c1a64dea8a12e3759ecb24ff3d54

```md
# Tasks

## 1. Freeze the production regression

- [ ] 1.1 添加生产多仓 E2E：Plan 因精确 write scopes 位于 protected branch 被拒绝，Runner 切换并 push 合法 source branches，composition 重建后 `run resume` 必须恢复同一 Run。   <!-- comet-task:55a7c1ec-4856-458a-8496-2313fcd5a4d9 -->
  **Acceptance:** 测试在修复前稳定失败于 `reconciliationRequired`，并保留 Run、Work、submission 与 project snapshot 证据。
  **Requirements:** 不用 Store 手改、`run next` 替代或第二个 Run 隐藏失败。
- [ ] 1.2 添加当前 poison 形态回归：错误 resume 已写入 branch-only reconciliation 后，后续 resume 可在相同证据下恢复。   <!-- comet-task:26bfacd4-7a32-469a-abac-c0ce4a20f491 -->
  **Acceptance:** 恢复后只存在一个新的 Configure Work，原 rejected Plan outcome 仍可审计。
  **Requirements:** 测试必须从公开 API 构造状态，不直接伪造最终 lifecycle phase。
- [ ] 1.3 固定负例矩阵：无关仓 branch、path、remote、topology、repository add/remove、detached/unpublished branch 及 Host/capability drift。   <!-- comet-task:d0ac9b0e-9f86-4ef0-bc57-8501382a9d70 -->
  **Acceptance:** 每类差异继续产生 reconciliation/fail-closed，且不派发 Configure。
  **Requirements:** 使用结构化 finding/error code 断言，不匹配人类 message 文本。

## 2. Model authorized branch correction

- [ ] 2.1 定义 typed authorized-rebind evidence 与稳定 digest，覆盖 rejected candidate、protected finding、旧 Binding、policy 和 snapshot diff。   <!-- comet-task:551566e4-bc42-4e6d-b603-309cebea481d -->
  **Acceptance:** 相同语义输入产生相同 digest；高基数本地路径不进入可移植语义摘要。
  **Requirements:** 授权不得是裸 boolean，也不得依赖 branch 命名约定。
- [ ] 2.2 实现纯 classifier，只允许当前 `build.plan`、`awaiting-correction` 和精确 protected write-set 的 branch-only 修正。   <!-- comet-task:d2b91160-d8da-457a-aeb8-d4868217437c -->
  **Acceptance:** 领域单测覆盖全通过、部分修正、空修正、额外修正及非 branch identity drift。
  **Requirements:** classifier 不访问 Git、不写 Store、不选择 Action。
- [ ] 2.3 将现有 `run next` recovery 改为消费共享 classifier。   <!-- comet-task:34fa7c09-6ce7-4e05-9287-928c0772528e -->
  **Acceptance:** 现有 next 回归继续通过，行为和 finding taxonomy 不退化。
  **Requirements:** 删除重复判断，避免两条恢复规则再次漂移。

## 3. Repair resume orchestration

- [ ] 3.1 在通用 reconciliation 终态化前，让 `run resume` 观察并分类 authorized protected-branch correction。   <!-- comet-task:5a45aa37-3c45-432f-8527-5ad277254079 -->
  **Acceptance:** 命中时不设置新的全局 reconciliation poison，直接进入受管 rebind 转换。
  **Requirements:** 未命中时完全保留现有通用 reconciliation 行为。
- [ ] 3.2 实现同一 Run 的原子 rebind：记录授权事实、精确失效旧 Plan checkpoint、提升 epoch 并派发 `build.configure`。   <!-- comet-task:ad3f80d2-d23b-448a-926c-86e0729865ca -->
  **Acceptance:** Design approval、Build Strategy、Tasks 与 rejected outcome 保留；没有 Execute Work 被提前创建。
  **Requirements:** Runtime 选择 Action，Agent/Runner 不得直接改 phase。
- [ ] 3.3 仅在授权 digest 与既有 branch-only reconciliation evidence 精确匹配时清除 poison。   <!-- comet-task:24f580b5-7f31-42a1-a2b9-64eea6db1e47 -->
  **Acceptance:** 当前失败验收的状态形态可恢复；任意额外差异都会阻止清除。
  **Requirements:** 不重写历史 snapshot/outcome，不增加 schema fallback。
- [ ] 3.4 固定部分修正语义并让 next/resume 一致。   <!-- comet-task:48cda826-dc40-400c-86cf-02dcc514ddf1 -->
  **Acceptance:** 未修正的 protected write repo 仍无写权限，已修正 repo 不被误判为未知漂移。
  **Requirements:** 文档、实现与结构化诊断使用同一规则。

## 4. Prove idempotency and observability

- [ ] 4.1 增加重复 `resume` 与并发/重放测试。   <!-- comet-task:f555d22c-0902-477c-900f-06c64dc35a0d -->
  **Acceptance:** 同一 epoch 最多产生一个 Configure Work 和一个成功 rebind transition。
  **Requirements:** 通过 identity/checkpoint 幂等，不靠捕获 duplicate-key 异常兜底。
- [ ] 4.2 增加授权 rebind 的 Span/Event 与低基数 Metric 投影。   <!-- comet-task:a800b1d9-afe9-4836-aeea-30c1da1f066d -->
  **Acceptance:** 可区分 next、resume、poison-recovery、rejected/idempotent 结果。
  **Requirements:** Metric labels 不含 branch、repo、path、remote、Run ID 或 digest。
- [ ] 4.3 添加 telemetry 安全与 cardinality 测试。   <!-- comet-task:a983be7f-45f8-49a5-b145-a6cddb49dc2a -->
  **Acceptance:** allowlist、敏感值扫描和聚合维度测试全部通过。
  **Requirements:** 不通过字符串清洗掩盖错误字段设计。

## 5. Real multi-repository acceptance

- [ ] 5.1 用修复分支产品恢复保留的 `add-compact-task-status-v2` Run。   <!-- comet-task:b8d7524d-4025-4758-b0f2-e9023663153a -->
  **Acceptance:** 原 Run 从 matching reconciliation poison 回到 Build Configure，无 Store 手改或第二 Run。
  **Requirements:** 三个 source branches 已公开；backend 只读仓继续允许停留在 `main`。
- [ ] 5.2 完成 Configure 与重新 Plan，证明新 Binding 只接受非 protected 写仓。   <!-- comet-task:a0737be6-885d-401f-8b81-b27c0c377626 -->
  **Acceptance:** 旧 Plan checkpoint 已失效，新 Plan 可追踪到新 Binding revision。
  **Requirements:** 不跳过 Human Decision、TDD、Review 或 Verify 门禁。
- [ ] 5.3 继续该小型 Change 至 Verify/Archive 或记录独立非本 Change 阻塞。   <!-- comet-task:7743b0fd-80dd-49ff-bfd4-29c8fa181cdf -->
  **Acceptance:** 恢复路径不再产生 reconciliation/重复 Work；后续问题具有独立结构化诊断。
  **Requirements:** 优先修复核心阻塞，不把无关功能扩进本 Change。

## 6. Documentation and full verification

- [ ] 6.1 更新 Runtime/断点恢复文档，说明 `next`、`resume`、authorized rebind 与通用 reconciliation 的边界。   <!-- comet-task:769a70b3-cd49-409f-9ccf-8dff5a447c87 -->
  **Acceptance:** 文档包含 Runner Git 责任、同一 Run 恢复和未知漂移 fail-closed 示例。
  **Requirements:** 不承诺 Runtime 自动建/推 branch。
- [ ] 6.2 记录 Comet rebind/checkpoint 原则及 Repoctopus 多仓差异。   <!-- comet-task:7550d8cd-94e0-49c6-8410-b97c2f9a7b5d -->
  **Acceptance:** provenance 指向固定 upstream baseline/公开资料，说明采用的行为而非复制源码。
  **Requirements:** 不引入第二套 spec、plan 或 skill authority。
- [ ] 6.3 运行定向测试、strict OpenSpec、architecture/provenance/generated 检查和完整 `npm run verify`。   <!-- comet-task:516b03b6-2a9f-4a2c-9964-9ba3be920e2a -->
  **Acceptance:** 所有必需检查通过，Windows 生产 CLI E2E 无 flaky 重试。
  **Requirements:** 失败必须修复根因，不降低门禁或删除负例。
- [ ] 6.4 清理临时 clone、验收日志和 scratch 输出，保留正式 Run、规格、测试与结构化诊断证据。   <!-- comet-task:5cad9452-0ead-4d67-9b1c-86a12df1c983 -->
  **Acceptance:** worktree 仅保留有意源码/文档变更，清理内容在最终报告列明。
  **Requirements:** 不删除用户数据、正式 evidence 或未合入分支。

```

## openspec/changes/recover-protected-branch-rebinding/specs/managed-work-execution/spec.md

- Source: openspec/changes/recover-protected-branch-rebinding/specs/managed-work-execution/spec.md
- Lines: 1-47
- SHA256: b29cbdf2938a57d77d57c5aff8ac70a80a5fc0def5d19fc1d6eb69405a44f27f

```md
## MODIFIED Requirements

### Requirement: Build Execute 前必须证明全部可写仓绑定合法 source branch

Runtime MUST 在 Build Plan 给出精确 write scopes 后、接受 Plan Evidence 或创建任何 Execute Work 前，把可写 repository 集合与冻结的 Execution Binding 和 protected branch policy 联合校验。匹配 protected pattern 的可写仓 MUST 被拒绝；只读仓 MUST NOT 因停留在 target/protected branch 被无关阻断。Runner 负责准备并公开 source branch/worktree，Runtime 不执行 Git branch 副作用。

当 Plan 因 protected branch finding 被拒绝后，Runtime MUST 把 rejected `build-plan-candidate`、精确 write scopes、旧 Execution Binding、protected policy 与 project snapshot 作为修正授权证据。Runner 完成对应 branch-only 修正后，无论通过 `run next` 还是进程重启后的 `run resume` 拉取，Runtime MUST 使用同一 classifier 建立新 Binding revision、精确失效旧 Plan checkpoint 并在同一 Run 重新派发 Build Configure。只有授权集合内仓库的 attached branch 变化可以走该路径；任何无关 branch、path、remote、topology、repository add/remove、worktree ownership、Host 或 capability 变化 MUST 继续进入通用 reconciliation 并 fail closed。

#### Scenario: 可写业务仓仍绑定 main

- **WHEN** 已验证 Plan 的 package write scope 包含 `web-design`，而当前 Execution Binding 把该仓绑定到受保护的 `main`
- **THEN** Runtime 在 Plan Outcome 终态化、Plan Evidence 和 Execute Work 之前返回结构化 finding，且不授予任何业务写权限

#### Scenario: 只读业务仓停留在 main

- **WHEN** `backend` 只作为读取或验证依赖出现在 Plan 中且没有任何 write scope，并绑定受保护的 `main`
- **THEN** Runtime 不因该只读仓拒绝 Plan，仍持续校验其 Binding 漂移和 HEAD 一致性

#### Scenario: 可写仓使用合法功能分支

- **WHEN** 每个 write scope repository 均绑定不匹配任何 protected pattern 的 attached source branch或合法 worktree
- **THEN** Runtime 可以继续接受 Plan Evidence并创建第一个就绪 Execute Work

#### Scenario: Runner 修正被拒绝的 checkout

- **WHEN** Plan 因 protected branch finding 被拒绝后，Runner 为相关仓准备并公开合法 source branch/worktree，再次拉取同一 Run
- **THEN** Runtime 通过既有 Binding drift/reconfigure 协议建立新 Binding revision，使旧 Plan 精确失效并重新规划，不要求编辑 Store 或启动第二个 Change Run

#### Scenario: 断点后通过 resume 恢复精确 branch 修正

- **WHEN** Plan 因 protected branch finding 被拒绝，Runner 只为 finding 中的可写仓准备并公开合法 attached source branches，随后 Host 进程重启并对同一 Run 调用 `run resume`
- **THEN** Runtime 使用与 `run next` 相同的授权 classifier，在同一 Run 创建一个 Build Configure revalidation Work，不设置 `reconciliationRequired`，也不丢失 Design approval、Build Strategy、Tasks 或 rejected outcome

#### Scenario: 已被错误标记的 matching Run 恢复

- **WHEN** 既有 `reconciliationRequired` 仅由同一 rejected Plan 要求的 branch-only 修正产生，且当前 frozen evidence、snapshot diff 与 protected write-set 仍精确匹配
- **THEN** Runtime 原子记录 authorized rebind、清除该 matching reconciliation projection并派发唯一的 Build Configure Work，重复 resume 保持幂等

#### Scenario: branch 修正夹带无关身份漂移

- **WHEN** Runner 修正 protected write repositories 的同时改变了无关仓 branch，或任一 checkout path、remote、topology、repository membership、worktree ownership、Host 或 capability 发生变化
- **THEN** Runtime 不授予 authorized rebind，保留或设置 `reconciliationRequired` 并 fail closed，不创建 Configure、Plan Evidence 或 Execute Work

#### Scenario: 多个 protected 写仓只完成部分修正

- **WHEN** rejected Plan 包含多个 protected write repositories，而当前 snapshot 只证明其中一部分已切换并公开合法 source branch
- **THEN** Runtime 不授予任何仍位于 protected branch 仓库的写权限，并以 next/resume 一致的结构化状态等待剩余修正或重新配置，不创建 Execute Work

```
