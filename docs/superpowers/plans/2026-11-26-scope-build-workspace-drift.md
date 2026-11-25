---
change: scope-build-workspace-drift
design-doc: openspec/changes/scope-build-workspace-drift/design.md
base-ref: c0ff030035e40c2a7cbc76035b6bc8d2077e7bbe
---

# 多仓 Build 工作区漂移恢复

<!-- comet-task-authority: openspec/changes/scope-build-workspace-drift/tasks.md -->

## 1. 真实 Git 回归与输入边界

<!-- comet-task-ref:00eeee26-8802-43bf-8131-21e5bb1591ce -->
<!-- comet-task-ref:a4b03b35-e844-4f7f-9f88-2ddf58bd424a -->

扩展现有 Windows 安装包的隔离多仓 Host。分别在框架工作包外推进已登记只读仓、在某包外向 Backend 提交可核验的业务改动，同一 Run 由全新进程恢复。记录当前 Runtime 在续跑或 Outcome 拒绝处的失败、真实 OID 和冻结 checkpoint。保留已批准包依赖与发布授权的边界，使用既有真实 Git fixture 覆盖相关输入、分支切换和无法观测。

## 2. 一致的 Runtime 恢复与 Archive 校验

<!-- comet-task-ref:f04ef1a9-1c51-42a4-866b-0154830d2b25 -->
<!-- comet-task-ref:6a8d1740-bd32-44ec-8876-9db430784db3 -->
<!-- comet-task-ref:f1c147d9-9c78-458e-8d5d-c6175a0fb9d0 -->
<!-- comet-task-ref:3f4afe50-a396-41dd-b49d-8126ccb411ba -->

从现有 execution workspace service 观察绑定身份、Git 对象、祖先和干净状态，在领域判定中区分受管写入、已证实的无关快进、已知依赖变化和未知。使两个继续入口与 Execute Outcome、Build Check 和 Verify 准入消费同一规则。保留受管 checkpoint 与相关证据的身份，复用 Run 版本守卫、受管 Work 派发和依赖传播。失败保留原状态，检查可能重复的副作用与错误路径。Archive 以批准策略和实际 Git base/head 核对源端独有提交及 PR 差异，复用冻结发布坐标。受管实现事实不能涵盖外部提交，目标未包含时阻断混入。保持既有规划、Workspace 清理与 Verify 配置特殊发布路径。

## 3. 实际候选包及正式验收

<!-- comet-task-ref:27901fb0-8bd8-479b-bc51-a4dba75a9b8c -->
<!-- comet-task-ref:1cf5b00d-249f-46b3-af85-e58cbbfe1444 -->

在 Windows 通过 npm 安装候选 tgz，验证两条 Issue 的断点冷恢复、复用完成项以及实际 PR 差异。验证真实输入变化的失效范围、相关安全边界，保留丢响应恢复验收。同时运行领域与生产组合测试、全量 Verify 和独立审查，报告各个执行结果和限制。
