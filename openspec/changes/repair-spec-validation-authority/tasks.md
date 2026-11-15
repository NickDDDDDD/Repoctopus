# Tasks

## 1. 锁定失败行为

- [x] 1.1 通过公开 CLI 固定失败校验、有效草案迭代和跨 Change 查询的回归。 <!-- comet-task:31d05ef2-5eb2-4305-9fd8-e28d4b834099 -->
  **Acceptance:** 修复前的候选分别复现错误绑定、摘要变化被拒和跨 Change 写入，记录持久化影响。
  **Requirements:** specification-authority#手动规格校验只读并绑定查询归属
- [x] 1.2 加入 Provider 故障注入与阶段接受中断、并发回归。 <!-- comet-task:5730719a-2b5b-46df-81a6-bbade6ef489b -->
  **Acceptance:** 能区分观察不可用、真实规划语义变化、版本过期、重复提交和同一提交未落盘。
  **Requirements:** specification-authority#阶段校验证据随受保护转换提交, specification-authority#规划观察区分不可用和确定性失效

## 2. 修复 Runtime 权威边界

- [x] 2.1 让 `spec validate --run` 使用只读 Run 归属核对并返回当前严格校验诊断。 <!-- comet-task:3ff70cbb-d90e-451c-988a-8e3da941d260 -->
  **Acceptance:** 无效草案、有效草案和错误 Run 的请求均不改变原 Run 的状态、checkpoint 或批准。
  **Requirements:** specification-authority#手动规格校验只读并绑定查询归属
- [x] 2.2 将各阶段的有效校验证据与受保护接受一起提交，核对同义的其他公开和内部绑定入口。 <!-- comet-task:0fdeb3e8-514f-4117-9bb8-27c4c56c392c -->
  **Acceptance:** 合法 Design 可以产生不同校验摘要，当前阶段的过期批准或过期提交仍被拒绝，重复提交幂等。
  **Requirements:** specification-authority#阶段校验证据随受保护转换提交
- [x] 2.3 统一 Build、Verify 和 Archive 的规划观察不可用处理。 <!-- comet-task:1c71c7f5-3495-4167-930a-0ec4696a2bda -->
  **Acceptance:** Provider 故障保留现有 Work 和有效事实，恢复后可继续，真实规划变更仍进入 Design 修订。
  **Requirements:** specification-authority#规划观察区分不可用和确定性失效

## 3. 安装包验收与文档

- [x] 3.1 复跑生命周期、规划批准、Verify 身份与 Archive 回归。 <!-- comet-task:aa7b2ce0-202b-46ef-bc53-770fc9e5f2d0 -->
  **Acceptance:** 原审批和冷恢复守卫测试通过，复选框提交与真实规划变更继续走各自路径。
  **Requirements:** specification-authority#阶段校验证据随受保护转换提交, specification-authority#规划观察区分不可用和确定性失效
- [ ] 3.2 用实际安装包完成同一 Run 的失败修正与多仓真实验收。 <!-- comet-task:5e9abfb6-3915-4853-ab62-b7d297e44421 -->
  **Acceptance:** 从无效草案修正、换进程、正式批准 Open 和 Design，到多仓 Verify、Archive 及发布后的终态恢复，验证关联和副作用次数。
  **Requirements:** specification-authority#手动规格校验只读并绑定查询归属, specification-authority#阶段校验证据随受保护转换提交, specification-authority#规划观察区分不可用和确定性失效
- [ ] 3.3 对齐 CLI 说明并记录验证证据。 <!-- comet-task:6d8d3a0a-a9fc-4119-82cf-d7f117874630 -->
  **Acceptance:** 文档说明 `--run` 查询关联、阶段接受与故障恢复，固定候选包及实际验收证据可以复核。
  **Requirements:** specification-authority#手动规格校验只读并绑定查询归属, specification-authority#规划观察区分不可用和确定性失效
