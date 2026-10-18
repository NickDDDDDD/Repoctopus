# Design

## Context

Repoctopus 当前的 Runtime 能持久化 Run、恢复 Journal、探测多仓 Git 状态并治理交付，但 Verify 的输入仍由调用方声明。现有 `platform/process/execute.ts` 只能执行单个受控命令，没有项目级配置、Evidence 生命周期、服务管理或浏览器反馈。架构背景见 `proposal.md` 的 Why，行为边界见本变更四份 delta spec。

实现需同时满足这些约束：

- Engine 保持纯函数，不访问文件、进程、浏览器、网络或 OTel。
- Runtime 是唯一 composition root，负责端口编排、副作用顺序、持久化和恢复。
- 一个团队工作区可以连接多个相互独立的 Git 仓库，本机路径不能进入共享配置。
- Windows 和 Linux 都要正确处理参数、进程树、PID 复用、端口冲突和路径差异。
- Comet 固定基线已经具备 Evidence、Receipt、指纹、Fence、Retention、Lock、Journal 和进程身份等成熟机制；采用时要保留来源、许可证、原始摘要、目标摘要和行为测试。

## Goals / Non-Goals

**Goals:**

- 建立从项目配置、执行 DAG、反馈采集、Artifact 持久化到 Verify Gate 的完整纵切。
- 让命令、Managed/Attached 服务、浏览器 Journey 和视觉检查使用同一 Evidence 契约。
- 让中断、重试、输入漂移和多个 Agent 并发都产生可解释、可恢复的结果。
- 让本地 Evidence 与 OTel 审计数据拥有清晰的隐私边界和稳定关联身份。
- 用合成项目 E2E 验证产品机制，并用独立的真实多仓示例配置验证接入体验。

**Non-Goals:**

- 本次不把 RED/GREEN/REFACTOR 提升为 Runtime 状态机；只采集实际执行的测试事实。
- 本次不实现 OpenSpec、OpenWiki、CodeHub、IDE Hook 或特定视觉模型 SDK。
- 本次不实现远程 Artifact 上传、团队级 Evidence 共享或 SigNoz Dashboard。
- 本次不把浏览器 Journey 扩展成任意脚本执行环境。
- 本次不为旧的实验性配置或未发布状态格式提供兼容迁移。

## Decisions

### 1. Evidence 是独立领域，Engine 只消费门禁投影

新增三个领域边界：

```text
repoctopus.yaml + .repoctopus/local.yaml
                  │
                  ▼
domains/project-configuration
  └─ EffectiveProjectConfig + config digests
                  │
                  ▼
domains/feedback
  └─ EvidenceProfile DAG + Adapter ports + resource requests
                  │
                  ▼
domains/evidence
  ├─ Attempt / Receipt / ArtifactRef
  ├─ InputFingerprint / Fence
  ├─ Bundle / Finding / GateOutcome
  └─ Journal / Retention reachability
                  │
                  ▼
domains/runtime ───────────── platform adapters
                  │
                  ▼
domains/engine receives immutable GateOutcome projection
```

`domains/evidence` 负责不可变事实、聚合规则和状态转换；`domains/feedback` 负责把 Profile 编译为 DAG，并声明命令、服务、浏览器和视觉端口；`domains/project-configuration` 负责共享配置、本机覆盖和探测候选。平台层实现 Git、进程、HTTP、端口、浏览器、文件存储和 OTel。

Engine 不理解截图、进程或浏览器，只接受带稳定身份的 Gate Outcome。这样实施反馈可以演进，而不破坏确定性 Engine。

**备选方案：**把全部逻辑放进 Runtime 服务。该方案初期文件少，但会把门禁聚合、持久化和平台副作用混在一起，难以进行纯领域测试，也会重复当前架构曾经缺少内核的问题，因此不采用。

### 2. Bundle 是内容寻址事实图的清单，不是复制制品的压缩包

核心模型使用版本化 envelope：

- `EvidenceAttempt`：一次显式采集，包含 Profile、开始指纹、节点状态和恢复游标。
- `EvidenceReceipt`：一个节点的一次执行结果，引用输入、输出、诊断和 Artifact。
- `ArtifactRef`：`sha256`、类型、大小、MIME、脱敏状态和本地对象引用。
- `EvidenceBundle`：当前 Attempt 的可达 Receipt/Artifact 清单、结束指纹和 Gate Outcome。
- `Finding`：零测试、日志截断、页面错误、视觉问题、需求冲突等结构化诊断。

