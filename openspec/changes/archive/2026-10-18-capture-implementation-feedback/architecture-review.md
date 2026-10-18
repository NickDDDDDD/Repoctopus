# 全量架构与来源复审

## 审查范围

- Repoctopus `app`、`domains`、`platform` 共 97 个生产 TypeScript 源文件。
- 固定 Comet `0.4.5`、commit `575ab0d172e8105257b3c9172b8c8a9b628960ca` 的 Engine、Process、Native Evidence、Snapshot、Receipt、Retention、Checkpoint、Lock、Supervisor 和 Portable Checks。
- 旧 `agents-workspace` 的 Workflow State、Hook、IDE 客户端配置、Skill、批准口令、Git 动作规则和模板项目路径。

机器可检查的能力归属位于 `scripts/architecture-governance.json`，验证入口为 `npm run check:architecture`。

## 结论

Repoctopus 没有复制旧 `agents-workspace` 的 Hook 脚本、Skill、五阶段常量、中文批准口令或 IDE 专有配置。Delivery 领域与旧工作流都涉及 commit、push 和 MR，但当前实现使用独立聚合、不可变交付快照、Human Decision 和可恢复远端动作，不是旧阶段状态机的换名移植。

Comet 的 Engine 与进程安全代码已经按来源清单采用。Evidence、Snapshot、Retention、Journal 和 Lock 在第一版中主要按行为重新实现，其中部分通用文件安全原语没有充分复用；本次已采用并登记 file identity、race-safe read、transient retry 和 atomic write，并强化 Lease、Artifact Store 与仓库 Fingerprint。

## Comet 受保护路径的完整能力闭包

第二轮复审不再以 import 数量或耦合深度作为拒绝采用的理由，而是从 Classic 的实际受保护转换反向追踪不变量。结论是 Comet 没有一个可单独复制的“Evidence Gate”；有效保护由 Classic 和 Native 中多个模块共同完成。

| 闭包环节       | Comet 实现                                                          | Repoctopus 需求与决定                                                                                                                      |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 冻结运行定义   | Skill snapshot、Run identity                                        | 已由不可变 Workflow Package、digest 和每 Run 快照承担，保留 Repoctopus 通用模型                                                            |
| 状态代次       | `checkEpoch`、Run iteration、current step                           | Evidence 绑定 `runId + actionId + stepId + stateVersion + profileId`，比固定阶段更适合任意工作流                                           |
| 可信执行       | Runtime `executeCommandCheck`                                       | 保留 Repoctopus DAG Adapter；命令、服务、浏览器和视觉必须由 Runtime 产生 Receipt，人工成功文本不能替代                                     |
| 输入与环境绑定 | Check snapshot、manifest、environment、log hash                     | 采用其不变量；由多仓 Fingerprint、Adapter identity、开始/结束 Fence、Receipt 和 Artifact 完成                                              |
| 受保护转换     | `classic-guard` 在 state lock 内重新读取和重新评价                  | 改为 Runtime 持有 Run transition lock 后读取当前状态并评价 Gate；评价结果不能在锁外缓存后提交                                              |
| 接受与状态提交 | transition、trajectory、state transaction                           | Bundle 接受事实进入下一 Run state、Trajectory 和 Checkpoint 的同一个恢复 Journal                                                           |
| 崩溃恢复       | state transaction、command invalidation、runtime reconcile          | 恢复未完成状态事务；无法证明完成的 Evidence 保持 incomplete；状态代次变化使旧 Attempt 自动失效                                             |
| 保留策略       | Native evidence dependency closure、mutation lock、cleanup recovery | 活动 Attempt、Runtime 已接受 Bundle、Delivery 批准 Bundle、每 Run/Profile 最近成功与失败证据构成 root；有待恢复 Runtime 事务时清理整体延后 |

Classic 的 OpenSpec 文件检查、固定 `open/design/build/verify/archive` 阶段、文档语言、handoff 文案和 CLI 输出属于产品工作流外壳。它们的职责必须先映射，但不进入 Repoctopus 内核：等价约束由 Workflow Contract、项目配置或具体工作流声明。Classic 的 branch binding 则不是外壳，应由 Repoctopus 多仓 Project Snapshot 和 Delivery Facts 承担。

这也修正了第一轮实验接线：只在 `run record` 提交前调用 `EvidenceGatePort` 仍有校验后到提交前的竞态，并且没有绑定 Action 和状态代次。最终接线必须使用上述受保护事务，不把独立 Gate 查询当成授权票据。

复审最初确认两个未完成的架构闭环：Evidence Gate 尚未进入核心 Runtime 转换，Delivery 批准快照也尚未向 Retention 提供 Bundle root。随后按完整能力闭包完成 AR-006 至 AR-008，并以受保护 Runtime 的真实多仓转换复验；不得再以独立 Evidence Run 的成功结果替代核心 Runtime Gate 证明。

## 能力判定

