# Comet Design Handoff

- Change: recover-build-host-capability-drift
- Phase: design
- Mode: compact
- Context hash: 0aa7d0d5bc4bd0ecaca514bfd5dda4efd62c211b5febfff5a5ec78b2c0062f59

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/recover-build-host-capability-drift/proposal.md

- Source: openspec/changes/recover-build-host-capability-drift/proposal.md
- Lines: 1-59
- SHA256: b190bc79dbc4ab7405e0f99bdb1c48436443077f447b79f99cbb93b2eb282982

```md
# Proposal

## Why

真实多仓验收揭示的不是缺少一个 `capability drift` 分支，而是两套能力身份同时存在：`ExecutionBinding` 把 Configure 时观察到的完整 Host capability digest 当作整个 Build 的长期身份，外部 Work claim 又只要求 Host 满足当前 Work。两条规则分别合理，组合后却把合法的只读 `build.plan` claim 错判为 Binding 漂移，并在 Plan submission 已持久化后抛出 `Execution Binding requires process.execute, repository.write`。

这次不能继续增加异常捕获或 Configure 回退。Comet 0.5.1 的成熟边界是：每个 Action 声明自己的 required capabilities，Runtime 在持久化 claim 前完成预检，Outcome 绑定原 claim；未知外部结果恢复原 Action，不用一份全局 capability digest 重新解释已经合法领取的 Action。Repoctopus 应采用这一不变量，同时保留自己的多仓 Workspace Binding、Build Strategy 和 Runtime-authoritative Work。

## Historical Failure Chain

| 历史 Change                                     | 当时解决的问题                                                         | 遗留或引入的冲突                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `separate-build-strategy-and-execution-binding` | 把稳定 Strategy 与机器 Binding 分离，并支持 Binding 自动重验           | 把 Configure 时的完整 capability digest 放进长期 Binding 语义，错误地跨 Work 固定能力集合       |
| `repair-build-configure-capability-contract`    | 防止能力不足的 Configure Host 建立不可执行 Binding                     | 让 Configure Work 声明整个 Build 的完整能力，进一步强化了全局能力快照                           |
| `stabilize-external-host-capabilities`          | 让外部 Host 只以明确声明的能力领取当前 Work，并在 claim 前拒绝缺失能力 | 正确引入 Work-scoped claim，却没有同步删除 Plan、Execute、Check 对全局 capability digest 的依赖 |
| `repair-build-plan-validation-retry`            | 在 candidate 校验失败后保留 claim、packet、invocation 和 submission    | 恢复边界位于 result validator 内；本次异常发生在进入 validator 前，因此无法生效                 |

现有单元测试分别证明了 Configure 需要完整能力、claim 需要当前 Work 能力和 candidate rejection 可以纠正，但没有覆盖“完整能力 Configure → 同 Host ID 的最小只读 Plan claim → Plan submission → `run next`”这一外部 Host 纵向旅程。嵌入式 E2E Host 在每个 Work 都声明同一能力超集，也掩盖了合同冲突。

## What Changes

- 把当前 Work 的 `requiredCapabilities` 设为 claim 能力的唯一权威；Runtime 必须在持久化 claim 和 Host invocation 前完成预检。
- 从 `ExecutionBinding` 的语义身份、Plan Evidence 和漂移判定中移除当前 Host capability digest。Binding 继续拥有 Workspace、repository、branch/worktree ownership、local overlay 和需要时的协调 Host identity。
- Configure 只验证当前 Configure Work、批准 Strategy 与多仓 Workspace Binding，不再要求 Configure claim 重复声明未来 Execute/Check 的全部能力。
- Plan、Execute 和 Check 的 Outcome 只按原 claim、packet、attempt、input digest、invocation 和 submission identity 验收，不因其能力集合不同于 Configure claim 而返回 Configure。
- 当前 Work 缺少能力时保持未 claim 的结构化 blocked continuation；已经 claim 且外部结果未知时只 reconcile 原 Work，不能新建 Work、重配 Binding或重放副作用。
- 增加外部 Host 的完整纵向合同测试、入口对称性测试和未知结果恢复测试，防止 claim、Outcome processor 与 Binding validator 再次形成三套不一致规则。
- 将预发布持久化协议一次性切换到新的 Binding schema；旧 Run 只返回 `migration_required` 诊断，不维护错误模型的双读或兼容层。保留 round4 Run 作为失败证据，并用修复后的产品启动相同验收场景。

## Capabilities

### Modified Capabilities

- `managed-work-execution`：以 Work-scoped capability preflight 取代全局 Binding capability identity，并统一 claim、Outcome 与未知结果恢复边界。
- `change-lifecycle`：限定 Configure 与 Binding 的职责，防止合法 Work capability 变化重建 Build Protocol。
- `development-telemetry`：区分 Work claim capability rejection、Host availability blocked 与真正的 Binding drift。

## Non-Goals

- 不放宽当前 Work 的 capability、write scope、side-effect 或 Host authorization 门禁。
- 不允许 Agent、Runner 或 Host 直接选择 phase、修改 Strategy 或更新 Binding。
- 不实现后台调度器、任意 Host 热迁移或多 Runner 负载均衡。
- 不把 Configure 时“看见过某能力”当作未来能力可用性的保证。
- 不恢复或重放 round4 的旧 Plan candidate；它只作为旧协议失败证据。

## Upstream Reference

固定 Comet 0.5.1（commit `35c9860b77b42bafa0c2d80d8d695889f888a924`）提供以下采用边界：

- `domains/engine/runtime-action.ts`：Action 持有 `requiredCapabilities`，claim/outcome 以 Action identity、attempt、input hash 和 claim token 关联。
- `domains/engine/runtime-service.ts`：Runtime 在写入 claim 前执行 capability 与 executor preflight。
- `domains/workflow-application/skill-executor.ts`：Executor 明确公开能力并只执行 Runtime 已 claim 的当前 Action。
- `test/domains/workflow-application/external-recovery.test.ts`：未知外部结果保留原 Action；只有权威证据证明未执行时才允许重试。

Repoctopus 独立实现这些不变量，不复制 Comet 的单仓状态布局、SDK 源码或 Skill 产物。

## Third-Party and License

本 Change 只参考 Comet 的公开行为不变量，不复制第三方源码、不新增依赖，许可证边界不变。

```

