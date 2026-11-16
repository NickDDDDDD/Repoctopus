# Tasks

## 1. 发布策略和回归

- [ ] 1.1 固定规格发布使用默认 API 的失败回归，并覆盖策略漂移。 <!-- comet-task:5ad42c94-49b6-40ae-bf86-be1941b4f8fb -->
  **Acceptance:** 自定义 API 的 Archive 验收在原候选暴露规格请求的目标差异。改变冻结策略会在任何新的发布副作用前被拒绝。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略

- [ ] 1.2 将 Runtime 已核验的 Delivery Policy 传给规格发布，与业务发布共用客户端配置路径。 <!-- comet-task:af9a4883-ace1-45cb-9399-9511e28a76ef -->
  **Acceptance:** 两类 MR 的查询与创建都到达配置的 HTTPS 测试接口。默认配置的发布回归通过。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略

## 2. 原 Run 恢复与正式验证

- [ ] 2.1 以原候选包为精确前驱验证受保护实现采纳。 <!-- comet-task:d88955bb-d28d-4416-b4c9-e91801424226 -->
  **Acceptance:** 保留 Run、策略、Verify Input、Bundle、Closure 和逻辑发布身份。错误前驱继续被拒绝。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略

- [ ] 2.2 用实际 Windows 安装包续跑原两条五仓实验。 <!-- comet-task:a94b4f27-a5eb-446a-9c06-1286e77de93c -->
  **Acceptance:** 普通轮复用两个业务 PR 与已推送的规格 OID，只补一个规格 PR。返工轮完成三项发布，后端原完成记录保持。两条 Run 都完成，重复冷恢复保留收据且无额外发布。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略

- [ ] 2.3 固定验收收据和通过完整 Verify。 <!-- comet-task:8353771b-8d8e-484f-acf6-0dbe7f8e5f0b -->
  **Acceptance:** 记录包摘要、实际 API 和 Git 副作用计数、原 Run 的终态及独立审查结果。
  **Requirements:** delivery-governance#Archive 发布使用同一份已核验的发布策略