| 能力                                                | 判定                               | 处理                                                                              |
| --------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| Engine loop、Resolver、Guardrail、Eval              | Comet 源码改造采用                 | 保留来源摘要和行为测试                                                            |
| 结构化进程、进程身份、进程树终止                    | Comet 源码改造采用                 | 保留 Repoctopus 环境变量和端口接口                                                |
| 文件 identity、竞态安全读取、短暂失败重试、原子写入 | 原先重复实现不足                   | 本次采用 Comet 原语，替换简化原子写入                                             |
| Resource Lease                                      | 与 Comet Lock 重叠                 | 保留 resource key 领域，采用文件 identity、竞态安全读取和保守接管规则             |
| Artifact Store                                      | 与 Comet Evidence Storage 重叠     | 保留通用 CAS，改用竞态安全读取与 exclusive publish                                |
| Repository Fingerprint                              | 与 Comet Snapshot 重叠且第一版过简 | 增加选择前后 Fence、两次内容复核、流式安全哈希和路径边界检查                      |
| Attempt、Receipt、Artifact、Bundle                  | 行为参考后重建                     | 保留跨仓通用模型，不引入 Native Change 依赖闭包                                   |
| Evidence Retention                                  | 行为参考后重建                     | root set 模型保留；补齐批准 Bundle 和每 Run 最近成功引用                          |
| Runtime、Delivery、Evidence Journal                 | 原有底层写入协议重复               | Runtime 与 Delivery 共用 RecoverableFileTransition；Evidence 保留并行追加事实模型 |
| 项目 Probe 与 Evidence Fingerprint                  | 表面重复、信任边界不同             | Probe 只生成候选与恢复差异；Fingerprint 生成正式 Evidence 输入，不合并模型        |
| 多仓 Detect、Agent 补全、用户确认                   | Repoctopus 新能力                  | 保留                                                                              |
| Managed/Attached Service、Browser、Visual           | Repoctopus 新能力                  | 保留                                                                              |
| OTel/SigNoz 映射与隐私允许列表                      | Repoctopus 新能力                  | 保留                                                                              |
| Delivery Governance                                 | Repoctopus 新领域                  | 保留，不继承旧 Hook 与阶段状态机                                                  |

## 已修复问题

### AR-001：简化原子写入重复实现成熟原语

旧实现只执行临时文件写入和 rename，没有目录身份、临时文件身份、父目录替换、目录同步和 Windows 短暂占用重试。本次改为从 Comet `native-atomic-file` 改造采用，并复用通用 file identity 与 transient retry。

### AR-002：Lease 只核对 JSON owner

旧 Lease 在 release、rebind 和 stale takeover 时只核对 owner 字段，同路径文件被替换为内容相同的新文件时无法识别。本次把文件对象 identity 加入内存所有权，所有读取使用 race-safe read，rename 前后再次核对身份。

### AR-003：Artifact CAS 发布和读取缺少文件竞态保护

旧 Store 使用普通 read 和 rename；POSIX rename 可以覆盖已存在对象，同大小损坏对象的 `exists` 也可能返回真。本次使用 exclusive hard-link publish、race-safe read 和完整摘要复核。

### AR-004：Fingerprint 没有采集内部 Fence

旧实现只读取一次 Git 选择，再摘要 dirty 文件；选择和读取期间变化可能形成不一致清单。本次在内容摘要前后重新捕获 HEAD、tree 与 dirty path，并对内容再摘要一次；任一变化均抛出 `RepositoryFingerprintChangedError`。

### AR-005：没有全量能力归属与旧工作流遗留门禁

原有 `check:brand` 只检查公共面是否泄露 Comet 名称。本次新增能力账本，要求每个生产源文件恰好属于一个能力；新增旧工作流路径和内容 denylist；来源清单中的目标必须属于 `source-modified` 能力。

## 第二轮复审已修复问题

### AR-006：Evidence Gate 未约束核心 Runtime

已让 Workflow Step 声明 Evidence Profile。Attempt 绑定 Run、Action、Step 和状态版本；Core Runtime 在 transition lock 内重新读取状态、重新核对当前多仓指纹，并把接受的 Bundle、下一状态、Trajectory 和 Checkpoint 写入同一恢复事务。普通 `succeeded` 不能推进受保护步骤。

### AR-007：Retention 未读取完整保护根

Delivery Snapshot 显式绑定并校验 Bundle。Retention 从活动 Attempt、Runtime Checkpoint 已接受 Bundle、Delivery 批准 Bundle、每个 Run/Profile 近期成功和失败审计集合建立 root set；存在待恢复 Runtime 事务时整体延后删除。

### AR-008：Delivery Store 与 Core Runtime Store 重复事务写入协议

领域状态继续分离，底层 lock、durable intent、replay 和 cleanup 已抽成 `RecoverableFileTransition`，Runtime 与 Delivery Store 共用。Evidence JSONL Journal 保留独立模型，因为并行节点追加和恢复语义不同。能力账本会阻止出现未评审的第四套事务协议。

## 旧工作流隔离结果

以下旧资产均未进入 Repoctopus 产品面：

- `scripts/workflow-hook.mjs` 和客户端 Hook 健康证明；
- `oh-my-workflow`、`team-delivery` 及旧项目级 Skill；
- `PLANNING`、`IMPLEMENTING`、`AWAITING_APPROVAL`、`DELIVERING`、`COMPLETED` 阶段常量；
- `批准报告`、`批准动作`、`APPROVE_DELIVERY` 文字协议；
- `.codex`、`.opencode`、`.codebuddy`、`.codearts` 项目配置；
- `.context`、`.rules`、`workspace.yaml`、`project.local.yaml` 和 Agent Lab 专有路径。

未来确需增加 IDE Adapter 时，应通过稳定协议生成客户端配置，并显式更新能力账本；不得恢复由 IDE Hook 自己维护工作流状态的旧架构。
