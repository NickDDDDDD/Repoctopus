# DSH / Comet 全量上游对齐审计

审计日期：2026-10-24。机器基线见 `upstream-baselines.json`；本报告覆盖 Repoctopus 能力账本中的全部 19 个能力域。这里的“全量”指按 Repoctopus 产品能力逐域闭合，不等同于逐行复制两个上游仓库。Comet 0.5.0 的逐项增量决定见 `comet/0.5.0-audit.md`。

## 结论

- DSH 发布依赖从 `dsh-v0.2.1-rc.2` 升到 `dsh-v0.2.1-rc.3` / `1f81c047fc48fa190a683e469daa699857e9afe8`，直接依赖统一固定为 `0.2.1-rc.3`；默认分支另行固定并审计到 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。
- Cordis 从 `4.0.4` 升到 `4.0.5`，Loader 从 `1.0.5` 升到 `1.0.6`；两个目录继续保存未修改 npm 发布快照。
- Comet 从 0.4.5 源码基线升级到 `0.5.0` / `aeb1a6598034e28ce46b8422d4dbd8785e607bd7`；当前 `master` 与发布标签指向同一提交。来源仓库统一为 `rpamis/comet`，20 个既有派生文件的上游摘要全部在新提交复核。
- 本轮发现并吸收两个适用修复：Loader 保存原始 module namespace 以支持安全重载；文件 Skill watcher 在 Windows 关闭阶段保留 error sink，避免迟到的 Chokidar 错误成为未捕获异常。
- Comet 0.5.0 的 Workflow Application 与 Classic SDK 提供了五阶段、固定 Skill/权限、审批哈希、稳定 Task ID 和同一 Run 恢复的成熟证据；Classic Archive preflight、官方 OpenSpec 后置校验、Native 本地 Journal、finish create-or-reuse PR 与 resume probe 进入简化 Archive 设计，但其单仓产品外壳不能替换 Repoctopus 的多仓 Evidence、MR 聚合和团队 Workspace。

## 基线差异审查

DSH 两个固定提交之间有约 10,007 个路径变化，主要增长来自客户端、实验包、Session、Agent 和 UI。审计先按 Repoctopus 能力账本确定相关面，再检查相应源码、测试和提交历史，避免用文件数量代替架构判断。

| 上游面 | 差异事实 | Repoctopus 决定 |
| --- | --- | --- |
| Skill Registry | `packages/skill/skill/src` 的 blob 未变化 | 升级发布包，不重写 Registry |
| Filesystem Skill | watcher 关闭错误处理、Agents Home 解析和测试增强 | 移植适用于当前显式 roots 适配器的关闭错误修复；不引入 DSH Home/ctx.fs |
| GitHub Webhook | Handler blob 未变化；路径移动到 `packages/experimental/webhook-github` | 不采用；Archive 和 reconcile 均通过 GitHub API 的短命令边界 |
| Webhook Runtime | 移到 experimental；现在会在规则卸载时 abort 并 drain 活动回调，但仍是 fire-and-forget Session dispatch | 不采用；核心产品不拥有 listener、Inbox 或 daemon |
| Cordis / Loader | Cordis 源码只有发布版本变化；Loader Entry 新增 `moduleNamespace` 并在加载成功后记录 | 更新不可修改快照；由现有 Loader 契约测试保护 |
| Runtime invariants | DSH 删除独立 runtime invariant plugins，把约束收回各领域 | 删除不再存在的 `dsh-invariants` 依赖；Repoctopus 继续在领域状态机和架构检查中维护自身不变量 |
| Jobs / lifecycle | DSH 增加稳定 job id、按所有者限流、first-wins settlement、wait claim 撤销和有序 shutdown | 作为 Operation Ownership 的交叉证据；不采用其进程内 Agent-owned Registry |
| Schedule | DSH 新增持久 Schedule 与 delivery history，但调度目标仍是 Agent Session/消息 | 不替换 Repoctopus Workflow Run；每日上游检查使用 CI schedule，不耦合产品运行时 |
| Session JSONL | 增加写 lease、迁移拒绝、撕裂尾恢复、并发有界扫描和 teardown 顺序测试 | 记录为文件持久化参考；当前 Run/Publication Journal 已使用原子写、身份复核和 intent journal，不引入 Session 格式体系 |
| Telemetry | DSH 增加可取消 HTTP export、重试和 shutdown deadline | Repoctopus exporter 已有 timeout、forceFlush、shutdown 与 durable Evidence outbox；无缺失行为需要移植 |

Comet 0.5.0 是一次显著升级。新增的 Runtime SDK、Workflow Application、Classic SDK、Application Hook、静态流程定义、运行视图与 Dashboard trace 共同把产品工作流约束下沉到可恢复 Runtime。Repoctopus 立即采用异步命令的进程树清理修复；生命周期能力进入 `establish-change-lifecycle`，而 POSIX 进程组探测、有界 Plugin Store 读取和 Native Snapshot 限额竞态复核列为独立维护 change 候选。完整证据与取舍见 `comet/0.5.0-audit.md`。

