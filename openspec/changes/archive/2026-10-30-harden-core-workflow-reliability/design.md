# Design

## Context

参见 [proposal.md](./proposal.md) 的 Why。当前实现已经把 claim、Host invocation、Outcome、Validator 和 continuation 收敛到同一个 Change Run，但在两个边界仍丢失了上游事实：

1. `WorkExecutionCheckpoint` 只保存 packet identity，`resumeClaim()` 却从当前 Work、Skill 与 Specification 状态重新组装 packet。Open/Design Host 合法写入规划工件后，当前 Work 自己就可能改变重组输入，导致恢复时出现 context digest 不匹配。
2. OpenSpec Provider 只读取 `artifactPaths.existingOutputPaths`，把无文件统一投影为 `missing`；同时把除小写 `warning` 外的诊断全部投影为 `error`。OpenSpec 官方 `skip_specs: true` 因而同时出现“strict validation 有效”和“delta-specs 缺失/INFO 被当成 ERROR”的矛盾状态。

Comet 0.5.1 的恢复审计给出的成熟约束是：锁内保留意图、锁外执行 Host、锁内按精确身份提交；已派发任务保持同一任务；等待超时不等于执行失败；未知结果先观察再修复，不能盲重放。Repoctopus 采用这些原则，但继续由 Cordis Service、Change Run、OpenSpec Provider 和多仓 Project Snapshot 承载自己的架构。

当前产品尚未正式发布。旧 checkpoint 不建立双读兼容；无法证明 packet 内容的旧活动 Run 保留为审计事实并明确要求迁移。

## Goals / Non-Goals

**Goals:**

- 让同一 claim 的完整 packet 在进程重启、Agent 更换和 Host reconcile 后仍可按原内容恢复。
- 让 Run checkpoint 继续只保存有界 identity，避免 Skill/Prompt/路径进入 Run、Trajectory、日志和 OTLP。
- 让 Specification Provider 独占外部状态归一化，Workflow 只依赖稳定领域状态。
- 用真实重启、Host 已修改 Change、`skip_specs`、INFO 诊断和矛盾诊断 fixture 建立失败优先的验收。
- 为恢复方式、工件满足方式和 Provider 契约错误提供可审计、低基数遥测。

**Non-Goals:**

- 不增加 daemon、轮询、Webhook、后台恢复器或第二套 Run 状态根。
- 不采用 Comet SDK、Classic/Native 状态目录、Skill 文案或实现源码。
- 不改变五阶段、Open/Design 双审批、OpenSpec Store、多仓 Workspace、Build 内部协议或 Skill 扩展策略。
- 不为旧 checkpoint 重组 packet，不增加 generation、旧 schema adapter 或静默 repair。
- 不把 packet 正文发送到 SigNoz/Desktop，也不把 Provider 专有 `skip_specs` 字段暴露给 Workflow。

## Decisions

### 1. 完整 packet 进入按 Run 隔离的不可变内容存储

新增领域端口 `WorkExecutionPacketStorePort` 与 Cordis Service `WorkExecutionPacketStore`。文件适配器把 packet 保存到 `.repoctopus/runs/<runId>/packets/<packetDigest>.json`；路径只由已校验的 runId 和 SHA-256 identity 派生。写入采用原子 create-or-verify：

1. 首次写入创建不可变内容。
2. 同 digest 重放必须逐字节/规范化内容一致，否则报告内容寻址冲突。
3. 读取后重新计算 packet identity，并同时核对 Run checkpoint、ActionIntent、current Work、attempt 与 checkEpoch。

按 Run 隔离而不是全局去重，牺牲少量磁盘空间，换取明确的所有权、清理边界和无需引用计数的故障模型。目录属于本地私有 Runtime 状态并由现有 `.gitignore` 边界保护；它不是共享 Run 事实，也不进入 trajectory/checkpoint。终态 Run 的普通保留/清理策略同时覆盖 packet 内容，当前 Change 不新增独立 GC。

