# Design

## Context

Repoctopus 已有确定性 Engine、可恢复 Runtime、多仓只读探测、版本化 CLI 和 OpenTelemetry 输出，但尚未拥有 Git 写操作、人工决策或托管平台端口。此前团队流程在 Runtime 外部用报告哈希和逐动作令牌约束 commit、push 与 MR，能够避免越权，却把可回退的本地开发检查点也变成人工阻塞点。

本设计把“开发保存”和“共享发布”拆成不同信任边界。已有 `runtime-foundation` 和 `multi-repository-probe` 规格继续约束纯 Engine、项目事实与恢复语义；本 change 只增加交付领域及其平台端口，不让 GitHub、IDE 或 OpenSpec 进入 Engine。

## Goals / Non-Goals

**Goals:**

- 允许策略控制的本地 checkpoint commit，无需逐次人工批准。
- 用一份验证报告和一个稳定摘要批准完整多仓交付集合。
- 通过结构化 Human Decision 请求适配 IDE 原生交互和 CLI 降级交互。
- 在批准后可恢复地执行多仓 push 与 MR 创建或更新，并读取 CI、评审和合入事实。
- 在 GitHub 上完成首个真实平台纵切，同时保持领域契约与平台无关。

**Non-Goals:**

- 不自动 merge，不绕过托管平台保护，不执行隐式 rebase 或 force push。
- 不实现 CodeHub、GitLab 或其他托管平台 Adapter。
- 不实现具体 IDE 插件；本 change 交付 Adapter 可消费的协议和 CLI 交互降级。
- 不把 OpenSpec、OpenWiki、TDD、测试证据采集或浏览器反馈整合进同一纵切。
- 不提供旧 `agents-workspace` 交付状态或动作令牌的迁移兼容。

## Decisions

### 1. Delivery Domain 是独立聚合，不扩充 Engine 动作类型

新增 `domains/delivery`，负责 `DeliveryIntent`、`DeliverySnapshot`、`HumanDecisionRequest/Response`、`PublicationPlan` 和状态转换。Engine 仍只根据通用 Workflow 推进步骤；Runtime 在工作流进入交付步骤时调用 Delivery Service。

选择独立聚合可以让交付状态拥有自己的幂等键、版本和 Journal，而不把 GitHub 字段塞进通用 `RunState`。备选方案是给 Engine 增加 `git.commit`、`git.push`、`mr.create` 等动作；该方案会让纯领域内核知道平台副作用并扩大每个工作流的 Guardrail 配置，因此不采用。

### 2. 交付意图显式选择仓库

调用方通过版本化 `DeliveryIntent` 提供 change 身份、选定仓库、每仓源分支、目标分支和期望动作。仓库身份引用 Project Snapshot 中的稳定 identity，不接受任意磁盘路径。未选仓库的脏状态产生警告，但不会进入提交或发布。

OpenSpec Adapter 后续可以从 change 产物生成该意图；Delivery Domain 不直接解析 OpenSpec。这样同一能力也能服务非 OpenSpec 工作流。

### 3. 自动 checkpoint 是批准前的本地操作

共享 `repoctopus.yaml` 中的交付策略声明：

- 是否启用自动 checkpoint；
- 保护分支匹配规则；
- commit message 正则或模板；
- 每仓快速检查命令；
- 远端名称和托管平台映射；
- MR 标题与正文模板。

缺少启用开关或提交格式时采取 fail-closed。Runtime 在提交前重新读取分支和工作树，只暂存 Delivery Intent 允许的仓库内容，运行快速检查，再创建普通 commit。它不在保护分支提交，不修改已有提交，不执行 rebase、reset 或 force push。

验证报告本身在请求批准前也作为 checkpoint commit 保存。因此待批准快照只接受干净工作树，批准后无需再制造会改变 HEAD 的“最终 commit”。

### 4. 快照绑定内容事实而不是命令文本

`DeliverySnapshot` 使用规范 JSON 和 SHA-256 计算整体摘要，至少包含：

- change identity 与 schema version；
- 每仓 repository identity、源分支、HEAD、HEAD tree、目标分支和远端目标 OID；
- 验证报告内容摘要与验证结果摘要；
- Delivery Intent、交付策略和 Publication Plan 摘要；
- 创建时间之外的稳定事实。

时间、绝对路径、Token 和本地用户名不进入摘要。仓库按 identity 排序，动作按稳定 action id 排序。时间作为元数据记录但不影响相同输入的摘要。

发布前 Runtime 重新捕获所有绑定事实。任何不同都产生结构化 drift，废止批准并回到 `verification_required`；Runtime 不自行选择旧报告、旧基线或新代码中的任一方。

### 5. Human Decision 是协议事件，IDE 交互是表现层

Runtime 输出版本化 `HumanDecisionRequest`，包含 request id、decision type、change、snapshot digest、报告引用、仓库摘要、计划动作和 `approve/request_changes/reject` 选项。Adapter 声明 `interactive-human-decision` capability 后可以把请求渲染为 IDE 卡片、弹窗或 Web 页面。

