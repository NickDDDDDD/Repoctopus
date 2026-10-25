# Design

## Context

参见 `proposal.md` 的 Why。当前实现有三条彼此未闭合的链路：`WorkContextAssembler` 能生成含正文的上下文，`WorkDispatcher` 只把 identity 保存进 `ActionIntent`，外部 Agent 再自行使用文件/终端完成工作。结果是 Runtime 能审计 claim 和 Outcome，却没有一个生产端口证明 Agent 收到并消费了完整上下文。

Comet 0.5.0 固定提交 `aeb1a6598034e28ce46b8422d4dbd8785e607bd7` 提供两个关键参考：`applicationSkillWork` 向宿主交付真实 Skill files，`createApplicationSkillExecutor` 在统一 preflight 后调用 `host.invokeSkill`。Repoctopus 不复制其 Workflow Application 产品外壳，而在现有 Cordis、WorkDispatcher、多仓 scope 和 Specification Provider 边界内实现等价端口。

本 Change 的 G1 Run 已在实现前启动并停留在旧 definition 的 Open。它证明我们没有再次在代码完成后才补建 Run，但旧 definition 没有 Open Work，且后续代码会改变 definition/composition，所以 G1 只能作为 bootstrap 历史，不能作为新协议的成功证据。

## Goals / Non-Goals

**Goals:**

- 让 lifecycle Work 从“可记录”变成“可由受管 Host 执行”，且完整上下文在首次副作用前交付。
- 让 Open、Design、Build、Verify、Archive 的内置 Work 都有生产可达路径和确定的推进依据。
- 保持 OpenSpec 四类工件、Tasks、strict validation 与归档为唯一规格权威。
- 让 Host 可替换且不把模型厂商或 IDE 引入 Engine。
- 用黑盒捕获 Host 和进程外 CLI/Application 协议证明正文消费、事件顺序、恢复与拒绝路径。

**Non-Goals:**

- 不实现通用自主 Agent、模型选择、会话 UI 或厂商 API Adapter。
- 不把 Repoctopus 描述为操作系统沙箱；任意未受管进程仍可能写文件，但不能取得受管成功事实。
- 不恢复 Webhook、后台 daemon 或等待 MR 合入模型。
- 不继续 Windows Dashboard 功能；该 Change 只保证后续 Dashboard 有可信 Work/Agent 状态可展示。

## Decisions

### 1. 将持久身份与短生命周期执行内容分离

新增版本化 `WorkExecutionPacket`：

```ts
interface WorkExecutionPacket {
  schemaVersion: 1;
  intent: ActionIntent;
  work: WorkDescriptor;
  context: WorkExecutionContext;
  hostRequirements: {
    action: 'invoke-skill' | 'call-tool';
    capabilities: readonly string[];
  };
}
```

`WorkExecutionContext.layers` 继续包含真实 content。`ActionIntent.executionContext` 只保存相同 schema、layer identity 与 digest。`WorkDispatcher.claim()` 先由 ActionDispatcher 持久化 intent，再返回 packet；任何序列化失败都不得留下“已交付”事实。Packet 不进入 RunStore、ActionStore、Trajectory、日志或 OTLP。

选择这种分离，而不是把正文写进 ActionIntent，是因为 Skill、模板和 change 输入可能很大或包含仅允许当前执行者读取的信息；恢复只需要冻结 identity，再由原 Provider 重新解析并逐层核对。

### 2. 新增 Host Registry 与 ManagedWorkExecutor 深模块

Cordis 增加两个产品 Service：

- `WorkExecutionHosts`：注册、撤销、唯一选择 `WorkExecutionHost` Contributor，并生成 composition identity。
- `ManagedWorkExecutor`：拥有 claim → assemble → preflight → invoke → outcome 的完整用例；外部入口不得自行拼接这些步骤。

Host 端口保持窄接口：

```ts
interface WorkExecutionHost {
  id: string;
  identity: LifecycleContributorIdentity;
  capabilities: readonly string[];
  supports(packetIdentity: WorkExecutionPacketIdentity): boolean;
  authorize(input: WorkHostAuthorization): Promise<boolean>;
  invoke(input: Readonly<WorkHostInvocation>): Promise<WorkHostResult>;
  reconcile?(input: Readonly<WorkHostReconciliation>): Promise<WorkHostResolution>;
}
```

`ManagedWorkExecutor.execute()` 是唯一会调用 `host.invoke` 的入口。它在调用前重新加载 Run/current Work、核对 intent、composition、definition、Skill/Provider digests 和 Host 能力。Host 返回值仍经过 ActionDispatcher、Work Validator 和 phase transition，Host 无权直接完成 Task 或改变 Run。

