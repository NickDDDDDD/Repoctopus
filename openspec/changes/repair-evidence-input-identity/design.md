---
comet_change: repair-evidence-input-identity
role: technical-design
canonical_spec: openspec
---

# Design

## Context

参见 [proposal.md](./proposal.md) 的动机。本次从已合入的 `22b5cd0` 开始，继续使用外部 Comet Classic 控制产品开发，Repoctopus 仅在独立实验多仓接受验证。

原始验收的两个 Evidence Attempt 配置、业务仓、工具、Adapter 和检查计划相同。Workspace 的唯一 Git 差异是两个 Task checkbox 从 pending 提交为 Runtime 已完成状态；第一次证据采集已经读到相同的完成文件，但它当时是 dirty。原始指纹分别为 `6261a7ee9faa0ebb9af845505cbfbffbe21a5ab84bbe8666cc17f0638b18809b` 与 `b147d9ceff741eb8faac0ec54c2be418047170a885bda1d95f6969e8a38ed745`。

已核对的接线缺口：

- `platform/git/evidence-fingerprint.ts` 无条件采集 HEAD、tree 和 dirty，`domains/evidence/fingerprint.ts` 聚合这些原始字段。
- `services/evidence-coordinator.ts` 的实际采集、Receipt 与 Gate 仍使用聚合 profile 指纹，`services/workflow-runs.ts` 的 Archive freshness 比较直接据此返回 Verify。
- `domains/evidence/dependencies.ts` 已有分区与依赖失效模型，但生产入口没有调用；现有覆盖集中在 `test/evidence-dependencies.test.ts`，未证明原始采集到 Archive 的路径。
- 主规格“Evidence 绑定完整输入指纹”仍无条件要求绑定 HEAD/tree；后加的“Evidence 失效必须按声明输入面传播”要求等价收尾不失效。“Archive 关闭前必须重验冻结输入”还描述先 Verify 后 Design，与既有最高受影响权威规则冲突。本次 delta 将这些冲突提交给 Open 与 Design 审查，获批前不实现。

先前 `stabilize-incremental-workflow-recovery` 的任务 7.1—7.3 和 9.1 已描述目标，局部模型验证没有覆盖真实接线，是本轮补齐的依据。

## Goals / Non-Goals

**Goals:** 由真实输入采集建立可持久化、可比较的依赖身份，让 Verify 与 Archive 对同一事实作相同判断；证明合法收尾不重做检查，真实变化仍准确阻断。

**Non-Goals:** 不增加阶段、后台任务或第二套任务/证据权威，不继续旧开发协议，不把任意目录忽略规则当成规划语义，也不改变上一 Change 的 checkout 授权和工作包恢复边界。

## Decisions

### 借鉴逐文件内容与显式依赖，分离原始来源

固定 Comet 提交 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 `domains/comet-classic/classic-check-policy.ts` 默认使用 `git: none`、`taskCheckboxes: ignore`；`classic-check-snapshot.ts` 在实际采集中用规范化 Task requirements 和文件内容建立 manifest，只有策略显式要求才纳入 HEAD/index。

本次采用相同的身份分离原则，按 Repoctopus 的多仓、Contributor 和 Specification Provider 端口重建生产接线。Runtime 仍保留真实 Git observation，用于 Binding、检查期间竞态、发布与审计。证据有效性使用其声明的输入投影；不能简单移除所有 Git 检查或仅在 Archive 加例外。

### Provider 提供规划语义，Git Adapter 观察实际内容

官方工件及 Task 完成归一化由注册的 Specification Provider 给出。Git Adapter 负责稳定枚举和读取实际产品内容；纯领域模块负责依赖排序、摘要和失效闭包。EvidenceCoordinator 作为 Cordis Service 组合这些事实，Engine 的 Run CAS 继续负责受保护状态接受。Evidence 不解析写死的 OpenSpec 路径。

没有精确输入声明的检查保留保守内容依赖；显式声明才能收窄范围。具体共享 Profile 字段与 Provider 投影契约在 Design 深化中列出并提交独立批准，同时保留 argv、cwd、工具和采集实现身份的绑定。

### 将现有模型接入证据生产与恢复

Receipt、Bundle、Gate 和 Verification Input 引用同一版本化依赖记录，Build Check 和 Plan Evidence 保留各自真实输入边界。节点结果复用先核对声明依赖、新鲜度与采集实现，Bundle/Gate 再校验完整 Acceptance Trace。恢复从原 Journal 和 Store 读取依赖，不能从新的聚合 HEAD 推导旧检查身份。

Verify 与 Archive 共用输入观察和比较。输入变化交给既有恢复分类，规划授权变化仍有更高优先级，未知结果保留原 checkpoint。保留项与失效项继续使用现有轨迹和遥测机制记录。

## Risks / Trade-offs

- 内容等价不代表任意命令等价：提供显式 Git/checkbox 依赖，未知依赖使用保守范围，缺少记录 fail closed。
- 排除规划文件可能漏掉真实设计变化：由 Provider 证明身份，记录 Provider/schema/policy，拒绝按目录名排除。
- 读取期间仓库或依赖变化：保持前后观察、文件身份和 Run revision 校验；不得接受混合快照。
- 节点复用可能把未知外部状态当成确定结果：服务、浏览器和 Attached Evidence 保留现有新鲜度及不可复用限制。
- 协议调整影响旧开发数据：明确版本并拒绝不受支持证据，使用新实验 Run，不双读、不自动改写 Store。
- 大仓全量内容采集可能增加开销：允许可靠的内容寻址复用，mtime 仅作提示，不能作为内容相同的证明。

## 验证策略

先建立在当前生产组合上失败的回归，复现真实 dirty→暂存→提交，不能只向纯模型注入“语义未变”。随后通过实际采集、Attempt、Receipt、Bundle、Gate 和 Archive 的同一链路转绿。

多仓公开 CLI 以新进程覆盖 Verify 通过后的完成状态提交、相反调用顺序与重复恢复；比较接受证据、当前 Work、epoch 和真实命令计数。负例覆盖产品内容、规划语义、显式 Git/checkbox、未知文件、控制面、配置、工具及采集期间变化；两个独立声明输入的命令验证仅重采受影响节点。中断恢复必须保留原 Journal、旧失败记录和当前合法断点。

最终用独立依赖安装构建固定候选，避免共享 node_modules 路径进入打包身份；在真实实验多仓复验，并在正式报告区分生命周期 Gate、独立 Profile 和未执行范围。普通决策继续写在本文件，结果进入 Evidence 与验证报告。
