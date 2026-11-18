# Tasks

## 1. 独立 Windows 多仓验收

- [x] 1.1 实现指定 `.tgz` 的隔离消费入口，创建临时 Workspace、两个业务仓、Git 远端和托管服务，打通 Init 至 Archive。 <!-- comet-task:4b087a72-25e9-4ea4-827b-a7e517cf6e65 -->
  - **Acceptance:** 独立 Windows 命令可以安装给定候选包，经公共 CLI 完成一个多仓 Change，输出实际包摘要与终态。无效候选明确失败。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收
- [x] 1.2 在首包完成后换进程恢复，完成剩余工作包及 Verify。 <!-- comet-task:c7b8f639-34f2-42a1-a78f-b62e5ed48d03 -->
  - **Acceptance:** 重新启动 CLI 后 Run 和计划身份一致，首包仍为完成状态且未重做，剩余工作包与 Verify 有实际结果。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收
- [x] 1.3 在 Archive 注入规格 PR 创建响应丢失并验证恢复。 <!-- comet-task:957a7a41-9038-4cba-8366-2c12a396081f -->
  - **Acceptance:** 服务端确实创建 PR，初次恢复在结果不可见时等待，随后同一 Run 采纳其身份并完成。比较首次发布、等待、恢复和终态复读的原始请求与 Git 引用，确认没有重复创建或推送。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收

## 2. Release Prepare 门禁与验证

- [x] 2.1 接入 Release Prepare 并增加发布契约检查。 <!-- comet-task:393efa9a-89b0-4f04-85dc-9283369c7770 -->
  - **Acceptance:** Windows Prepare 用实际候选文件运行独立入口，验收摘要与封存摘要一致。失败或证据缺失时拒绝封存和上传，并保留阶段诊断。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收
- [x] 2.2 记录维护者运行方式，并验证独立入口和发布接线。 <!-- comet-task:b89cd085-8d91-45b9-8892-c68a5b521bd1 -->
  - **Acceptance:** 保存实际候选包的独立 Windows 通过证据及 Release Prepare 调用证据，覆盖恢复和副作用计数。维护者可按文档重现并定位失败。
  - **Requirements:** product-distribution#Windows 候选包通过多仓生命周期验收
