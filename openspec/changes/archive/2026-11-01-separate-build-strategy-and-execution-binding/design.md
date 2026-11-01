---
comet_change: separate-build-strategy-and-execution-binding
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-01-separate-build-strategy-and-execution-binding
status: final
---
# Design

## Context

`BuildConfigurationProposal` 当前把稳定策略和 `bindingDigest`、`bindingStateDigest`、`hostId`、`hostCapabilities` 共同加入 semantic digest，随后建立 `build-configuration:*` Human Decision。该模型让机器事实变化与用户语义变化共享失效规则：切换 Runner、正常推进 HEAD、修复 checkout 或 Verify 返回 Build 都可能重复询问已经批准过的 execution/TDD/review/isolation 选择。

### 固定上游证据

2026-11-01 重新核对固定的 Comet `0.5.1`（`35c9860b77b42bafa0c2d80d8d695889f888a924`）与默认分支审计头（`63d2ba736a24090ee826c012b5963a579ca5fb8c`）。默认分支新增的 MiniMax Code 平台支持没有修改 Classic Runtime、Runtime SDK、Engine 或生命周期状态机，因此不改变本 Change 的参考边界，也不升级固定采用版本。

Comet Classic 的成熟边界是：Resolver 先选择 `configure`，有效配置才进入 `plan`；配置决定绑定精确 proposal hash；计划必须绑定当前 Tasks/plan reference 并记录 Plan Evidence，之后才能 Execute；暂停或恢复时重新观察精确身份，只重做缺失、无效或被用户明确改变的部分。Repoctopus 采用这些不变量，但不复制 Comet 的单仓状态文件、Superpowers Design Doc 或第二份 Build Plan 文档：OpenSpec Tasks 仍是规格与任务权威，Run-local BuildPlan 只是执行投影；稳定的人/团队选择进入 Strategy，Host、checkout 与 HEAD 等可重建事实进入 Binding。

### 上游映射与本地取舍

| Comet 0.5.1 参考 | 成熟不变量 | Repoctopus 采用方式 |
| --- | --- | --- |
| `domains/comet-classic/classic-sdk-build.js` 的 `proposeClassicSdkBuild` / `decideClassicSdkBuild` | 配置候选和决定绑定精确 proposal hash；过期决定不能作用于新候选 | Design approval 绑定 `BuildStrategy.semanticDigest`；稳定决定身份为 `decisionKind + semanticDigest` |
| 同文件的 `submitClassicSdkBuildPlan` / `continueClassicSdkBuildPlan` | Plan 在 Execute 前绑定当前配置、Tasks revision、plan receipt 与 evidence；恢复必须重新证明同一输入 | `PlanEvidence` 绑定 Strategy、Binding、Tasks、拓扑、scope、composition checkpoint 与 plan revision，任何依赖输入变化只失效相应后继事实 |
| 同文件的 `completeClassicSdkBuild` | 没有已接受计划和完成证据不能离开 Build | Build Check 只接受当前 Plan revision 的 required package completion 和 Evidence |
| `domains/comet-classic/classic-sdk-application.js` 的 `full.build.configure → confirm → plan → execute → check` | Runtime 选择合法 Action，Host 只完成当前 Action | 保留 `Configure → Plan → Execute → Check`；把稳定策略提前并入既有 Design approval，Configure 只解析机器 Binding，因此删除产品内部重复的常规 confirm |

Comet 的 `confirm` 对其一次性 Build 配置是必要的。Repoctopus 已有独立 Design Human Decision，而且需要支持多仓、跨 Runner 与独立 composition compatibility；继续在 Configure 为同一稳定策略再确认一次只会建立第二个批准权威。因此本设计采用 Comet 的精确身份、evidence-before-effect 和增量恢复规则，不照搬重复批准或单仓状态布局。

## Goals

