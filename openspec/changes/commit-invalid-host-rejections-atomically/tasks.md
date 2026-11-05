# Tasks

## 1. 复现与原子拒绝

- [x] 1.1 新增 Host 输入落盘与拒绝之间的中断回归，确认旧实现恢复时会尝试终态化非法候选。 <!-- comet-task:dc303f36-9a1a-433d-9bc8-fc9aef6804e6 -->
- [x] 1.2 在同一次 Run 提交中记录直接拒绝，验证历史、等待补交状态与事件同时提交，原 claim 和 invocation 保持，重复或冲突 ID 按原规则处理。 <!-- comet-task:6b380055-6255-416a-8491-e69945a9e0e8 -->
- [x] 1.3 内嵌 Host、外部 Runner 与 reconciliation 共用已分类提交入口，验证非法输入无法出现在待接受状态，真实 Host 失败继续按原失败协议处理。 <!-- comet-task:d6b1e1cb-6a59-496e-94a0-9aa1640d7c8e -->

## 2. 恢复验证

- [x] 2.1 从持久化 Run 重新启动，确认同一 invocation 可用新 submission ID 补交，合法结果只接受一次。 <!-- comet-task:f8261879-1535-4fd9-97d5-16a1eb2b095d -->
- [x] 2.2 完成独立审查和全量门禁，记录包身份和实际中断恢复证据。 <!-- comet-task:db5f39ba-1f8a-41bf-9770-1562c57df383 -->

## Workflow follow-up

- 归档和合入后，使用更新的 Runtime 继续下一轮小型多仓验收。
