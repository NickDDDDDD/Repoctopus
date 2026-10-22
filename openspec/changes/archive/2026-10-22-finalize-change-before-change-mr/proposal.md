# Proposal

## Why

当前工作流在规划阶段就创建长期开放的 Change MR，并把它同时当作评审入口、远端并发栅栏和最终收尾载体。这使“MR 表示已经完整、可供合入的交付”与“Change 仍在实施”发生语义冲突，也容易导致 Change MR 被提前合入。

Repoctopus 应把公开 Change 分支作为实施期间的持久协作与并发边界，只在全部业务实现合入、合入后验证通过且规格完成同步归档后创建最终 Change MR。一个 Change 默认对应一个 Business MR，但必须支持显式登记多个 Business MR，并等待完整集合全部合入。

## What Changes

- **BREAKING**：Delivery 不再要求规划阶段已有 Change MR；改为登记 Workspace Repository 中已公开的 Change 分支、目标分支与精确远端 OID。
- **BREAKING**：Post-merge 发布不再更新既有 Change MR；它先在 Change 分支完成验证记录、主规格同步与 Change 归档，再创建或幂等恢复最终 Change MR。
- 把规划批准从代码平台 MR 状态中解耦，使用绑定四类规划产物、Change 分支 OID 和 Provider 校验结果的结构化 Human Decision。
- 一个 Change 默认声明一个 Business MR；只有多仓、独立可验证的有序交付或必要补充修复等明确原因才允许登记多个，并将完整集合绑定到批准快照。
- 只有全部已登记 Business MR 合入并取得权威 merge commit 后，Post-merge Run 才能执行；新增 Business MR 会使既有交付批准和收尾候选失效。
- 最终 Change MR 只包含允许的规格基线、归档 Change、验证与关闭状态，不得夹带业务代码；Runtime 仍不执行 merge。
- 迁移现有 Delivery 状态、配置、领域契约、Adapter、恢复语义、文档和测试，明确旧的 `changeMergeRequest: update-existing` 策略不再有效。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `delivery-governance`：以公开 Change 分支替代提前创建的 Change MR，定义 Business MR 默认一个、允许显式多个的交付集合及最终 Change MR 创建边界。
- `post-merge-automation`：使用 Change 分支 OID 完成并发收敛，并在验证、同步和归档后幂等创建最终 Change MR。
- `specification-authority`：在没有 Change MR 的规划阶段，以 Provider 校验结果和结构化人工决定批准四类规划产物。

## Impact

- 领域与状态：Delivery Intent、批准快照、Delivery Journal、Post-merge Run 输入、发布 Intent/Receipt 和迁移版本。
- 平台与 Git：Change 分支远端核对、普通非强制 push、最终 MR 的幂等创建与发布后核对。
- Runtime 与插件：Delivery Service、PostMergeCoordinator、Post-merge Actions、GitHub Adapter、命令入口和事件映射。
- 配置与文档：`repoctopus.yaml`、schema、示例、自举开发、交付、平台事件与 Post-merge 恢复指南。
- 测试：单 Business MR 默认路径、多 Business MR 显式路径、集合漂移、并发 Runner、MR 创建响应丢失、旧状态迁移和越权修改负向用例。
- 第三方：不引入新依赖，不复制新的第三方源码，现有许可证边界不变。
