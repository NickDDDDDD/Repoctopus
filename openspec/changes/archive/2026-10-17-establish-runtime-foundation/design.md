# Design

## Context

Repoctopus 是独立维护的多仓 Agent 工作流产品。一个团队在宿主项目中共享一个 Repoctopus 工作区仓库，工作区与多个业务仓库平级。产品需要在不同 Agent 客户端、不同代码托管平台和不同技术栈之间保持同一套状态、规则、证据和恢复语义。

研究基线为 `rpamis/comet` commit `575ab0d172e8105257b3c9172b8c8a9b628960ca`，版本 `0.4.5`，许可证 MIT。Repoctopus 直接采用适合的成熟源码，而不是通过不稳定的 npm 库接口依赖 Comet，也不把 Comet 仓库作为运行时依赖。采用范围必须由来源清单和偏差记录证明。

## Goals / Non-Goals

**Goals:**

- 建立可以独立测试、构建和分发的 Engine 与 Runtime。
- 用一个真实纵向闭环证明多仓探测、确定性解析、持久化、恢复和 OTLP 输出能够共同工作。
- 保持核心领域模型与 IDE、Git 托管平台、SigNoz 和具体宿主项目解耦。
- 为后续 TDD、反馈、批准、交付、OpenSpec 和 OpenWiki 留下清晰接缝，但不提前实现空洞框架。

**Non-Goals:**

- 不在本切片实现完整团队交付流程。
- 不实现旧状态、旧命令或旧目录兼容。
- 不把截图、完整终端输出、完整 Prompt、模型回复或源码正文直接写入 OpenTelemetry 属性。
- 不构建合规、防抵赖或不可篡改审计系统。
- 不实现独立 `insights` 领域；第一阶段的效果指标由 SigNoz Query 和 Dashboard 从结构化事实聚合。

## End-State Architecture

```text
Repoctopus/
├── bin/
│   └── repoctopus.js
├── app/
│   ├── cli/
│   └── composition-root/
├── domains/
│   ├── engine/                  # 纯状态、Resolver、Guardrail、Eval
│   ├── workflow-contract/       # 工作流包、动作、证据和版本契约
│   ├── runtime/                 # Run 编排与领域端口
│   ├── trajectory/              # 事实流、Checkpoint、恢复和协调
│   ├── project/                 # 多仓项目模型与探测结果
│   ├── evidence/                # 后续结构化证据与制品引用
│   ├── delivery/                # 后续 Git/MR 交付计划
│   └── spec-workflow/           # 后续 OpenSpec 工作流扩展
├── platform/
│   ├── filesystem/
│   ├── process/
│   ├── git/
│   ├── hosting/
│   ├── browser/
│   ├── service/
│   ├── clients/
│   ├── openspec/
│   ├── openwiki/
│   └── telemetry/
│       └── opentelemetry/
├── workflows/                   # 版本化默认工作流包
├── skills/                      # 项目级 Agent Skills 源码
├── deploy/
│   └── signoz/                  # Collector、Dashboard 与告警资产
├── third_party/
│   └── comet/                   # 许可证、来源清单和采用报告
├── scripts/
├── test/
├── docs/
└── openspec/
```

只有本切片需要的目录会立即建立。目录出现在目标架构中不代表要提前创建空实现。

## Decisions

### 1. Engine 是内核，Runtime 是可运行系统

Engine 保持纯函数和端口驱动，只接受 Run、工作流快照、事件和证据投影，返回决定与下一状态。Engine 不读取文件、不执行 Git、不调用网络，也不知道 SigNoz、IDE 或 OpenSpec。

Runtime 负责组合 Engine、工作流包、Run Store、Trajectory、Checkpoint、多仓探测和平台适配器。CLI 和后续 Skill、Hook 都进入同一个 Runtime API，不复制状态判断。

### 2. 采用 Comet 以需求适配为准

先运行候选模块的上游测试并生成依赖闭包。若 Comet 模块满足 Repoctopus 需求且不会引入冲突语义，保留完整边界和测试；只有出现明确需求缺口、产品边界冲突或维护风险时才扩展、改写或重构。

复制的实质源码必须在 `third_party/comet/source-manifest.json` 记录上游 commit、原路径、目标路径、内容摘要和采用方式。产品公共名称、命令和状态路径统一映射为 Repoctopus，来源归属通过许可证和清单表达。

最终采用范围只包含 Engine Loop、Resolver、Guardrail、Eval 和 Workflow Hash。上游文件存储、Skill 依赖、产品 CLI、TUI 和模板不进入产品；工作流类型位于 `domains/workflow-contract`，文件持久化位于 `platform/runtime`，以保持 Engine 的纯领域边界。

### 3. 第一个 tracer slice 穿过真实边界

E2E 在临时父目录创建两个独立 Git 仓库，执行：

```text
project probe
  → run start
  → run status / next
  → run record
  → 结束进程
  → run resume
  → 校验 Trajectory、Checkpoint 和 OTLP 接收结果
```

这条路径必须使用公共 CLI 和构建后的 Node.js 产物，不得直接调用测试专用内部函数完成核心步骤。

