# 项目接入

首次接入时，先获取 CLI，再选定一个 Git 仓库作为 Workspace。CLI 探测仓库，Agent 核对并补全候选，维护者审核后，Repoctopus 才写入团队共享配置。此页给出各步骤的细节。可以先按 README 跑通最短路径。[快速开始](../README.md#快速开始) · [CLI 安装](install.md) · [新成员接入](#新成员接入)

## 选择 Workspace

- **单仓**。以业务仓根目录作为 Workspace，审核接入后由 Repoctopus 写入共享配置并准备 `openspec/`。业务 MR 和 Change MR 可以在同一仓库，使用各自的分支和 MR。
- **多仓**。把协调仓和业务仓检出到同一个父目录，例如 `team-platform/` 下的 `workspace/`、`web/` 和 `backend/`。协调仓保存共享配置、OpenSpec 和 Change MR，业务仓保存实现和业务 MR。

OpenSpec Store 是 Workspace 内规格树的逻辑身份，团队共用同一个 ID，例如 `team-platform`。每台机器把该 ID 登记到自己的 Workspace 路径。详见 [Workspace、Store 与实现仓](specification.md#workspacestore-与实现仓)。

## 配置放在哪里

| 位置                                    | 谁维护                 | 放什么                                                                                 |
| --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| Workspace 根目录的 `repoctopus.yaml`    | 团队维护者，提交到 Git | 仓库 ID、相对路径、验证 Profile、交付策略、OpenSpec Store、团队 Skill 和 Collector URL |
| Workspace 内的 `.repoctopus/local.yaml` | 本机用户               | 绝对仓库路径、端口、浏览器、视觉交换目录及资源上限                                     |
| 启动 Agent 或 CLI 的进程环境            | 开发者或 CI 的凭据管理 | GitHub API Token、Collector 认证 Header 等凭据                                         |
| Workspace 内的 `.repoctopus/`           | Runtime                | 探测草稿、审批请求、Run 状态与 Evidence                                                |

批准接入时，Repoctopus 将 `.repoctopus/` 加入 Workspace 的 `.gitignore`。本机覆盖、状态和草稿随该目录留在本机。[示例忽略规则](examples/repoctopus.gitignore)

[共享配置示例](examples/repoctopus.yaml)展示多仓字段的组织方式。按团队实际仓库、验证命令、Skill 和目标环境补全候选，再走下面的审核流程。

| 共享配置项                                                         | 如何填写                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiVersion`、`kind`                                               | 使用示例中的版本和类型。                                                                                                                                 |
| `workspace`、`repositories`                                        | 为 Workspace 和各仓设置稳定 ID。`workspace.repositoryId` 指向路径为 `.` 的登记仓库，其他仓填写相对路径。                                                 |
| `profiles`、`evidence.retention`                                   | 用 `verify` Profile 指定各仓的构建、测试和验收命令。按真实验证范围填写 `covers`，按团队要求设置本地 Evidence 的保留规则。详见 [Evidence](evidence.md)。  |
| `specificationProvider.store`                                      | 使用探测和审批确认的 Store ID，`repositoryId` 指向规格所在的 Workspace 仓库。                                                                            |
| `delivery.checkpoint`、`delivery.publication`                      | 配置受保护分支、检查命令、远端和 GitHub API。凭据位置填环境变量名，例如 `REPOCTOPUS_GITHUB_TOKEN`，由开发环境或 CI 注入值。详见[交付治理](delivery.md)。 |
| `skillProviders`、`lifecycle.skillBindings`、`composition.plugins` | 按需添加团队 Skill 来源、阶段绑定或经过审核的扩展。详见 [Skills](skills.md)和[插件](plugins.md)。                                                        |
| `telemetry.endpoint`                                               | 可选。填写团队的 OTLP/HTTP Collector 基础 URL，详见 [SigNoz 接入](telemetry.md)。                                                                        |

字段形状见[共享配置 Schema](schemas/project-config.schema.json)和[本机覆盖 Schema](schemas/local-project-config.schema.json)。

## 1. 生成探测草稿

在选定的 Workspace Git 仓库根目录运行。CLI 只扫描 `--scan-root` 的直接子 Git 仓库，所以单仓和同级多仓布局都用 `--scan-root ..`。Workspace 必须位于扫描目录下一级。建议使用仅包含本项目仓库的父目录。若扫描结果还包含无关仓库，审核前核对配置候选和 Store pointer 清单。

```powershell
$detected = repoctopus project detect --scan-root .. --workspace . --store team-platform --json | ConvertFrom-Json
$draft = $detected.result.file
$draft
```

草稿为每条结论保存 `sources` 和 `confidence`。`unresolved` 列出探测无法确认的命令、端口、健康端点或未知构建系统。命令不会创建或覆盖 `repoctopus.yaml`，也不会写入业务仓。

`--store` 是可编辑的 lowercase kebab-case OpenSpec Store ID；省略时优先沿用已有共享配置，否则从 Workspace 名称派生。草稿的 `storeBinding.root` 会把 Workspace Root 分类为：已精确登记、健康但本机未登记、缺失、部分/不健康或登记冲突，并绑定固定 OpenSpec 版本、根 manifest 与本机 registry Evidence。只有前三类可进入审批；部分根和冲突必须先按诊断处理，Repoctopus 不会覆盖或自动修复。

同一草稿还明确记录逐业务仓分类：未配置、已指向同一 Store、指向其他 Store、本地规格权威、配置损坏或只读。只有安全的未配置仓会得到 `openspec/config.yaml` 的精确 `before/after` pointer diff；冲突不会生成覆盖操作。用户不希望为某个仓安装 pointer 时，可以在候选中把 selection 改为 `skip`，或重新探测时传 `--skip-pointer repo-a,repo-b`。Runtime 仍通过显式 `--store` 使用权威 Store，不依赖业务仓 pointer。

Store ID 是团队配置，registration 是每机状态：新成员、CI 节点和另一台开发机 clone Workspace 后都必须各自登记相同 ID 到各自的绝对路径。pointer 可选且可按仓跳过，它不负责登记，也不改变 Workspace 的 Specification 权威。

## 2. 由 Agent 补全候选

让 Agent 读取 `$draft`，核对各仓 README、构建文件和团队约定，将完整候选写到本机文件，例如 `.repoctopus/drafts/project-candidate.yaml`。Agent 应处理全部 `unresolved`，并保留探测无法重建的人工字段，例如 Evidence 保留规则与 `delivery` 策略。

候选必须通过 [项目配置 Schema](schemas/project-config.schema.json)。共享仓库路径使用相对于 workspace 的路径；成员机器上的绝对路径写入 `.repoctopus/local.yaml`。

探测到的 required 命令节点会以 `covers: ['*']` 作为安全候选，并产生
`acceptance-coverage` unresolved finding。这里的 `*` 表示“当前节点必须覆盖该 change
的全部 Acceptance”，目的是避免新项目以空 coverage 进入 Build；它不是所有团队的
推荐终态。批准前应按命令的真实证明范围收窄为 `task:<taskId>`、
`requirement:<ref>` 或精确 `acceptance-<sha256>` selector。准备审批时，默认 `verify`
Profile 必须至少有一个声明 coverage 的 required 节点；optional 节点或无 coverage 的
前置节点不能单独满足这个条件。

### 团队插件可信边界

团队插件只能在 `repoctopus.yaml` 的 `composition.plugins` 中声明。每项同时指定静态 Descriptor、模块入口和可选领域配置；两个路径都相对于 workspace。Repoctopus 在执行模块前核对插件 ID、契约版本、来源、能力、权限、状态 Schema 和代码摘要，任一项不符都会拒绝启动，模块求值副作用不会发生。

静态 Descriptor 中的 `configSchema` 使用受限且可审计的 JSON Schema 子集：`type`、`properties`、`required`、`additionalProperties`、`items`、`enum` 和 `const`。不支持的关键字会在准入阶段直接拒绝，不能退化为导入插件后再校验。

`.repoctopus/local.yaml` 不能新增插件、替换 Provider 或扩大权限。团队不直接维护 `cordis.yml`，也不在配置中表达 Loader 或 Fiber；App Boot 只把已经准入的领域插件翻译为 Loader Entry。

## 3. 准备人工决定

```powershell
$prepared = repoctopus project prepare `
  --workspace . `
  --draft $draft `
  --candidate .repoctopus/drafts/project-candidate.yaml `
  --json | ConvertFrom-Json
$request = $prepared.result.file
```

Repoctopus 会再次解析完整候选，计算候选摘要，并把当前正式配置摘要、reconcile diff 和未决项绑定到 `HumanDecisionRequest`。等待期间若 `repoctopus.yaml` 改变，原请求失效。

## 4. 由用户确认

```powershell
repoctopus project review --workspace . --request $request
```

`project review` 只接受交互式终端。IDE Adapter 可以展示同一版本化请求，但必须提供经过认证且绑定当前 `snapshotDigest` 的响应。选择批准后，Runtime 才原子写入 `repoctopus.yaml`；请求修改或拒绝不会写入正式配置。

审批摘要同时绑定完整 Store binding proposal，不能在等待期间替换 Store ID、Workspace 根、固定 Provider、Root disposition、仓库选择或 pointer diff。批准后的 apply 严格按以下顺序执行：

1. 先持久化 `prepare-root` Intent。根缺失时调用仓库固定的 OpenSpec 官方 `init`，根健康时保持内容不变；随后重新观察精确 Workspace Root。
2. 健康证明成立后才执行 `store register`，并通过显式 `context --store <id>` 核对 Store metadata、registry 和 checkout。
3. 为每个选择安装的业务仓分别保存 Intent，重新比较 `openspec/config.yaml` 的 `before` 内容，原子写入并保存 Receipt。
4. 所有前置步骤成功后才发布 `repoctopus.yaml` 与完成状态。

流程绝不调用会删除目录的命令，也不使用 `store setup` 或手工拼装 OpenSpec 私有文件。进程若在官方初始化、登记或 pointer 写入与 Receipt 之间退出，重试会从同一 request 的 Intent 和当前真实状态重新观察：只有可证明由该初始化产生的标准 manifest 或完全相同的 pointer 内容才能补记 `recovered`；出现用户文件、部分根、Store 冲突或身份漂移时停止并保留诊断，不覆盖或删除。生成的 Workspace Root、Store metadata 和业务仓 pointer 仍是各仓普通 Git 变化，必须走后续正常 Change/Delivery 发布流程，接入 apply 本身不 commit、push 或创建 MR。

如果看到 `store_register_root_unhealthy`，说明使用的是尚未具备 Root bootstrap 的旧接入路径，或当前 `openspec/` 已是部分根。不要手工修改 `.repoctopus/` journal，也不要删除已有 `openspec/`。升级后重新运行 `project detect`；缺失根会得到可审批的初始化计划，已存在的不健康根则会给出阻断诊断。

需要从本机安全移除登记时，先停止引用该 Workspace 的 CLI/Desktop，运行 `npx --yes --package @fission-ai/openspec@1.14.3 openspec context --store <store-id> --json` 核对精确路径，再运行 `npx --yes --package @fission-ai/openspec@1.14.3 openspec store unregister <store-id> --json`。该命令不删除 checkout；禁止把 `store remove` 当作清理命令。业务仓 pointer 的删除必须作为普通 Git change 单独评审。

## 5. 运行首次 Evidence

```powershell
repoctopus evidence plan --workspace . --profile verify --json
$run = repoctopus evidence run --workspace . --profile verify --json | ConvertFrom-Json
repoctopus evidence status --workspace . --attempt $run.runId --json
repoctopus evidence inspect --workspace . --attempt $run.runId --json
```

`plan` 在副作用前完成配置解析、DAG 校验和输入指纹采集。`run` 将 Attempt、Receipt、Artifact 和 Bundle 保存到 `.repoctopus/evidence/`。若进程在运行中中断，使用 `evidence resume --attempt <id>`；恢复不会静默重跑已开始但没有 Receipt 的命令。

## 更新已有项目

再次执行 `project detect` 会生成新草稿，并在 `reconcile` 中列出新增、删除和冲突。现有正式配置保持不变。完成 Agent 补全和用户确认后，才会写入新版本。

## 新成员接入

1. 检出团队 Workspace 和需要使用的业务仓，尽量沿用团队相对目录布局。
2. 如果本机布局不同，按仓库 ID 在 `.repoctopus/local.yaml` 覆盖实际路径。例如，团队登记的 `backend` 在另一块盘时可以写成：

   ```yaml
   apiVersion: repoctopus/v1alpha1
   kind: RepoctopusLocal
   repositoryPaths:
     backend: 'D:/team-platform/backend'
   ```

3. 在本机登记团队已批准的 Store ID。沿用第 1 至 4 步，以现有 `repoctopus.yaml` 为候选，核对审批预览只包含预期登记或 pointer。工作区配置已被审批且根健康时，仍需完成本机登记。详见 [OpenSpec Store](specification.md#workspacestore-与实现仓)。
4. 从启动 Agent 或 CLI 的环境注入团队要求的发布凭据和 Collector Header。用 `repoctopus evidence plan --workspace . --profile verify --json` 检查仓库和 Profile 能否解析。

## 启动第一个 Change

在已接入的 Workspace 中，从团队目标分支创建并公开一个 Change 分支。下面以 `main` 为目标，`fix-settings-save-message` 为 Change ID。也可以让 Agent 在收到需求后执行这些命令。

```powershell
git switch main
git pull --ff-only origin main
git switch -c change/fix-settings-save-message
git push -u origin HEAD

$started = repoctopus run start --workspace . --change fix-settings-save-message --target main --json | ConvertFrom-Json
$runId = $started.runId
repoctopus run status --workspace . --run $runId --json
```

在 Agent 对话中同时说明需求、`changeId` 和 `runId`，让它从同一个 Run 继续。Agent 用 `run next` 请求 Runtime 派发下一步，按返回的 continuation 领取 Work、使用执行包里的 Skill 并提交 Outcome。遇到人工决定时，由你在 Runtime 给出的可信交互入口确认。多仓任务在 Build 为需要写入的业务仓准备并推送各自的工作分支。运行中断后，先查原 Run 状态，再按[恢复指南](self-hosting.md#3-运行与恢复)操作。
