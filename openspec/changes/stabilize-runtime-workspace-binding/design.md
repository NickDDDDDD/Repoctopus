# Design

## Context

参见 [proposal.md](./proposal.md) 的动机。本次验收暴露的顺序是：`startChange` 先创建稳定 Run 和 Open Work，Open Outcome 被 Host 接受后才由 Specification planning branch 校验发现 source 与 target 相同；一个宽泛 `catch` 又把所有 inspection/validation 错误投影为 `open-observation-unavailable`。调用方随后切换分支并重放 `run start` 时，Coordinator 恢复旧 Run，而 Service 仍用新 snapshot 构造并记录候选 Work，触发“Created Work is not the Runtime-selected current Work”。

Project snapshot 同时包含稳定语义和易变事实：repository identity、branch 与 topology 可参与启动绑定，HEAD、worktree digest、path 和 captured time 会在正常开发中变化。若直接把整个 snapshot digest 当作幂等启动身份，任何代码修改都会错误地产生冲突；若完全忽略 snapshot，又无法识别分支切换和仓库替换。

Comet 0.5.1 的可借鉴原则是：workspace preparation/validation 先于 Run；Run 绑定固定 workspace identity 和 revision；恢复使用原 Action/checkpoint；只有外部结果未知才 reconciliation。Repoctopus 保持自己的多仓与职责边界：Runner 准备 checkout，Runtime 校验和冻结语义，不引入 Comet SDK 或让 Runtime 执行 Git switch/worktree。

## Goals / Non-Goals

**Goals:**

- 在 Run Store 第一次写入前拒绝 detached HEAD、source=target 和不匹配的 Workspace Repository identity。
- 以排除正常代码变化的 semantic binding identity 区分新建、幂等恢复和冲突。
- 让 Service 只对真正新建的 Run执行初始 Work/Skill 记录，恢复路径完全采用 Store 中的 current Work。
- 让 Open observation retry 复用原 Outcome/attempt/invocation，并把确定性无效与不可判定错误分开。
- 用生产边界黑盒测试证明“失败时没有幽灵 Run、恢复时没有重复 Host”。

**Non-Goals:**

- Runtime 不创建、切换、删除或回收 branch/worktree。
- 不为开发期已卡死的 Run 增加兼容迁移或直接 Store 修复；它们保留为只读缺陷证据。
- 不解决 OpenSpec Store 首次初始化、CLI adapter 默认值和 consumed-layer 文案问题。
- 不增加后台 daemon、轮询器或第二套生命周期。

## Decisions

### 1. 用纯领域值对象表达启动绑定，而不是复用完整 ProjectSnapshot digest

新增版本化 `ChangeStartBinding` 纯值对象，由 Workspace Repository snapshot 与已经解析的 target branch facts 派生。它包含：Workspace Repository id、规范化 remote identity、attached source branch、target remote identity、target branch，以及按 repository id + remote identity 计算的 topology identity；不包含本机 path、HEAD、worktree 状态和时间。构造器返回稳定 digest，并以受限错误码拒绝：

- `workspace-repository-missing`
- `source-branch-detached`
- `source-target-equal`
- `remote-identity-mismatch`
- `repository-topology-mismatch`

`startChange` 在 `verifyRoot`、Workspace Repository 定位与远端 target branch observation 完成后立即派生该值；失败发生在 runId 可计算但 Run Store 尚未 initialize 的位置。`ChangeStartBinding` 放入 `change.open` trigger facts，因此 Coordinator 现有 trigger identity/CAS 可以冻结它。

选择该方案而不是比较完整 snapshot，是为了允许同一 branch 上正常的 HEAD、dirty 状态和多仓实现进展；选择它而不是只比较 branch 字符串，是为了防止仓库 remote 或 topology 被替换后误恢复旧 Run。

### 2. `startOrResume` 显式返回 started/resumed disposition

Coordinator 的幂等入口返回 `{ status, disposition }`（或等价的强类型结果），而不是要求 Service 从诊断文案猜测是否新建。`started` 才允许执行初始 Skill snapshot、effective composition、`work.created` 和首次 Desktop activation 记录；`resumed` 直接返回 Store 中的 authoritative lifecycle/current Work。若 workflow、trigger（含 binding）或其他冻结 identity 不匹配，抛出带公共受限 code 的 `RunIdentityConflictError`，CLI failure envelope 保留该 code。

正常开发后的完整 ProjectSnapshot 可以用于 `resume` 的 drift observation，但不作为 `run start` 的 binding identity。这样“同 branch 的内容变化”走原 Run 的恢复/失效协议，“切换 source、target、remote 或 topology”在启动边界 fail closed。

选择显式 disposition 而不是复用 `runtime.idempotent-start` diagnostic，是为了让控制流依赖类型而非展示字符串；选择返回原 status 而不是重新构造候选 Work，是为了消除本次 invariant failure 的根因。