### 4. 工作流快照在 Run 内不可变

启动 Run 时对规范化工作流包计算摘要并保存快照。运行期间磁盘上的工作流定义变化不得静默改变已有 Run；Runtime 返回漂移诊断，并要求继续使用原快照或显式启动新 Run。

Run State 同时保存本地 `workflowSource`，Runtime 通过 `WorkflowSourcePort` 读取当前定义并只比较摘要。Engine 始终使用冻结快照；来源不可读或摘要变化只产生 `workflowDrift`，不改变运行中的工作流。

首个默认工作流只需要足够证明多步转换、证据等待、失败和恢复。完整 Open、Design、Build、Verify、Archive 宏观阶段及精确团队步骤在后续工作流 change 中实现。

### 5. Trajectory 是运行事实源

每次有效转换先追加版本化 Trajectory Event，再提交新的 Run State 和 Checkpoint。写入采用临时文件、刷盘和原子替换；中断后通过恢复 Journal 判断操作处于未开始、部分完成或完成状态，并保证重放幂等。

Checkpoint 至少绑定：

```text
runId
stateVersion
workflowDigest
trajectoryOffset
projectSnapshotDigest
artifactManifestDigest
```

恢复时重新探测外部 Git 事实。若仓库路径、身份、HEAD 或工作树摘要已经变化，Runtime 不盲目恢复旧决定，而是返回需要协调的差异。

### 6. 多仓探测只观察，不修改

`project probe` 扫描给定父目录的直接子目录，识别 Git 工作树并生成稳定排序的仓库快照。它不执行 fetch、checkout、clean、commit 或写入业务仓。

仓库快照至少包含规范化仓库标识、本地路径、远端身份、当前分支、HEAD 和工作树摘要。本切片不决定最终共享项目配置格式；后续初始化 change 使用“确定性扫描 + Agent 补全 + 用户确认”生成配置。

### 7. OpenTelemetry 是输出协议，不是领域事实源

Runtime 先写本地 Trajectory，然后把领域事件投影到 OpenTelemetry：

- 一个 Run 对应根 Trace。
- 阶段或步骤执行对应 Span。
- 状态变化、恢复、策略决定和错误对应命名 Event/Log。
- 运行数量、耗时、失败、恢复和发送积压对应低基数 Metric。

事件使用稳定 `event.id`，并携带 `project.id`、`run.id`、`workflow.version`、`stage.name`、`repository.id`、`agent.client` 和 `model.name` 等可用维度。缺失信息保持缺失，不由 Runtime 猜测。

OTel Adapter 异步发送到本机或内网 Collector，并用持久化 Delivery Cursor 记录最后成功批次的 Trajectory 位置。进程重启后从 Cursor 之后重放，稳定 `event.id` 允许查询侧识别重复。网络或 SigNoz 故障只增加发送积压和健康诊断，不改变工作流状态。Collector 的生产配置应使用持久化发送队列；Repoctopus 本切片只提供不含凭据的开发样例和 OTLP 契约测试。

### 8. 遥测默认最小化和脱敏

默认只发送元数据、结果、摘要、耗时、内容哈希和制品引用。属性键采用允许列表；Token、密码、Cookie、授权头、环境变量值和疑似密钥必须在 Adapter 层过滤。

截图、完整日志和测试输出属于制品，不进入普通 OTel 属性。本切片只定义制品引用形状，不实现远程制品存储。

### 9. CLI 同时服务人和 Adapter

公共命令返回稳定退出码。`--json` 输出使用版本化 envelope，包含 `ok`、`command`、`runId`、`result`、`diagnostics` 和 `nextActions`；普通文本由同一结果对象渲染。

状态改变命令必须通过 Runtime 完成，直接编辑 `.repoctopus/` 文件不会获得有效转换。后续 IDE Adapter 和 Skill 只调用公共 Runtime API 或 CLI。

`doctor` 只使用只读投影检查状态、Trajectory、Checkpoint、来源和遥测队列。它发现未完成 Journal 时报告恢复入口，但不重放或完成转换；只有 `run resume` 执行恢复。

### 10. 分发包保留锁定的生产依赖

CLI 构建为 ESM，但 npm package 依赖不内联进单文件 bundle。分发包通过 lockfile 和 package metadata 安装锁定的生产依赖，避免 CommonJS 依赖在 ESM bundle 中依赖动态 `require` 兼容垫片；package E2E 必须从打包产物安装生产依赖后运行。

## Failure and Recovery

| 失败                     | 行为                                             |
| ------------------------ | ------------------------------------------------ |
| 工作流包无效             | 启动前拒绝，不创建半成 Run                       |
| 状态或 Checkpoint 半写入 | 使用恢复 Journal 完成或回滚同一转换              |
| Trajectory 尾部损坏      | 保留文件并返回 doctor 诊断，不静默截断           |
| 仓库在恢复前发生变化     | 返回 reconciliation 差异，旧的下一步决定失效     |
| OTLP 端点不可用          | 本地事实保持有效，异步队列重试，工作流不阻塞     |
| 遥测字段包含敏感信息     | 字段被丢弃或替换，记录本地脱敏诊断               |
| 上游源码闭包引入无关模块 | 停止复制该闭包，记录证据并缩小采用边界           |
| 规格与上游行为冲突       | 暂停受影响实现并请求用户决定，不以成熟度替代需求 |