1. 将稳定、可审查的人/团队选择与瞬时、可重建的执行事实分离。
2. 保留 Comet 成熟的 `Configure → Plan → Execute → Check` 顺序和精确恢复语义。
3. 让 Runtime 仍是 Action、Outcome 验证和 phase 推进的唯一权威，Agent/Host 不能自行选阶段或改策略。
4. 用依赖图精确失效 Strategy、Binding、Plan、Evidence 和 Work，而不是重建整个 Build Protocol。
5. 在预发布阶段一次性删除错误的可写协议，不维护双写或猜测式兼容层。

## Non-goals

- 不新增 Hotfix/Tweak profile、Direct execution、Executing Plans 或运行中模式升级。
- 不把实际 Skill composition 的代码、版本、配置身份并入 planning approval。
- 不新增第五类规划文档、第二套任务 checkbox 或独立 ADR。
- 不把本机绝对路径、正文、摘要原文或无界 identity 导出到 OpenSpec、共享配置或 OTLP。

## Decisions

### 1. BuildStrategy 是 Design 批准的稳定语义

`BuildStrategy` 采用以下预发布 schema：

```ts
interface BuildStrategy {
  schemaVersion: 1;
  strategyId: string;
  revision: number;
  executionMode: 'autonomous' | 'subagent-driven-development';
  tddMode: 'tdd' | 'direct';
  reviewMode: 'standard';
  isolationIntent: 'current' | 'branch' | 'worktree';
  semanticDigest: string;
}
```

`semanticDigest` 只规范化并散列四个策略字段及其 schema version；`strategyId` 由 Change/Run identity 与该摘要确定性派生，`revision` 只在语义摘要变化时递增。Strategy 不包含 Host、capability、仓库 HEAD、checkout path、worktree owner、actual composition identity 或批准记录。Design proposal 展示完整 Strategy，Design Human Decision 的 planning snapshot 引用其 semantic digest；批准本身仍由 planning approval authority 所有，避免 Strategy 再嵌入第二份 approval authority。

实际 Cordis composition 由已有独立 compatibility authority 比较 `same | compatible-adoption | migration_required`。兼容 adoption 可以更新当前 composition checkpoint 和受影响 Evidence，但不得刷新 Design approval；不兼容变化进入 `migration_required`，不得伪装为 Strategy 修改。

### 2. ExecutionBinding 是 Configure 解析的机器事实

`ExecutionBinding` 采用以下可移植核心：

```ts
interface ExecutionBinding {
  schemaVersion: 1;
  bindingId: string;
  revision: number;
  strategyDigest: string;
  host: {
    hostId: string;
    capabilityDigest: string;
  };
  repositories: Array<{
    repositoryId: string;
    branchRef: string;
    headRevision: string;
    isolation: 'current' | 'branch' | 'worktree';
    workspaceOwnerId: string;
  }>;
  semanticDigest: string;
  stateDigest: string;
  localOverlayRef: string;
}
```

- `semanticDigest` 表示可跨 Runner 比较的 repository identity、branch/isolation/ownership 与 capability 语义。
- `stateDigest` 表示本次执行观察到的 HEAD、工作区状态和 capability snapshot，用于精确判断后继 Evidence 是否仍新鲜。
- `localOverlayRef` 只引用本机受保护 overlay；绝对 checkout/worktree path 和本机凭据只存在 overlay 中，不进入 portable digest、OpenSpec、共享配置、trajectory payload 或 OTLP。
- `bindingId`/`revision` 标识已接受的观察版本；兼容重建创建新 revision，不回写旧记录。

Binding 引用 Strategy，但不拥有或改变 Strategy。它也不吞并 composition authority：当前有效 composition checkpoint 作为 Plan/Work 的独立依赖输入，由 compatibility authority 验证。

### 3. BuildProtocolState v2 删除混合配置权威

领域状态一次性切换为：

```ts
interface BuildProtocolStateV2 {
  schemaVersion: 2;
  strategy: BuildStrategy;
  binding?: ExecutionBinding;
  bindingHistory: ExecutionBinding[];
  plan?: BuildPlan;
  planEvidence?: PlanEvidence;
  packageCompletions: PackageCompletion[];
  checkEvidence?: BuildCheckEvidence;
}
```

