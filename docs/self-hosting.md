# 短生命周期自举

Repoctopus 使用自己的 Project composition 执行开发、Archive 发布和一致性检查。没有常驻 Runner、Webhook、Inbox、Lease 或后台轮询；每个命令装配同一套受保护 Service/Contributor，完成后通过 Cordis 生命周期释放资源。

## 自举闭环

```text
OpenSpec 四类规划产物
  → 公开 Change 分支
  → 可信用户批准 Open
  → 深化同一四类规划产物
  → 可信用户批准 Design
  → Build Configure（批准执行模式、TDD、Host 与隔离绑定）
  → Build Plan + Plan Evidence
  → Execute Work Packages
  → Build Check
  → Verify Evidence
  → Archive preflight
  → 关闭规格并发布全部 Business MR + 最终 Change MR
  → 完整 Publication Receipt
  → 原 Change Run completed

下一次 run start 或显式 change reconcile
  → 按 Receipt 拉取远端 head/state
  → 无变化直接结束
  → 有变化进行规格影响审查
  → 需要修正时建立普通后续 Change
```

Archive 不等待任何 MR 合入，也不执行 merge。最终 Change MR 是 Workspace Repository 中对已归档规格的评审入口；Business MR 是业务仓的实现评审入口。两者可以位于同一物理仓库，但不是同一个 MR。

公开分支、Planning approval、Delivery approval 与 MR merge 是不同授权边界。Change 是团队共享工作单元，不归 MR author、Git author、某台机器或某个 Agent 独占；具备相同 Workspace、持久状态和凭据的成员都可以安全恢复命令。

规划阶段只公开分支并取得绑定精确 OID 的规划批准，不创建 Change MR。最终 Change MR 只由 Archive 在规格关闭后发布，用于评审已验证、已归档的完整结果。

## 1. 准备共享配置

从[完整项目配置示例](examples/repoctopus.yaml)开始，至少确认：

- `repositories` 使用稳定逻辑 ID，路径都相对 Workspace；
- `workspace.repositoryId` 指向保存 OpenSpec change 和最终 Change MR 的仓库；
- `skillProviders` 与 `specificationProvider` 是团队准入的插件；
- `lifecycle.skillBindings` 只引用项目 Provider 中受评审的逻辑 Skill，并只使用允许的 guidance/replacement slot；
- `specificationProvider.store` 声明唯一 OpenSpec Store identity；
- `delivery.publication` 声明 GitHub remote、API 地址、模板和 Credential 引用；
- Evidence profile 覆盖所有需要验证的业务仓。

`repoctopus.yaml` 可以提交 Git。它只保存环境变量名，不保存 Credential 值。旧 `platformEvents` 与 `postMerge` 字段会 fail-fast，并提示迁移到 `delivery.publication.apiCredential` 和 `change reconcile`，不会被静默忽略。

## 2. 注入 Credential

```powershell
$env:REPOCTOPUS_GITHUB_TOKEN = '<github-token>'
```

GitHub Token 只由 Delivery/Consistency 平台 Adapter 读取。不要把值放进 YAML、命令行、日志、OTLP 属性、规格或 MR 正文。缺少变量时，涉及远端 API 的命令 fail closed；只读 help/version 在 composition 启动前返回，不读取 Credential 或写持久状态。

## 3. 运行与恢复

```powershell
npm ci
npm run build
node bin/repoctopus.js run start --workspace . --change <change-id> --target main --json
node bin/repoctopus.js run status --workspace . --run <run-id> --json
node bin/repoctopus.js run next --workspace . --run <run-id> --json
```

`run start` 在创建新 Run 前执行一次有界 consistency reconcile。平台暂时不可用只产生警告，不阻断新任务；命令不会启动 listener 或 Timer。

在 Windows x64 上，成功创建或恢复 Change Run 后，Runtime 会自动启动或激活 Desktop Dashboard 并转交当前 Run 上下文。源码正常路径只要求先运行标准 `npm run build`；不需要配置 Desktop executable。`unavailable` 或 `unsupported` 诊断不回滚 Run，也不停止远端 OTLP。完整步骤见[启动或恢复 Desktop Dashboard](desktop-activation.md)。

同一 Workspace/change 的 `run start` 总是创建或恢复同一个稳定 runId，不接受 mode 或代次参数。Open 和 Design 分别产生独立 Human Decision。Design 批准后，Runtime 先执行 Build Configure；Runner 必须先准备 `current`、`branch` 或 `worktree` checkout，并提供每个仓库的精确路径和 Git facts。Runtime 本版只校验并冻结 binding，不创建或切换 checkout。

Build Configure 的 Human Decision 冻结 execution mode、TDD mode、standard review、Host 能力和隔离。随后 Runtime 从 OpenSpec Tasks 产生 Run-local BuildPlan，执行 Plan Evidence、当前 Work Package 和 Build Check。每次 `run next` 只拉取 Runtime 当前 continuation。内嵌 Host 由同一短生命周期 App 注册；外部 Agent/Runner 使用 `run work-claim`/`run work-outcome` 的 Host-bound 协议：claim 通过 `--host-capabilities build.autonomous`（或受证明的 `subagent.dispatch.attested`）声明 Runner 能力，Outcome 通过 `--submission-id <new-id> --result-file <result.json>` 提交受 Runtime schema 校验的结构化 Build 结果。Invocation 中的 Host 快照是跨 CLI 进程的权威身份，后续校验不依赖原进程仍在运行。电脑关闭不需要守护进程：下一位具备 Workspace 状态的 Runner 从同一个 checkpoint 恢复；若原调用结果未知，必须先 `run work-reconcile`，不能自动重放。

