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

### 多仓验收默认：隔离安装包

多仓验收默认采用 package-first：从当前提交构建并生成 tarball，把它安装到全新的消费者目录，再通过安装包公开的 `bin` 运行 CLI。这样验收对象是即将被其他仓库消费的包，而不是长期源码 checkout 中可能残留的忽略文件。下面的 `<change-id>` 和目标仓路径仍需替换为本轮验收值：

```powershell
$packageDirectory = Join-Path ([IO.Path]::GetTempPath()) ('repoctopus-pack-' + [guid]::NewGuid())
$consumerDirectory = Join-Path ([IO.Path]::GetTempPath()) ('repoctopus-consumer-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $packageDirectory, $consumerDirectory | Out-Null

npm run build
$package = npm pack --json --pack-destination $packageDirectory | ConvertFrom-Json
$tarball = Join-Path $packageDirectory $package[0].filename
npm install --ignore-scripts --omit=dev --prefix $consumerDirectory $tarball
node (Join-Path $consumerDirectory 'node_modules/repoctopus/bin/repoctopus.js') run start --workspace <workspace-path> --change <change-id> --target main --json
```

首次 checkout、`node_modules` 缺失或 `package-lock.json` 更新时，先执行 `npm ci`；依赖未变化时不要求每次验收都重复安装。验收结束后可以删除这两个唯一命名的临时目录。仓库的 `npm run test:package-e2e` 会自动执行同样的打包、隔离安装和公共 `bin` 边界检查，但不能替代针对真实多仓拓扑的生命周期验收。

### 诊断例外：直接运行源码

只有在诊断尚未打包的源码改动时才直接运行源码 checkout。每次切换、拉取或合入源码后，都必须从当前 checkout 重新构建并先执行 freshness preflight：

```powershell
npm ci
npm run build
node scripts/build.mjs --check
node bin/repoctopus.js run start --workspace . --change <change-id> --target main --json
node bin/repoctopus.js run status --workspace . --run <run-id> --json
node bin/repoctopus.js run next --workspace . --run <run-id> --json
```

`npm ci` 仍只在依赖需要恢复时执行；后两个构建命令则不能因为 `dist/` 已存在而省略。缺失 `dist/` 表示源码 CLI 尚未构建；历史 `dist/` 即使仍能启动，也可能属于旧提交，不能作为验证证据。CLI launcher 不会隐式重建源码。

仓库内的 `Continuous integration / verify` 会在 pull request、`main` push 和人工触发时，从干净 checkout 执行 `npm ci` 与 `npm run verify`。这份检查状态不等于服务端已经启用合入保护；如果团队要求失败时阻止合入，仓库管理员还必须在 GitHub 规则中把该稳定检查配置为 required check，并单独验证平台配置。

`run start` 在创建新 Run 前执行一次有界 consistency reconcile。平台暂时不可用只产生警告，不阻断新任务；命令不会启动 listener 或 Timer。

在 Windows x64 上，成功创建或恢复 Change Run 后，Runtime 会自动启动或激活 Desktop Dashboard 并转交当前 Run 上下文。源码正常路径只要求先运行标准 `npm run build`；不需要配置 Desktop executable。`unavailable` 或 `unsupported` 诊断不回滚 Run，也不停止远端 OTLP。完整步骤见[启动或恢复 Desktop Dashboard](desktop-activation.md)。

同一 Workspace/change 的 `run start` 总是创建或恢复同一个稳定 runId，不接受 mode 或代次参数。Runner 必须先建立并公开 source branch 或 worktree；Runtime 在任何 Run/Skill/Work/Desktop 成功写入前校验 attached source、target、remote 与多仓 topology，并冻结不含 path、HEAD、dirty 状态和时间的 `ChangeStartBinding`。等价重放直接采用 Store 中的 current Work，不重建候选 Work；绑定漂移返回公共 conflict code，且不修改 checkpoint。Runtime 本版只观察和校验，不创建或切换 checkout。

不要把四类分支事实混成一个字段：`ChangeStartBinding` 只冻结协调仓启动时的 source/target 坐标；Open 的 `ExecutionWorkspaceIntent` 只记录用户选择的 `current|branch|worktree` 隔离模式；Configure 的 `ExecutionWorkspaceBinding` 逐仓记录各自 branch、HEAD 和 worktree ownership；Delivery intent 最后声明每个发布项的 source/target。branch isolation 不要求全部仓使用协调仓 source branch，也不要求它们位于 delivery target。恢复时 Runtime 比较逐仓 Binding，不能从分支命名推断或回填 Open Intent。

协调仓启动合法并不代表所有业务仓已经可写。Build Plan 形成精确 write scopes 后，Runtime 会在 Plan Evidence 和首个 Execute Work 之前检查每个可写仓的 Binding branch；`main`、`master`、`release/*` 等模式来自启动时冻结的 Delivery Policy，本次 target branch也始终受保护。只读仓不受此限制。若返回 `change.build-plan-protected-branch`，先为诊断列出的仓创建并立即 push source branch/worktree，再对同一 Run 执行下一次 pull；Runtime 会通过 Binding revalidation 回到 Configure，不要修改 Store、伪造新 Plan 或启动另一个 Change。

Open 和 Design 分别产生独立 Human Decision。Open Host Outcome 成功后若 Specification Provider 暂时不可用，Runtime 返回 `reobserve`：下一次 pull 重读 Provider，但保留同一 Work、attempt、check epoch、invocation、Outcome、Receipt 与 Skill consumption；这不是外部结果未知，因此不能执行 `work-reconcile`。严格校验已经成功、后续 planning branch/approval 观测暂时失败时，Work 保持 `validated`，恢复后从 planning gate 继续而不再次调用 Host。Design 批准后，Runtime 才执行 Build Configure。

