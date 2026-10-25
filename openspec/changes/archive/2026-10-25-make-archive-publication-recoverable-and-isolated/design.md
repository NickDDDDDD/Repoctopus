# Design

## Context

当前 Archive 实际跨越三个边界：

1. OpenSpec 官方命令在隔离 checkout 中生成并验证关闭候选；
2. Business Delivery 推送实现分支并创建或采纳业务 MR；
3. 最终规格发布提交关闭候选、推送独立 archive 分支并创建或采纳规格 MR。

第一层已有 `SpecificationClosureJournal`，第二层已有 Delivery v3 状态与精确远端核对。缺口位于第三层：`closeAt()` 把隔离候选重放到调用者工作树并清理 checkout，`SpecificationPublicationAdapter` 随后在调用者当前分支提交。这样既破坏分支不变量，也让“commit 成功但进程中断”“push 成功但响应丢失”“MR 已创建但本地未记录”等状态没有独立恢复围栏。

Comet Native 将 archive transaction 与 workspace finish journal 分开。我们采用“窄事务 + finish journal + 观察优先”的机制，不采用其 Classic/Native 双状态根、产品命令壳或等待远端合入模型。

## Goals / Non-Goals

### Goals

- Archive 成功、失败和重试均不改变调用者 branch、HEAD、index 和 worktree。
- 官方 OpenSpec archive 只执行一次；已形成的有效候选可以跨进程恢复。
- 规格提交、push 和 MR 创建各自具有稳定意图、CAS 状态与精确观察规则。
- Business Delivery 始终从已验证实现 commit 发布，不把规格关闭 diff 当作合法脏路径。
- 失败现场保留足够诊断，终态后清理短命 checkout，不引入 daemon 或后台 GC。

### Non-Goals

- 不等待或自动合入业务/规格 MR。
- 不把多仓发布伪装成跨仓 ACID 事务，也不自动 force-push、rebase、删分支或关 MR。
- 不建立第二套 Change lifecycle、Post-merge 状态或 webhook listener。
- 不把本地绝对 checkout 路径写入长期领域 Receipt。

## Decisions

### 1. Closure Receipt 携带不透明候选身份

`SpecificationClosureResult` 增加：

```ts
candidate: {
  checkoutId: string;
  baseOid: string;
}
```

`checkoutId` 只用于在 Workspace 管理根中定位候选，`baseOid` 绑定候选创建前的已验证 HEAD。Result 不暴露绝对路径。隔离事务在保存 Receipt 前补齐该身份，使 committed Journal、Receipt 与 checkout 三者可以互相核对。

`closeAt()` 不再把 `changedFiles` 复制回主工作树，也不删除候选。官方 archive 的后置条件已经在候选内完成；调用者工作树只用于核对当前 HEAD 未漂移。

### 2. 规格发布使用独立单调 Journal

新增 `SpecificationPublicationJournal`：

- `prepared`: 固定 Change/generation、closure/plan、checkout/base、archive branch、target、remote、commit message 与精确 changed files；
- `committed`: 保存候选 commit OID；
- `pushed`: 保存经 `ls-remote` 核对的相同 OID；
- `completed`: 保存唯一精确 MR identity、provenance 与最终 Publication item。

每次状态推进使用 digest CAS。Journal 只管理一个规格发布项，不重复 Business Delivery 状态，不表达 MR 合入或生命周期终态。

### 3. 每一步先观察再执行

恢复算法遵循：

- `prepared` 且 checkout HEAD 等于 base：核对 diff allowlist 后提交；HEAD 已是单个匹配 commit 时采纳，否则阻断。
- `committed`：远端分支不存在才普通 push；远端已是同 OID 则采纳，不同 OID 阻断。
- `pushed`：查询所有相同 repository/head/base 的 MR；唯一且 head OID 匹配则采纳，没有才创建，多个或漂移阻断。
- `completed`：重新观察 remote 和 MR；完全等价时返回 Journal 中稳定 Receipt，不生成新时间戳或新 identity。

故障可能发生在副作用完成、CAS 写入前；因此恢复同时接受“Journal 落后一个状态但外部事实精确匹配”，这与 Comet finish journal 的 recovery fence 一致。

