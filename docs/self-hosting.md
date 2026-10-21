# 自举与 Runner 部署

Repoctopus 用自己的 Project composition 执行日常开发命令，并用专用 Runner composition 接收合入事件和完成规格收尾。两者读取同一份 `repoctopus.yaml`，但生命周期不同：普通命令执行后立即关闭；Runner 持续持有 HTTP、Inbox 领取和 Post-merge Fiber。

## 自举闭环

```text
开发者或 Agent
  │ OpenSpec change + implementation + Evidence
  ▼
Delivery checkpoint ── commit + push + remote OID verification
  │
  ▼
业务 MR + 协调 MR ── 人工评审与合入
  │ signed webhook (wake-up only)
  ▼
Runner → durable Inbox → authoritative MR refresh
  │ all business MRs merged
  ▼
unique Post-merge Run
  ├─ checkout exact merge commits
  ├─ execute Evidence and recheck input fence
  ├─ close change through Specification Provider
  ├─ audit changed paths and content digests
  └─ commit + push + update the existing coordination MR
```

Webhook 不是合入证据，开发者进程也不是收尾状态的持有者。权威事实位于 Delivery、Run、Evidence、Action Receipt、Specification Closure Receipt 和 Event Inbox，因此原开发者离开后，Runner 仍能从持久边界继续。

## 1. 准备共享配置

从[完整项目配置示例](examples/repoctopus.yaml)开始。至少确认：

- `repositories` 的路径都相对 coordination workspace，逻辑 ID 稳定；
- `skillProviders` 与 `specificationProvider` 指向已准入的插件；
- `platformEvents.github.path` 是独占 webhook 路径，HTTP 端口没有被其他服务占用；
- `postMerge.runnerIdentity` 等于 `platformEvents.runner.identity`；
- `postMerge.evidenceProfile` 存在，并验证收尾所需的全部仓库；
- `verificationPathPrefixes` 是项目根以下的专用验证目录，不能是根目录、业务源码目录或宽泛 glob；
- 发布操作严格等于 `commit`、`push`、`merge_request.update`，不授予 merge、force-push、rebase 或删分支能力。

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

- 把工作目录和 `--workspace` 固定到 coordination workspace；
- 使用受限操作系统身份，并允许它读取项目仓、写 `.repoctopus/` 与专用临时目录；
- 只向需要的平台暴露配置端口和 webhook 路径；
- 在升级或重启时发送 `SIGINT` 或 `SIGTERM`，等待进程正常退出；
- 保留同一 workspace 的持久目录，不把容器临时文件系统当作权威存储。

当前版本面向单工作区 Runner。租约支持崩溃恢复和旧 Token fence，但不等同于生产级多节点高可用承诺。

## 4. 数据边界

| 数据                                     | 权威位置                       | 运维要求                                    |
| ---------------------------------------- | ------------------------------ | ------------------------------------------- |
| 团队配置和 Provider 选择                 | `repoctopus.yaml`              | 进入 Git；只引用 Credential 名称            |
| 本机覆盖                                 | `repoctopus.local.yaml`        | 不提交；不得扩大共享策略权限                |
| Run、Journal、Evidence、Action、Delivery | `.repoctopus/`                 | 持久卷、受限权限、备份与保留策略            |
| webhook payload、Inbox 状态和 Lease      | `.repoctopus/events/`          | 按敏感数据处理；禁止复制到日志或遥测        |
| 精确检出与收尾工作树                     | `postMerge.temporaryRoot`      | Repoctopus 专属目录；不要人工复用或混放文件 |
| 规格关闭和验证记录                       | Guardrail 允许的规格及验证路径 | 发布前核对路径集合和内容摘要                |
| Token、secret、Git 作者身份              | Credential Provider / 进程环境 | 不落配置、digest、持久状态或 OTel           |

删除 `.repoctopus/` 会丢失恢复和幂等事实，不能作为重试手段。使用 `event retry`、`run resume`、`evidence resume` 和 `delivery resume` 从对应权威边界恢复。

## 5. 上游关系

- **Cordis / Loader**：来自固定 DSH 提交的未修改发布快照，是唯一应用 Runtime 和插件生命周期内核。
- **DSH**：直接使用固定版本 Skill Registry；适配 Filesystem Skill 和 GitHub 验签边界。Agent、Session、Workspace 与 fire-and-forget Webhook Runtime 因语义不匹配而明确排除。
- **Comet**：提供 Engine、Guardrail、原子文件、受保护转换、Evidence、Journal、Checkpoint、恢复和 Receipt 的源码或设计证据；Repoctopus 针对多仓与持久事件模型进行登记后的修改或重建。
- **OpenSpec**：当前 Specification Provider；Workflow 只依赖 Repoctopus 领域契约，可在兼容迁移规则下替换 Provider。
- **Matt Skills**：固定摘要的内置 Skill 内容来源，通过同一个 DSH Registry 注册，不形成第二个 Skill 容器。

机器固定基线见 `third_party/upstream-baselines.json`。`npm run check:upstream` 联网检查 DSH 与 Comet 默认分支和 release tag 是否漂移；每日 CI 只报告漂移，不自动移动基线。升级必须重新执行能力审计、来源摘要和完整验证。

## 6. 观察和恢复

日常诊断从持久事实开始：

```powershell
node bin/repoctopus.js event status --workspace . --envelope <envelope-id> --json
node bin/repoctopus.js delivery status --workspace . --change <change-id> --json
node bin/repoctopus.js run status --workspace . --run <run-id> --json
node bin/repoctopus.js evidence status --workspace . --attempt <attempt-id> --json
```

分阶段恢复步骤见[观察和恢复 Post-merge 收尾](post-merge.md)，Inbox 语义见[平台事件处理](platform-events.md)，composition 和数据所有权见[插件内核架构](architecture.md)。
