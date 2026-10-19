# 项目接入

Repoctopus 使用“确定性扫描 → Agent 补全 → 用户确认”建立团队共享配置。扫描结果只是本机草稿；Agent 不能把自己的推断直接写成团队事实。

## 配置边界

- `repoctopus.yaml` 进入 Git，保存逻辑仓库、Evidence Profile、团队插件、保留规则和交付策略。
- `.repoctopus/local.yaml` 被 Git 忽略，只保存本机仓库路径、端口、浏览器路径、视觉反馈交换目录和资源上限。
- `.repoctopus/drafts/` 和 `.repoctopus/decisions/` 是本机接入状态，不进入业务仓。

初始化项目仓时可把 [`examples/repoctopus.gitignore`](examples/repoctopus.gitignore) 的规则加入 workspace `.gitignore`。当前规则忽略整个 `.repoctopus/`，因为该目录只包含本机覆盖、草稿、运行状态、证据对象和受管浏览器；共享事实仅写入根目录的 `repoctopus.yaml`。

- `project detect` 只扫描 `--root` 指定目录中的直接子 Git 仓库，并排除 `--workspace` 自身。

## 1. 生成探测草稿

在 Repoctopus workspace 中运行：

```powershell
npm run build
$detected = node bin/repoctopus.js project detect --root .. --workspace . --json | ConvertFrom-Json
$draft = $detected.result.file
$draft
```

草稿为每条结论保存 `sources` 和 `confidence`。`unresolved` 列出探测无法确认的命令、端口、健康端点或未知构建系统。命令不会创建或覆盖 `repoctopus.yaml`，也不会写入业务仓。

## 2. 由 Agent 补全候选

让 Agent 读取 `$draft`，核对各仓 README、构建文件和团队约定，将完整候选写到本机文件，例如 `.repoctopus/drafts/project-candidate.yaml`。Agent 应处理全部 `unresolved`，并保留探测无法重建的人工字段，例如 Evidence 保留规则与 `delivery` 策略。

候选必须通过 [项目配置 Schema](schemas/project-config.schema.json)。共享仓库路径使用相对于 workspace 的路径；成员机器上的绝对路径写入 `.repoctopus/local.yaml`。

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
