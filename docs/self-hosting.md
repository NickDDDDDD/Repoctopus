# 自举与 Runner 部署

Repoctopus 用自己的 Project composition 执行日常开发命令和一次性 Post-merge 补偿，并用专用 Runner composition 接收合入事件。两者读取同一份 `repoctopus.yaml`，但生命周期不同：普通命令可以装配 Coordinator 与受保护 Action Provider，执行后立即关闭且不持有 HTTP 或后台 Timer；Runner 持续持有 HTTP、Inbox 领取和 Post-merge Fiber。

## 自举闭环

Repoctopus 从公开 Change 分支开始，在业务实现全部合入后才生成最终 Change MR：

```text
开发者或 Agent
  │ OpenSpec 四份规划产物
  ▼
公开 Change 分支 ── 普通 push + 远端 OID 核对，不创建 MR
  │
  ▼ 可信规划批准（只授权实施）
实现 + Evidence + Delivery approval
  │
  ▼
Business MR（默认一个；有明确理由时可显式多个）
  │ 全部由人合入
  ▼
Post-merge 候选
  │ signed webhook（只负责唤醒）        下一次 run start / 显式 reconcile
  ├──────────────────────────────┐       │
  ▼                              ▼       ▼
Runner → durable Inbox ─────────────→ authoritative MR refresh
  │ all business MRs merged
  ▼
same Change Run / archive phase
  ├─ checkout exact merge commits
  ├─ execute Evidence and recheck input fence
  ├─ close change through Specification Provider
  ├─ audit changed paths and content digests
  └─ commit + push + create-or-recover final Change MR
                                         │
                                         ▼ 人工合入
                                      目标分支
```

Change 分支始终位于配置指定的 Workspace Repository。Dedicated Workspace 将它放在独立 Workspace 仓库，业务 MR 位于相邻业务仓；Embedded Workspace 允许 Change 分支与业务实现位于同一物理仓库。规划阶段只公开分支并取得绑定精确 OID 的规划批准，不创建 Change MR。全部 Business MR 合入后，原 Change Run 的 Archive phase 才把验证记录、主规格同步和 change 归档结果提交到该分支，并创建或恢复唯一的最终 Change MR。

公开分支、规划批准、Delivery approval 和最终 Change MR 是四个不同边界：公开分支只保证团队可见和可恢复；规划批准只允许开始实施；Delivery approval 只授权已验证的 Business MR 发布动作；最终 Change MR 只呈现已经收尾的完整 Change，且仍需人工合入。任何一个边界都不能推导另一个边界的授权。

Webhook 不是合入证据，MR 作者也不是 Change owner。Change 是团队共享工作单元；任一成员或 Agent 都可以继续修复和实现，Runner identity 只用于租约与审计。权威事实位于 Delivery、Run、Evidence、Action Receipt、Specification Closure Receipt 和 Event Inbox，因此原开发者离开后，其他 Runner 仍能从持久边界继续。

## 1. 准备共享配置

从[完整项目配置示例](examples/repoctopus.yaml)开始。至少确认：

- `repositories` 的路径都相对 Workspace，逻辑 ID 稳定；
- `skillProviders` 与 `specificationProvider` 指向已准入的插件；
- `platformEvents.github.path` 是独占 webhook 路径，HTTP 端口没有被其他服务占用；
- `postMerge.runnerIdentity` 等于 `platformEvents.runner.identity`；
- `postMerge.evidenceProfile` 存在，并验证收尾所需的全部仓库；
- `verificationPathPrefixes` 是项目根以下的专用验证目录，不能是根目录、业务源码目录或宽泛 glob；
- Post-merge 发布只允许把目标分支普通合入 Change 分支、提交允许路径、普通 push，并创建或恢复最终 Change MR；它不授予 MR merge、force-push、rebase 或删分支能力。

`runnerIdentity` 是同一 composition 内连接 Inbox Lease 与 Post-merge 执行审计的运行身份，不是 Change owner。配置不接受 `changeOwner`、`mrAuthor`、`branchAuthor` 或类似的候选过滤字段；Change 归属来自 change ID 和持久领域事实。

`repoctopus.yaml` 可以提交 Git。它只保存 Credential Provider 和环境变量名，不保存值。

## 2. 注入 Credential

示例配置引用四个环境变量：

```powershell
$env:REPOCTOPUS_GITHUB_WEBHOOK_SECRET = '<webhook-secret>'
$env:REPOCTOPUS_GITHUB_TOKEN = '<github-token>'
$env:REPOCTOPUS_GIT_AUTHOR_NAME = 'Repoctopus Bot'
$env:REPOCTOPUS_GIT_AUTHOR_EMAIL = 'repoctopus@example.invalid'
```

Webhook secret 只进入当前验签内存；GitHub Token 只由平台 Adapter 读取；Git 作者身份只在受保护的 Post-merge 发布 Adapter 构造提交时使用。缺少变量会使相关插件 fail closed。不要把值放进 YAML、命令行、日志、OTel 属性或 MR 正文。

## 3. 启动和停止

先完成安装和构建，再以前台进程启动：

```powershell
npm install
npm run build
node bin/repoctopus.js runner start --workspace . --json
```

成功时标准输出首先给出一个版本化 envelope：`command` 为 `runner start`，`result.status` 为 `ready`，并包含实际 `origin` 和 `compositionDigest`。随后进程保持运行。Webhook URL 是 `origin + platformEvents.github.path`。

生产部署应让服务管理器：