不把 Host 合并进现有 Work Contributor：Contributor 表达副作用适配和所需能力，Host 表达“谁调用 Agent”。二者生命周期、恢复和安全诊断不同；合并会再次把“能接收 Outcome”误当成“真的执行过 Agent”。

### 3. 外部 Host 使用相同 packet 协议，不用 manual success

公共 Application Service 提供：

- `run.work.claim`：返回完整 packet，供进程外 Host 领取；不再只返回 ActionIntent。
- `run.work.execute`：选择已注册的进程内 Host 并完成完整纵切。
- `run.work.outcome`：仅接受带 Host invocation identity 的结果；保留一个明确的 migration/manual-adoption 路径，但它不能产生 managed execution 事实。

CLI `run work-claim --json` 可以成为 IDE/Runner 的进程外 Host 协议，但输出由调用者负责保密，不写入日志。普通人手工执行命令不会被标记为 `host-invoked`。后续 Codex/OpenCode 插件通过同一 Application Service 接入，不需要修改 domain。

### 4. 执行会话把 Guard 与 Host 调用关联起来

新增短生命周期 `WorkExecutionSession`，至少包含 `runId/workId/attempt/claimToken/contextDigest/hostId`。`ManagedWorkExecutor` 在 `host.invoke` 期间激活会话，finally 中撤销。Command Router、Specification、repository/process/Git/platform protected operation 从显式调用上下文读取 session，并交给现有 `RuntimeWorkGuard`。

不使用全局可变“当前 Work”，避免并发 Runner 和异步调用串线；进程内使用显式 invocation context 或 AsyncLocalStorage 只携带不可变 session identity，真正授权仍重新读取持久 claim。进程外 Host 每次受保护调用必须提交 session token，应用边界核对后才执行。

Guard 不是 OS 沙箱。直接 `fs.writeFile` 或外部 shell 仍可能改变文件，但没有 session 的变化只能被 Git/Provider snapshot 观察为 drift，不能产生 Receipt 或 Validator success。

### 5. Repoctopus-owned 阶段 Skill 与 Provider 指令分层

新增只读内置 `repoctopus-lifecycle` Skill Provider，提供：

- `repoctopus-open-change`
- `repoctopus-design-change`
- `repoctopus-build-task`
- `repoctopus-verify-change`
- `repoctopus-archive-change`

这些 Skill 只描述阶段协议、停止条件、输入/输出和 continuation，不复制 OpenSpec 模板。当前 Specification Provider 通过扩展后的 `phaseContext()` 返回官方 instructions/template、artifact kinds、allowed operations 和 digest。装配顺序保持：Runtime contract → action Skill → Provider protocol → augmentations → Method Profile → change inputs。

Build 的 action owner 改为 `repoctopus-build-task`，`tdd` 与 `codebase-design` 是 augmentation；Verify 的 action owner 改为 `repoctopus-verify-change`，`code-review` 是 augmentation。这样阶段协议拥有产物和 continuation，方法 Skill 不会意外成为工作流 owner。

### 6. 让五阶段 Work 真正可达

内置 definition 升级版本，保留五个 phase，但只声明真实可创建的 Work：

| Phase   | 当前 Work / 决定                               | action Skill                      | 推进依据                                          |
| ------- | ---------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| Open    | `change.intake`                                | `repoctopus-open-change`          | Provider 验证 change metadata/root 后的 Validator |
| Design  | `specification.plan`                           | `repoctopus-design-change`        | Provider strict validation 后的 Human Decision    |
| Build   | `task.implement`                               | `repoctopus-build-task`           | Outcome + task Validator + Provider checkbox 更新 |
| Verify  | `evidence.verify`                              | `repoctopus-verify-change`        | Host review Outcome + Acceptance/Evidence Gate    |
| Archive | `specification.close`，随后 `delivery.publish` | `repoctopus-archive-change`，`pr` | Closure/Publication Receipt                       |

删除当前不可达的 `specification.decision` Work；Human Decision 是 wait condition，不伪装成 Agent Work。`next()` 不再自动提交 Open intake。Design assessment 不完整时创建/保持 `specification.plan`，而不是只写 blocker。Verify 自动命令仍由 Evidence Coordinator 执行，但必须在 Verify Host Outcome 被接受后才开始，避免把自动测试成功当成 Agent 已审查。

### 7. Fresh 与 adopt-existing 是创建时冻结的事实

`StartChangeRunInput` 和 trigger facts 增加 `mode: 'fresh' | 'adopt-existing'`，默认 fresh，并纳入 runId identity input、trigger digest、projection 和 telemetry allowlist。