### 4. 候选清理只发生在可远端恢复之后

规格发布 Journal 到达 `completed` 后，commit、remote branch 与 MR 已足以在 checkout 缺失时重建 Publication Result。此时 Adapter 才清理短命 worktree。若清理失败，发布仍保持 completed，但返回可定位 cleanup diagnostic；后续显式 maintenance 可重试，不回滚远端事实。

如果流程在更早状态失败，checkout 必须保留。不能在 `finally` 无条件删除，因为那会摧毁唯一未发布候选。

### 5. Archive orchestration 不再共享脏工作树

Workflow 先恢复/发布 Business Delivery，再发布隔离规格候选。Business Delivery 的 project snapshot 和 Git inspect 必须 clean；删除 `allowedDirtyPathsByDeliveryId` 的 Archive 特例。两者即使位于同一物理仓，也使用不同 worktree 与 source ref。

Run 只在组合 Receipt 同时包含全部 Business items 和 completed Specification item 后进入终态。任一步失败保持 Archive 可重试，不把部分远端成功当成失败回滚目标。

### 6. CLI attempt 身份显式命名

`archive-prepare` 接受 `--evidence-attempt <uuid>`，指向 Verify Evidence attempt；`archive-publish` 接受可选 `--work-attempt <integer>`，指向 Git Work claim attempt。旧的模糊 `--attempt` 在这两个命令上被拒绝并给出替代参数，其他命令的既有含义不变。

## Alternatives Considered

### Archive 后把调用者分支 reset 回去

拒绝。它掩盖了错误副作用，会覆盖并发用户修改，而且无法修复响应丢失窗口。

### 在主工作树创建 archive commit 后切回原分支

拒绝。进程在 commit 与切回之间中断仍会污染分支/index，且同仓并发 Runner 无法安全共享该目录。

### 把规格项塞进 Business DeliveryState

拒绝。Business Delivery 已绑定验证实现 commit，而规格候选直到关闭后才产生 commit OID；强行合并会制造时间顺序与权威冲突。独立窄 Journal 更清晰，最终由 Publication Receipt 组合。

### 终态前一直保留 checkout

拒绝。Run receipt 接受与进程返回之间仍有崩溃窗口。规格 Journal completed 后已经可以仅靠 Git 远端恢复，应尽早有界清理。

## Migration and Compatibility

- 新 Closure Result 要求 candidate；历史 Receipt 保持可读，不用于新规格发布。
- 新规格发布 Journal 使用独立 schema v1；不存在时从当前 Closure candidate 创建，存在时必须 identity 完全相同。
- Archive CLI 参数有意消除歧义；文档、help 与 E2E 同步更新。
- 已完成 Run、远端分支和 MR 不重写；旧临时 checkout 由显式维护诊断处理。

## Risks / Trade-offs

- completed Journal 成为本地恢复加速器，但远端精确事实仍是最终外部证明；二者不一致时 fail-closed。
- Windows 对 worktree 删除可能短暂失败；清理需要有界重试，不能因此重放发布。
- 同一仓会同时存在业务 MR 与规格 MR，这是既有策略；隔离只修复提交位置与恢复语义，不改变评审拓扑。
- 多仓中 Business 发布可能部分完成后规格发布失败；重试从已有 Delivery state 继续，不做危险补偿回滚。

## Verification

- 单元测试覆盖 Journal canonical identity、CAS、非法转换与 Receipt 精确匹配。
- 真实 Git 测试在 commit 后、push 后、MR 创建后注入故障，使用新 Adapter 恢复且每个副作用至多一次。
- OpenSpec Provider 测试证明 close 后调用者 status/branch/HEAD/index 不变，候选 checkout 保留；completed 发布后 checkout 被清理。
- Delivery tests 证明 Archive 不再传递 allowed dirty paths，同仓业务分支仍从原验证 OID 发布。
- CLI E2E 证明两个 attempt 参数不可混用，错误信息给出准确恢复命令。
- 自举回归记录 Archive 前后 branch、HEAD、upstream 与 porcelain，要求完全一致；随后运行完整正式 Verify。
