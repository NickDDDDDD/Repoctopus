---
change: unify-build-workspace-recovery
design-doc: openspec/changes/unify-build-workspace-recovery/design.md
base-ref: c25e2ab
---

# Build 工作区恢复实施计划

按已批准的 autonomous、TDD、thorough 配置执行。需求和完成状态由同一份 OpenSpec tasks.md 管理。

<!-- comet-task-authority: openspec/changes/unify-build-workspace-recovery/tasks.md -->

## 目标与边界

`resume` 和 `next` 在 Build 续行前共用当前绑定与进度判定。Cordis 服务观察 Git，纯领域规则判断恢复事实，协调器以受保护更新记录结论。已接受的 Binding、Plan、工作包与当前 invocation 保持各自权威。验收通过安装后的 CLI 使用真实多仓实验项目。

## 文件与接口

- `domains/runtime/build-workspace-recovery.ts` 定义当前执行绑定、Build checkpoint、启动与当前项目快照、实际 checkout 和当前执行状态的纯恢复判定，返回可继续或带原因的冲突。
- `services/workflow-runs.ts` 通过共同观察入口收集当前事实，在两个恢复入口消费同一判定，复用现有 protected Plan correction 与当前 Work acceptance。
- `domains/runtime/workflow-runs.ts` 使用当前 Run revision 和绑定检查恢复观察，原子记录事件与可归属的工作区阻塞，不改写启动 snapshot。
- `app/cli/main.ts` 从实际恢复 continuation 生成续行提示。
- `test/managed-change-execution.e2e.test.ts` 扩展现有生产组合用例，在首包 acceptance 后用新进程 CLI 验证入口一致性和未授权分支。
- `test/build-workspace-recovery.test.ts` 覆盖领域边界，`verification/` 的本次报告保存真实多仓、TDD 和独立审查结果。

## 1. 固定失败回归

<!-- comet-task-ref:6127efa1-c744-493c-b5d3-af228e61ed50 -->
<!-- comet-task-ref:22a2b9d4-45eb-48e8-9a34-ef81e1137a63 -->

扩展现有两业务仓生产组合验收，在 Run 创建之后、Configure 之前准备源分支，在首包完成后关闭应用。新进程分别执行公开 `run resume` 与 `run next`，比较原 Run、Binding、Plan、1/2 已完成包和下一 Work。记录基线在合法恢复上失败，再补未授权分支、切回和未接受 HEAD 用例。

执行 `node_modules/.bin/vitest.cmd run test/managed-change-execution.e2e.test.ts` 的目标用例，失败必须指向恢复行为差异。

## 2. 统一判定和受保护更新

<!-- comet-task-ref:b3b7225f-5aad-4f22-b32e-697300bbd5ba -->
<!-- comet-task-ref:cf620592-c727-4f43-b1be-92310c94c941 -->

先写领域测试，验证当前 Binding 和最新 checkpoint 可以解释启动后的正常进度，未知分支、路径、远端、仓库集合以及无法由当前 Work 解释的 HEAD 均阻断。未知 invocation 保留原断点，不调用 Host。共同观察与状态更新验证当前 revision，冲突解除时不得清除无关 reconciliation。`resume` 在通用启动快照阻断前使用恢复结论，`next` 在返回当前 Work 和 Build 副作用前使用相同结论。

保持旧 protected Plan correction 的授权规则，实际授权修正可进入 Configure，未授权变化不能通过 Configure 自动替换绑定。CLI 续行指令使用有效恢复状态。

执行领域和生产组合回归，再运行现有 protected-branch、Runtime recovery、执行恢复和架构检查。每次提交后立即 push。

## 3. 真实多仓与交付验证

<!-- comet-task-ref:fb73ee9b-c100-4202-bf9b-ee78b64602ed -->
<!-- comet-task-ref:e762f35d-ed60-4ad0-b9a8-ae45973a8649 -->
<!-- comet-task-ref:e3c8cecb-99ae-4352-951a-d928597f63b0 -->

从候选提交构建 tarball，安装到独立消费者目录。在四个实验业务仓与 Workspace 的独立 checkout 运行两个小工作包。首包完成后分别用新进程调用两个入口，互换调用顺序并重复观察；切换一个业务仓到未授权分支，核对阻断且绑定、计划和工作包没有丢失；切回后完成第二包并核对无重放。

独立审查者核对恢复判定与真实 CLI 路径，修复本范围内缺陷后复验。按 `.comet/check-policy.json` 中的精确 `npm.cmd run verify` 执行正式检查。报告记录安装包、Git 引用、Run 标识、命令和执行结果，清理本次临时配置与调试产物。

## 审查重点

- 新进程必须读取持久 Store，不能靠同一 composition 的内存状态。
- 两个入口顺序互换，不能让第一个入口提前修好第二个入口的缺陷。
- 接受当前 checkout 的权限来自 Binding 与原授权，不能仅凭 HEAD 是快进或分支名称相似。
- 未知 invocation 与已提交结果仍走原核对和 acceptance，重复恢复不能重放工作。
- 过期观察不能覆盖新 revision，解除工作区冲突不能清空无关阻塞。
