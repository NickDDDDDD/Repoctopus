# Tasks

## 1. 确定观察和恢复契约

- [x] 1.1 用公开 CLI 和真实 Git fixture 复现两条 Issue，梳理 resume、next、Execute Outcome、Build Check 的原有判定及提交边界，并先记录失败回归。**Acceptance:** 两个独立场景均复现全仓 HEAD 阻塞，当前实现和 Comet 对照可追溯。**Requirements:** managed-work-execution#Runtime 必须按 Package write scope 推进 workspace revision <!-- comet-task:00eeee26-8802-43bf-8131-21e5bb1591ce -->
- [x] 1.2 在正式 Design 明确可核验的 Package 输入、Check 输入和发布边界，以及未知范围、工作树修改和历史改写时的处理。**Acceptance:** 每类判定均有真实输入来源、允许动作和失败路径，对缺少读范围的仓库有保守策略。**Requirements:** change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:a4b03b35-e844-4f7f-9f88-2ddf58bd424a -->

## 2. 统一 Build 漂移判定与提交

- [ ] 2.1 实现共用的 checkout 与 Git 变化分类，验证仓库身份、祖先关系、受管写入和外部变化。**Acceptance:** 分支切换、改写和无法观测不会误判为无关快进。**Requirements:** managed-work-execution#Runtime 必须按 Package write scope 推进 workspace revision <!-- comet-task:f04ef1a9-1c51-42a4-866b-0154830d2b25 -->
- [ ] 2.2 将继续入口和 Execute Outcome 接入同一判定，使用受管提交保留合法进度和处理失效范围。**Acceptance:** 同一 Run 冷恢复保留有效包与审批，并发、丢失响应和未结算执行不会重复写入或留下部分进度。**Requirements:** change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:6a8d1740-bd32-44ec-8876-9db430784db3 -->
- [ ] 2.3 让 Build Check 依据同一观察绑定有效输入，复用现有 Evidence 失效及依赖传播。**Acceptance:** 已知输入变化只复核相关包及依赖者，无关快进保留有效结果，实际规划变化仍受既有审批约束。**Requirements:** change-lifecycle#Build Check 必须验证最终 workspace checkpoint、change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:f1c147d9-9c78-458e-8d5d-c6175a0fb9d0 -->
- [ ] 2.4 保持 Git 交付坐标和范围可验证，补齐阻塞时的公开诊断与恢复说明。**Acceptance:** 外部提交不会计为受管实现或混入发布，无法安全隔离时给出可行动的诊断。**Requirements:** managed-work-execution#Runtime 必须按 Package write scope 推进 workspace revision <!-- comet-task:3f4afe50-a396-41dd-b49d-8126ccb411ba -->

## 3. 端到端验证

- [ ] 3.1 在 Windows 安装实际候选包，在模拟多仓分别复现只读仓同步、包外业务提交和相关输入变化，覆盖冷恢复并验证真实发布差异。**Acceptance:** 两个无关快进场景均续跑原 Run 到 Archive，相关变化场景仅复核受影响的范围，发布差异不含外部业务改动。**Requirements:** managed-work-execution#Runtime 必须按 Package write scope 推进 workspace revision、change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:27901fb0-8bd8-479b-bc51-a4dba75a9b8c -->
- [ ] 3.2 运行相关回归、正式 Verify 和独立审查，核对规划发布、Verify 配置补齐、纯 Runtime 输出清理及旧证据复用路径。**Acceptance:** 附带公开验收步骤与实际证据，已知阻塞和范围限制均可追溯。**Requirements:** change-lifecycle#Build Check 必须验证最终 workspace checkpoint、change-lifecycle#多仓 Build 漂移仅失效受影响的有效进度 <!-- comet-task:1cf5b00d-249f-46b3-af85-e58cbbfe1444 -->