组合层新增唯一内建插件 `work-execution-packet-store-file`，拥有独立 `work-execution-packet-store-write` authority、filesystem permission 与 `work-execution-packet: 1` state schema；Project composition 把 `workExecutionPacketStore` 列为 required service。`WorkExecutionCheckpoint` 一次升级到 schema 3，`work-execution-authority` 的 descriptor state schema 同步升级且不声明旧实现兼容。packet 自身保持现有 schema 2，存储 envelope 使用 schema 1；这区分了“执行包格式”和“Run 如何保证其可恢复”两个版本边界。

备选方案：

- **恢复时重新组装并比较摘要**：已经被真实自举证明错误；当前 Work 的合法写入会改变重组输入。
- **把完整 packet 内嵌到 RunState**：恢复简单，但会把 Skill、Provider 指令、Prompt 与路径复制到 checkpoint、journal、Dashboard/调试输出，破坏最小披露边界。
- **全局 packet CAS**：可去重，但需要引用计数、跨 Run 清理与更复杂的权限边界，本阶段收益不足。

### 2. Claim 使用 prepare → bind → deliver 三段边界

领取流程调整为：

1. 在内存中解析当前 Work、组装 packet，并先保存 ActionIntent。
2. 把完整 packet 原子写入私有内容存储。
3. 通过 Run CAS 绑定 claim 与 packet identity。
4. CAS 成功后才向 Host 交付 packet 并记录 context/Skill delivery。

第 2 步后、第 3 步前崩溃只留下无权威资格的孤立内容；它与 ActionIntent 的孤立记录相同，可忽略并由后续清理处理。第 3 步成功后响应丢失时，新 Runner 按 checkpoint 精确读取第 2 步的内容。同一 claim 的重放返回相同 packet；不能生成第二个 attempt。

这对应 Comet 的 reserve → execute → commit 思想，但 Repoctopus 的“reserve”是 Run CAS，“execute”由 WorkExecutionHost 完成，“commit”是 Outcome/Validator 的后续 Run CAS，而不是引入 Comet coordinator。

### 3. 所有恢复路径只读取冻结 packet，不调用 assembler

`resumeClaim()`、Host reconcile、外部 Outcome 消费和恢复 Validator 所需的 packet 都通过统一 `loadAuthoritativePacket(runId)` 获取。该入口按顺序验证：

- checkpoint schema 是新版本且存在 packet identity；
- 内容存储中存在对应 packet；
- 内容重算 identity 与 checkpoint 相同；
- claim identity 与 ActionIntent 相同；
- runId、workId、attempt、checkEpoch、inputDigest 与当前 Run 边界相同。

`WorkContextAssembler` 只在**新 claim**时调用。claim 后 Skill、Provider 指令或规划文件变化不会改写旧 packet；它们在创建下一 Work、新 epoch 或显式兼容检查时才参与新身份。Host invocation 已存在且结果未知时仍执行 observe-before-repair：只调用原 Host 的 reconcile 能力，不因 packet 可读而再次 invoke。

旧 checkpoint 或缺失 packet 内容返回 `migration_required` / `content-missing-or-corrupt`。不会用当前内容“修好”旧 claim，也不会改 Store 伪造完成。

### 4. Provider 用三态工件满足契约封装官方状态

`SpecificationArtifact.status` 扩展为：

- `ready`：适用工件有可验证内容；digest 来自规范化内容。
- `skipped`：Provider 根据当前 schema 和官方状态明确确认该类工件不适用；digest 绑定 Provider identity、changeId、artifact kind、官方 skip 状态和相关 metadata identity。
- `missing`：适用工件没有有效内容；不得带满足 digest。

