# Tasks

## 1. Freeze the blocked checkpoint

- [ ] 1.1 以完整生产序列固定 capability drift RED：完整能力 Configure 后，相同 Host ID 以 Plan 最小能力提交 candidate，再调用 `run next`
  **Blocked by:** none
  **Acceptance:** 修复前测试稳定复现 `Execution Binding requires process.execute, repository.write`；claim、packet、invocation 与 submission 均通过公共协议产生并保持可审计
  **Requirements:** managed-work-execution#build-host-capability-drift-recovery
- [ ] 1.2 固定正常与负例矩阵，包括相同 digest、subset、superset、顺序规范化、不同 Host ID、重复 next 和进程重启
  **Blocked by:** 1.1
  **Acceptance:** 每个案例具有结构化状态断言；测试不修改 Run Store、不匹配人类错误全文，也不创建第二个 Run
  **Requirements:** managed-work-execution#build-host-capability-drift-recovery

## 2. Make capability drift recoverable

- [ ] 2.1 将 Execution Binding drift 改成对缺失能力不抛异常的 total classifier
  **Blocked by:** 1.2
  **Acceptance:** subset/superset/digest 变化返回 `capability`；相同规范化能力继续比较 checkout/path；领域与服务定向测试通过
  **Requirements:** managed-work-execution#build-host-capability-drift-recovery
- [ ] 2.2 统一 Plan、Execute、Check 的先漂移恢复、后完整能力断言顺序
  **Blocked by:** 2.1
  **Acceptance:** 三个分支命中 capability drift 时都派发唯一 Configure revalidation；没有 candidate 被接受、没有 package/check 被完成
  **Requirements:** managed-work-execution#build-host-capability-drift-recovery
- [ ] 2.3 保留旧执行事实并验证 Configure 后精确重规划
  **Blocked by:** 2.2
  **Acceptance:** 旧 claim/submission 留在 trajectory，新 check epoch 只有一个 Configure Work；新 Plan revision 绑定新 Binding 且不重放旧 candidate
  **Requirements:** managed-work-execution#build-host-capability-drift-recovery

## 3. Prove product behavior

- [ ] 3.1 完成定向恢复、幂等、current execution retirement 与 managed Change E2E 测试
  **Blocked by:** 2.3
  **Acceptance:** 所有定向测试通过，且没有放宽 Work capability、write scope、side-effect 或 Host ID 门禁
  **Requirements:** managed-work-execution#build-host-capability-drift-recovery
- [ ] 3.2 使用修复后的打包产品恢复 round4 验收 Run并继续两包 TDD，或记录 composition 不兼容后启动完全相同的新 Run
  **Blocked by:** 3.1
  **Acceptance:** 不编辑 Store；恢复路径进入 Configure→Plan，或新 Run 保留旧正式诊断；最终能继续真实多仓验收
  **Requirements:** managed-work-execution#build-host-capability-drift-recovery
- [ ] 3.3 更新恢复文档、正式验证报告并运行完整产品门禁
  **Blocked by:** 3.2
  **Acceptance:** `npm run verify`、package/tracer E2E、strict OpenSpec、generated、architecture、provenance 与 diff check 全部通过；临时日志、JSON 和 scratch 输出已清理
  **Requirements:** managed-work-execution#build-host-capability-drift-recovery
