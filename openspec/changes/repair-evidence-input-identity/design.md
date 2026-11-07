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

没有精确输入声明的检查保留保守内容依赖；显式声明才能收窄范围。以下契约是本轮 Design 候选，批准后才实施。

### Profile 输入声明

在 command 节点增加可选 `inputs`，不另设命令策略文件。command 的 executable、args、cwd、timeout、cache 和 required/covers 继续由同一共享 Profile 管理；Host 不能用 Outcome 改写它们。

```yaml
inputs:
  schemaVersion: 1
  repositories:
    - repository: frontend
      files: ['src/**', 'package.json', 'package-lock.json']
      outputs: ['dist/**']
    - repository: shared-library
      files: ['src/**', 'package.json']
  git: none
  taskCheckboxes: ignore
  env: [NODE_ENV]
```

- `repositories` 省略时覆盖全部登记仓，`files` 省略时覆盖该仓保守内容集合。显式空列表拒绝，不能借空集合产生零输入成功证据。
- 显式仓库集合是该命令声明的完整跨仓读取范围；仓库名只能引用当前项目登记项。路径使用仓库根相对的 `/` 分隔，支持字面路径及 `*`、`?`、`**`，拒绝绝对路径、`..`、NUL、越界 symlink 和未支持语法。
- `outputs` 默认空，仅排除该命令明确声明写出的路径；文件同时作为该命令的显式输入和输出时拒绝歧义。后继节点读取前驱产物时，仍绑定该产物实际内容，不能继承前驱的输出排除。
- `git` 默认 `none`；`all` 绑定所选仓的 HEAD、tree 和 index 内容身份。原始分支、remote、topology、checkout ownership 始终经过独立授权核对，不受此开关影响。
- `taskCheckboxes` 默认 `ignore`，仅对 Provider 证明属于当前 change、且完成状态与当前 Run 接受事实一致的官方 Tasks 生效。`include` 额外绑定其实际内容；未被 Provider 认领的文件维持普通产品输入。
- `env` 默认空，值仅形成有域隔离的摘要，不保存或上传环境变量原值。Windows 按环境键大小写规则去重。Node、实际解析的命令程序及当前 Contributor/Adapter 身份始终绑定，命令程序不可可靠识别时禁止复用。
- 各节点绑定其有效配置及输入声明摘要，不能让无关节点条目替代当前命令身份。配置整体仍需通过当前 Run 的配置与 composition 权威；不兼容变化不能借节点级复用绕过正式恢复。
- 服务、浏览器、视觉和 Specification 节点保持现有采集及新鲜度规则，本轮不为其开放命令缓存选项。它们使用保守依赖并保留实际上游输入；`inputs` 放在不支持的节点类型时直接拒绝。

### Provider 投影与稳定文件采集

`SpecificationWorkspace` 增加只读的证据输入投影端口，输入是当前 change、绑定的 Specification Root 和已有规划观察。返回版本化投影，记录 Provider/schema/policy、稳定 repository ID、逐个官方工件的仓内路径、实际读取内容摘要和语义摘要。语义投影不包含本机绝对路径、发布 OID、mtime 或 checkbox 状态。Tasks 复用现有 Task revision、依赖、Acceptance 与 Requirement 语义解析；完成合法性仍依据当前 Run 与 Task completion receipt，不能从勾选反推实现成功。

Provider 负责官方路径及语义，Git Adapter 核对投影中的实际字节来源，保证没有把另一个文件的语义套用到当前内容。状态、schema、元数据、路径、Provider 或任务映射不能证明时 fail closed；不以预先保存的 semantic digest 跳过实际读取。

EvidenceCoordinator 的 `plan`/观察入口接受可选 workflowRunId，并沿调用链携带当前 change 与 Provider 投影；不能只在 `run` 阶段补投影而让 Build Check、Verify gate 与 Archive 比较不同输入。独立 Profile 没有可核对的 Change 上下文时，对未被证明的规划文件使用普通内容依赖，其 Bundle 仍无生命周期 Acceptance 权威。

采集清单包含选中路径、文件类型、实际字节摘要、大小及规范化语义来源。HEAD/index 中的 tracked 文件即使被 ignore 仍保留；选中范围内的未跟踪与显式 ignored 输入也被实际枚举，Git ignore 不是安全排除依据。只允许显式 command outputs、Git 自身元数据及已登记的 Runtime 输出 ownership 排除自产日志、Journal、收据与缓存；执行控制面输入仍独立绑定，不能被宽泛输出规则覆盖。Runtime 输出规则沿现有 Repository Input Policy 的 Contributor 机制声明并校验冲突，不建立平行忽略清单。默认范围过大时返回有界诊断，引导明确声明输入及输出，不能静默截断。