OpenSpec 1.14.3 的真实输出中，`status --json` 通过 `artifacts[].id/status` 报告 `specs: skipped`，同时 `artifactPaths.specs.existingOutputPaths` 为空。Adapter 因此继续用 `artifactPaths` 验证实际内容，只从顶层 `artifacts` 识别官方 `skipped`；不能把顶层“依赖已满足、可以开始写”的 `ready` 误认为内容已完成。Provider 要求四个官方 artifact kind 各有且只有一个规范化投影。`planningComplete` 和 strict validation 仍由 OpenSpec 官方结果提供。

Planning approval 保持四个 `PlanningArtifactSnapshot`，但接受 `ready` 或 `skipped` 的稳定 digest。这样审批语义仍绑定四类协议，且不会伪造不存在的 delta-spec 文件。Workflow 的 Open Gate 删除固定 Set + `status === ready` 逻辑，改为调用领域 helper 检查 Provider-normalized satisfaction。

备选方案：

- **Workflow 直接读取 `.openspec.yaml.skip_specs`**：把 OpenSpec 专有字段泄露进生命周期，替换 Provider 后仍需修改 Workflow。
- **为维护 Change 生成空 delta spec**：制造不存在的行为变更，破坏规格权威。
- **把 skipped 当 ready**：物理工件与协议满足混为一谈，Dashboard、审计和审批无法解释真实状态。

### 5. 诊断严重级别保持原义并建立一致性不变量

领域严重级别扩展为 `info | warning | error`。OpenSpec 1.14.3 的真实校验输出使用 `items[].issues[].level = INFO|WARNING|ERROR`；Adapter 读取 `level`、做大小写归一化并只接受这三个明确值，不再读取不存在的 `severity` 后把所有值降成 error。未知值形成 Provider contract error 并使校验无效。最终结果遵守：

```text
valid = processExitSuccess
     && providerReportedValid
     && noNormalizedErrorDiagnostics
     && repoctopusStrictChecksPass
```

INFO 不再阻断推进，WARNING 保留可见但不自动失败，ERROR 必定使 `valid=false`。如果外部结果同时声明 `valid=true` 和 ERROR，adapter 保留原错误并追加有界的 contract-conflict 诊断；下游只看到一个自洽的无效结果。

备选方案是继续根据进程退出码单独决定 valid；这会再次产生“valid + error”的不可解释状态，因此拒绝。

### 6. 领域 helper 统一定义“已满足”和“可批准”

在 Specification domain 提供纯函数：

- `isSpecificationArtifactSatisfied(artifact)`：仅 `ready|skipped` 且 digest 合法。
- `normalizePlanningArtifacts(change)`：要求四类恰好一次、全部满足并保留 digest。
- `assertSpecificationValidationConsistency(validation)`：`valid` 与 diagnostics 严重级别一致。

Open Gate、planning manifest、planning approval、Design validator 和 Archive preflight 复用这些规则。Service/Workflow 不再分别维护“文件存在”“四个 ready”“planningComplete”变体。

### 7. 遥测记录决策结果，不记录敏感内容或高基数细节

在现有 Trajectory/OTLP 管道中增加四个有界事件：

- `work.packet-stored`：`created | reused`；只在 packet 内容写入或幂等命中后记录。
- `work.packet-recovered`：`recovered | missing | corrupt | legacy`；只表达按 checkpoint 读取的结果，不表示 Host 已执行。
- `specification.artifacts-observed`：一次记录四类固定 artifact kind 的 `ready | skipped | missing`，不含路径、正文或 metadata。
- `specification.validation-observed`：记录 `valid`、最高 severity、info/warning/error 计数和 `contract-conflict` 布尔值；不把任意诊断 message 作为 Metric label。

Trace/Event 保留精确关联；Metrics 只使用固定枚举，不使用 changeId、digest、路径或诊断代码作为 label。Desktop 与 SigNoz 继续消费同一 OTLP 事实，不查询 packet store 或 RunStore。

### 8. 验证采用失败优先的真实纵切

验证分四层：

