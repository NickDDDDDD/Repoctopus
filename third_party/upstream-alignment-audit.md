# DSH / Comet 全量上游对齐审计

审计日期：2026-10-21。机器基线见 `upstream-baselines.json`；本报告覆盖 Repoctopus 能力账本中的全部 19 个能力域，以及当前 change 尚未完成的事件运维、合入后收尾、配置组合和部署验证。这里的“全量”指按 Repoctopus 产品能力逐域闭合，不等同于逐行复制两个上游仓库。

## 结论

- DSH 从 `d0dca04e22f09fe04967090b2ee70587ecdad6cc` 升到 `dsh-v0.2.1-rc.2` / `687f282e8625c6b8d11ff58211a90524be2e4317`。直接依赖统一固定为 `0.2.1-rc.2`；已被上游删除的 `dsh-invariants` 从闭包移除。
- Cordis 从 `4.0.4` 升到 `4.0.5`，Loader 从 `1.0.5` 升到 `1.0.6`；两个目录继续保存未修改 npm 发布快照。
- Comet `master` 仍指向已审计源码提交 `575ab0d172e8105257b3c9172b8c8a9b628960ca`，因此不产生源码快照变更；`0.4.5` 发布标签固定在 `c90af44a4474662d7853aae76ce785404974fb0a`，两者之间只有发布后的文档提交。机器基线分别记录 branch commit 与 tag commit，不再把两种身份混为一谈。
- 本轮发现并吸收两个适用修复：Loader 保存原始 module namespace 以支持安全重载；文件 Skill watcher 在 Windows 关闭阶段保留 error sink，避免迟到的 Chokidar 错误成为未捕获异常。
- 没有发现 DSH 或 Comet 中可以整体替换 Repoctopus 持久事件 Inbox、多仓 Evidence、MR 聚合或合入后收尾的实现。上游相似模块仍然提供设计证据，但产品边界不同。

## 基线差异审查

DSH 两个固定提交之间有约 10,007 个路径变化，主要增长来自客户端、实验包、Session、Agent 和 UI。审计先按 Repoctopus 能力账本确定相关面，再检查相应源码、测试和提交历史，避免用文件数量代替架构判断。

| 上游面 | 差异事实 | Repoctopus 决定 |
| --- | --- | --- |
| Skill Registry | `packages/skill/skill/src` 的 blob 未变化 | 升级发布包，不重写 Registry |
| Filesystem Skill | watcher 关闭错误处理、Agents Home 解析和测试增强 | 移植适用于当前显式 roots 适配器的关闭错误修复；不引入 DSH Home/ctx.fs |
| GitHub Webhook | Handler blob 未变化；路径移动到 `packages/experimental/webhook-github` | 更新来源路径和 commit；保留持久 Inbox 适配 |
| Webhook Runtime | 移到 experimental；现在会在规则卸载时 abort 并 drain 活动回调，但仍是 fire-and-forget Session dispatch | 不采用；它仍无 durable inbox、去重、lease、receipt、retry 和跨进程恢复 |
| Cordis / Loader | Cordis 源码只有发布版本变化；Loader Entry 新增 `moduleNamespace` 并在加载成功后记录 | 更新不可修改快照；由现有 Loader 契约测试保护 |
| Runtime invariants | DSH 删除独立 runtime invariant plugins，把约束收回各领域 | 删除不再存在的 `dsh-invariants` 依赖；Repoctopus 继续在领域状态机和架构检查中维护自身不变量 |
| Jobs / lifecycle | DSH 增加稳定 job id、按所有者限流、first-wins settlement、wait claim 撤销和有序 shutdown | 作为 Operation Ownership 的交叉证据；不采用其进程内 Agent-owned Registry |
| Schedule | DSH 新增持久 Schedule 与 delivery history，但调度目标仍是 Agent Session/消息 | 不替换 Repoctopus Workflow Run；每日上游检查使用 CI schedule，不耦合产品运行时 |
| Session JSONL | 增加写 lease、迁移拒绝、撕裂尾恢复、并发有界扫描和 teardown 顺序测试 | 记录为文件持久化参考；当前 Run/Inbox 已使用 Comet 来源的原子写、身份复核和 intent journal，不引入 Session 格式体系 |
| Telemetry | DSH 增加可取消 HTTP export、重试和 shutdown deadline | Repoctopus exporter 已有 timeout、forceFlush、shutdown 与 durable Evidence outbox；无缺失行为需要移植 |

Comet 没有提交漂移，但本轮重新检查了此前未充分利用的 `domains/agent-learning/experience-journal.ts` 和 `coordinator.ts`。其 `claimEpisode`、过期重领、token/owner fence 与 `renewClaim` 是任务 4.4 Lease/Heartbeat 的有效参考；Repoctopus 已实现处理期续租、失效 token 拒绝结算和卸载后自然恢复。Comet 的协调器只在阶段边界续租，不提供独立定时 heartbeat，因此不能直接替换长处理 Runner。

## 能力覆盖矩阵

状态含义：`采用` 表示直接包或不可修改快照；`适配` 表示登记来源的源码/行为改造；`参考` 表示审查后保留产品原生实现；`无对应` 表示两个上游都没有满足需求的边界。

