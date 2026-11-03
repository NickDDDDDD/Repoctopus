# Tasks

## 1. Freeze the regression

- [ ] 1.1 为 `ExecutionWorkspaceIntent` 添加红测，证明 branch 模式不接受或要求 delivery target branch。 <!-- comet-task:0b3d0cce-0d53-4cd5-9dc2-95bdc6e5ac79 -->
- [ ] 1.2 为多仓 Binding 添加红测：协调仓功能分支、三个业务仓 `main` 和一个不同功能分支可以共同绑定。 <!-- comet-task:e7ea31c1-f725-433a-9380-c3c879b9c699 -->
- [ ] 1.3 添加负例，覆盖 detached/缺失 branch facts、remote/topology drift 与 worktree ownership 不匹配。 <!-- comet-task:c531183a-745a-44bf-9235-97df290273ec -->

## 2. Separate the domain identities

- [ ] 2.1 重构 `ExecutionWorkspaceIntent`，移除 `targetBranch` 并更新稳定摘要、类型和构造器。 <!-- comet-task:26c5a165-707b-4817-a306-3ac79b495e14 -->
- [ ] 2.2 重构逐仓 Binding 校验，删除全仓共享 branch 比较并保留模式、拓扑和身份门禁。 <!-- comet-task:6f7562b4-5652-4cd8-8291-d3972bd5bf41 -->
- [ ] 2.3 更新 binding error taxonomy，移除错误的 `branch-mismatch` 语义并保持结构化恢复分类。 <!-- comet-task:9c95df08-2be1-44c5-867d-2c89b4e34f65 -->

## 3. Repair production orchestration

- [ ] 3.1 修改初次 Open approval，不再从 delivery trigger 向执行 Intent 注入 target branch。 <!-- comet-task:b1977633-d3d2-433f-8417-1cda68d527da -->
- [ ] 3.2 修改 workspace-intent revision 路径，使其与初次批准复用同一 Intent/Binding 语义。 <!-- comet-task:cb4496fb-84b2-4fe8-8b06-12e538a133ec -->
- [ ] 3.3 审计 Runtime、CLI、Dashboard/telemetry 和持久状态的所有 `workspaceIntent.targetBranch` 消费点，删除错误耦合而不改 Delivery target。 <!-- comet-task:fd44d6cf-0bc1-42b0-a4f1-21e8ba32a0f2 -->

## 4. Preserve Build safety

- [ ] 4.1 保留并扩展 Plan 验证测试，证明可写仓绑定 protected branch 仍被拒绝。 <!-- comet-task:e20b3e4b-cd33-443d-96ee-cbc7822d60bc -->
- [ ] 4.2 证明只读仓停留在 target/protected branch 不阻断 Plan。 <!-- comet-task:523450a3-835e-4941-8e25-f16e943104d0 -->
- [ ] 4.3 证明 Runner 切换被拒绝写仓的 branch 后触发 Binding revalidation，而不是要求重做 Open approval。 <!-- comet-task:17dacdf0-f711-434b-a59b-cbc2bca8e4aa -->

## 5. Production acceptance

- [ ] 5.1 增加 Windows 生产 CLI E2E：真实 `run start`、Open Host Outcome、branch Human Decision 后进入 Design。 <!-- comet-task:848ab558-b119-44f8-940b-d55222ef820a -->
- [ ] 5.2 E2E 同时断言协调仓 source branch 与 delivery target branch 保持不同，其他仓无需共享 source branch。 <!-- comet-task:292d5fee-e9c4-4e38-bc36-aef8fda4847f -->
- [ ] 5.3 验证失败批准不写 lifecycle/Specification Store，修复后的重复批准保持幂等。 <!-- comet-task:9d14088e-b156-4da8-9be3-2f111e65120b -->

## 6. Documentation and full verification

- [ ] 6.1 更新 Runtime/自举文档，解释 Intent、Binding、ChangeStartBinding 和 Delivery target 的职责边界。 <!-- comet-task:10382a35-d3ab-4bc3-bad9-02454fb45d99 -->
- [ ] 6.2 运行定向测试、strict OpenSpec、architecture/provenance/generated 检查和完整 `npm run verify`。 <!-- comet-task:7fae3b5d-9230-42d1-8988-3e28be2d23a1 -->
- [ ] 6.3 清理临时验收日志和 scratch 输出；保留正式 Run、规格、测试与诊断证据。 <!-- comet-task:5b9dc4f6-b939-47ca-a035-8d4438f8422c -->
- [ ] 6.4 用修复后的产品继续模拟多仓验收；若旧 Run 因 composition identity 不兼容则记录并从同一场景创建新 Run，不添加兼容旁路。 <!-- comet-task:1ee9c804-2040-4b1f-8318-4a0789ce1b86 -->
