# Tasks

## 1. 固定两个真实撕裂故障

- [ ] 1.1 增加 Archive 回归夹具：Design approval 因规划语义变化失效但 lifecycle 仍在 Archive，preflight 当前只抛错且不恢复 phase。
      **Acceptance:** 失败测试证明任何 Specification Closure、Git push 或 MR 调用之前必须得到显式 Design 恢复结果
      **Requirements:** change-lifecycle#规划授权失效必须原子恢复-design-checkpoint; specification-authority#later-phase-必须只读观察并在副作用前收敛规划授权
- [ ] 1.2 增加 continuation 回归夹具：lifecycle 已是 Design/currentWork 为空或已替换，但 checkpoint 仍是旧 Build Work。
      **Acceptance:** 失败测试复现旧 `workId`、旧 `checkEpoch` 与 `validator-pending` 被错误投影为当前 continuation
      **Requirements:** managed-work-execution#只有匹配当前-lifecycle-work-的-execution-checkpoint-才可续行

## 2. 原子化 lifecycle 与 execution checkpoint

- [ ] 2.1 扩展 planning invalidation observation，使其携带 Runtime 物化的 `specification.plan` Work，并在一次领域 transition 中回到 Design、替换 Work、递增 epoch、清除下游输入。
      **Blocked by:** 1.1
      **Acceptance:** Build、Verify 与无副作用 Archive 的纯领域测试均得到完整 Design checkpoint，不出现 `design/currentWork=null` 中间态
      **Requirements:** change-lifecycle#规划授权失效必须原子恢复-design-checkpoint
- [ ] 2.2 在 Coordinator 的同一 Run CAS 中退役与新 lifecycle current Work/epoch 不匹配的 `workExecution`，并保留 trajectory 审计事实。
      **Blocked by:** 1.2, 2.1
      **Acceptance:** transition commit 后 Run state 不含陈旧 checkpoint；旧 claim/Outcome/Receipt 事件仍可读取且没有第二次副作用
      **Requirements:** managed-work-execution#只有匹配当前-lifecycle-work-的-execution-checkpoint-才可续行
- [ ] 2.3 为遗留 torn state 增加只读 recovery 防线，优先投影 lifecycle current Work，不加载或续行旧 intent。
      **Blocked by:** 2.2
      **Acceptance:** 冷启动夹具返回新 Design Work 的 `work-unclaimed` 或 `transition-pending`，绝不返回旧 Build `validator-pending`
      **Requirements:** managed-work-execution#只有匹配当前-lifecycle-work-的-execution-checkpoint-才可续行

## 3. 让规划授权在受保护入口收敛

- [ ] 3.1 抽取 later-phase Planning Authority Observation，严格读取 Provider semantic digest、validation 与当前 approval，不刷新 approval proposal。
      **Blocked by:** 2.1
      **Acceptance:** Build/Verify/Archive 观察不写 approval Store；只有 Design gate 可创建或刷新 Human Decision request
      **Requirements:** specification-authority#later-phase-必须只读观察并在副作用前收敛规划授权
- [ ] 3.2 在 Build/Verify pull 入口发现语义漂移时创建 Design Work并提交单次 invalidation observation，移除现有先 `assess()` 后 transition 的顺序。
      **Blocked by:** 3.1
      **Acceptance:** planning approval 与 lifecycle 不再因一次 Build/Verify pull 被主动拆成两个当前状态，重复 pull 幂等
      **Requirements:** change-lifecycle#规划授权失效必须原子恢复-design-checkpoint; specification-authority#later-phase-必须只读观察并在副作用前收敛规划授权
- [ ] 3.3 在 Archive preflight 检查 semantic digest、strict validation 与 approval authority，失效时返回 `planning-revision-required` 和完整 Design checkpoint。
      **Blocked by:** 3.1, 3.2
      **Acceptance:** Specification Closure、Git、平台 MR adapter 的调用计数均为零；重新批准后同一 Run 可继续
      **Requirements:** specification-authority#later-phase-必须只读观察并在副作用前收敛规划授权

## 4. 遥测、恢复和完整验证

- [ ] 4.1 为 planning invalidation 与 execution retirement 增加 trajectory/OTLP 事实及低基数契约测试。
      **Blocked by:** 2.2, 3.3
      **Acceptance:** trace 可关联 from/to phase、旧/新 epoch 与失效类型；Metric label 不含 digest、路径、自由文本或 run/work identity
      **Requirements:** development-telemetry#规划恢复必须上报权威失效与-checkpoint-退役事实
- [ ] 4.2 增加跨进程重启和端到端测试，覆盖 Archive 故障、Desktop 风格旧 continuation、重复恢复、重新批准与继续执行。
      **Blocked by:** 2.3, 4.1
      **Acceptance:** 同一 Run 在重启前后只有一个当前 checkpoint，旧 Work 不会复活，恢复无需编辑 Store
      **Requirements:** change-lifecycle#规划授权失效必须原子恢复-design-checkpoint; managed-work-execution#只有匹配当前-lifecycle-work-的-execution-checkpoint-才可续行
- [ ] 4.3 运行严格 OpenSpec、相关 Vitest、typecheck、lint、architecture/provenance/generated 检查和完整 `npm run verify`；更新正式验证报告并清理临时审计目录。
      **Blocked by:** 4.2
      **Acceptance:** 所有命令通过，DSH/Comet 漂移检查为 current，分支每次提交均已 push，临时 clone 和调试输出已清理
      **Requirements:** development-telemetry#规划恢复必须上报权威失效与-checkpoint-退役事实
