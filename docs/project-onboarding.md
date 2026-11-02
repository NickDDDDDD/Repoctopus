# 项目接入

Repoctopus 使用“确定性扫描 → Agent 补全 → 用户确认”建立团队共享配置。扫描结果只是本机草稿；Agent 不能把自己的推断直接写成团队事实。

## 配置边界

- Workspace 是团队共享、版本化的 Repoctopus 工作流入口。单仓项目可将它嵌入业务仓（Embedded Workspace）；多仓项目通常使用与业务仓同级的独立 Workspace Repository（Dedicated Workspace）。两种拓扑使用同一配置与运行模型。
- `workspace.repositoryId` 必须指向路径为 `.` 的登记仓库。每个 change 的 Change MR 位于这个 Workspace Repository；业务 MR 位于 Delivery Intent 选定的业务仓。Embedded Workspace 可以让两类 MR 同仓，但必须使用不同分支拓扑与 MR 身份。
- `repoctopus.yaml` 进入 Git，保存逻辑仓库、Evidence Profile、团队插件、保留规则和交付策略。
- `.repoctopus/local.yaml` 被 Git 忽略，只保存本机仓库路径、端口、浏览器路径、视觉反馈交换目录和资源上限。
- `.repoctopus/drafts/` 和 `.repoctopus/decisions/` 是本机接入状态，不进入业务仓。

初始化项目仓时可把 [`examples/repoctopus.gitignore`](examples/repoctopus.gitignore) 的规则加入 workspace `.gitignore`。当前规则忽略整个 `.repoctopus/`，因为该目录只包含本机覆盖、草稿、运行状态、证据对象和受管浏览器；共享事实仅写入根目录的 `repoctopus.yaml`。

- `project detect` 只在首次接入或显式重新探测时扫描 `--scan-root` 指定目录中的直接子 Git 仓库，并把 `--workspace` 所在 Git 仓库一同纳入候选。日常 Run、Evidence、Delivery 与恢复不扫描目录，只使用正式配置中登记的仓库。

## 1. 生成探测草稿

在 Repoctopus workspace 中运行：

```powershell
npm run build
$detected = node bin/repoctopus.js project detect --scan-root .. --workspace . --store team-platform --json | ConvertFrom-Json
$draft = $detected.result.file
$draft
```

草稿为每条结论保存 `sources` 和 `confidence`。`unresolved` 列出探测无法确认的命令、端口、健康端点或未知构建系统。命令不会创建或覆盖 `repoctopus.yaml`，也不会写入业务仓。

`--store` 是可编辑的 lowercase kebab-case OpenSpec Store ID；省略时优先沿用已有共享配置，否则从 Workspace 名称派生。草稿的 `storeBinding` 明确记录 Workspace 根与逐业务仓分类：未配置、已指向同一 Store、指向其他 Store、本地规格权威、配置损坏或只读。只有安全的未配置仓会得到 `openspec/config.yaml` 的精确 `before/after` pointer diff；冲突不会生成覆盖操作。用户不希望为某个仓安装 pointer 时，可以在候选中把 selection 改为 `skip`，或重新探测时传 `--skip-pointer repo-a,repo-b`。Runtime 仍通过显式 `--store` 使用权威 Store，不依赖业务仓 pointer。

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
$prepared = node bin/repoctopus.js project prepare `
  --workspace . `
  --draft $draft `
  --candidate .repoctopus/drafts/project-candidate.yaml `
  --json | ConvertFrom-Json
$request = $prepared.result.file
```

Repoctopus 会再次解析完整候选，计算候选摘要，并把当前正式配置摘要、reconcile diff 和未决项绑定到 `HumanDecisionRequest`。等待期间若 `repoctopus.yaml` 改变，原请求失效。

## 4. 由用户确认

```powershell
node bin/repoctopus.js project review --workspace . --request $request
```

`project review` 只接受交互式终端。IDE Adapter 可以展示同一版本化请求，但必须提供经过认证且绑定当前 `snapshotDigest` 的响应。选择批准后，Runtime 才原子写入 `repoctopus.yaml`；请求修改或拒绝不会写入正式配置。

审批摘要同时绑定完整 Store binding proposal，不能在等待期间替换 Store ID、Workspace 根、仓库选择或 pointer diff。批准后的 apply 先用 OpenSpec `store register` 核对或登记当前 Workspace checkout，绝不调用会删除目录的 `store remove`。随后为每个选择安装的业务仓分别保存 Intent、重新比较 `openspec/config.yaml` 的 `before` 内容、原子写入并保存 Receipt；一个仓的操作不伪装成跨仓事务。进程若在写入与 Receipt 之间退出，重试会识别完全相同的 `after` 内容并补记 `recovered`，其他内容则作为输入漂移拒绝且不覆盖。生成的 Workspace 配置、Store metadata 和业务仓 pointer 仍是各仓普通 Git 变化，必须走后续正常 Change/Delivery 发布流程，接入 apply 本身不 commit、push 或创建 MR。

需要从本机安全移除登记时，先停止引用该 Workspace 的 CLI/Desktop，运行 `npx openspec context --store <store-id> --json` 核对精确路径，再运行 `npx openspec store unregister <store-id> --json`。该命令不删除 checkout；禁止把 `store remove` 当作清理命令。业务仓 pointer 的删除必须作为普通 Git change 单独评审。

## 5. 运行首次 Evidence

```powershell
node bin/repoctopus.js evidence plan --workspace . --profile verify --json
$run = node bin/repoctopus.js evidence run --workspace . --profile verify --json | ConvertFrom-Json
node bin/repoctopus.js evidence status --workspace . --attempt $run.runId --json
node bin/repoctopus.js evidence inspect --workspace . --attempt $run.runId --json
```

`plan` 在副作用前完成配置解析、DAG 校验和输入指纹采集。`run` 将 Attempt、Receipt、Artifact 和 Bundle 保存到 `.repoctopus/evidence/`。若进程在运行中中断，使用 `evidence resume --attempt <id>`；恢复不会静默重跑已开始但没有 Receipt 的命令。

## 更新已有项目

再次执行 `project detect` 会生成新草稿，并在 `reconcile` 中列出新增、删除和冲突。现有正式配置保持不变。完成 Agent 补全和用户确认后，才会写入新版本。