## openspec/changes/recover-build-host-capability-drift/design.md

- Source: openspec/changes/recover-build-host-capability-drift/design.md
- Lines: 1-171
- SHA256: 6f0658f639f51d561beeb9a417f24c87862c113175899f9e96e0376cda5bf40e

[TRUNCATED]

```md
---
comet_change: recover-build-host-capability-drift
role: technical-design
canonical_spec: openspec
status: draft
---

# Design

## Bottom Line

Repoctopus 必须使用一套能力权威：Work 描述所声明的 required capabilities。`ExecutionBinding` 不再把 Configure invocation 的完整 capability digest 当作所有后续 Work 的身份。Runtime 在 claim 前验证当前 Work，在 Outcome 时验证原 claim，在外部结果未知时恢复原 claim；只有 Workspace、Host coordination identity 或 repository binding 真正变化时才重建 Binding。

## Context

当前实现同时维护三种能力判断：

1. `createExecutionBinding()` 要求 Configure Host 同时具备 execution mode、`process.execute`、`repository.read`、`repository.write` 和 `specification.read`；
2. `claimExternal()` 只验证本次 Host 声明覆盖当前 Work capabilities；
3. Plan、Execute 和 Check 在处理已提交 Outcome 时，用本次 invocation capabilities 重建 Execution Binding并比较 Configure 时的 capability digest。

`stabilize-external-host-capabilities` 正确修复了第 2 条，但没有更新第 1、3 条。结果是 Plan claim 可以合法建立，Plan submission 也可以持久化；`executionBindingDrift()` 随后把只读 Plan invocation 传给要求完整 Build 能力的 `createExecutionBinding()`，在它返回 `capability` 分类之前先抛异常。

`repair-build-plan-validation-retry` 无法覆盖该路径。它只在 Work result validator 判断 candidate 可纠正时记录 rejected submission；当前异常发生在 validator 之前。`separate-build-strategy-and-execution-binding` 的自动 revalidation 也无法覆盖，因为 classifier 本身依赖会抛异常的 Binding constructor。

## Comet Boundary

固定 Comet 0.5.1 不持久化一份跨 Action 的完整 executor capability digest：

- 每个 Runtime Action 声明 `requiredCapabilities`；
- claim 先计算候选状态并执行 capability/executor preflight，成功后才写入 Run；
- claim 保存 executor、session 和 token，Outcome 以 Action、attempt、input hash 和 token 返回；
- executor 抛错或返回结果未知时，Runtime 保留原 Action ownership并要求 reconcile；
- 后续 Action 重新执行自己的 capability preflight，不用前一 Action 的能力集合判定漂移。

Repoctopus 需要额外保留多仓 `ExecutionBinding`，但该差异不要求把 capability snapshot 放进 Binding 语义。Binding 负责“在哪里、以哪个协调身份工作”，Work 负责“当前动作需要什么能力”。

## Goals

1. 让 claim、Host invocation、Outcome acceptance 和 recovery 使用同一个 Work capability contract。
2. 保留 Build Strategy 与多仓 Execution Binding，但删除跨 Work 的全局 capability identity。
3. 保留 claim、packet、invocation、submission 和未知执行事实，不用 Configure 回退掩盖合法 claim。
4. 用真实外部 Host 纵向测试证明 Configure、Plan、Execute 和 Check 的入口对称。
5. 在预发布阶段破坏性切换错误 schema，不留下双读、兼容 adapter 或隐式 fallback。

## Non-Goals

- 不改变 Build Strategy 的 execution/TDD/review/isolation 语义。
- 不允许能力不足的 Host 领取 Work或执行工具副作用。
- 不让 Plan Host 静默更新 Workspace Binding或协调 Host identity。
- 不保证任意时刻都存在能够领取下一 Work 的 Host；无兼容 Host 是合法 blocked 状态。
- 不在本 Change 中实现 Host 调度市场或后台 daemon。

## Decisions

### 1. Work capability contract 是唯一能力权威

每个不可变 `WorkDescriptor` 继续声明完整的 `capabilities`。Runtime 必须在创建 authoritative claim 前比较 Host 明确声明的能力与当前 Work requirements：

- 完整覆盖：持久化 claim、packet 和 invocation；
- 缺失能力：不持久化 claim或 invocation，返回 `executor-required`/`capability-required` continuation；
- 重复请求：对同一 current Work 和同一 claim identity 幂等；
- 调用方不得通过省略 `hostCapabilities` 让 Runtime从 Work requirements 推断 Host 实际能力。

Configure、Plan、Execute 和 Check 使用同一个 preflight helper。任何入口绕过该 helper 都是架构测试失败。

### 2. ExecutionBinding 不拥有 capability snapshot

`ExecutionBinding` 的下一 schema 保存：

```ts
interface ExecutionBinding {
  schemaVersion: 3;
  bindingId: string;
  revision: number;
  strategyDigest: string;
  coordinatorHostId: string;
  repositories: ExecutionBindingRepository[];
  semanticDigest: string;
  stateDigest: string;

```

Full source: openspec/changes/recover-build-host-capability-drift/design.md

## openspec/changes/recover-build-host-capability-drift/tasks.md

- Source: openspec/changes/recover-build-host-capability-drift/tasks.md
- Lines: 1-76
- SHA256: e7db53e7282e230ae4cfdbfa5afa5a99a6e1ad83b03458eae665cffbc8416222

```md
# Tasks

## 1. Freeze the conflicting historical contracts

- [ ] 1.1 为四个历史Change建立characterization matrix，锁定Binding capability identity、Configure全量能力、外部Host精确声明和Plan correction各自的现有行为。 <!-- comet-task:0a8c7088-c1e8-4a09-9f7c-33c269824f5e -->
      **Blocked by:** none
      **Acceptance:** 测试和设计证据明确指出每条规则的owner、输入、持久化事实和失效边界；不得只记录commit message
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [ ] 1.2 使用公共外部Host协议固定真实RED：Configure成功后，相同Host ID以Plan最小能力claim并提交candidate，`run next`在Plan validator前抛出完整Binding能力异常。 <!-- comet-task:40d4a113-a339-4b5e-8350-52448f19ea84 -->
      **Blocked by:** 1.1
      **Acceptance:** fixture断言claim、packet、invocation和submission均已持久化，异常来自全局Binding能力重建；测试不修改Store、不匹配完整人类错误全文
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [ ] 1.3 固定测试盲点：证明嵌入式E2E Host在每个Work声明能力超集，而既有外部Host测试只覆盖claim、不覆盖Outcome processing。 <!-- comet-task:b33d75b1-b5e0-43e9-b174-18653731e251 -->
      **Blocked by:** 1.2
      **Acceptance:** 新回归必须在缺少任一侧时失败，防止单元测试分别通过却纵向合同再次冲突
      **Requirements:** change-lifecycle#build-configuration-只允许受支持的固定策略

## 2. Establish one capability authority

- [ ] 2.1 破坏性升级ExecutionBinding schema，删除Host capability digest、Plan Evidence host capability digest和对应serializer/fixture/compatibility分支。 <!-- comet-task:5961fcea-c280-417f-9900-3c6e816cf2f3 -->
      **Blocked by:** 1.3
      **Acceptance:** 生产代码定向搜索不再存在跨Work capability identity；旧schema活动Run只返回结构化`migration_required`，没有双读或默认值猜测
      **Requirements:** managed-work-execution#buildstrategy-与-executionbinding-使用独立身份
- [ ] 2.2 将Configure Work收窄为当前Action真实所需capabilities，并保持Strategy、Workspace和coordinator Host identity验证。 <!-- comet-task:e28bb111-aeba-443f-9788-6d8bfe6c75ea -->
      **Blocked by:** 2.1
      **Acceptance:** Configure不要求未来Execute的repository/process能力；能力不足仍在当前Configure claim前失败
      **Requirements:** managed-work-execution#build-configure-产生可批准的不可变配置
- [ ] 2.3 统一WorkDispatcher与ManagedWorkExecutor的pre-claim capability validator，禁止从Work requirements反向补齐Host声明。 <!-- comet-task:cfd4ea4f-d1fb-48d3-bcc6-89ea93e7bed6 -->
      **Blocked by:** 2.2
      **Acceptance:** Configure、Plan、Execute和Check共享同一helper；缺失能力时claim、packet ownership和invocation计数均为零
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域

## 3. Align Outcome and recovery semantics

- [ ] 3.1 删除Plan、Execute和Check Outcome processing中的capability-based Binding rebuild，只保留原claim身份与Binding-owned事实验证。 <!-- comet-task:52d11eab-cc19-4341-9721-94a7265daf1e -->
      **Blocked by:** 2.3
      **Acceptance:** Plan最小能力submission进入原validator并产生唯一Plan revision；不创建Configure Work或第二个Plan Work
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [ ] 3.2 统一三个入口的Outcome acceptance顺序和共享helper，保留candidate correction与processing-error边界。 <!-- comet-task:0eeed472-c996-4b9b-9b64-60282c15d9fc -->
      **Blocked by:** 3.1
      **Acceptance:** Plan、Execute和Check不再维护独立能力顺序；candidate rejection保留同一claim，程序错误继续fail closed
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [ ] 3.3 对齐Comet unknown execution恢复：reconcile原claim，仅在权威未执行证据后允许受控retry。 <!-- comet-task:530dc513-95c6-4c56-af8c-f3ee38bb1659 -->
      **Blocked by:** 3.2
      **Acceptance:** unknown状态不派发Configure、不新建Work、不重放副作用；进程重启后仍引用原invocation
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域

## 4. Prove the vertical product contract

- [ ] 4.1 建立外部Host最小能力纵向E2E：Configure→Plan→Execute blocked→Execute accepted→Check，覆盖单仓和多仓。 <!-- comet-task:9ef440e3-3a54-47f9-9340-e418eb12902f -->
      **Blocked by:** 3.3
      **Acceptance:** 每个Action只声明自己的最小能力；合法claim正常推进，能力不足只阻断当前Work，Strategy/Binding和approval保持不变
      **Requirements:** change-lifecycle#build-configuration-只允许受支持的固定策略
- [ ] 4.2 增加重启、重复pull、并发claim、submission重放和unknown reconcile矩阵。 <!-- comet-task:a05a32be-6e54-4ff8-bdd5-91ff023cd280 -->
      **Blocked by:** 4.1
      **Acceptance:** 每个边界只有一个claim/invocation/accepted Outcome；重复调用返回相同continuation或revision conflict
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [ ] 4.3 更新Trajectory、OTLP和Dashboard projection，区分claim capability rejection、executor blocked、unknown reconcile和真正Binding drift。 <!-- comet-task:a113e6dc-1e46-4abb-a94a-2cf9da74352f -->
      **Blocked by:** 4.2
      **Acceptance:** 最小能力Plan/Execute不会增加binding drift或Configure retry指标；identity和capability文本不进入Metric labels
      **Requirements:** development-telemetry#build-策略绑定与人工等待必须可观测

## 5. Verify and deliver

- [ ] 5.1 运行领域、Service、CLI、单仓/多仓E2E、重启与架构测试，并执行strict OpenSpec、typecheck、lint、generated、provenance和完整`npm run verify`。 <!-- comet-task:3cdbf292-6c52-45b3-847b-2a8ac24a18c3 -->
      **Blocked by:** 4.3
      **Acceptance:** 所有门禁通过；定向搜索证明没有全局Binding capability identity或三个入口的重复能力顺序
      **Requirements:** managed-work-execution#host-capability-必须以当前-work-为作用域
- [ ] 5.2 保留round4旧Run和错误输出作为正式失败fixture，用修复后的打包产品启动相同两包TDD多仓验收。 <!-- comet-task:8d4294ba-4368-4fcf-9840-99a8c335b820 -->
      **Blocked by:** 5.1
      **Acceptance:** 不编辑旧Store；新Run完成Configure→Plan并能正确阻断/接受Execute Host，最终继续到Check
      **Requirements:** change-lifecycle#build-configuration-只允许受支持的固定策略
- [ ] 5.3 更新运行时文档和正式验证报告，提交、推送并清理临时日志、JSON与scratch输出。 <!-- comet-task:71cbf4a9-a53c-43a3-b1ea-994682579485 -->
      **Blocked by:** 5.2
      **Acceptance:** 文档说明Work capability、Binding和unknown recovery的唯一owner；验证报告绑定最终commit和命令结果，工作树干净且远端同步
      **Requirements:** development-telemetry#build-策略绑定与人工等待必须可观测

```

## openspec/changes/recover-build-host-capability-drift/specs/change-lifecycle/spec.md

- Source: openspec/changes/recover-build-host-capability-drift/specs/change-lifecycle/spec.md
- Lines: 1-52
- SHA256: 900377a86c9ae358dee6e2bf09651c96c52a6fd03571d6a62c20ac85d26964b8

```md
# change-lifecycle Delta

## MODIFIED Requirements

### Requirement: Build Configuration 只允许受支持的固定策略

Repoctopus MUST把Build的稳定人类/团队语义建模为版本化`BuildStrategy`，仅允许`executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard`和`isolationIntent=current|branch|worktree`。Design Human Decision MUST绑定完整Strategy semantic digest；Build Configure MUST只解析和验证独立ExecutionBinding。Runtime不得因合法Work间required capabilities不同、当前Work暂无兼容Host、进程恢复或同摘要返工而重建Binding或重复请求批准。只有Strategy语义、coordinator Host identity或Binding-owned Workspace facts变化时才能按对应权威失效。

#### Scenario: 兼容Host执行不同Build Action

- **WHEN** 同一coordinator Host依次为Configure、Plan、Execute和Check声明各自Work所需能力，Strategy和Workspace Binding未改变
- **THEN** Runtime保持同一Strategy和ExecutionBinding，逐Work完成claim preflight，不创建额外Human Decision或Configure Work

#### Scenario: 用户批准受支持的配置

- **WHEN** Runtime根据已批准Open、仓库拓扑、Tasks和用户选择提出合法BuildStrategy，当前composition兼容该策略，且可信用户批准Design语义摘要
- **THEN** Run固定Strategy identity/digest，后续Configure、Plan、Work、Check和遥测都引用该Strategy，不再创建常规Build Configuration approval

#### Scenario: 兼容 Host 或 checkout 变化

- **WHEN** 恢复时coordinator Host identity或本地checkout变化，但isolation intent、repository ownership和全部Strategy语义仍满足
- **THEN** Runtime重新验证并冻结新的ExecutionBinding，使依赖旧Binding-owned输入的Plan/Evidence失效，但复用已批准Strategy且不建立新Human Decision

#### Scenario: 实际隔离没有可信 binding

- **WHEN** Runner或Host只声明isolation名称，但没有为受影响仓库提供可验证checkout、branch、head、worktree ownership与Workspace facts
- **THEN** Build Configure阻断并报告ExecutionBinding诊断，不从路径或当前进程目录猜测，也不要求用户批准无法验证的机器事实

#### Scenario: 请求 Hotfix profile

- **WHEN** 调用方请求Hotfix、Tweak或任一未声明workflow profile
- **THEN** Runtime拒绝请求并保持唯一完整Change lifecycle，不把profile映射成隐藏快捷路径

#### Scenario: 批准后请求切换执行模式

- **WHEN** 已批准Strategy的execution/TDD/isolation语义被显式改变
- **THEN** Runtime使旧Strategy approval失效并建立绑定新语义摘要的Human Decision，不静默重写或把机器Binding重验冒充策略批准

#### Scenario: direct TDD 模式执行任务

- **WHEN** Strategy选择`tddMode=direct`
- **THEN** Work可以不强制逐任务先红后绿，但仍必须声明相关测试、执行回归检查并通过Build Check与Verify

#### Scenario: 当前Work缺少兼容Host

- **WHEN** Strategy和ExecutionBinding仍有效，但没有Host声明当前Work的完整capabilities
- **THEN** Runtime保持当前phase、Work和checkEpoch并返回结构化blocked continuation；它不得把Host availability误分类为Strategy或Binding变化

#### Scenario: 协调Host或Workspace事实变化

- **WHEN** coordinator Host identity、repository topology、branch/worktree ownership、isolation或local overlay与当前Binding不一致
- **THEN** Runtime派发唯一Build Configure revalidation并精确失效依赖旧Binding的后继事实，不重放旧Host Outcome

```

## openspec/changes/recover-build-host-capability-drift/specs/development-telemetry/spec.md

- Source: openspec/changes/recover-build-host-capability-drift/specs/development-telemetry/spec.md
- Lines: 1-32
- SHA256: 75307e938cf5a3308ad2b6da77a51fa6c4cacb2318f3e8307fcdbad210c04d0d

```md
# development-telemetry Delta

## MODIFIED Requirements

### Requirement: Build 策略绑定与人工等待必须可观测

Repoctopus MUST分别记录BuildStrategy proposed/approved/reused/invalidated、ExecutionBinding validated/drifted、Work claim capability accepted/rejected、executor availability blocked、Human Decision created/reused/superseded和Plan preflight finding。Telemetry MUST区分Work-scoped capability rejection与真正的Binding-owned identity drift；它不得从Plan、Execute或Check invocation的capability list推断Binding变化。Metric labels MUST只使用有界phase、action、result和reason枚举，Host、Work、claim和digest只作为Trace/Event关联身份。

#### Scenario: 当前Work能力不足

- **WHEN** Host缺少当前Work的required capability并在claim前被拒绝
- **THEN** Trace记录`work.claim-capability-rejected`和有界missing-capability class，claim/invocation计数不增加，binding drift计数不增加

#### Scenario: Configure 自动重验 binding

- **WHEN** coordinator Host identity或checkout变化但批准Strategy语义未变，Runtime接受新ExecutionBinding
- **THEN** Trace表示binding revision和受影响Evidence invalidation，approval count不增加且不导出checkout路径

#### Scenario: Plan 提前阻断越界写入

- **WHEN** Plan Evidence发现package write scope超出任务或仓库边界
- **THEN** Trace在Execute前记录有界planning finding，使团队可计算preflight catch rate，Metric不使用路径文本作为label

#### Scenario: 不同Work使用不同能力集合

- **WHEN** 同一coordinator Host成功领取Plan和Execute且两次声明的能力集合不同
- **THEN** Trace分别记录两个合法Work claim；Dashboard和聚合不得显示ExecutionBinding漂移或Configure重试

#### Scenario: 外部执行结果未知

- **WHEN** 已claim Work的外部结果无法判定并进入reconcile
- **THEN** Trace保留原claim/invocation关联并记录unknown/reconcile outcome，不把恢复投影为新Work成功或Binding重建

```

## openspec/changes/recover-build-host-capability-drift/specs/managed-work-execution/spec.md

- Source: openspec/changes/recover-build-host-capability-drift/specs/managed-work-execution/spec.md
- Lines: 1-126
- SHA256: 3077efab946fc58d6c988a40b037321d409d75d97c08f5e837ddedbd99f87721

[TRUNCATED]

```md
# managed-work-execution Delta

## MODIFIED Requirements

### Requirement: Build Configure 产生可批准的不可变配置

Runtime MUST 从已通过 Design Human Decision 的版本化 `BuildStrategy` 读取 execution/TDD/review/isolation intent，并根据当前 Run、仓库拓扑、隔离事实与协调 Host identity 解析独立 `ExecutionBinding`。Binding MUST 固定 repository、branch、初始 head、worktree ownership、可移植 semantic digest 和只在本地保存的 path/local overlay，但 MUST NOT 把任一 Work invocation 的 capability list或 digest作为跨 Work 语义身份。Configure Host MUST 在 claim 前满足当前 `build.configure` Work 的 capabilities；未来 Plan、Execute和Check MUST 分别按自己的 Work capabilities执行claim preflight。

#### Scenario: Configure 只验证当前 Work 和 Workspace Binding

- **WHEN** Host满足 `build.configure` 的读取、Strategy协调和Workspace观察能力，但没有为当前claim声明未来Execute所需的写入能力
- **THEN** Runtime可以验证并接受ExecutionBinding；该接受不授予未来Work权限，也不保证下一Work已有兼容Host

#### Scenario: 多仓任务选择 subagent 模式

- **WHEN** 任务可按仓库和依赖边界形成Work Package，用户在Design approval中接受subagent Strategy，Configure Host满足当前协调Work的能力
- **THEN** Runtime固定该Strategy并把模式绑定全部Build Action；Configure只验证当前Work和实际ExecutionBinding，不授予后继Work能力

#### Scenario: Host 不支持批准配置

- **WHEN** 当前Host不满足当前Build Work的capability contract
- **THEN** Runtime在持久化claim和副作用前等待兼容Host，不静默降级Strategy；只有请求改变策略语义时才需要新Human Decision

#### Scenario: 多仓 isolation binding 通过验证

- **WHEN** Runner为批准的current、branch或worktree intent提供受影响仓库的本地checkout facts
- **THEN** Runtime以稳定repository identity、branch、初始head、worktree identity和Workspace ownership验证Binding；绝对路径只保存在本地Run overlay

#### Scenario: 绑定变化但策略未变

- **WHEN** 同isolation intent下coordinator Host、checkout、初始HEAD或本机路径发生兼容变化
- **THEN** Runtime生成新Binding identity、使依赖旧Binding-owned输入的Plan/Evidence失效并自动重验，不创建Build Strategy approval

#### Scenario: 下一 Work 暂时没有兼容 Host

- **WHEN** ExecutionBinding有效且Runtime已派发`build.execute`，但当前Host声明的能力不覆盖该Work requirements
- **THEN** Runtime在持久化claim和invocation前返回结构化capability blocked continuation，保留当前Work和Binding，不返回Configure、不降级Strategy

#### Scenario: Binding-owned事实变化

- **WHEN** coordinator Host identity、repository topology、branch/worktree ownership、isolation或local overlay发生变化
- **THEN** Runtime按现有精确失效规则派发Build Configure revalidation；当前Work capability声明不同本身不得触发该路径

### Requirement: Plan Evidence 在执行前证明计划可行

Runtime MUST 在创建Execute Work前验证BuildPlan对批准Tasks、验收、仓库拓扑、依赖、repository/write scope、terminal report ownership、ExecutionBinding、有效Skill composition和BuildStrategy的完整覆盖，并持久化绑定当前输入的Plan Evidence。Evidence MUST验证每类后继Work声明了所需capability contract，但MUST NOT把某次Plan或Configure invocation的Host capability digest作为Execute可用性的长期证明；实际Host availability只在对应Work claim时验证。

#### Scenario: 低风险计划声明完整Execute能力合同

- **WHEN** Plan覆盖全部Task和验收、仓库边界与write scope合法，并且派生Execute Work声明其repository/process能力
- **THEN** Runtime接受Plan Evidence并创建第一个就绪Execute Work；Host是否可领取由该Work的claim preflight决定

#### Scenario: 低风险计划自动通过

- **WHEN** Plan Validator证明全部Task/acceptance、仓库边界、write scope、报告归属、后继Work capability contract、Binding和composition被覆盖，且风险策略不要求暂停
- **THEN** Runtime接受Plan Evidence并生成第一个就绪Execute Work，不创建虚假人工审批

#### Scenario: 计划的 write scope 与任务不一致

- **WHEN** Work Package请求写入未被Task、definition或目标仓库允许的路径
- **THEN** Plan Evidence返回结构化planning finding并留在Plan revision，不等到Execute工具调用后才失败

#### Scenario: 计划触发可选人工暂停

- **WHEN** 计划包含definition声明的高风险副作用、跨仓不可逆顺序或其他暂停条件
- **THEN** Runtime建立绑定Strategy、Binding与plan digest的Human Decision，在可信决定前不创建Execute Work

#### Scenario: 计划输入漂移

- **WHEN** Tasks、验收、仓库拓扑、Strategy、Binding-owned facts、Skill composition或计划identity与Plan Evidence输入不一致
- **THEN** Runtime使旧Evidence失效并按变化权威返回Plan revision、Design或`migration_required`；当前Work Host capability list不同不得单独触发该失效

#### Scenario: Plan遗漏后继Work能力合同

- **WHEN** Plan或Work派生规则无法为某个有副作用package确定完整required capabilities
- **THEN** Plan Evidence在创建Execute Work前fail closed并返回结构化finding，不从Configure Host的历史能力推断缺失值

#### Scenario: Plan invocation能力与Configure invocation不同

- **WHEN** 合法Plan claim只声明当前只读Work所需能力，且其coordinator Host identity与ExecutionBinding一致

```

Full source: openspec/changes/recover-build-host-capability-drift/specs/managed-work-execution/spec.md