Artifact 字节按 SHA-256 保存一次，Bundle 只引用它们。批准快照绑定 Bundle 摘要，由可达性分析保护完整证据闭包。JSON envelope 和 Schema 带独立版本；未知主版本拒绝，兼容的次版本保留未知字段。

**备选方案：**每次运行生成独立目录或压缩包。它容易查看，但重复截图和日志、难以安全清理，也无法表达 Receipt 复用和跨 Bundle 引用，因此不采用。

### 3. 采用 Comet 的机制内核，按 Repoctopus 领域重新落位

以固定 commit `575ab0d172e8105257b3c9172b8c8a9b628960ca` 为唯一上游基线。先为候选模块做依赖闭包分析和行为特征测试，再复制并改造；不从另一个工作树运行源码，也不在产品代码中保留 Comet 命名空间。

| Comet 机制                                             | Repoctopus 处理 | 主要变化                                                           |
| ------------------------------------------------------ | --------------- | ------------------------------------------------------------------ |
| 命令 spawn、进程 identity、进程树终止                  | 改造采用        | 接入结构化 argv、Windows/Linux、资源 lease 和逻辑仓库 cwd          |
| Evidence storage、verification/build evidence、receipt | 改造采用        | 合并成通用 Artifact/Receipt/Bundle，增加多仓和可信等级             |
| Snapshot、pre/post fence、receipt refresh              | 改造采用        | 指纹覆盖多仓 dirty 内容、配置、工具、浏览器、Journey 和 Adapter    |
| Retention                                              | 改造采用        | 按引用闭包保护活动 Attempt、批准快照和最近成功 Bundle              |
| Progress checkpoint、journal、lock、mutation lock      | 改造采用        | 统一到 Repoctopus Runtime Journal 与资源 lease，避免第二套恢复模型 |
| Comet 的产品命令、品牌、Skill 外壳、Dashboard 测试     | 不采用          | 不属于通用 Runtime，且会带入错误产品边界                           |
| 完整 TDD 工作流语义                                    | 延后            | 当前只采集测试事实，后续独立 change 决定状态机                     |

每个新增上游文件都更新 `third_party/comet/source-manifest.json`、MIT 许可证覆盖说明和 adoption report，并记录上游与目标 SHA-256。行为测试用于证明改造后的语义，不依赖文件逐行相同。

**备选方案：**重新实现全部机制，或把 Comet 当运行时依赖。前者增加已知错误和维护成本；后者让 Repoctopus 的领域边界受上游产品结构约束，也无法稳定定制，因此都不采用。

### 4. Profile 先编译为不可变 DAG，再执行节点

配置加载完成后，Compiler 执行 Schema 校验、引用解析、能力检查、环检测和资源冲突预检，生成不可变 Execution Plan。节点至少包含：

- 稳定 `nodeId`、Adapter 类型和逻辑仓库 identity；
- `dependsOn`、`required`、超时、重试分类和缓存策略；
- 结构化输入和期望输出；
- 所需端口、服务、浏览器上下文和临时目录资源。

Scheduler 只运行依赖满足的节点。上游失败将依赖节点标为 `blocked`，独立分支继续。测试、构建和业务断言失败不会在节点内部自动重跑；显式再次执行会创建新 Attempt。仅启动、健康探测和导航的瞬时故障可按有界策略重试，并为每次尝试写 Receipt。

**备选方案：**按 YAML 顺序串行执行。它实现简单，但无法表达前后端并行、阻断原因或资源冲突，也会增加真实多仓项目的反馈时间，因此不采用。

### 5. 命令 Adapter 默认绕过 shell

正式命令使用 `executable` 与 `args[]`，环境只允许从显式名称或本机 secret provider 引用，不把值写入共享配置。Adapter 使用平台原生 spawn 传参，保存可脱敏的命令摘要、退出码、时间、截断情况和结构化测试结果。

Profile 可以显式声明 shell，但需固定 shell identity、标记较低可移植性并触发安全诊断。运行时临时命令只形成 supplemental observation，不满足正式门禁。

日志默认每流最多 20 MiB；超限时停止收集并保存前后各 200 行的脱敏摘要，同时登记原始长度、截断原因和门禁影响。具体默认值由版本化 Schema 提供，项目可以收紧。