文件路径、类型、删除和内容集合规范排序。文件内容身份使用实际有效字节；暂存和提交不会改变相同内容的身份。采集前后比较选择集合、文件对象和内容；HEAD/index 即便不进入语义摘要，仍用于发现采集期间的并发写入。新文件、删除、同大小同时间的内容变化、路径大小写碰撞和不支持的 submodule 输入均有明确拒绝或声明方式，不信任 mtime 证明内容相同。

### 将现有模型接入证据生产与恢复

Receipt、Bundle、Gate 和 Verification Input 引用同一版本化依赖记录，Build Check 和 Plan Evidence 保留各自真实输入边界。节点结果复用先核对声明依赖、新鲜度与采集实现，Bundle/Gate 再校验完整 Acceptance Trace。恢复从原 Journal 和 Store 读取依赖，不能从新的聚合 HEAD 推导旧检查身份。

Verify 与 Archive 共用输入观察和比较。输入变化交给既有恢复分类，规划授权变化仍有更高优先级，未知结果保留原 checkpoint。保留项与失效项继续使用现有轨迹和遥测机制记录。

### 单一输入快照，区分节点与整体身份

生产采集返回一个版本化 Evidence 输入快照，包含规范化逐仓文件清单、Provider 投影、各节点输入声明与有效配置、工具/Adapter 身份和 DAG 依赖；另存原始 Git observation 作为来源。快照的语义指纹排除纯来源变化，源记录仍由内容寻址身份保护并随 Context 持久化，不写回旧 Receipt 或旧 Verification Input。

每个节点从此快照派生自己的输入摘要，包含精确 argv、逻辑 cwd、有效策略、环境摘要、工具和采集实现、所选内容及实际依赖。消费上游产物时额外绑定其内容身份，并引用真实前驱 Receipt；引用的 Attempt、时间戳不冒充语义输入。Profile/Bundle 身份组合各节点声明及输入身份，不能再把所有 Receipt.inputFingerprint 强制设为相同的 profile 摘要。

### DAG 生成产物在消费前冻结

独立 Builder Check 指出：不能把本 Attempt 尚未生成的 `dist/**` 字节冻结到初始 Verification Input，再把正常构建产物当成输入漂移。这里采用“源输入在 Attempt 前固定，派生输入在前驱完成后固定”的顺序，沿用现有 DAG 和 Receipt/Artifact Store，不增加新的生命周期。

1. 编译 Profile 时解析 producer 的逐仓 `outputs` 所有权与现有 `dependsOn`。预先冻结的是源输入、生产者及输出选择规则、DAG 和 Acceptance coverage；同 Attempt 的派生文件不以不存在或旧版本的字节进入源输入指纹。多生产者重叠、消费者读取非前驱输出、输出覆盖受保护控制面或选择规则无法可靠区分时 fail closed。
2. producer 完成命令后，由 Runtime 通过相同稳定文件读取器采集完整输出清单，保存带 repository/path/type/size/content digest 的内容寻址 manifest Artifact，并将其与 producer Receipt 和源输入摘要一起持久化。不是由 Host 自述“产物没变”。没有 output 声明的普通命令仍按原执行方式采集日志及结果。
3. consumer 启动前，核对其前驱 Receipt 已提交且通过，按声明的文件选择集合取得对应 producer manifest，再重新读取选中产物。其节点输入摘要由预冻结的源输入摘要及实际派生内容摘要组成；Receipt 记录当前 producer Receipt 引用与 manifest。语义摘要不混入前驱 Receipt 的时间戳；当前 Attempt 的证明引用仍使用真实当前 Receipt。
4. 结束时，源输入与初始源快照比较，派生输入与各自消费前已冻结 manifest 比较。合法 producer 输出不会使全图误判漂移；消费者执行期间发生的替换、缺失、增删或源文件越权修改仍使受影响证据失效。Gate 的逐节点校验从固定 DAG、producer Receipt、manifest 和实际 consumer Receipt 重建这条证明链，不能仅比较不同粒度的摘要字符串。
5. Verification Input 的预冻结身份包含源输入和派生规则，不假装知道未来产物字节。Bundle/Gate 的证据依赖记录在上述规则下绑定实际派生产物身份；Archive 新鲜度使用同一观察器，核对当前源输入和已接受证据实际依赖的派生清单，不能因最初的旧输出被正常构建替换而重做 Verify。
6. 缓存 producer Receipt 之前，除源码及新鲜度外，还要证明其承诺的输出当前存在且内容匹配。缺失或改变时不复用 producer，按合法确定性执行路径重采；本轮不从 Artifact Store 自动回写构建文件。consumer 缓存按当前已确认的派生内容判断，重采 producer 但产物字节等价时可以复用仍匹配的 consumer，同时重新绑定当前证明引用。
7. producer 的 Receipt 与输出 manifest 在相同节点 Journal 完成边界前落盘。重启先恢复已提交 producer 事实再判断 consumer；只有 intent 没有完整 Receipt/manifest 时保持 unknown，不复制半份清单或重跑不明外部副作用。manifest Artifact 进入既有保留闭包，不能在 Bundle 或 Gate 仍引用时删除。