### 恢复 Design 返工

当 Runtime 返回 Design 时，先按投影执行当前 `specification.plan` Work。不要删除 `.repoctopus/`、修改 `comet-state.yaml`、重建 Run 或手工把 phase 改回 Build。

新 Design 批准后，Runtime 会检查暂停的 Build 候选：

1. Workspace intent、repository binding 和 Host 策略仍相同则保留 Configuration；否则回到 Configure。
2. Runtime 总是重新接受一份绑定新 planning/task identity 的 Plan。旧 Plan 只作为不可执行候选。
3. 新 Plan 的 package ID、digest 和依赖仍匹配时保留 completion；其他 package 重新执行。
4. Plan Evidence、Build Check 和 Verify Evidence 只有在完整输入仍相同时才保留。

如果 `run next` 在相同 checkpoint 上重复调用，它会返回同一 Work 或 Wait，不会重新创建整套 Build Protocol。未知 Host 或发布结果先运行 reconciliation；只有 Adapter 明确证明未执行时才增加 attempt。

`run status` 始终是只读投影，不会为了显示下一步而重新校验 packet、探测 Host 或写恢复事件。需要动态确认外部执行结果时，使用投影返回的 `reconcile` continuation 进入 `run work-reconcile`；不要用反复查询状态代替 reconciliation。

`work-outcome` 只提交候选事实，不代表 Runtime 已经接受 Action Outcome。Runtime 会先执行当前 Work 的结构、领域和 Validator 校验；可纠正拒绝会返回 `awaiting-correction`，并保留同一 Work、claim、attempt、checkEpoch、invocation 与冻结 packet。Runner 必须使用新的 `submission-id` 提交修正版；相同 ID 与相同内容是幂等重放，相同 ID 改变内容是冲突。Store、Provider 或未知处理错误保留原 submission 等待 Runtime 重试，不应伪装成 Agent 可纠正错误。

Archive 使用两个公共入口：

```powershell
node bin/repoctopus.js run archive-prepare --workspace . --run <run-id> --evidence-attempt <attempt-id> --intent <intent.yaml> --json
node bin/repoctopus.js run archive-publish --workspace . --run <run-id> --work-attempt 1 --json
```

`archive-prepare` 冻结已经验证的代码、报告、Delivery Intent、远端基线与人工授权请求。批准后，`archive-publish` 在隔离 checkout 关闭规格，依次发布业务分支/MR 和专用规格 archive branch/MR，并在接受完整 Publication Receipt 后完成 Run。响应丢失时递增 `--work-attempt` 重跑；Publication Journal 会观察 commit、远端 branch 与 MR，复用已经完成的项，不推进或污染当前开发分支。

后续远端变化使用短生命周期命令：

```powershell
node bin/repoctopus.js change reconcile --workspace . --json
node bin/repoctopus.js change reconcile --workspace . --change <change-id> --json
```

候选来自已完成 Change 的 Publication Receipt，不按 MR 作者过滤。检查结果为 `unchanged`、结构化审查请求或暂时不可用诊断；它不会回退已完成 Run。影响结论是 `no-spec-impact`、`spec-update-required` 或 `uncertain`。后两者需要可信用户参与；需要修正规格时创建引用原 Change、Receipt 与受影响 MR 的普通后续 Change。

## 4. 数据边界

| 数据                                        | 权威位置                       | 运维要求                             |
| ------------------------------------------- | ------------------------------ | ------------------------------------ |
| 团队配置和 Provider 选择                    | `repoctopus.yaml`              | 进入 Git，只引用 Credential 名称     |
| 本机覆盖                                    | `repoctopus.local.yaml`        | 不提交，不得扩大共享权限             |
| Run、Trajectory、Evidence、Action、Delivery | `.repoctopus/`                 | 受限权限、备份和保留策略             |
| Publication Receipt 与一致性审查            | `.repoctopus/` 对应领域 Store  | 不手工编辑；通过命令恢复             |
| OpenSpec change 与主规格                    | Workspace Repository           | 由 Specification Provider 关闭和归档 |
| Token                                       | Credential Provider / 进程环境 | 不落配置、digest、持久状态或 OTel    |

删除 `.repoctopus/` 会丢失本机恢复和幂等事实，不能作为重试手段。全新 clone 不会凭空重建未同步的本地历史；团队应通过受控备份、共享工作目录或后续显式迁移保存仍需恢复的状态。

## 5. 上游关系

- Cordis / Loader 是唯一应用 Runtime 和插件生命周期内核。
- DSH 提供固定版本 Skill Registry；其 Agent、Session、Workspace 和 Webhook Runtime 不进入产品运行时。
- Comet 提供 Engine、Guardrail、Evidence、Journal、Checkpoint、恢复和 Receipt 的设计/源码证据；Repoctopus 采用其短生命周期 Change 思想并扩展多仓 Publication Receipt。
- OpenSpec 是当前可替换的 Specification Provider。
- Matt Skills 只提供方法能力，不建立第二套规格或任务权威。

机器固定基线见 `third_party/upstream-baselines.json`。`npm run check:upstream` 联网检查上游漂移但不自动升级；移动基线必须重新执行采用审计、来源摘要和完整验证。

后续阅读：[交付治理](delivery.md)、[状态与恢复](runtime-state.md)、[插件内核架构](architecture.md)、[启动或恢复 Desktop Dashboard](desktop-activation.md)、[OpenTelemetry 与本地 Desktop](telemetry.md)。