**备选方案：**把命令统一保存为字符串。不同 shell 的引用和展开行为无法稳定复现，还会放大注入风险，因此不采用。

### 6. Managed 与 Attached 服务共享健康模型，使用不同信任边界

Managed 服务由 Runtime 启动。Runtime 在 spawn 前获得资源 lease，随后保存 PID、创建时间、可验证进程 identity、命令摘要、进程组、日志 Artifact 和停止策略。依赖 Journey 完成后按反向依赖顺序关闭；恢复时只有 identity 和 lease 都匹配才终止进程树。

Attached 服务只执行观察，不接管生命周期。除非配置的 build identity endpoint 返回并通过当前输入指纹校验，其结果为 `observed`。Runtime 不停止 Attached 进程。

Readiness 是可组合谓词：

- TCP 端口只说明进程开始监听；
- HTTP 健康检查校验 URL、状态码和可选 JSON 字段；
- 日志正则用于没有健康端点的旧服务；
- 组合条件全部满足后才进入 Ready。

每次探测记录时间、结果分类和有界脱敏诊断。端口、服务和临时目录的 lease 写入原子文件并带 owner process identity；陈旧 lease 仅在 owner identity 失效后回收。

**备选方案：**发现端口占用就复用或杀进程。这样可能连接错误代码或误杀用户进程，不能作为可信证据，因此不采用。

### 7. Browser Adapter 使用有限 Journey DSL 和双层浏览器来源

正式 Journey 是共享配置中的声明式动作序列，只提供 `navigate`、`waitFor`、`assertVisible`、`assertText`、`assertUrl`、`screenshot`、`collectConsole` 和 `collectFailedRequests`。动作引用稳定 selector 名称或可审查 locator，不允许任意 JavaScript。

产品依赖精确锁定的 `playwright-core`，不在普通安装或验证时下载浏览器：

- 开发反馈可以发现并使用系统 Chrome/Edge，结果默认是 `observed`；
- 正式浏览器门禁使用 Repoctopus 显式安装命令取得的固定 Chromium revision，校验 revision 后产生 `verified` 证据；
- 缺少固定浏览器时返回可复制的安装命令，当前 Bundle 为 `incomplete`。

每个 Journey 使用隔离 browser context，默认不继承个人 profile、Cookie 或扩展。失败时保存当前截图、有界 DOM 摘要、console/page error 和失败请求；网络响应正文默认不采集。

**备选方案：**复用系统浏览器生成正式证据，或直接接入现有 Playwright CLI。前者版本不可复现，后者难以把 Artifact、指纹、lease 和恢复纳入统一 Runtime，因此只把系统浏览器用于快速反馈，并由产品 Adapter 管理正式运行。

### 8. 视觉检查是端口协议，不绑定模型供应商

Runtime 持久化版本化 `VisualInspectionRequest`，其中只含当前 screenshot ArtifactRef、viewport、页面 identity、验收标准及可选设计参考。IDE、视觉模型或人工 Adapter 返回 `VisualInspectionResponse`，需引用 request ID 与原截图摘要，并输出结构化 finding：区域、严重级别、说明、依据和置信信息。

Core 不引入模型 SDK，不接受只含自然语言的“看起来正常”。没有 Adapter 时，必需视觉节点为 `incomplete`。视觉 finding 默认 advisory；只有共享 Profile 中可以确定验证的规则才阻断。如果 finding 揭示 OpenSpec、设计图、接口契约等权威来源冲突，Runtime 创建 `requirements-conflict` Human Decision，并暂停受影响节点。

**备选方案：**直接在 Runtime 调用某个视觉模型。这样会绑定供应商、凭据和 IDE 能力，也难以区分模型判断与确定性断言，因此不采用。

### 9. 指纹由规范化输入清单计算，并设置采集前后 Fence

Fingerprint Builder 生成排序后的 canonical manifest，再计算 SHA-256。清单包括：

- 每个参与仓库的逻辑 identity、HEAD、tree、dirty 路径及所选文件内容摘要；
- 共享配置与允许的本机覆盖摘要；
- lockfile、构建配置、Journey 和输入 Artifact 摘要；
- Repoctopus、Adapter、工具、Playwright 与浏览器版本；
- Profile、节点和环境能力摘要。