- 把工作目录和 `--workspace` 固定到 Workspace；
- 使用受限操作系统身份，并允许它读取项目仓、写 `.repoctopus/` 与专用临时目录；
- 只向需要的平台暴露配置端口和 webhook 路径；
- 在升级或重启时发送 `SIGINT` 或 `SIGTERM`，等待进程正常退出；
- 保留同一 workspace 的持久目录，不把容器临时文件系统当作权威存储。

团队可以运行多个 Runner。共享同一状态卷的进程用 Inbox Lease 避免重复领取；使用独立状态卷的 Runner 可能重复查询和验证，但收尾发布以公开 Change 分支的精确远端 OID 与普通非强制 push 为最终并发栅栏。先完成发布的 Runner 胜出，其他 Runner 只有在目标同步提交的双 parent、tree、message 和 author，以及关闭提交的 `Repoctopus-Closure-Audit` 摘要都等价时才收敛为 no-op，否则 fail-closed。最终 MR 的并发创建通过相同 head/base 的平台唯一性和 create-or-recover 查询恢复为一个 MR identity。

这套语义保证远端结果安全收敛，但不承诺共享数据库调度、自动扩缩容、无重复计算，或让全新状态卷自动发现历史 Change。Runner identity 变化也不会转移 Change 所有权；新进程仍必须从持久 Delivery 和平台权威事实恢复。

## 4. 数据边界

为每类数据配置与其恢复职责匹配的持久位置：

| 数据                                     | 权威位置                       | 运维要求                                    |
| ---------------------------------------- | ------------------------------ | ------------------------------------------- |
| 团队配置和 Provider 选择                 | `repoctopus.yaml`              | 进入 Git；只引用 Credential 名称            |
| 本机覆盖                                 | `repoctopus.local.yaml`        | 不提交；不得扩大共享策略权限                |
| Run、Journal、Evidence、Action、Delivery | `.repoctopus/`                 | 持久卷、受限权限、备份与保留策略            |
| webhook payload、Inbox 状态和 Lease      | `.repoctopus/events/`          | 按敏感数据处理；禁止复制到日志或遥测        |
| 精确检出与收尾工作树                     | `postMerge.temporaryRoot`      | Repoctopus 专属目录；不要人工复用或混放文件 |
| 规格关闭和验证记录                       | Guardrail 允许的规格及验证路径 | 发布前核对路径集合和内容摘要                |
| Token、secret、Git 作者身份              | Credential Provider / 进程环境 | 不落配置、digest、持久状态或 OTel           |

删除 `.repoctopus/` 会丢失恢复和幂等事实，不能作为重试手段。使用 `event retry`、`run resume`、`evidence resume` 和对应的 `run archive-*` 命令从权威边界恢复。

## 5. 上游关系

Repoctopus 固定并审计以下上游来源：

- **Cordis / Loader**：来自固定 DSH 提交的未修改发布快照，是唯一应用 Runtime 和插件生命周期内核。
- **DSH**：直接使用固定版本 Skill Registry；适配 Filesystem Skill 和 GitHub 验签边界。Agent、Session、Workspace 与 fire-and-forget Webhook Runtime 因语义不匹配而明确排除。
- **Comet**：提供 Engine、Guardrail、原子文件、受保护转换、Evidence、Journal、Checkpoint、恢复和 Receipt 的源码或设计证据；Repoctopus 针对多仓与持久事件模型进行登记后的修改或重建。
- **OpenSpec**：当前 Specification Provider；Workflow 只依赖 Repoctopus 领域契约，可在兼容迁移规则下替换 Provider。
- **Matt Skills**：固定摘要的内置 Skill 内容来源，通过同一个 DSH Registry 注册，不形成第二个 Skill 容器。

机器固定基线见 `third_party/upstream-baselines.json`。`npm run check:upstream` 联网检查 DSH 与 Comet 默认分支和 release tag 是否漂移；每日 CI 只报告漂移，不自动移动基线。升级必须重新执行能力审计、来源摘要和完整验证。

## 6. 观察和恢复

日常诊断从持久事实开始：

```powershell
node bin/repoctopus.js post-merge reconcile --workspace . --json
node bin/repoctopus.js event status --workspace . --envelope <envelope-id> --json
node bin/repoctopus.js delivery status --workspace . --change <change-id> --json
node bin/repoctopus.js run status --workspace . --run <run-id> --json
node bin/repoctopus.js evidence status --workspace . --attempt <attempt-id> --json
```

`post-merge reconcile` 是一次性命令：它枚举当前 workspace 已登记且可能等待收尾的 Delivery，重新查询全部业务 MR，并在命令结束后关闭 composition。日常 `run start` 会先调用相同入口。候选不按 MR 作者、Git 作者或 Runner identity 过滤；Change 分支或最终 Change MR 的提交者不因此获得或承担独占 Change 所有权。

第一版候选发现仍依赖当前 workspace 的 `.repoctopus/deliveries/`。新 clone 如果没有复制或共享该持久状态，不能声称已经发现全部历史 change；这与多个已经发现同一 change 的 Runner 能否安全竞争是两个不同问题。

## 7. 后续步骤

部署 Runner 后，按当前工作选择后续指南：

- [Delivery v2 到 v3 迁移](delivery-v2-migration.md)：迁移旧 Delivery 并重新取得授权。
- [观察和恢复 Post-merge 收尾](post-merge.md)：按持久状态恢复收尾。
- [平台事件处理](platform-events.md)：理解 Inbox、Lease 和死信语义。
- [插件内核架构](architecture.md)：理解 composition 和数据所有权。