生产状态不再保存 `configurationProposal`、`configuration` 或可写 `BuildConfiguration` 兼容字段。`BuildPlan` 用 `strategyDigest + bindingId + bindingStateDigest` 代替 `configurationId/configurationDigest`；Plan/Work 另行引用当前 composition checkpoint，不把它折叠进 Strategy 或 Binding。

旧预发布 Run 只返回结构化 `migration_required` 诊断与重新开始指引。Runtime 不对旧字段双读、补默认值、猜测 Strategy 或生成可继续执行的转换状态。

### 4. Configure 只解析和验证 Binding

Design 已批准后，Runtime 选择 `build.configure`，把冻结 Strategy、仓库拓扑、Workspace ownership 约束和 Host capability requirement 交给 Host。Host 只能返回 `execution-binding-candidate`，不得重新选择 execution/TDD/review/isolation。

Runtime Validator 在 acceptance boundary 内完成：

1. 校验候选仍引用当前 Strategy digest 与 Run revision；
2. 校验三种 isolation 的分支/worktree ownership、repository identity、write root 和多仓关系；
3. 校验 Host capabilities 能执行 Strategy，且实际路径只写入 local overlay；
4. 校验当前 composition 与 Strategy/Action 要求相容；
5. 接受 Binding revision，记录 trajectory，然后自动选择 `build.plan`。

可纠正候选失败保留同一 Work/attempt/checkEpoch 并追加有界 rejected submission；不会创建 `build-configuration:*` wait，也不会让 Agent 用另一个 phase 绕过。没有兼容 Host、未知 Workspace owner、越界 checkout 或不兼容 composition 时 fail closed：分别等待兼容执行者、要求明确 intent/ownership 或进入 `migration_required`，而不是要求用户“批准”无法验证的机器事实。

### 5. Human Decision 由语义而非机器观察标识

所有决策请求使用确定性 identity：

```text
decisionId = H(runId, decisionKind, semanticDigest)
```

同一 `decisionKind + semanticDigest` 的 retry、resume、Runner 交接、同摘要返工或重复提交必须恢复同一 request/proposal hash，并记录 `reused`；不能重建另一张待处理卡。摘要变化时旧决定标记 `superseded`，新决定拥有新的 identity。提交决定必须以当前 Run revision、proposal hash 和 CAS revision 校验，过期批准不能应用。

固定人工边界是 Open 与 Design。Build 只在以下情况下额外暂停：

- 用户明确请求改变 Strategy；
- Strategy 仍有必填字段无法从已批准 Design 得出；
- definition 声明的有界高风险规则要求批准；
- 外部授权、不可逆副作用或未知外部结果需要可信人决定。

Build Configure 的正常成功、兼容 Binding 漂移、兼容 composition adoption、Plan 的确定性校验或 Verify 的普通实现返工都不是新的批准理由。

### 6. PlanEvidence 在副作用前证明完整执行边界

`PlanEvidence` 至少绑定：

- 当前 OpenSpec Tasks identity、Task revision、acceptance/requirement references；
- planning semantic digest 与已批准 `BuildStrategy.semanticDigest`；
- 当前 `bindingId`、`bindingStateDigest`、Host capability digest；
- 独立的当前 composition checkpoint identity 与 compatibility result；
- repository topology、package dependency DAG、repository/write scope authorization；
- terminal report owner、validator profiles、review policy 与有界 risk classification；
- BuildPlan revision、每个 Work Package 的 Task/acceptance/scope 映射。

Plan Validator 返回结构化 findings。缺 Task/acceptance、越界写入、错误仓库、缺报告 owner、能力不足、composition 不兼容或输入漂移都在创建 Execute Work 前 fail closed。低风险且完整的 Evidence 自动进入 Execute；只有 definition 声明的有界风险才创建绑定 `strategyDigest + planDigest + riskDigest` 的 Human Decision。