| Repoctopus 能力域 | Comet 证据 | DSH 证据 | 结论 |
| --- | --- | --- | --- |
| Plugin composition | 无 Cordis 运行时 | `vendor/cordis`、`vendor/loader` | 采用，已升级 |
| Action execution | Native check receipt/storage | Jobs settlement 只管理进程内工作 | 适配 Comet；DSH 不替换 durable Intent/Receipt |
| Engine / resolver / guardrails | `domains/engine` | Agent Loop 面向模型回合 | 适配 Comet；保持纯 Engine |
| Run / trajectory / checkpoint | Engine storage/run store | Session persistence 与迁移体系 | 适配 Comet；DSH 仅作持久化参考 |
| Protected transitions | Classic store/guard、plugin store | Session write lease、迁移拒绝 | 适配 Comet；现有 intent journal 已覆盖产品状态 |
| Process safety | `platform/process` | subprocess-local、win32-process | 已采用 Comet；DSH 的 Agent shell 隔离不进入当前边界 |
| Filesystem safety | race-safe read、atomic file、lock | fs sandbox、observation、Session JSONL | 已采用 Comet；DSH 参考而不叠加第二套抽象 |
| Multi-repository project | 单项目 registry | Workspace/Session 单工作区语义 | 参考后保留 Repoctopus 原生多仓模型 |
| Project onboarding | 无确定性多仓确认流 | Workspace registry 不含本产品确认协议 | 无对应，保留原生 |
| Skill integration | Comet Skill 是产品工作流包 | `ctx.skills` Registry 与 filesystem provider | 采用 Registry、适配 provider；已升级并修复 watcher |
| Specification authority | OpenSpec integration 与事务写入 | 无 Specification Provider | Repoctopus 原生 Provider；Comet 继续作为事务/恢复参考 |
| Platform event ingress | 无通用 webhook runtime | GitHub handler 与 fire-and-forget runtime | 适配 handler；持久 Inbox 保持原生 |
| Platform event runner | Experience Journal claim/renew | Webhook drain、Jobs lifecycle | 已吸收两者不变量；Repoctopus 仍需自己的跨进程 Runner |
| Delivery governance | Native pull-request finish | Workspace changes 记录本地改动 | 适配 Comet 边界；多仓 Human Decision 保持原生 |
| Evidence / receipt / retention | Native Evidence 全套实现 | Session log 不表达跨仓 Evidence | 行为适配 Comet，不引入 DSH Session |
| Repository fingerprint | Native snapshot/fence | 无等价多仓 fence | 适配 Comet |
| Feedback adapters | Agent/project learning | Message/command feedback 面向聊天产品 | 语义不同，保留 Repoctopus Browser/implementation feedback |
| Telemetry | runtime metrics | Cordis OTel service、可取消 exporter | Repoctopus 原生低基数映射已具备有界关闭；上游仅参考 |
| CLI / provenance | Comet CLI 和 installer 强耦合产品 | DSH commander/CLI 强耦合 Agent 产品 | 保留版本化 Repoctopus CLI 与来源检查 |

## 尚未完成能力的上游结论

| 当前任务面 | 上游可复用证据 | 审计决定 |
| --- | --- | --- |
| 4.5 event status/replay/retry | Comet claim/renew；DSH Jobs wait claim、first-wins settlement | 使用现有 Inbox authority 增加管理命令，不引入第二个队列 |
| 4.6 event 运维文档/E2E | DSH GitHub real E2E 的签名请求结构 | 只借鉴 fixture 形状；验证目标必须是 Repoctopus 持久接收与恢复 |
| 5.x post-merge closure | Comet Native PR finish、snapshot/fence、OpenSpec transaction | 继续采用精确 commit、fence、receipt 思路；两个上游都没有多业务 MR 聚合与只允许规格收尾的 guardrail |
| 6.x config/composition | Cordis Loader；Comet project-config transaction | Loader 负责生命周期；配置写入可复用 Comet 的 candidate/quarantine/recovery 思路，但 schema 与 authority 保持原生 |
| 7.x package/deploy/recovery | DSH teardown 与持久 Session E2E；Comet package/tracer E2E | 作为故障矩阵输入，不直接复制产品装配 |

## 每日漂移策略

`npm run check:upstream` 使用 `git ls-remote` 分别比较 DSH/Comet 默认分支提交与固定 release tag 提交；任何分支前进、标签缺失或标签身份变化都返回非零。`.github/workflows/upstream-alignment.yml` 每天执行一次，也支持手动触发。

该检查只负责发现漂移，不自动升级。发现漂移后必须：

1. 更新本机只读上游工作树并确定新的 commit/tag。
2. 按本报告能力矩阵审查相关源码、测试和提交历史。
3. 更新 npm 精确版本、快照、来源摘要、采用决定与契约测试。
4. 运行完整 `npm run verify` 和需要的进程外 E2E 后，才移动固定基线。

标准 `npm run verify` 继续保持离线可重复，只检查固定基线与本地来源一致性；网络漂移检测独立运行，避免开发和发布被临时网络故障污染。

## 非 DSH / Comet 发现

只读 `npm audit --omit=dev` 报告 4 个 high severity 项，链路为 `@fission-ai/openspec@1.14.1 -> fast-glob -> micromatch -> braces`，对应 `GHSA-vfj7-8cjw-p6xm`。npm 给出的修复目标是 OpenSpec `1.14.3`，超出当前精确固定版本。本轮没有执行 `npm audit fix --force`，因为这不是 DSH/Comet 基线的一部分，并且 Specification Provider 升级需要独立兼容性验证；该项应作为下一轮依赖安全升级处理。