这是对 Repoctopus 现有跨节点 Evidence DAG 的适配。Comet 的逐检查 `outputs` 排除用于避免命令自产物污染源输入；它不提供这里完全相同的多类型 Evidence DAG，不能把本段称为直接复制的 Comet 实现。验收必须用真实的 build-output→consumer 场景证明时间边界。

`createAcceptanceTrace` 和恢复路径按照不可变 coverage plan 核对 nodeId、对应节点依赖摘要、实际 Receipt、信任与新鲜度，再形成绑定当前 Verification Input 的完整 Trace。不能仅删除旧的聚合指纹相等断言；必须用逐节点验证替代，保留跨 Run、旧 Work、缺失 Receipt 和伪造 Trace 的拒绝。

`EvidenceDependencyRecord` 复用已有分区及失效闭包。实现内容、规划语义、执行控制与显式 Git 依赖进入对应分区；publication provenance 只用于发布来源，不自动进入验证依赖。Plan Evidence 继续绑定 Task/Strategy/Binding/Plan，Build Check 继续绑定最终 workspace checkpoint 和实现/测试事实，其授权 fence 不因内容等价被弱化。

依赖记录的 subjectId 与对象身份禁止循环计算：先计算不含自身记录的依赖集合摘要，再用事实及该摘要计算 Receipt/Bundle 等对象 ID，最后生成引用该 ID 的依赖记录。读取时重算对象和记录摘要、核对 subjectId、分区及下游引用；不能只验证外层 JSON 形状。

### 从实际 Store 选取可复用 Receipt

目前 EvidenceService 的可复用参数没有生产调用方。补齐现有 EvidenceStore 的有界候选查询，由 EvidenceCoordinator 读取当前 Workspace 的真实已提交记录，按 profile/node、节点输入摘要和实际采集身份筛选后传入现有执行器。不增加数据库或另一份成功账本；索引若存在，只是可以从原 Store 重建的加速信息。

只有声明 `cache: true`、原始状态 passed/verified、证据未失效且 TTL 未过期的确定性命令可复用。旧 Receipt 保留，当前 Attempt 创建带 sourceReceiptId 的新复用 Receipt，原始有效期不能延长。原全局 composition 不同仍按现有兼容权威先处理；没有可核对的采集实现及状态契约兼容事实时不复用。

新 Attempt 中，节点 A 的源内容变化使 A 及声明依赖 A 的后继失效；独立节点 B 的输入身份不变时保留 B 并生成可追溯复用事实。旧 Bundle/Gate 仍保留历史，不能直接改成当前成功。Attempt 被标记 superseded 后，只有逐节点证明未受漂移影响、且满足完整复用条件的历史 Receipt 可以成为新候选。

Journal 中已有 completion 的节点先核对其原 Receipt；只有 intent 而无 Receipt 的外部结果保持 unknown/reconciliation，不借输入刷新或创建新 Attempt 自动重发。旧失败、超时、截断和漂移记录不被覆盖。Provider 不可用只返回受限 retry，不合成“输入已改变”。

### Verify、Archive 与恢复使用相同观察

统一观察先核对当前 Run、composition 与 checkout 授权，再取得规划批准、实际输入依赖及副作用边界的同一快照。纯领域层按 planning、plan、work、evidence 的既有顺序分类，Coordinator 只物化 Runtime 选定的处置。接受 Gate 或恢复决定前，用当前 revision/epoch/Work fence 重验依赖，防止采集、评估和 Run CAS 之间使用混合事实。

等价任务收尾保留 Verification Input 语义身份和已接受 Bundle/Gate，不创建新的 evidence.verify Work。`run resume` 不能先按启动 HEAD 阻断 Verify/Archive，再让 `run next` 另行修正；这两个恢复入口使用同一兼容证明解释已授权 checkout 中的等价来源进度。该证明不能授权分支、remote、path、topology 或 ownership 漂移，也不能清除无关 reconciliation。Build 阶段继续使用上一 Change 的 Binding/checkpoint 恢复，不用本次证据投影放宽 Build Check 的精确 HEAD fence。