OpenSpec Tasks 是“要完成什么以及完成声明”的权威；Runtime BuildPlan 是“在当前 Strategy/Binding 下如何分包执行”的版本化投影。Plan 可以让多个 package 引用同一 Task，但不得增加未获批准的需求、建立第二套 checkbox 或修改 Task 语义。

### 7. 依赖矩阵决定精确失效与返工

| 变化 | 保留 | 失效/下一步 | 人工决定 |
| --- | --- | --- | --- |
| Design approval 接受 Strategy | Open/Design Evidence、Strategy | 选择 Build Configure | 不新增 |
| Configure 接受 Binding | Strategy、Design approval | 创建/重建 Plan | 不新增 |
| 同 Strategy 下 Host/capability/HEAD/path 兼容漂移 | Strategy、Design approval、无关 package completion | 新 Binding；仅失效依赖旧 Binding state 的 Plan Evidence/未执行 Work | 复用原决定 |
| Strategy 任一语义字段改变 | Open Evidence、独立 composition checkpoint | 旧 Design approval/Plan/后继 Evidence；返回 Design | 新 Design decision |
| compatible composition adoption | Strategy、Design approval、Binding | 刷新 composition checkpoint 以及直接依赖旧 composition 的 Evidence/Work | 复用原决定 |
| incompatible composition | 可诊断历史 | 阻断为 `migration_required` | 不伪造策略批准 |
| Tasks/acceptance/planning digest 改变 | Strategy（若语义仍匹配）、Binding（若仍新鲜） | 返回 Design 或 Plan，按 planning authority 判定；旧 Plan Evidence 失效 | 仅真正 Design 语义变化时新建 |
| Plan candidate 可纠正错误 | 当前 Plan Work/attempt/frozen input | 同一 Work 接收修正 candidate | 不新增 |
| 有界高风险 Plan | Strategy、Binding、Plan candidate | 等待 risk decision；接受后生成 Evidence | 按 risk digest 唯一 |
| Verify implementation finding | Open/Design、Strategy、未受影响 Binding/completion/Evidence | 递增 checkEpoch，返回 Plan revision 或受影响 Execute package | 复用原决定 |

失效是显式领域事件，不靠文件时间、checkbox、当前目录或聚合 fingerprint 猜测。恢复首先读取既有 checkpoint identity；只有 dependency matrix 证明输入已变，才创建新 revision。`auto_transition` 只决定是否继续派发 Runtime 已选择的下一个合法 Action，不改变 phase 合法性。

### 8. 遥测与桌面只投影领域事实

Trajectory 与 OTLP 记录下列有界事件：

- `build.strategy.proposed|approved|reused|invalidated`
- `build.binding.validated|drifted|rejected`
- `human_decision.created|reused|superseded|resolved`
- `build.plan.preflight.accepted|rejected`

事件关联 run/change、phase/action、strategy revision、binding revision、plan revision、独立 composition compatibility class、reason class 与 duration。Metric label 只能使用枚举；digest 仅在本地 trajectory 作为 opaque correlation，不能拆分或导出高基数原文；绝对路径、正文、用户输入和本机凭据一律不导出。

Desktop projection 只允许一张当前有效 Human Decision 卡。Strategy decision、自动 Binding revalidation、composition compatibility 与历史 reused/superseded timeline 使用不同状态，不能把自动重验伪装成等待用户。

### 9. 删除旧生产协议，不保留双写

实现必须删除或替换以下生产概念：

- 类型：`BuildConfigurationProposal`、`BuildConfiguration`；
- 函数：`createBuildConfigurationProposal`、`acceptBuildConfiguration`；
- 状态：`configurationProposal`、`configuration`；
- Host result kind：`build-configuration-candidate`；
- 事件/等待：`build-configuration-proposed`、`build-configuration-decision`、`build-configuration:*`；
- `BuildPlan.configurationId/configurationDigest` 以及由其派生的聚合失效。