- fresh：Provider 发现预勾选且无当前 Run Receipt 的 Task 时返回 adoption conflict；不能创建 imported claim。
- adopt-existing：用户显式确认后，Runtime 保存来源 snapshot 和 imported claims；它只跳过重复 Build，不跳过 Verify。

现有历史 Run 保持旧语义，不在原 generation 下重解释。迁移 planner 对活动旧 Run 返回 `migration_required` 或要求新 generation；不会批量改写已有 Run 文件。

### 8. 可达性检查属于 definition/composition 验证

为每个 Work definition 建立静态 registration：creator id、允许 Host action、Contributor capability、Validator id。builtin validation 必须证明：

1. phase 引用的每个 Work 在 registry 中存在；
2. 每个 Work 有至少一个生产 creator；
3. action Skill 可由 active Provider 唯一解析；
4. 至少一个 Host contract 可以支持其 action kind；
5. Contributor capabilities 覆盖 Work；
6. Validator 已注册且 transition 消费其事实。

这不是通用 Capability Resolver；它只验证 lifecycle 已声明的四类 Contributor/Provider 关系，并进入现有 composition snapshot。

### 9. 测试以消费者和事件顺序为验收中心

测试分四层：

1. Domain：packet identity、Host selection、session scope、fresh/adoption transition。
2. Contract：完整 content 与 identity 对应、恢复漂移、Outcome host identity、definition reachability。
3. Production composition：显式注入 `CapturingWorkExecutionHost`，但使用真实 Skill Registry、OpenSpec Provider、ActionStore、RunStore、Command Router、Guard 和 Validator。
4. 进程外黑盒：临时 Git Workspace 从不存在的 change 开始，通过打包 CLI/Application Host 协议执行 Open → Design → Build → Verify → Archive；捕获 Host 把收到的 packet 写入测试私有内存/有界 fixture，不把正文写入产品 Store。

关键事件序列必须可断言：

```text
claim.persisted
→ context.delivered
→ host.invoked
→ protected-operation.accepted
→ outcome.persisted
→ validator.accepted
→ lifecycle.transitioned
```

负向测试覆盖 identity-only packet、正文未读取、首次写入早于 delivery、无 Host、双 Host、Skill 漂移、Provider 指令漂移、session 过期、越仓写入、伪造 Outcome 和 fresh imported claim。

## Risks / Trade-offs

- **[外部 IDE 仍可绕过 Repoctopus 直接改文件]** → 明确区分 managed success 与 drift；正式 Host 只暴露受保护工具，黑盒测试证明旁路不能产生 Receipt 或推进事实。
- **[完整 packet 通过 CLI stdout 泄漏]** → 默认文本输出只显示 identity；只有显式 JSON/Host 协议返回正文，CLI 禁止日志记录 packet，并加入红action测试。
- **[阶段 Skill 与 Provider instructions 冲突]** → 阶段 Skill 不拥有模板内容；definition validation 检查 artifact protocol owner 唯一，冲突在 claim 前失败。
- **[旧 Run 因 definition/composition 升级不可恢复]** → 不静默升级；保留只读状态，使用 migration planner 或新 generation，并记录关联。
- **[Host 调用中断导致是否执行未知]** → claim 和 session identity 先持久化；有 reconcile 的 Host 核对原调用，无 reconcile 时保持 unknown/manual repair，不自动重发外部副作用。
- **[黑盒 Host 仍可能只是高级 mock]** → 捕获 Host 只替代模型推理，不替代生产服务；它必须通过公共 Host Contributor、真实 packet、真实 Guard/Provider/Store 完成文件纵切，并验证实际文件结果。

## Migration Plan

1. 保留 G1 bootstrap Run 在旧 definition 的 Open，不调用旧 `next()`；记录它无法证明新协议。
2. 先实现 packet、Host registry/executor、阶段 Skill Provider、Open/Design Work 和 black-box capture Host 的最小纵切。
3. 升级 definition/composition 后，让 G1 明确显示 contributor/definition drift；以新 generation 和 `adopt-existing` 接管已完成的 bootstrap 任务，剩余实现任务通过新 Host 协议执行。
4. 在临时 Workspace 创建完全 fresh 的独立 Change，逐阶段运行到 Archive，作为 Open/Design/Build/Verify/Archive 的正式行为证据。
5. 运行完整 verify、package E2E 和 tracer E2E；更新正式验证报告与现有规格，之后才允许恢复 Dashboard Change。
6. 回退时可以移除新 Host/Skill plugins 并恢复旧 CLI，但新 definition generation 不允许用旧 Runtime 继续写；只读检查保持可用。
