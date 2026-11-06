---
change: commit-invalid-host-rejections-atomically
design-doc: openspec/changes/commit-invalid-host-rejections-atomically/design.md
base-ref: dd87c6afea786244b60915dd7f037b0109f5ec62
archived-with: 2026-11-06-commit-invalid-host-rejections-atomically
---

# 非法 Host 提交原子拒绝实施计划

<!-- comet-task-authority: openspec/changes/commit-invalid-host-rejections-atomically/tasks.md -->

本计划按已批准的 autonomous、TDD 和 thorough 审查执行。OpenSpec 是任务完成权威。
Comet 0.5.1 的单次 Run mutation 是拒绝提交的参考边界，Repoctopus 继续使用现有
Run Store、claim、packet、invocation 和提交身份规则。

## 复现中断窗口

<!-- comet-task-ref:dc303f36-9a1a-433d-9bc8-fc9aef6804e6 -->

在现有生产组合验收中注入 Host 原始状态格式错误，在首个写入该提交的 guarded commit
完成后中断。冷启动前检查已经落盘的结果，旧实现应出现可供失败接受路径消费的
`submitted`。保留首次 RED 输出。

## Run Store 原子拒绝

<!-- comet-task-ref:6b380055-6255-416a-8491-e69945a9e0e8 -->

在 `services/work-execution-authority.ts` 复用现有提交身份分类、历史边界和事件类型。
一次 guarded commit 只将确定非法的候选写入拒绝历史，并设置 `awaiting-correction`。
验证同 ID 同内容重放、同 ID 不同内容冲突，以及并发到达的其他候选不会被清除。

## Host 入口

<!-- comet-task-ref:d6b1e1cb-6a59-496e-94a0-9aa1640d7c8e -->

在 `services/managed-work-executor.ts` 让内嵌、外部和 reconciliation 共用分类及记录逻辑。
确定的 ingress 拒绝直接走拒绝提交，合法结果仍进入原有领域校验路径。运行
`test/managed-work-executor.test.ts` 和 `test/work-execution-submission.test.ts`，覆盖有界原始
内容、委派及 Skill 消费校验、未知处理器和真正的 Host 失败。

## 冷恢复与交付证据

<!-- comet-task-ref:f8261879-1535-4fd9-97d5-16a1eb2b095d -->

复用 RED 场景，重启后核对 claim 与 invocation、拒绝事实、无非法 Receipt，并用新的
submission ID 补交正确结果。断言只出现一次合法接受，再走完生命周期。

<!-- comet-task-ref:db5f39ba-1f8a-41bf-9770-1562c57df383 -->

运行定向测试、独立审查及完整 `npm.cmd run verify`。报告记录真实命令、产品包摘要、
平台限制和检查结果。每个已提交的切片立即推送。