声明的证据输入确实变化时，返回新的合法 Verify checkpoint并只重新采集受影响节点；旧 Host Outcome、Claim 和失败历史保持审计且不能冒用为新 Work 的结果。规划同时变化时只应用一次 revise-design，其 Evidence 失效属于下游结果。已开始 Closure/publication 的情况继续原 Journal/reconciliation。

### 按 Comet 分离验证证据与发布 preflight

用户明确要求“参考 comet 修正”后，对照固定上游完成了本处 Spec Patch。Comet 的 `classic-sdk-archive-preflight.ts:assertVerifyEvidenceCurrent` 先按声明输入检查验证证据，并明确容许 Verify 接受与 Archive 授权带来的正常 epoch 增长；`runClassicSdkArchivePreflight` 独立捕获当前分支和 `baseCommit`。`classic-sdk-archive.ts` 在关闭前再次要求实时 HEAD 与该 preflight 基线一致，变化时阻断，不自动忽略。`classic-sdk-application.ts:deliveryOutcomeValidator` 最终核对实际提交、批准分支/remote、连续单父提交范围及所有交付路径和内容。

Repoctopus 采用这一分离原则，保留逐仓精确发布坐标和现有 Publication Journal。`ArchiveDeliveryInput` 仍冻结真实发布 OID，不能拿旧发布 Work 执行新坐标。发布坐标未变时保持当前 Work；尚无副作用而坐标变化时先阻断，Runtime 重新执行同一受保护 preflight，核对当前 Branch/remote/topology、原批准范围、发布提交和有效验证证据，再退役旧发布输入并建立匹配的 Archive checkpoint。首次准备和合法刷新可递增 epoch，当前有效 Gate/Bundle 不因此失效，也不重复 Verify。

Comet 的交付范围校验是参考，其单仓提交范围实现不直接替代 Repoctopus 的多仓精确 OID 校验。未经原发布授权覆盖的分支、远端或写集变化继续 fail closed；副作用已开始或结果未知时维持原 Journal/reconciliation，不重新关闭或重发。该修正移除了原 delta 对 Work/epoch 的过度承诺，不扩大发布授权。

### 协议与实施边界

Evidence fingerprint manifest 从 v2 改为 v3，Context 从 v1 改为 v2，Bundle/Gate 从 v2 改为 v3，Verification Input 从 v3 改为 v4；Receipt/Attempt 增加必需的 v1 schema 标识与依赖字段，缺失版本不再视为当前记录。Plan Evidence/Build Check 的新增必需依赖相应升级版本，既有 DependencyRecord 继续使用其规范摘要方法。Builtin definition 与 composition identity 按实际状态协议变化更新，不提供旧协议执行兼容。

实现边界集中在现有配置 parser/compile、Specification Service/Provider、Git Adapter、Evidence 领域与持久化、EvidenceCoordinator 和 WorkflowRuns。Kernel 不解析 YAML 或 OpenSpec，纯领域不做文件系统 I/O；平台适配器不推进 phase。新增纯模块需登记已有架构与来源清单，采用 Comet 源码时保留许可证和固定引用。

共享配置说明、Provider/Host 协议说明与各阶段回归随对应任务完成；不把八项 Tasks 复制成第二套 checkbox。测试过程只进入 Evidence 与正式报告。

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

另外用实际 producer 生成初始不存在的文件，再由 consumer 读取，证明合法产物不导致 Attempt superseded；在 consumer 开始后替换产物则阻断。分别在 producer Receipt 前、manifest 后及节点 completion 后中断，核对未知状态不重发、完整前驱不重跑。删除缓存 producer 的输出后再次采集，证明不会把旧成功误认为输出仍存在。

最终用独立依赖安装构建固定候选，避免共享 node_modules 路径进入打包身份；在真实实验多仓复验，并在正式报告区分生命周期 Gate、独立 Profile 和未执行范围。普通决策继续写在本文件，结果进入 Evidence 与验证报告。

### 实施约束：副作用使用冻结 OID

独立审查确认 Run 事务锁只能序列化 Run 写入，不能锁住外部 Git。Archive 每个 effect 前在领域 owner 的 guarded operation 中核对 Work、epoch、input、blocker 和完整 Binding；新 Closure 复核规划、证据及 publication checkpoint。SpecificationClosurePlan 固定 sourceOid，checkout 直接从该 literal OID 创建；Business push 同样使用冻结 OID，不能再次读取可前移的分支作为实际发布来源。已开始 Journal 始终恢复原计划。该约束是现有“冻结发布坐标”验收的具体实现，不增设审批或生命周期。

缓存资格还必须读取原 Bundle 的逐节点 superseded 结论；不可因源码恢复原值复活已失效 Receipt。声明输出逐 pattern 缺失时不缓存；程序 launcher 可以是符号链接，但身份绑定入口与真实目标，并在稳定读取中验证解析不变。