对应替换为 Strategy/Binding 明确引用、`execution-binding-candidate`、自动 Configure acceptance 和上述 decision identity。测试 fixture、contributor contract、dashboard reducer、docs 和 telemetry 必须同步切换，避免旧名字变成暗中可写的第二条路径。

## Testing Strategy

实施遵循 red → green → regression：先用历史旅程证明旧协议确实会重复批准或遗漏 preflight，再切换领域模型。

1. **领域单测**：Strategy/Binding digest 独立；schema v2；decision reuse/supersede；Plan Evidence fail closed；dependency matrix 精确失效。
2. **Transition/Service 测试**：Runtime 选择 Configure/Plan/Execute/Check；Host 不能改 phase；Configure 无常规 wait；候选拒绝保留同一 attempt；CAS/restart 返回同一 continuation。
3. **隔离与多仓测试**：`current|branch|worktree`、多仓 ownership、跨 Runner Host drift、HEAD drift、本地 path overlay 隐私。
4. **Composition 测试**：same、compatible adoption、incompatible migration 三条路径与 planning approval 正交。
5. **返工测试**：Plan finding、bounded risk pause、Build Check、Verify→Build，证明只失效受影响 package/evidence 且不增加相同决定。
6. **观测/UI 测试**：trajectory、OTLP 基数/隐私/离线复算，Desktop 只有一张当前决定卡并区分自动重验。
7. **基线修复与全量验收**：先在不改语义的前提下拆分超长主规格 Requirement；运行 `openspec validate change-lifecycle --type spec --strict`、`openspec validate --all --strict`、`npm run spec:validate`、定向测试和 `npm run verify`。

正式 E2E 必须覆盖单仓、多仓和跨 Runner 恢复，并将最终提交、Strategy/Binding/Plan Evidence identity 与验证命令记录到正式 verification report，而不是 implementation notes。

## Risks / Trade-offs

- **Strategy 提前进入 Design approval 后，Build Configure 不再提供第二次常规确认。** Design proposal 必须展示完整 Strategy；真实策略变化使旧批准失效，actual composition 由独立兼容性权威验证，Configure 不能静默改写任一方。
- **Binding 允许跨 Host 或正常 HEAD 变化重建，错误实现可能把越权漂移当成兼容变化。** Validator 分别核对 repository identity、Workspace ownership、isolation intent、branch/worktree ownership 与 capability；不相容变化 fail closed。
- **更细的 identity 增加领域类型数量。** 代价换来可解释的精确失效；每种 identity 只有一个 owner，禁止重新引入“全量 planning fingerprint”。
- **预发布破坏性切换会使旧 Run 无法继续。** 当前没有正式兼容承诺；只读诊断比维护错误协议和永久双写更安全。
- **OpenSpec Store 的本机注册表同一 Store ID 只指向一个 checkout，自举切换 worktree 时会 fail closed。** 当前流程只通过 OpenSpec 官方 unregister/register 做显式、可逆重绑定；Store 多 checkout 协调属于独立问题。

## Migration and Rollback

预发布阶段一次性切换持久化 schema 和生产路径。旧 Run 检测到 schema v1 或混合 configuration 字段时返回 `migration_required`，说明它不能在新协议下安全续跑；不自动猜测 Strategy/Binding，不并行维护两套可写协议。

若发布前验证失败，回退整个 Change commit 并重开新 Run；不得只回退部分 serializer 或保留双写。完成切换后，架构测试和定向搜索必须证明旧生产入口已删除。

## Stop Conditions

- Design planning snapshot 无法稳定绑定完整 Strategy；
- 现有恢复协议要求把本机绝对路径放入可移植身份；
- Plan Evidence 无法在 Execute 前取得 write scope 或终端报告所有权；
- 新模型仍会因兼容 Host/HEAD/path/composition 变化建立人工决定；
- 实现需要保留旧 `BuildConfiguration` 可写路径或第二份任务权威才能工作。
