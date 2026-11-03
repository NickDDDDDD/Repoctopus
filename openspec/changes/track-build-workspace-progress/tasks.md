# Tasks

## 1. 固定真实退化与领域合同

- [x] 1.1 保存真实五仓 Run 的失败轨迹，增加生产 composition 回归：合法 Execute commit 后不得返回 Configure，Plan/Completion 必须保留。
      **Acceptance:** 红测复现 `change.build-binding-revalidation-required`、0 completion 和 Plan 丢失，且失败原因不是 Git/依赖环境。
      **Requirements:** managed-work-execution / Build workspace 进度必须与 Execution Binding 身份分离

- [x] 1.2 定义 Runtime-owned `BuildWorkspaceCheckpoint` 及确定性 digest，覆盖初始、幂等、fast-forward、未授权仓变化和 non-fast-forward 领域测试。
      **Acceptance:** checkpoint 不包含路径、时间或凭据；只有当前 package 写集可以产生下一 revision。
      **Requirements:** managed-work-execution / Runtime 必须按 Package write scope 推进 workspace revision

## 2. Execute 与 Check 验收边界

- [x] 2.1 重排 Execute Outcome 处理：先验证结果身份，再区分 Binding identity drift 与合法 HEAD progress，并原子接受 completion、checkpoint、Task receipt 和下一 Work。
      **Acceptance:** 合法 commit 直接进入下一 Execute/Check；identity drift 仍回 Configure；失败不留下半完成 receipt。
      **Requirements:** change-lifecycle / Package Completion 必须原子推进 Build workspace checkpoint

- [x] 2.2 从 Host Package/Check result 删除 `repositoryDigest`，由 Runtime observation 生成 checkpoint digest 并写入 Completion/Check Evidence。
      **Acceptance:** Host 任意摘要不能伪造 repository state；CLI、fixtures、schema 与文档没有双写旧字段。
      **Requirements:** managed-work-execution / Repository revision Evidence 必须由 Runtime 观察

- [x] 2.3 让 Build Check 冻结并重验最终 checkpoint；Check 期间代码变化返回 repair/finding，不静默吸收。
      **Acceptance:** 精确匹配通过；未授权 head change 与 non-fast-forward 分别产生结构化拒绝且不推进 Verify。
      **Requirements:** change-lifecycle / Build Check 必须验证最终 workspace checkpoint

## 3. 恢复、兼容与观测

- [x] 3.1 增加同 Run 恢复：旧错误 Configure checkpoint 重新观察当前 HEAD 后建立初始 checkpoint，不修改 Store；无法证明的旧状态 migration required。
      **Acceptance:** 只声明精确直接前驱 compatibility；没有 wildcard、schema 猜测或手工 checkpoint 修补。
      **Requirements:** change-lifecycle / Workspace progress 恢复必须 fail closed

- [x] 3.2 增加 trajectory/OTLP 与 CLI 诊断，区分 accepted、unauthorized change、non-fast-forward、identity drift 和 observation failure。
      **Acceptance:** metrics 只使用有界枚举和计数，不包含仓库、branch、HEAD、path、digest 或正文。
      **Requirements:** development-telemetry / Build workspace progress 必须可审计

- [x] 3.3 更新架构与自举文档，明确 Binding 是授权基线、Checkpoint 是执行进度、Runner 负责 commit/push、Runtime 负责观察/授权。
      **Acceptance:** 文档不暗示 Runtime 创建分支或 commit，也不把正常 HEAD 变化描述为 Binding drift。
      **Requirements:** managed-work-execution / Build workspace 进度必须与 Execution Binding 身份分离

- [x] 3.4 保持兼容 adoption 前已派发 Action Intent/Work Packet 的冻结身份，不用 Run 的新 composition digest 反向否定旧 packet。
      **Acceptance:** 精确前驱 adoption 后，已接受 Outcome 可由同一 packet 继续验证；Intent 内部 composition 或 packet context 被篡改仍拒绝。
      **Requirements:** managed-work-execution / Runtime 必须按 Package write scope 推进 workspace revision

- [x] 3.5 统一 Planning approval、Project snapshot 与 Archive publication 的 Workspace Repository remote identity。
      **Acceptance:** 配置内 repository id 不再冒充平台仓库身份；同一 Git remote 在规划与发布边界产生相同规范化 identity，真实多仓 Archive 不在发布时误报 Workspace Repository 不匹配。
      **Requirements:** delivery-governance / Change branch 与 Publication 必须共享同一远端身份

## 4. 验证与继续真实验收

- [ ] 4.1 运行领域、Service、CLI、production composition、telemetry 和 architecture 定向测试。
- [ ] 4.2 运行完整 `npm run verify`、严格 OpenSpec validation、package/report freshness checks。
- [ ] 4.3 使用修复后的 Runtime 恢复或重新开始模拟多仓 Change，完成三个 package、Build Check、Verify 和 Archive；每个分支/commit 立即 push。
- [ ] 4.4 保存正式验证报告、清理临时日志/scratch、提交并 push，准备合入。
