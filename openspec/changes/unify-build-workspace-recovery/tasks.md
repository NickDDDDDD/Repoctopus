# Tasks

## 1. 复现与回归测试

- [x] 1.1 用公开 CLI 建立两仓、两工作包的回归场景。先启动 Run，再准备获准的源分支并完成首包，观察基线版 `run resume` 和 `run next` 给出不同恢复判定。 <!-- comet-task:6127efa1-c744-493c-b5d3-af228e61ed50 -->
- [x] 1.2 补充未授权分支、切回原分支、未接受的 HEAD 变化和重复恢复用例，核对原 Work、Binding、Plan 和工作包证据。 <!-- comet-task:22a2b9d4-45eb-48e8-9a34-ef81e1137a63 -->

## 2. 统一判定

- [x] 2.1 让两个 CLI 入口共用对最新有效 Binding、Build 工作区 checkpoint 和当前 Git 观察的判定。验证合法变化保留 Run、工作包进度和下一项工作。 <!-- comet-task:b3b7225f-5aad-4f22-b32e-697300bbd5ba -->
- [x] 2.2 按既有恢复协议处理真实漂移和未确定的外部结果。验证无法解释的 checkout 变化阻断执行，且获准的受保护分支重绑定仍按原规则运行。 <!-- comet-task:cf620592-c727-4f43-b1be-92310c94c941 -->

## 3. 真实多仓验收

- [x] 3.1 用候选 CLI 在独立 `agent-lab` 验收 checkout 创建新 Run。完成第一个工作包后，在不同新进程中执行两个恢复入口，核对同一 Run、Binding、Plan、1/2 个已完成工作包与同一下一项工作。 <!-- comet-task:fb73ee9b-c100-4202-bf9b-ee78b64602ed -->
- [x] 3.2 将一个业务仓切到未授权分支，记录两个入口都阻断执行且保留现场。恢复原分支后继续第二个工作包，确认第一个工作包未重放。 <!-- comet-task:e762f35d-ed60-4ad0-b9a8-ae45973a8649 -->
- [x] 3.3 执行仓库验证命令，提交 CLI 结果与正式验证证据，供本 Change 归档和合入检查。 <!-- comet-task:e3c8cecb-99ae-4352-951a-d928597f63b0 -->
