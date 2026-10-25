# Spec Delta

## REMOVED Requirements

### Requirement: 全部相关业务 MR 合入后才启动收尾

**Reason**: Archive 以精确发布完成为边界，不等待 Business MR 合入。

**Migration**: Verify 后直接关闭规格并发布全部 MR；后续变化由 consistency reconcile 处理。

### Requirement: 合入后验证绑定精确 merge commit

**Reason**: 新流程不构造合入后 checkout 或以 merge commit 作为关闭输入。

**Migration**: Archive 绑定已验证的 Delivery snapshot 与 published head OID。

### Requirement: 规格同步和关闭由当前 Provider 执行

**Reason**: 该职责移入 Specification Authority 的 Archive 关闭事务，不再属于 Post-merge 产品语义。

**Migration**: 使用 `SpecificationClosureJournal` 和当前 Provider。

### Requirement: 机器收尾修改受路径和语义双重限制

**Reason**: 路径与语义 Guardrail 保留在 Archive/Specification owner，独立 Post-merge 能力退役。

**Migration**: Closure Receipt 与 Publication Receipt 继续绑定允许差异。

### Requirement: Post-merge Run 可以幂等恢复

**Reason**: 产品只保留同一 Change Run 的 Archive Work，不再存在 Post-merge Run 或 Coordinator。

**Migration**: 本地关闭由 Closure Journal 恢复，远端发布由稳定 Publication item 恢复。

### Requirement: 无需开发者返回本机执行收尾

**Reason**: 收尾不再等待 merge；任一短生命周期执行者都可按持久 Run 和发布身份继续 Archive。

**Migration**: 不从动作身份推导 Change owner。

### Requirement: 开发 Run 启动前执行一次性补偿

**Reason**: 不再补偿 Post-merge 等待；启动前仅执行非阻塞 consistency reconcile。

**Migration**: 旧 `post-merge reconcile` 替换为 `change reconcile`。

### Requirement: 多个 Runner 的远端结果安全收敛

**Reason**: 长驻 Runner 退役；远端幂等性由短生命周期 Publication Intent/Receipt 的稳定身份保证。

**Migration**: observe-before-retry 保留，不保留 Runner lease/ownership 语义。

### Requirement: 规格关闭发布后创建最终 Change MR

**Reason**: 职责转移到 Delivery Governance 的 Publication Receipt，不再属于 Post-merge capability。

**Migration**: `delivery.publish` 在规格关闭后创建或采用最终 MR，并立即完成 Archive。

### Requirement: 新项目配置只生成 v3 收尾发布策略

**Reason**: Post-merge 配置与版本化收尾策略整体删除。

**Migration**: 项目只配置普通 Delivery Provider、仓库和发布策略。

### Requirement: 已登记 Business MR 集合在收尾期间冻结

**Reason**: Business 发布集合继续由批准 Delivery snapshot 冻结，但没有“收尾等待期”。

**Migration**: Publication Receipt 绑定 snapshot 中的完整 item 集合。
