# DSH / Comet 全量上游对齐审计

审计日期：2026-10-30。机器基线见 `upstream-baselines.json`；本报告按 Repoctopus 产品能力逐域闭合，并分别审计旧发布→新发布、新发布→默认分支头。这里的“全量”表示所有相关能力都有采用、拒绝或延后结论，不表示复制上游的全部代码。

## 固定事实

| 上游 | 旧发布 | 采用发布 | 已审计分支头 | 关系 |
| --- | --- | --- | --- | --- |
| DSH | `dsh-v0.2.1-rc.3` / `1f81c047fc48fa190a683e469daa699857e9afe8` | `dsh-v0.2.1-rc.5` / `b830ec950faba0a46dda564be3e2d854afed94f1` | `master` / `ce7073d51254c26cd63b22a60835b8f948deb447` | rc.3 → rc.5 → master 均为祖先链 |
| Comet | `0.5.0` / `aeb1a6598034e28ce46b8422d4dbd8785e607bd7` | `0.5.1` / `35c9860b77b42bafa0c2d80d8d695889f888a924` | `master` / `4901cac9330f5ffe289abfa6daf8412bfa190dc0` | 0.5.0 → 0.5.1 → master 均为祖先链 |

两个上游许可证均为 MIT 且发布间文本摘要不变。基线 schema v2 明确区分：`pinnedTagCommit` 是产品采用和 provenance 的来源，`auditedBranchCommit` 只是每日漂移与候选审计边界。

## 结论

- 八个 DSH 直接包统一升级并固定为 `0.2.1-rc.5`；npm registry 元数据、tarball 解包身份、integrity 和 lockfile 一致。
- rc.3→rc.5 的 Skill、Filesystem Skill、Cordis 与 Loader 行为源码不变；登记的桌面参考面只有 `apps/desktop/package.json` 发布元数据变化。
- Cordis 4.0.5 与 Loader 1.0.6 快照字节不变，因此只推进它们所属的 DSH 发布身份，不改包版本和逐文件摘要。
- Comet 来源移动到 0.5.1；20 个登记来源中只有 `native-lock.ts` 与 `classic-command-checks.ts` 的来源摘要变化，20 个 Repoctopus 目标摘要均不变。
- DSH master 与 Comet master 的未发布变化只形成候选或拒绝结论，不进入发布快照，也不在本 Change 改写 Runtime。
- 自举暴露的 frozen Work packet、skip-specs Gate 和 Provider INFO 严重度问题已记录，但统一留给后续核心可靠性 Change。

## 四段增量审计

### DSH rc.3 → rc.5

| 相关面 | 差异事实 | 决定 |
| --- | --- | --- |
| 八个直接包 | 精确 `0.2.1-rc.5` 均已发布，解包 `name/version` 与 registry shasum/integrity 一致 | 采用；package、overrides 与 lockfile 一次升级 |
| Skill Registry | `packages/skill/skill/src/index.ts` 行为源码不变 | 采用新发布包，不重写 Registry |
| Filesystem Skill | 登记源码不变 | 保持现有适配器和来源摘要 |
| Cordis / Loader | `vendor/cordis` 与 `vendor/loader` 的 tag-to-tag diff 为空 | 保持不可变快照字节，只更新所属 DSH tag/commit |
| Desktop | 登记面只有 `apps/desktop/package.json` 的发布版本元数据变化 | 更新参考摘要；不把 DSH 桌面依赖范围覆盖到 Repoctopus 的安全精确版本 |
| Agent/Session/Workspace/Webhook | 不属于当前采用闭包 | 继续拒绝进入产品运行时 |

### DSH rc.5 → master

该区间有大量快速开发提交；先按产品登记面筛选，再审查相邻测试和提交历史。登记面中只有五个路径变化。

| 相关面 | 分支尾部事实 | 决定 |
| --- | --- | --- |
| Filesystem Skill | 单个 root 发现失败时记录并跳过该 root，保留其余 root，同时把观察标为 incomplete | 延后；是 Provider 可靠性候选，但必须通过独立 Change 适配 Repoctopus 显式 roots 与遥测 |
| Desktop Host/Shell | `host-process.ts`、`main.ts` 与启动测试增加 shutdown、恢复、诊断和菜单/生命周期改动 | 延后到正式发布；不从 master 摘取未发布桌面行为 |
| Desktop package | 依赖与发布元数据继续变化 | 拒绝直接采用范围；Repoctopus 保持已审计的精确安全版本 |
| Cordis / Loader | 当前发布采用面不随 master 自动移动 | 不伪装成 npm 快照，等待对应正式发布后再审计 |
| 产品 Session/Agent/UI | 变化量很大但与 Repoctopus 外部 Agent、多仓 Change Run 边界不一致 | 不采用产品壳；仅在具体缺口 Change 中取证 |

### Comet 0.5.0 → 0.5.1

| 相关面 | 差异事实 | 决定 |
| --- | --- | --- |
| Classic reusable checks | 有效 timeout 进入复用身份，避免配置变化后重用旧结果 | 更新来源摘要；原则已纳入后续可靠性审计，本 Change 不改产品 Runtime |
| Native lock diagnosis | 新增 typed busy error、malformed/unknown 观察和精确 recovery token | 延后；作为 recoverable lease/lock 的成熟参考 |
| Native lock repair | 必须重新观察同一 token 并明确确认 owner stopped；不能靠时间流逝接管 | 延后；采纳原则，不复制 Native 状态根 |
| 发布流水线 | artifact 自检、可选完整 Eval receipt、changelog 与格式 | 不采用；属于 Comet 自身发布工程 |