日常提交造成的 HEAD/worktree 变化是 content drift，不会全局卡住自举 Run；当前阶段仍必须按自己的 frozen input、planning binding、Evidence 或 closure 规则重验。branch、remote、路径、仓库增删与 Workspace/Project 身份变化属于 identity drift，恢复入口保持 fail closed。

Build Configure 的 Human Decision 冻结 execution mode、TDD mode、standard review、Host 能力和隔离。随后 Runtime 从 OpenSpec Tasks 产生 Run-local BuildPlan，执行 Plan Evidence、当前 Work Package 和 Build Check。每次 `run next` 只拉取 Runtime 当前 continuation。内嵌 Host 由同一短生命周期 App 注册；外部 Agent/Runner 使用 `run work-claim`/`run work-outcome` 的 Host-bound 协议。Runner 必须在每次 claim 中声明同一组完整、稳定的 Host 能力，而不是只声明当前 Work 使用的能力；例如 autonomous Build Host 使用 `--host-capabilities build.autonomous,process.execute,repository.read,repository.write,specification.read`，subagent-driven Build Host 将 `build.autonomous` 替换为受证明的 `subagent.dispatch.attested`。Runtime 在持久化 claim 前校验当前 Work 的能力是否为该集合的子集，且不会用当前 Work/packet 反向扩充 Host 身份；Work 的副作用类别和 write scopes 仍逐项限制实际权限。Outcome 通过 `--submission-id <new-id> --result-file <result.json>` 提交受 Runtime schema 校验的结构化 Build 结果。Invocation 中的 Host 快照是跨 CLI 进程的权威身份，后续校验不依赖原进程仍在运行。电脑关闭不需要守护进程：下一位具备 Workspace 状态的 Runner 从同一个 checkpoint 恢复；若原调用结果未知，必须先 `run work-reconcile`，不能自动重放。

Execution Binding 是 Configure 时冻结的授权基线：repository、branch、isolation、worktree owner 与 Host identity 不会因正常开发 commit 改写。Runtime 另行维护 `BuildWorkspaceCheckpoint` 作为逐 Package 的 Git 进度；Runner 负责在授权 write scope 内 commit/push，Runtime 独立观察 HEAD、证明 fast-forward，并原子接受 Package Completion 与下一 checkpoint。Host 的 Package/Check result 不上报 repository digest。未授权仓变化、历史重写或 identity drift 都会 fail closed；Build Check 只接受与最终 checkpoint 精确一致的 workspace。

Plan 因可写仓仍在受保护分支而拒绝时，Runner 负责创建、切换并 push finding 指出的 source branches；Runtime 不代做 Git 操作。随后使用普通 `run next` 或 `run resume`：两者消费同一个 authorized-rebind classifier，只在 rejected candidate、write scopes、旧 Binding、保护策略和 branch-only diff 精确匹配时返回 Configure。若曾被旧恢复路径误写 `reconciliationRequired`，也只有相同授权摘要可以撤销该投影；不要手改 Run Store、恢复旧 checkout 或新建 Change Run。

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

| 数据                                         | 权威位置                       | 运维要求                                |
| -------------------------------------------- | ------------------------------ | --------------------------------------- |
| 团队配置和 Provider 选择                     | `repoctopus.yaml`              | 进入 Git，只引用 Credential 名称        |
| 本机覆盖                                     | `repoctopus.local.yaml`        | 不提交，不得扩大共享权限                |
| Run、Trajectory、Evidence、Action、Delivery  | `.repoctopus/`                 | 受限权限、备份和保留策略                |
| Publication Receipt 与一致性审查             | `.repoctopus/` 对应领域 Store  | 不手工编辑；通过命令恢复                |
| Host Hook、rules、Skill 与 Agent instruction | 原 Host 约定路径               | 保持原位；由输入策略登记并绑定 Evidence |
| OpenSpec change 与主规格                     | Workspace Repository           | 由 Specification Provider 关闭和归档    |
| Token                                        | Credential Provider / 进程环境 | 不落配置、digest、持久状态或 OTel       |

删除 `.repoctopus/` 会丢失本机恢复和幂等事实，不能作为重试手段。全新 clone 不会凭空重建未同步的本地历史；团队应通过受控备份、共享工作目录或后续显式迁移保存仍需恢复的状态。

Host 文件不需要在 Verify 或 Archive 前临时移出 Workspace。已登记的未跟踪 Host 输入会进入
独立 control-plane fingerprint；未知文件仍按产品 dirty 输入处理，已跟踪的团队 Agent
instructions/Skills 仍是产品输入。若 Host 内容在 Evidence 后变化，应重新运行验证，而不是
修改 `.gitignore`、清空状态或绕过 Archive 重验。

## 5. 上游关系

- Cordis / Loader 是唯一应用 Runtime 和插件生命周期内核。
- DSH 提供固定版本 Skill Registry；其 Agent、Session、Workspace 和 Webhook Runtime 不进入产品运行时。
- Comet 提供 Engine、Guardrail、Evidence、Journal、Checkpoint、恢复和 Receipt 的设计/源码证据；Repoctopus 采用其短生命周期 Change 思想并扩展多仓 Publication Receipt。
- OpenSpec 是当前可替换的 Specification Provider。
- Matt Skills 只提供方法能力，不建立第二套规格或任务权威。

机器固定基线见 `third_party/upstream-baselines.json`。`npm run check:upstream` 联网检查上游漂移但不自动升级；移动基线必须重新执行采用审计、来源摘要和完整验证。

后续阅读：[交付治理](delivery.md)、[状态与恢复](runtime-state.md)、[插件内核架构](architecture.md)、[启动或恢复 Desktop Dashboard](desktop-activation.md)、[OpenTelemetry 与本地 Desktop](telemetry.md)。