1. 纯领域测试：packet 内容身份、artifact 三态、诊断一致性和规划快照。
2. Adapter contract fixture：真实形状的 OpenSpec status/validate JSON，覆盖 `skip_specs` INFO、缺失工件、未知 severity 和 valid+error。
3. 进程重启纵切：领取 Open Work、Host 写入四份规划工件、在 Outcome 返回边界模拟中断、重建应用、读取原 packet并从原 invocation/Outcome 继续；断言 assembler 没有被恢复路径调用且 Host 不被重放。
4. 公共路径验收：正常有 delta spec Change 与 `skip_specs` Change 都能形成 Open approval；缺 packet、旧 checkpoint 与歧义 Host 继续 fail closed；OTLP/Desktop 投影只出现统一事实。

测试必须使用临时 Workspace/Store，不修改真实 `.repoctopus` 历史来伪造成功。完成后清理临时 packet、日志和故障注入输出。

## Risks / Trade-offs

- **[packet 正文落盘扩大本地敏感面]** → 仅写入 gitignored 的私有 Run 目录，路径不可注入，不进入共享事实/日志/OTLP；Run 清理同步删除。若未来需要跨机器传输或加密，另建安全 Change。
- **[packet 写入成功但 Run CAS 失败留下孤儿]** → 内容不可变且无 checkpoint 引用就没有执行权；沿用 Run 清理清除，不建立反向权威。
- **[同 digest 内容冲突揭示规范化缺陷]** → fail closed 并报告 `corrupt`，绝不覆盖；canonical identity 的单元与属性测试覆盖顺序稳定性。
- **[OpenSpec CLI 输出格式继续演进]** → adapter 对顶层字段做窄解析和契约 fixture；未知状态/严重级别 fail closed，Workflow 不感知版本细节。
- **[skipped digest 受 metadata 变化影响]** → 这是预期行为；skip 决定变化会使旧 planning approval 失效并要求重新审查。
- **[旧活动 Run 无法恢复]** → 产品仍为预发布；明确 migration required 并保留审计，不以兼容代码牺牲新模型正确性。
- **[自举 Change 在修复完成前无法用缺陷 Runtime 可靠执行 Open]** → Open 阶段使用官方 OpenSpec 工具创建并严格校验四份权威材料，记录一次过渡例外；实现后必须以全新临时 Run 完成真实中断纵切，不能用当前 Store 手工改状态替代。

## Migration Plan

1. 先建立会失败的 packet 重启、`skip_specs`、INFO、valid+error 与旧 checkpoint contract tests，保存真实错误作为基线。
2. 引入新 packet store 端口、文件适配器和应用组合；切换新 claim 为 prepare → bind → deliver，checkpoint schema 一次升级且不保留旧读取分支。
3. 让所有 resume/reconcile/outcome 路径读取统一 frozen packet，删除恢复路径对 `WorkContextAssembler` 的调用并完成重启纵切。
4. 扩展 Specification domain 三态与 severity，修正 OpenSpec adapter、planning snapshot/approval、Open/Design Gate 和所有 fixture。
5. 接入低基数 Trajectory/OTLP 映射，验证 Desktop 与 SigNoz 消费相同事实且不泄露 packet/路径/诊断正文。
6. 更新架构、Runtime state、Specification 与 Telemetry 文档，运行 typecheck、lint、全量测试、package、OpenSpec strict、provenance 和真实公共 CLI 验收。
7. 在新代码下用临时 Workspace 创建全新 Change Run，完成 claim → Host 写规划 → 模拟中断 → 新进程恢复 → Validator/Open approval 的完整纵切。旧自举 Run 只作审计证据，不修改 Store、不伪造完成。
8. 回退仅允许回退整个未发布 Change；不得保留“旧重组 + 新 packet store”双路径。若已经产生新 schema Run，回退代码只能明确拒绝读取，不能按旧逻辑重放。
