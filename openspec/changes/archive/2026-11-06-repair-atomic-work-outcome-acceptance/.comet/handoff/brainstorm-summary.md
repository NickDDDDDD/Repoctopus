# Brainstorm Summary

## 已确认

- 目标：完整修复受管 Build Work 在领域校验前过早绑定 terminal Outcome、导致原 invocation 无法纠正的问题。
- 方法：优先参考固定 Comet 0.5.1 的成熟 Runtime 语义，但实现服从 Repoctopus 的 Cordis、多仓、外部 Host、Evidence 与两阶段副作用边界。
- 范围：统一处理 `build.configure`、`build.plan`、`build.execute`、`build.check`；不迁移旧预发布 Run，不修改 Store 绕过保护。
- 规格：现有 `managed-work-execution` 已声明本次行为，Open 已批准 `skip_specs`，不建立重复 delta spec。

## 候选设计（等待 Design 决定）

1. 所有成功的 Build Host submission 先停在 `submitted`，由唯一 acceptance coordinator 按身份/协议、schema、Work 领域语义、lifecycle validator、transition feasibility 顺序处理。
2. `ManagedWorkExecutor` 只执行或接收 Host payload、记录 submission 和执行事实；删除 Configure 特判及 Plan/Check 延迟名单。
3. 使用封闭 disposition：`accepted`、`correctable-rejection`、`processing-error`。候选错误进入同一 claim/invocation 的 `awaiting-correction`；处理错误保留 pending；只有未知执行结果进入 reconciliation。
4. 采用 Comet 的原子接受不变量，不照搬单事务实现：Repoctopus 在锁外读取 Provider/Project Snapshot 并生成绑定稳定 digest 的 validation record，再由 Run Store guarded commit 重新核对身份并一次性写 terminal facts。
5. Configure、Plan、Execute、Check 各自拥有完整处理器。Execute 保留现有 workspace checkpoint 与副作用 journal，不把外部副作用塞入 Run Store 事务。
6. accepted fact 到 lifecycle observation 之间通过现有 checkpoint 幂等恢复；恢复不重调 Host、不创建新 Work/attempt。

## 已比较方案

- 推荐：统一 acceptance coordinator + Work 处理器注册表。它消除分散接受边界，并让新增 Work fail closed。
- 拒绝：只增加 Configure digest 特判。它仍会让后续新字段/Work 重复同类缺陷。
- 拒绝：把完整 Build 校验下沉到 `WorkExecutionAuthority`。它会让 Store authority 依赖 Provider、Project Snapshot 与 Build orchestration，破坏领域边界。
- 拒绝：直接引入 Comet Runtime SDK。它会与 Repoctopus 多仓 Runtime 和 Cordis Service 形成双权威。

## 主要风险与验证

- 锁外校验期间输入漂移：validation record 绑定稳定 digest，guarded commit 内重核，漂移就重新观察。
- Execute 副作用重复：保持两阶段 journal，并增加每个中断点的恢复测试。
- processing error 被当成 Host 错误：typed disposition 与独立遥测 reason code，禁止从异常文本推断。
- 回归面较大：先以 Round 8 的 Configure wrong-digest 场景做 RED/GREEN 垂直切片，再逐个迁移其余 Work。
- 最终验证：单元/集成/外部 CLI/冷启动/遥测/全量 `npm run verify`，并用新的多仓 Run 重放 Round 8；旧 Run 只保留证据。

## Spec Patch

- 无。若实现中发现当前规格与固定 Comet 语义或 Run Store 不变量冲突，停止 Build 并返回 Design，不在实现中自行增加兼容分支。