开始 Fence 在首个副作用前持久化，结束 Fence 在最终聚合前重新采集。任何相关输入漂移使 Attempt 成为 `superseded`。只有确定性命令 Receipt 在完全相同指纹和有效期内可以复用；服务、Attached 和浏览器反馈默认重采集。

Dirty worktree 不用 Git status 文本代表内容。Builder 对 Profile 选中的 tracked、modified、staged 和 untracked 文件计算实际摘要，并以逻辑仓库相对路径排序。平台绝对路径从共享摘要中排除。

**备选方案：**只绑定 commit SHA。开发阶段最需要反馈时通常存在未提交修改，该方案会错误复用旧证据，因此不采用。

### 10. 配置分为共享规则与受限本机映射

`repoctopus.yaml` 是版本化、Git 跟踪的共享事实，包含逻辑仓库、Profile、节点、Journey、门禁、保留和隐私规则。`.repoctopus/local.yaml` 被 Git 忽略，只能覆盖 Schema 明确标记的机器相关字段：仓库路径、端口、浏览器路径、视觉反馈交换目录和资源上限。

加载顺序是 parse → 分别校验 → 权限化 merge → 规范化 → 分别计算摘要。共享规则不是普通深合并对象；本机覆盖触碰 `required`、trust、blocking、retention 下限或隐私规则时直接失败。

`project detect` 只读扫描用户显式作用域，识别 Git、package manager、Maven/Gradle、常见服务端口和健康端点，输出带来源、置信度和 unresolved 项的 draft。Agent 补全后，Runtime 通过 Human Decision 展示完整候选或 reconcile diff；用户确认才写正式配置。reconcile 不覆盖人工字段。

**备选方案：**只维护一份含绝对路径的配置，或让探测直接更新正式配置。前者无法团队共享，后者会把启发式判断伪装成事实，因此不采用。

### 11. Journal、资源 lease 和 Artifact Store 共同提供恢复

状态目录使用版本化布局：

```text
.repoctopus/
  local.yaml
  drafts/
  runtime/
    attempts/<attempt-id>/journal.jsonl
    attempts/<attempt-id>/state.json
    leases/<resource-key>.json
  evidence/
    objects/sha256/<prefix>/<digest>
    receipts/<receipt-id>.json
    bundles/<bundle-id>.json
    indexes/
```

状态转换顺序为：写 intent Journal → 执行或登记副作用 → 写 Receipt/Artifact → 写 completion Journal → 原子替换投影状态。恢复通过 Journal 重建投影；已登记且可验证的副作用不重复执行。无法判断的节点进入 `incomplete` 并要求显式新 Attempt，不假装成功。

Retention 从活动 Attempt、批准交付快照、每个 change 最近成功 Bundle 及归档前失败 Bundle 建立 root set，标记可达对象后再清理。清理先获取 store mutation lock；运行中的 lease 或未完成 Journal 阻止删除相关对象。

**备选方案：**进程退出时删除临时目录。它会丢失失败证据和恢复所需身份，也无法支持事后审计，因此不采用。

### 12. OTel 只在本地事实落盘后导出允许列表元数据

Evidence 领域事件先进入现有 Trajectory/Delivery Cursor，再由 Telemetry Adapter 映射：Run 为根 Trace，Attempt 与节点为 Span，Artifact 登记、恢复、重试、漂移和 Gate Outcome 为固定名称 Event/Log，耗时与结果为低基数 Metric。

允许列表只包含稳定 ID、逻辑仓库 identity、Adapter 类型、结果分类、耗时、重试数、Artifact 类型/摘要/大小/MIME/脱敏状态和引用。命令输出、服务日志、健康正文、DOM、截图、视觉请求/响应、绝对路径和 secret 永不作为 OTel 属性。导出失败不回滚 Evidence，Delivery Cursor 支持稍后重放。

本次只验证 OTLP 兼容输出和隐私边界，不把 SigNoz 查询或 Dashboard 结构写进领域层。

**备选方案：**把 Artifact 正文发送到日志后端。它增加敏感泄露、传输和存储成本，也破坏后端中立，因此不采用。

### 13. 验证分为产品合成 E2E 与真实多仓接入验收

Repoctopus 仓内建立合成 fixture，覆盖：