### 3. Open observation 使用分类边界，不按异常文本决定恢复

Open gate 保留三条路径：

1. Provider 成功返回 strict invalid 或 planning artifacts 可确定无效：原子安装唯一 repair Work、递增 epoch、退役旧 execution。
2. Provider/Store/进程暂时失败，无法判断有效性：保留原 Work/Outcome/attempt/invocation，返回 `reobserve` continuation；下一次 `run next/resume` 再调用 observation，不调用 Host reconcile。
3. 原 Host execution 的外部结果未知：只有 Work execution authority 才返回 `reconcile` 并调用 Host reconciliation。

启动 binding 错误在路径 1–3 之前被消除。对于并发或遗留状态仍可能抛出的 branch identity 错误，Specification planning 与启动 binding 共享一个受限 typed error family，Open gate 将其投影为 binding/input conflict，而不是捕获消息文本或误报 Provider unavailable。

选择 `reobserve`（同 checkpoint 内部重试）而不是 `reconcile`，是因为 Provider read 不是原 Host 的未知外部副作用；选择保留成功 Outcome，是为了避免重复消耗 Skill 或重复写入规划工件。

### 4. 观测事实遵循“无 Run 不造 trajectory”

创建前拒绝没有合法 Run，因此通过现有 durable canonical observation outbox 写入 `change.start.preflight`，使用候选稳定 run identity 仅作 Trace/Event 关联，并明确 `run_created=false`；不为遥测初始化 Run Store。已有 Run 的 `start.reused`、`start.conflict`、`open.observation.unavailable|accepted|rejected` 和 `open.reobserved` 从持久 trajectory 映射到同一 outbox。

事件属性使用受控枚举；branch、remote、path、digest 与错误正文只留在本地诊断或领域对象，不进入 Metric label。OTLP export 失败不改变 preflight 或 Run 结果。

### 5. 验证以失败路径的持久副作用为核心

测试分三层：

- 领域测试：相同输入得到相同 binding digest；易变 HEAD/worktree/path 不改变 binding；branch/remote/topology 改变会改变或拒绝 binding。
- Service/Coordinator 测试：source=target 在 Store initialize 前失败；新建只记录一次初始 Work；等价重放返回同 Work；binding 漂移返回 typed conflict且 checkpoint/trajectory 不变。
- 生产 CLI/Provider 黑盒：临时多仓 fixture 从 target branch 启动失败且没有 Run 目录，切换公开 feature branch 后成功；接受一次 Open Host Outcome，注入一次 Provider unavailable，再恢复 Provider，证明 invocation/attempt/Outcome 未变化且没有调用 Host reconcile。

Telemetry 测试把 outbox envelopes 与 trajectory 对齐，并断言敏感字段和高基数值不进入 Metric labels。最终 Evidence 绑定 `npm run verify`、严格 OpenSpec validation、Windows CLI E2E 以及工作区卫生。

## Risks / Trade-offs

- [Risk] topology identity 过宽会让新增业务仓阻断旧 Run，过窄会误绑定已替换仓库 → 只纳入配置权威中的 repository id + normalized remote identity；新增/删除/替换仓库返回显式 conflict，由正式新 Change 或后续迁移协议处理。
- [Risk] `startOrResume` 返回类型调整影响普通 workflow 调用方 → 只改变幂等入口的结果类型，并以编译器逐个迁移调用点；非 Change 的 `start` 保持不变。
- [Risk] Provider error 分类遗漏会把真实程序缺陷当作可重试 → 未识别异常仍 fail closed 为 `observation-unavailable/reobserve` 并保留诊断，但绝不调用 Host reconciliation；测试覆盖已知 binding typed error。
- [Risk] preflight telemetry 自身失败影响启动 → outbox/export 采用 best-effort diagnostic，领域拒绝或成功结果优先，不能因为 OTLP 不可用创建或回滚 Run。
- [Trade-off] 不迁移已卡死的开发 Run意味着验收 change 需在修复后以新 identity 重跑 → 这是预发布阶段避免 Store 补丁和隐藏兼容债的刻意选择，旧 Run继续保留为回归证据。

## Migration Plan

这是未正式发布 Runtime 的破坏性修正，不提供旧 Run schema 迁移。合入后：

1. 使用测试 fixture 验证新的创建前拒绝和幂等恢复协议。
2. 保留当前 `document-web-design-boundary` 卡死 Run 的只读文件与日志证据，不修改其 Store。
3. 重新初始化一次干净验收 Change，验证正确 branch 上的完整 Open→Design 最小路径。
4. 若回归失败，回退本 Change 的代码提交；OpenSpec 规划和旧验收证据不需要迁移或删除。

任何实现发现规范要求与现有 trigger/RunStore 接口无法同时满足，或必须通过写 Store、比较错误文本、重放 Host 才能恢复时，停止 Build 并回到 Design 评审。
