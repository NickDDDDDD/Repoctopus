# Design

## Context

在精确对应 `origin/main` 的 Windows 安装包上，独立 Workspace 与两个业务仓到达首个 `build.execute`。在工作包范围之外的 Workspace 仅执行一笔运行时文件解除跟踪提交后，`resume` 和 `next` 都报告 `unaccepted-head`，保持原 Work。尝试 `work-reconcile` 返回没有需要核对的 Host 调用。这把问题定位到 Build workspace checkpoint 的合法进度采纳。

Comet Classic 0.5.1 的 `classic-branch-binding.ts` 以已绑定 checkout 和分支确定工作区归属。`classic-sdk-revision.ts` 在运行中或结果未知的执行结算后，通过同一 Run 的版本校验完成受限更新，并保留已有执行历史。已核对上游 `78b1b11` 仍保持该顺序。Repoctopus 的逐仓 HEAD 与工作包写集需要额外的 Git 证明。参考固定上游源码 `35c9860b77b42bafa0c2d80d8d695889f888a924`。

## Goals / Non-Goals

**Goals**

- 绑定前识别被跟踪的运行时输出，返回可操作的仓库和路径诊断。
- 受限接纳已绑定 Workspace 的纯清理进度，并保留原 Run 和有效事实。
- 用公开 CLI 验证 Windows 多仓的待执行首包、已完成包、重放、并发和拒绝路径。

**Non-Goals**

- 自动修改开发者的 Git index、提交或分支，扩大工作包写集，或为任意 HEAD 漂移增加允许选项。
- 对历史 checkpoint 引入通用迁移，改变第三方源码、插件绑定或 Release。

## Decisions

1. **同一输入分类。** Build Configure 通过当前组合的仓库输入策略与平台 Git 事实判断跟踪冲突。使用能识别 `runtime-output` 的现有规则，避免把团队允许跟踪的其他路径误报为本地状态。初次检查给出诊断，受保护的 Binding 接受会复核即将绑定的事实。
2. **由 Runtime 证明纯清理。** Git 平台适配器读取 checkpoint HEAD 与当前 HEAD 的祖先关系、提交路径变化及当前 index/worktree。只在当前绑定 checkout 内判定，核对每个变化路径确实是原先跟踪、当前已经不再跟踪的运行时输出。读取不完整、混合变更、历史改写、分支变化及其他仓变化走现有阻断处理。Design 进一步确认可接受的历史形状和对既有 Evidence 依赖的处理。
3. **复用现有 Build workspace checkpoint。** Cordis WorkflowRuns 统一 `resume` 与 `next` 的观察，在当前 Run 的受保护提交内复核绑定、Work 和 checkpoint。领域层只接受 Runtime 提供的结构化 Git 事实，按原恢复身份推进 workspace checkpoint。Engine 继续提供现有事务边界，Git adapter 负责检查仓库，Host Outcome 不增加 Git 权威。
4. **保留原执行和依赖。** 执行结果未知时先处理原 invocation。清理不授予产品写权限。若某项已接受事实确实声明了变化的 Git 输入，按现有精确失效规则处理。重复 pull 采用已接受 checkpoint。

## Risks / Trade-offs

- 误将混合提交归为清理会绕过 Build 写集。回归覆盖业务修改、普通文件删除、历史改写、其他仓漂移、未知执行与提交时观察变化。
- 确保任一捕捉到的前置问题都能在原 Run 从新进程重试。冻结后的实验用有据的旧包与候选对比，沿用现有 Runtime 兼容性入口或受管夹具覆盖合法历史状态。
- 诊断在 CLI 给出必要路径，持久审计记录采用有界原因和 Git 身份，OpenTelemetry 按现有恢复事件验证，路径与 OID 不作为指标标签。
- 如果实施观察与正式规格、Design 或接口权威发生冲突，在对应阶段复核后再继续。