- 多仓指纹、dirty 内容和配置漂移；
- DAG 并行/阻断、零测试、Receipt 复用和四种 Bundle 结果；
- Managed/Attached、健康检查、PID 复用、lease 冲突、崩溃恢复和清理；
- 浏览器 Journey、固定/系统浏览器信任等级及视觉 request/response；
- OTel 关联与原始内容不外泄；
- 上游采用模块的行为特征和来源校验。

独立的 `agent-lab-workspace` 作为接入验收单元，维护自己的 `repoctopus.yaml`，覆盖四个前端包构建、Maven `verify`、零测试 finding、Vite、两个 Spring 服务、两个健康端点、桌面/移动 Journey 和视觉响应。它与产品仓分别评审；四个业务仓只作为输入，不为接入验证引入无关修改。

该示例当前前端使用 fixtures，不调用后端，所以验收证明“同一 Bundle 同时覆盖前后端反馈”，不宣称端到端业务调用已经成立。

**备选方案：**只在真实项目验证。它反馈真实，但故障面太多且难以稳定覆盖恢复和漂移；只做合成测试又无法证明多仓接入可用，因此使用两层验证。

### 14. 并行节点只串行化共享写入，不锁定可并行执行资源

同一 Attempt 的并行节点共享一个 JSONL Journal，因此 `FileEvidenceJournal` 先在进程内按 Attempt 排队，再用跨进程 lease 保护实际追加。这样保留稳定 sequence，同时不会把同一 Runtime 的合法并行写入误报为 lease 冲突。

每个 Browser Journey 启动独立 Chromium 实例和隔离 context。固定浏览器可执行文件是只读安装资产，不是独占运行资源，因此 Browser Adapter 不对可执行文件路径加全局 lease；Profile 外层 lease、独立进程生命周期和 `finally` 清理负责运行边界。真实 Agent Lab 验收发现并修复了这两个锁粒度问题。

## Risks / Trade-offs

- [Evidence 状态和 Artifact 数量快速增长] → 使用内容寻址去重、引用闭包保留、容量上限和显式清理报告。
- [跨平台进程树语义不同] → 采用并改造已验证的进程 identity/termination 机制，并分别在 Windows、Linux 建立行为测试；身份不确定时宁可留下 orphan 诊断也不误杀。
- [dirty worktree 指纹成本过高] → 只摘要 Profile 输入集，流式计算并缓存文件元数据；任何缓存命中都再次核对大小、mtime 和内容策略。
- [浏览器下载体积影响采用] → 普通安装不下载；开发反馈使用系统浏览器，正式门禁通过显式命令安装固定 revision。
- [视觉判断不稳定] → 原图、请求和结构化响应全部绑定摘要；默认 advisory，只有共享 Profile 明确的确定性规则才阻断。
- [本机覆盖成为绕过入口] → Schema 使用字段级覆盖权限，合并后再次验证门禁单调性并把覆盖摘要纳入指纹。
- [日志脱敏遗漏秘密] → 允许列表优先、内建与项目敏感规则组合；无法可靠脱敏的必需 Artifact 采集失败。
- [Comet 代码引入隐式依赖] → 先做依赖闭包与行为测试，逐文件登记来源；不复制产品外壳或运行时全局状态。
- [真实示例的工具版本或网络导致验收波动] → 产品合成 E2E 是确定性门禁，真实接入验收单独报告环境能力与 `incomplete`，不把环境缺失描述为产品成功。

## Migration Plan

1. 先引入版本化配置、Evidence envelope、Schema、文件 Store 和 Comet 来源登记，不接入现有 Verify 门禁。
2. 接入 Fingerprint、Journal、Retention 和命令 Adapter，用合成测试固定崩溃恢复、漂移和复用语义。
3. 接入 Managed/Attached 服务、readiness 和资源 lease，再加入 Browser 与 Visual Adapter。
4. 把 Bundle Gate Outcome 投影给 Engine/Verify，并接入 CLI 与 OTel；旧调用方在切换点之前继续使用现有显式输入。
5. 在独立示例工作区生成候选配置，经用户确认后提交真实配置并完成接入验收。
6. 只有产品 E2E、严格 OpenSpec 校验、来源校验和真实接入报告通过后，才移除旧的非 Evidence Verify 输入路径。

回滚时保留 `.repoctopus/evidence` 与 Journal，不执行破坏性格式降级；代码回退到前一版本后忽略未知目录。若切换后发现阻断问题，恢复旧 Verify 输入路径并把新 Bundle 标为不可用于交付，待修复版本重新读取已有不可变事实。