完整文件和摘要证据见 `comet/0.5.1-audit.md`。

### Comet 0.5.1 → master

只有 `4901cac`：允许 Comet Native 在 Shape 确认前重定向 declared Specs，确认后仍受保护。Repoctopus 使用 OpenSpec Provider 与自己的规划批准摘要，不使用 Native Shape 状态根，因此不采用实现；保留“批准前可纠正、批准后旧批准失效”的交叉证据。

## 能力覆盖矩阵

状态含义：`采用` 是直接包/不可修改快照；`适配` 是登记来源的实质改写；`参考` 是审查后保留 Repoctopus 原生边界；`拒绝` 是明确不进入产品。

| Repoctopus 能力域 | Comet 证据 | DSH 证据 | 当前结论 |
| --- | --- | --- | --- |
| Plugin composition | 无 Cordis Runtime | Cordis 4.0.5、Loader 1.0.6 | 采用 DSH 发布快照；rc.5 字节不变 |
| Engine / resolver / guardrails | Engine、Workflow Contract | Agent Loop 面向模型回合 | 适配 Comet，保持纯 Engine |
| Change Run / phase | Classic 五阶段、固定 Definition、claim/outcome | Session 持久化面向 DSH 产品 | 适配 Comet 思路；一个权威 Run 贯穿五阶段 |
| Action/Work execution | reserve→host→commit、精确 recovery | Jobs/Agent dispatch | 适配 Comet，Host 由 Repoctopus/Cordis 边界承载 |
| Protected transitions | Classic guard/store、approval hash | Session lease/migration fence | 适配 Comet；Validator/Receipt 决定推进 |
| Process safety | argv-safe spawn、进程身份与树终止 | subprocess/win32 process | 已适配 Comet；不引入 DSH Agent shell |
| Filesystem safety | race-safe read、atomic file、lock | fs sandbox/observation | 已适配 Comet；DSH root 隔离修复延后 |
| Multi-repository workspace | 单项目/单仓 | Workspace 偏 Session 工作区 | 保持 Repoctopus 原生团队 Workspace 与多仓模型 |
| Project onboarding | 无多仓确认流 | 无产品等价物 | 原生确定性扫描、补全和用户确认 |
| Skill integration | Action 固定 Skill/能力/scope | `ctx.skills` Registry 与 filesystem provider | 采用 DSH Registry，适配 Comet 绑定不变量 |
| Team Skill configuration | Workflow Application/Creator 较重 | Provider roots/rank | 原生配置扩展；核心 Action Skill 不允许被任意替换 |
| Specification authority | OpenSpec integration、Shape | 无 Specification Provider | 原生可替换 Provider；当前实现为 OpenSpec Store |
| Build planning/execution | Build configure/plan/execute/check | Subagent/Agent 能力 | 采用阶段思想；Tasks 是规格任务权威，Runtime Work 是执行计划 |
| Verification | Check receipt、Evidence、Verifier | Session/Job 结果 | 适配 Comet；Agent success 不等于验收通过 |
| Archive/publication | preflight、finish、resume probe | Workspace changes | 适配到多仓 Publication Receipt；不等待 MR 合入 |
| Event/Webhook | 无必要的合入等待 | experimental fire-and-forget Session dispatch | 拒绝核心 Webhook/daemon；按需 reconcile |
| Evidence/retention | Native Evidence/Receipt | Session log | 行为适配 Comet，不引入其产品状态根 |
| Repository fingerprint | Native snapshot/fence | 无等价多仓 fence | 适配 Comet 并组合多仓身份 |
| Desktop Dashboard | Run view/trace | Electron Shell/Host/Tray | DSH 进程边界适配；同一 OTLP 数据源，只读投影 Run |
| Telemetry | Runtime metrics | Cordis OTel service/exporter | 原生低基数 OTLP；上游作为关闭/恢复参考 |
| CLI/provenance | Comet CLI 强耦合产品 | DSH CLI 强耦合 Agent 产品 | 保持版本化 Repoctopus CLI 和机器可查 provenance |

## 恢复与一致性边界

Comet 0.5.1 再次确认：等待超时不是执行失败，已派发 verifier 仍是同一任务，未知外部结果必须先观察再决定，lock repair 必须绑定精确 token。Repoctopus 后续核心可靠性 Change 应把这些原则映射到 frozen Work packet、Host Outcome、Specification Provider Gate 与 diagnostics，不应新增 lifecycle generation 或第二套状态权威。

当前版本刷新 Change 不做上述 Runtime 修复。原因不是兼容旧设计，而是避免 provenance 变更与行为重构混在一个验证边界中。已发现问题保留在本 Change 的 Design “Deferred Core Reliability Findings” 中，并将在归档后建立独立 Specification Change。

## 每日漂移策略

`npm run check:upstream` 分别比较默认分支与 `auditedBranchCommit`、发布标签与 `pinnedTagCommit`。任何分支前进、标签缺失或标签移动都返回非零；provenance 只绑定 `pinnedTagCommit`。

发现漂移后必须：

1. 在可清理临时 checkout 中固定 tag、branch、祖先关系与许可证。
2. 分别审计旧发布→新发布、新发布→分支头。
3. 对相关能力逐项给出采用、拒绝或延后结论。
4. 更新精确依赖、来源摘要、采用报告和契约测试。
5. 通过完整验证后才移动采用发布；分支审计身份可以独立前进。

`.github/workflows/upstream-alignment.yml` 每日执行检查，也支持手动触发。网络检查与离线 `npm run verify` 分开，避免临时网络故障破坏可重复构建。