## 能力覆盖矩阵

状态含义：`采用` 表示直接包或不可修改快照；`适配` 表示登记来源的源码/行为改造；`参考` 表示审查后保留产品原生实现；`无对应` 表示两个上游都没有满足需求的边界。

| Repoctopus 能力域 | Comet 证据 | DSH 证据 | 结论 |
| --- | --- | --- | --- |
| Plugin composition | 无 Cordis 运行时 | `vendor/cordis`、`vendor/loader` | 采用，已升级 |
| Action execution | Native check receipt/storage | Jobs settlement 只管理进程内工作 | 适配 Comet；DSH 不替换 durable Intent/Receipt |
| Engine / resolver / guardrails | `domains/engine` | Agent Loop 面向模型回合 | 适配 Comet；保持纯 Engine |
| Run / trajectory / checkpoint | Runtime SDK、固定 Workflow Definition、Action claim/outcome | Session persistence 与迁移体系 | 适配 Comet；统一为一个 Change Run，DSH 仅作持久化参考 |
| Protected transitions | Classic store/guard、plugin store | Session write lease、迁移拒绝 | 适配 Comet；现有 intent journal 已覆盖产品状态 |
| Process safety | `platform/process` | subprocess-local、win32-process | 已采用 Comet；DSH 的 Agent shell 隔离不进入当前边界 |
| Filesystem safety | race-safe read、atomic file、lock | fs sandbox、observation、Session JSONL | 已采用 Comet；DSH 参考而不叠加第二套抽象 |
| Multi-repository project | 单项目 registry | Workspace/Session 单工作区语义 | 参考后保留 Repoctopus 原生多仓模型 |
| Project onboarding | 无确定性多仓确认流 | Workspace registry 不含本产品确认协议 | 无对应，保留原生 |
| Skill integration | Workflow Application 固定 Skill、能力、side effect 与 scope | `ctx.skills` Registry 与 filesystem provider | 采用 DSH Registry 与 Cordis 组合；吸收 Comet 的 Action 绑定和写权限不变量 |
| Specification authority | OpenSpec integration 与事务写入 | 无 Specification Provider | Repoctopus 原生 Provider；Comet 继续作为事务/恢复参考 |
| Platform event ingress | 无通用 webhook runtime | GitHub handler 与 fire-and-forget runtime | 不采用；核心产品删除 Webhook/Event Inbox，按需 reconcile 直接读取平台状态 |
| Platform event runner | Experience Journal claim/renew | Webhook drain、Jobs lifecycle | 不采用常驻 Runner；命令级 Journal 和 observe-before-retry 提供恢复边界 |
| Delivery governance | Classic preflight；Native finish 创建或复用 PR 后返回 | Workspace changes 记录本地改动 | 采用发布即完成；多仓 Publication Receipt 保持原生且不等待合入 |
| Evidence / receipt / retention | Native Evidence 全套实现 | Session log 不表达跨仓 Evidence | 行为适配 Comet，不引入 DSH Session |
| Repository fingerprint | Native snapshot/fence | 无等价多仓 fence | 适配 Comet |
| Feedback adapters | Agent/project learning | Message/command feedback 面向聊天产品 | 语义不同，保留 Repoctopus Browser/implementation feedback |
| Telemetry | runtime metrics | Cordis OTel service、可取消 exporter | Repoctopus 原生低基数映射已具备有界关闭；上游仅参考 |
| CLI / provenance | Comet CLI 和 installer 强耦合产品 | DSH commander/CLI 强耦合 Agent 产品 | 保留版本化 Repoctopus CLI 与来源检查 |

## 尚未完成能力的上游结论

| 当前任务面 | 上游可复用证据 | 审计决定 |
| --- | --- | --- |
| Archive publication | Comet Native PR finish、snapshot/fence、OpenSpec transaction | 采用精确 commit、普通 push、create-or-reuse MR、CAS 和 receipt；不等待 merge |
| Event/Post-merge retirement | Comet 无合入等待或通用 Webhook runtime | DSH Webhook 位于 experimental 且面向 Session dispatch | 删除产品事件链，保留 Delivery Provider 的 GitHub API 端口 |
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

该发现已在独立原子升级中处理：OpenSpec 从 `1.14.1` 精确升级到 `1.14.3`（tag commit `c794978f4f8845ce59693373c9dd882ee776588c`）。上游用 `tinyglobby`、`picomatch` 和 `brace-expansion` 替代 `fast-glob`，移除了 `micromatch -> braces` 与 `GHSA-vfj7-8cjw-p6xm` 链路；Repoctopus 没有使用 `npm audit fix --force`。升级后的 Specification Provider 重新覆盖 inspect、严格 validate、prepareClosure、幂等 close 与打包 CLI 契约，生产依赖审计恢复为 0 个已知漏洞。