## Roadmap Slices

1. **Runtime Foundation**：本 change，证明内核、多仓快照、恢复和 OTel 纵向闭环。
2. **Evidence and Feedback**：TDD、Superpowers 方法、浏览器、前端控制台、后端日志和服务反馈。
3. **Human Decisions**：正式验证报告、可信批准、冲突处理和内容绑定。
4. **Client Nerves**：Codex、OpenCode、CodeBuddy、CodeArts Adapter 与能力分级。
5. **Multi-Repo Delivery**：依赖图、Git/MR、CI、合入证据和平台适配器。
6. **Spec and Knowledge**：OpenSpec 收尾事务、OpenWiki 检索与回写。
7. **Project Distribution**：项目初始化、团队配置、Node-only 分发和独立升级。
8. **Engineering Intelligence**：SigNoz Dashboard、告警、Ubuntu 部署和效果评估基线。

每个切片必须独立产生可运行结果，后续切片不得通过提前加入空接口扩大本切片。

## Assumptions

| 假设                                                | 状态                 | 证据或失效条件                                                          |
| --------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- | --- | --------------------------------------- |
| Comet 源码允许复制和修改                            | 已验证               | 固定基线仓许可证为 MIT；复制源码必须保留声明和来源清单                  |
| Comet 没有供本产品依赖的稳定库接口                  | 已验证               | 基线 `package.json` 提供 CLI `bin`，没有公共 `exports` 契约             |
| Runtime 可以使用 Node.js 22.16 或更高版本           | 已验证               | Comet 基线声明 `^22.16.0                                                |     | >=24.0.0`；最终范围由依赖安装与构建验证 |
| SigNoz Community 可以接收 OTLP Trace、Metric 和 Log | 已验证               | SigNoz 自托管通过 Collector 提供 OTLP/gRPC 与 OTLP/HTTP 接入            |
| OTel 故障不应阻止团队开发                           | 用户已确认的目标推论 | 目标是内部追踪、事后排查和效果改进，不是合规审计                        |
| 上游 Engine 闭包可以独立采用                        | 未验证               | 任务 1 的依赖图、测试和最小编译 spike；失败时必须缩小边界或记录重构理由 |
| 多仓 Git 状态可以稳定摘要并安全协调                 | 未验证               | 临时多仓 E2E 必须覆盖 dirty、detached HEAD、路径移动和恢复前 HEAD 变化  |

## Stop Conditions

- 固定 Comet commit、许可证或来源内容与本设计不一致。
- 采用 Engine 必须连带引入 Dashboard、Native workflow 或其他没有当前需求的产品模块。
- 规格、设计、上游行为或测试夹具对同一外部行为给出冲突要求。
- 无法在不修改被探测业务仓的情况下取得所需 Git 事实。
- 状态转换无法在进程中断后做到可诊断且幂等恢复。
- OpenTelemetry SDK 或 Collector 接入要求把 SigNoz 细节带入领域层。

命中停止条件时，受影响实现暂停并记录证据；不受影响的任务可以继续。

## Plan Review

日期：2026-10-17

| 维度     | 初评 | 修订后 | 依据                                                                                                |
| -------- | ---- | ------ | --------------------------------------------------------------------------------------------------- |
| 完整性   | 4/5  | 5/5    | 明确正常流程、状态损坏、部分写入、外部仓变化、遥测中断、重放和停止条件                              |
| 可行性   | 4/5  | 5/5    | 固定上游基线并先做依赖闭包与编译 spike，随后用公共 CLI 完成多仓 tracer E2E                          |
| 范围     | 3/5  | 5/5    | 将完整产品拆为八个垂直切片，本 change 只保留 Runtime Foundation；移除首版 insights 和全部后续空实现 |
| 可测试性 | 4/5  | 5/5    | tasks 为每层列出命令、故障注入、临时多 Git 仓、OTLP 接收和 Node-only package E2E                    |
| 风险     | 4/5  | 5/5    | 风险通过 Stop Conditions、上游来源检查、原子恢复、只读 Git 探测和非阻塞遥测控制                     |
| 假设     | 3/5  | 5/5    | 假设表区分已验证、用户目标推论和实施 spike 才能验证的条件，并给出失效动作                           |

### Scope Challenge Resolution

- 删除独立 `insights` 领域，指标先由 SigNoz 聚合。
- 延后 TDD、视觉与服务反馈、批准、IDE Hook、Git/MR、OpenSpec 收尾、OpenWiki 和项目分发。
- 不建立旧状态升级、第二套编排内核、SigNoz 私有协议或远程制品存储。
- 保留恢复、脱敏、来源治理和真实 tracer E2E，因为删减这些内容会使首个切片无法证明核心正确性。
