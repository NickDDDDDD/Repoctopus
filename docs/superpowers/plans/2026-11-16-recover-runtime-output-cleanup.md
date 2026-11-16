---
change: recover-runtime-output-cleanup
design-doc: openspec/changes/recover-runtime-output-cleanup/design.md
base-ref: b6a33525a3db152eaa8b2547cf930a1d2f0f7391
---

# Build 运行时输出清理恢复实施计划

<!-- comet-task-authority: openspec/changes/recover-runtime-output-cleanup/tasks.md -->

## 1. 复现与前置防护

### 1.1 已安装基线的 RED

<!-- comet-task-ref:31a2399e-563a-405b-b0dd-d38e5b49d194 -->

复用三仓安装包实验，固定同一待执行 Work 和提交前后 OID。对没有改变业务输入的 Workspace HEAD 变化保留公开 CLI 失败输出。

### 1.2 阻止错误跟踪进入 Binding

<!-- comet-task-ref:65d563e2-172e-4e27-828f-67017cc397c0 -->

在 Git adapter 读取 HEAD 和 index，并用已有输入分类选出冲突。Build Configure 的候选接受和最终状态提交都重查。以独立 case 验证误跟踪、按提示清理和故障后的同一 Configure。

## 2. 受管清理进度

### 2.1 纯 Git 清理证明

<!-- comet-task-ref:8b1a6921-d4e7-470f-a686-47ace9286637 -->

在真实本机 Git 仓测试单父删除、业务路径、修改、额外提交、未提交变更、不可读及混合状态。仅在当前 Workspace 的同一绑定 checkout 接纳直接前驱。沿用现有 repository input policy。

### 2.2 同一 Run 的进度接受

<!-- comet-task-ref:bd34d9d8-af6d-4364-bfc6-7fc5ca6b9c7e -->

从共享 Build 恢复入口核对当前持久身份与已批准规划。使用已有 checkpoint 进度函数与 Execute Work 构造器。推进新 checkpoint 和同一包的新 Work，保留其他有效事实。

### 2.3 状态提交和中断

<!-- comet-task-ref:396cbd60-6f74-4129-99c7-a61756060ff5 -->

在 Run Store 同一守卫提交复核原 blocker、revision、调用和 Git 证明。原调用未知仍走原恢复入口。并发、日志中断和重放的断言覆盖轨迹和 checkpoint，失败不写入接受事实。

## 3. 包验收与说明

### 3.1 真实三仓冷恢复

<!-- comet-task-ref:654cfd4c-837b-4808-a980-08ab4954fb29 -->

以实际 Windows 安装包、真实 Git 仓及独立 bare remotes 覆盖冻结前阻断和冻结后采纳。绑定受影响的精确前驱，使用新 CLI 进程核对同一 Run、已完成包、下一 Work、混合提交和后续 Verify。

### 3.2 证据登记和回退边界

<!-- comet-task-ref:463c0bce-9ae8-4493-b25d-fc5247e2a885 -->

更新 Runtime 状态说明，记录确切安装包、CLI 证据和独立审查。保持遥测维度有界。检查 Comet 来源摘要与包级验证。兼容或 Git 证明失败时，由原绑定守卫停止，保留现有现场给后续核对。