响应必须引用 request id 和 snapshot digest，主体身份由可信 Adapter 上下文提供。Runtime 不接受请求正文中自行声明的 actor。响应、时间、主体、来源 Adapter 和决定写入追加式 Trajectory。

CLI 降级命令只在交互式终端展示完整摘要并读取选择，不提供 `--yes`、环境变量或标准输入批量自动批准。纯文本 IDE Adapter 可以把自然语言选择转成相同响应事件。没有可信交互通道时保持 `awaiting_approval`。

### 6. 一次批准授权整份 Publication Plan

批准对象是完整交付快照，不是单个 Git 命令。有效批准允许 Runtime 自动执行计划内的普通 push 和 MR create/update；不再生成逐动作批准令牌。计划以选定仓库 identity、动作类型和稳定 action id 排序。

批准只覆盖计划中列出的动作。merge、force push、删除分支、改写目标分支或新增仓库不属于授权范围，Runtime 必须拒绝。

### 7. 发布使用逐动作 Journal 和远端核对

`platform/delivery` 保存 Publication Journal。每个动作遵循“核对远端事实 → 执行或复用 → 持久化结果”的顺序：

1. 普通 push 前核对本地源 HEAD、远端源 OID 和目标基线；不一致时阻断。
2. push 成功后记录远端分支 OID。
3. MR 创建前按仓库、源分支和目标分支查询开放 MR；已存在则更新并复用，避免响应丢失后重复创建。
4. 每个动作落盘后才执行下一动作。

多仓交付不假装具备事务原子性。中途失败会保留 `partially_published` 状态；恢复时重新核对已完成动作，只从第一个未完成动作继续。如果已完成动作的远端事实发生变化，Runtime 进入人工修复状态。

### 8. 平台端口隔离 GitHub 实现

`MergeRequestPort` 暴露 capability probe、find、create、update 和 status，不暴露 merge。`GitHubMergeRequestAdapter` 使用 GitHub REST API 和注入的 Credential Provider；API base URL 可配置以兼容 GitHub Enterprise，但默认不包含任何具体账户或仓库。

GitHub Adapter 规范化以下状态：MR identity、URL、open/closed/merged、merge commit、CI 汇总、review decision、未解决会话和 branch protection capability。403 套餐限制、401/403 权限错误、404 配置错误和 5xx/网络错误映射为不同诊断。分支保护不可用只记录警告，不伪装成本地保护，也不阻断本纵切的发布。

### 9. 合入只能作为外部事实进入 Runtime

Repoctopus 可以轮询或按调用读取 MR 状态，把人工合入提交和时间记录为 `MergeEvidence`。端口和 CLI 均不提供 merge 操作。所有选定仓库都具有合入证据后，交付状态进入 `merged`，供后续 OpenSpec 同步与归档纵切消费。

### 10. 遥测记录决策和耗时，不记录内容与凭据

交付事件复用现有 OpenTelemetry 出口，记录 change、snapshot、仓库数量、动作类型、状态、重试次数、批准等待时长和发布耗时。验证报告正文、commit diff、MR 正文、Token、Authorization、Cookie、带凭据 URL、绝对路径和环境变量值不得进入普通属性。

## Risks / Trade-offs

- [一个报告批准多个仓库会扩大批准失效范围] → 以 change 为一致性交付单元；漂移报告精确指出发生变化的仓库，重新验证只执行受影响检查，但最终重新生成整体摘要。
- [CLI 交互仍无法提供强对抗性的真人证明] → 本地产品以防止误操作为目标，要求 TTY 且不提供自动批准参数；需要更强身份保证时由认证的 IDE/Web Adapter 提供主体证明。
- [GitHub 首个实现可能诱导领域模型偏向 GitHub] → 用托管平台中立状态和端口契约约束领域层，GitHub 字段只存在于 Adapter。
- [多仓部分发布无法自动回滚] → 明确记录部分完成状态，通过幂等核对继续；不自动删除已推分支或关闭已建 MR。
- [远端目标分支持续变化会频繁使批准失效] → 把目标基线变化视为需要重新评估的真实风险，不用静默 rebase 换取表面流畅。

## Migration Plan

1. 新增交付策略 schema、Delivery Domain 和纯状态转换测试，不改变现有 Runtime 命令。
2. 接入 Git 写端口、Human Decision Port、Publication Journal 和 GitHub Adapter。
3. 增加 CLI 纵切与本地 bare Git remote、mock GitHub API 的 E2E 测试。
4. 更新架构、状态、配置和安全文档，再把新交付工作流作为显式可选入口。
5. 回退时删除新交付入口和状态目录；既有 Runtime Run、Project Snapshot 和遥测格式继续可读。已创建的远端分支或 MR 属于外部事实，回退代码不会自动删除。
