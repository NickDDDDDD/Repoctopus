# Design

## Context

参见 [proposal.md](./proposal.md) 的 Why。当前领域层已经分别拥有 Change Lifecycle、Build Protocol、Work Execution、Specification Authority、Evidence 与 Runtime identity graph，但 Service 编排仍把 `design_assumption_invalid` 和 `planning_semantics_changed` 两种 Host finding直接折叠为 `build-design-revision-required`，并通过额外Human Decision回到Design。与此同时，Build Check已有局部Plan invalidation，Specification Provider已有规划语义摘要，Evidence已有输入指纹；这些能力尚未由一个统一恢复决策连接起来。

真实多仓轨迹证明问题不是缺少更多phase，而是恢复权威被分散：计划切面错误被当成Design错误、任务checkbox提交被当成实现输入漂移、Archive依次经过Verify和Design处理同一根因。固定Comet 0.5.1的`revise-design`、`revise-plan`、`continue-build`与Evidence invalidation提供成熟语义参考，但Repoctopus仍需保留自己的多仓Project Snapshot、OpenSpec Provider、Work/Host、Cordis composition与OTLP契约。

## Goals / Non-Goals

**Goals:**

- 建立唯一、纯领域的恢复分类器，使Runtime而非Host选择恢复动作。
- 让恢复只回到最小且正确的权威checkpoint，并保持CAS幂等、历史可审计和依赖精确失效。
- 在Open/Design与Plan Evidence边界发现可静态判定的Requirement映射、Purpose和TDD包闭包错误。
- 让规划语义、实现内容、执行控制面与publication provenance使用不同身份，避免无关提交使批准和Evidence失效。
- 通过单元、服务、CLI和真实多仓轨迹重放证明恢复路径与遥测均正确。

**Non-Goals:**

- 不引入Comet SDK、存储格式或运行时依赖，也不复制Comet的Classic文档布局。
- 不增加新lifecycle phase、repair worker、第五类OpenSpec工件、ADR或第二套ticket权威。
- 不保留旧finding/transition的双写兼容层；项目尚未发布稳定版，旧活动Run只允许显式失败或重新开始。
- 不处理凭据、PR文案/Skill映射、Dashboard与其他不属于恢复根因的问题。

## Decisions

### 1. 采用 Comet 式有序 Inspector 与显式恢复命令

由多个纯领域、权威专属Inspector分别核对Requirements/Design Evidence、Plan Evidence、当前Work执行与Evidence依赖，再由一个薄`RecoveryCoordinator`按固定顺序选择第一个不再有效的权威。Inspector不依赖Store、Git、OpenSpec CLI或Host；Service负责把已观察事实转换为输入。输出为不可变`RecoveryDecision`：

- `revise-design`：批准的Requirement、Design、Task语义或approval authority已变化。
- `revise-plan`：批准语义不变，但Package边界、依赖、write scope内的测试切面、命令或Plan可行性需要改变。
- `continue-build`：当前Work与输入仍有效，可按retry policy纠正或续行。
- `invalidate-evidence`：上层事实有效，仅声明的Evidence输入发生变化。
- `retry-infrastructure`、`reconcile-external`、`halt`：分别处理暂时不可用、外部结果未知和不可恢复冲突。

Coordinator固定按“规划语义 → Plan → 当前Work → Evidence”执行Inspector；Requirements drift存在时不再运行Plan drift恢复，和Comet的readiness顺序一致。一次observation只产生一个最高层decision，其`decisionId`由run、expected revision/epoch、observation identity、authority diff与invalidation set规范化计算。Service在RunStore转换锁内重新读取输入并通过显式命令应用decision，重复调用返回既有checkpoint或revision conflict。

选择该方案而不是单一巨型分类器，是因为各权威拥有不同Evidence合同，单体输入会不断膨胀；选择它而不是在`workflow-runs.ts`继续添加条件分支，是因为恢复顺序、幂等身份和失效集合必须可独立穷举测试。Service只负责编排事实采集和原子提交。

### 2. 方案比较

- **候选A：有序权威Inspector + 显式Runtime命令（采用）**。最接近Comet 0.5.1的`inspectClassicSdkRevisionReadiness`与revision command模式，同时可复用Repoctopus现有identity graph、多仓Snapshot和Work/Host合同。代价是需要为每层维护独立Evidence输入，但边界清晰。
- **候选B：一个通用RecoveryClassifier**。表面统一，却会把Specification、Plan、Work、Evidence的不同合同塞进一个不断扩张的输入模型，容易成为新的集中式条件分支，因此不采用。
- **候选C：保留各阶段Service条件分支，只替换信号名称**。改动小，但仍会重复判定authority drift，无法保证Requirements优先于Plan或同一根因只处理一次，因此不采用。
- **候选D：直接引入Comet SDK**。能复用实现，但会把Comet的单项目Classic状态、Skill与文档模型带进Repoctopus，破坏多仓OpenSpec Store、Cordis composition和外部Host架构，因此只借鉴语义与测试，不引入依赖。

### 3. Host finding 改为事实合同，移除动作式finding

删除`design_assumption_invalid`与`planning_semantics_changed`。新的有界finding只描述事实层：实现失败、批准权威冲突声明、Plan约束、Evidence不匹配、Evidence基础设施不可用和外部结果未知；同时携带当前Work允许的Requirement、Task、Package与Evidence引用。

Work Execution Validator先校验schema、引用存在性与当前Work关联，再生成稳定finding identity。Host不能提交phase、recovery action或invalidation set。`authority-conflict`也只是待验证声明：Runtime必须重新观察Specification Provider identity后才能选择`revise-design`。

选择事实合同而不是让Host直接返回四种动作，是为了保持Runtime-authoritative，并防止团队自定义Host或Agent绕过权威比较。

### 4. Lifecycle只物化分类结果，不再建立Build→Design提案Wait

移除`build.design-revision-required/approved/rejected`协议和`build-design-revision-required`observation。Lifecycle接受领域decision并物化唯一转换：

- `revise-design`原子创建`specification.plan` Work、递增epoch、挂起Build Protocol并按identity graph失效下游事实；后续仍由正常Design审批决定新规划。
- `revise-plan`保持Build，创建下一revision的`build.plan` Work并保留未受影响completion。
- `continue-build`保持phase、Work与Plan，在同一执行链创建合法attempt或重投未确认attempt。
- `invalidate-evidence`退役受影响check/evidence并返回Build Check、Verify或Archive前置重验的最近合法节点。

Design返工不再先询问“是否回Design”：如果权威语义已经改变，旧approval客观上已无效；如果没有改变，则不应回Design。真正扩大范围、权限或风险的决定仍由已有Open/Design/Plan授权协议处理。

### 5. Identity graph按权威分层并由decision一次计算失效闭包

扩展现有Runtime identity graph，至少区分：

1. `planning-semantic`与`design-approval-authority`；
2. `build-strategy`、`execution-binding`与`build-plan`；
3. `work-input`、`package-completion`与`workspace-checkpoint`；
4. `evidence-dependency`、Receipt、Bundle、Gate与Verification Input；
5. 独立的`publication-provenance`。

每个decision先计算保留/失效集合再提交一次transition，禁止Archive先按源码fingerprint回Verify、随后又按planning digest回Design。Task checkbox、普通实现OID和publication provenance不进入planning semantic identity；只有命令策略显式声明Git identity时，commit才进入对应Evidence依赖。

### 6. Build Plan在派发前验证可完成闭包

扩展Plan Validator与Plan Evidence：除了Task/Acceptance覆盖、DAG、Binding、write scope与保护分支，还验证每个Package能独立满足其Outcome/Validator合同。`tddMode=tdd`时，一个可完成Package要覆盖同一行为切片的RED、实现、GREEN与相关回归；不能把RED和GREEN拆成两个都声称可完成的Package。`direct`仍要求实现与回归，但不要求RED。

Plan revision在已批准授权包络内自动接受；只有repository/write scope、风险或外部副作用扩大才建立Human Decision。这样错误测试切面会成为`revise-plan`，而不是执行后反复回Design。

### 7. Specification Provider在批准前完成引用与关闭静态预检

Tasks解析器将Requirement metadata按明确语法规范化，支持半角/全角逗号与分号，并拒绝空token或歧义内容。Provider使用当前主规格与delta导出的稳定Requirement identities验证每个映射，Build Plan只消费解析结果。

Provider在Open/Design严格校验中计算不产生副作用的closure preflight：验证新增capability具有可归档Purpose、delta操作与退役声明能形成唯一关闭计划。Archive仍在隔离checkout重新验证文件与候选结果，但不再首次发现规划时已可确定的错误。

### 8. Evidence使用显式依赖清单而不是仓库级粗指纹

Verification Input保留完整审计身份，但每个Evidence节点声明实际消费的产品内容、planning semantic、control-plane、工具、环境和可选Git identity。Specification仓中的规划文件由Provider语义投影参与验证；合法checkbox变化只更新完成投影，不改变planning semantic。实现文件仍按真实内容指纹，未知输入继续fail closed。

`invalidate-evidence`沿依赖图只失效受影响Receipt及其下游Bundle/Gate。Evidence Provider不可用保持当前节点blocked/retry，不通过`revise-plan`或`revise-design`隐藏基础设施错误。

### 9. Service、Cordis与平台边界

- **领域模块**：定义finding facts、分层Inspector、RecoveryDecision、identity diff、Plan closure与invalidation closure；全部使用纯数据和确定性函数。
- **WorkflowRuns Service**：在Cordis Effect中观察Specification、Project Snapshot、Build Protocol和Evidence事实，调用RecoveryCoordinator，并在RunStore CAS/transaction中物化decision。
- **Specification/Evidence/Git平台适配器**：只提供可验证事实、Receipt与稳定identity，不选择lifecycle动作。
- **Cordis composition**：继续负责Provider/Validator/Host能力装配与Effect清理；composition drift走既有兼容或migration判定，不冒充planning drift。
- **CLI/Runner**：pull当前Action、提交当前Work Outcome和显示Runtime decision；不得拼装等价transition。

### 10. OTLP记录分类效率而不泄露高基数内容

新增稳定事件/跨度表达`recovery.observed`、`recovery.classified`、`recovery.applied`和`evidence.invalidated`。允许属性包括source phase/action、decision kind、authority layer、reason code、retained/invalidated计数、attempt与是否重放；finding摘要、路径、Requirement文本、commit、digest和用户内容不作为metric attribute。Trajectory保存完整内容寻址引用，Dashboard可按run/change关联查看。

### 11. 用真实轨迹的脱敏fixture做状态机重放

将本轮多仓验收中三类Build→Design和Archive双回退压缩为无业务名称的事件fixture。测试从相同初始checkpoint重放，断言：

- 错误TDD拆包与测试切面得到`revise-plan`；
- 当前Work输出拒绝得到`continue-build`；
- checkbox与非语义收尾提交不产生阶段回退；
- 真正planning semantic变化直接得到一次`revise-design`；
- 单一Evidence输入变化只得到`invalidate-evidence`；
- 重复投递收敛到相同decision/checkpoint。

除领域测试外，Service integration验证RunStore原子性，CLI/E2E验证Runner只能执行Runtime action，多仓验收验证最终阶段往返计数。预期目标是该fixture的Build→Design只保留真实规划变化，Archive不再因同一根因先Verify后Design。

## Risks / Trade-offs

- **[分类器过度相信Host关联]** → 所有关联先由当前权威集合验证；未知或不足的finding保持blocked，不默认升级Design。
- **[输入分区遗漏真实依赖]** → Evidence policy默认fail closed；只有显式、版本化策略可缩小输入面，并用变异测试验证每类输入变化。
- **[自动Plan revision扩大权限]** → 以批准授权包络比较repository、write scope、风险与外部副作用，任一扩大都转Human Decision。
- **[状态schema变化使旧Run不可恢复]** → 项目尚未稳定发布，不实现旧行为兼容；旧schema明确报告`migration_required`或要求重新开始，不静默猜测。
- **[closure preflight与Archive实现漂移]** → 两者复用同一个纯领域closure analyzer；Archive只增加当前checkout与副作用安全检查。
- **[一次改动跨多个核心模块]** → 按领域合同、Service接线、Provider/Evidence适配、遥测与E2E分层提交，每层先有失败测试再实现。

## Migration Plan

1. 先加入新领域类型、分类器、依赖图与失败测试，不接生产Service。
2. 为Plan、Specification与Evidence补齐前置分析器，并让旧路径与新测试形成可观察差异。
3. 一次切换WorkflowRuns与Lifecycle definition到新decision，删除旧finding、observation、transition、wait与遥测枚举。
4. 更新状态schema与composition identity；旧Repoctopus活动Run明确停止并重新开始，不建立双轨转换。
5. 运行单元、integration、CLI/E2E、真实轨迹重放及多仓验收，再更新固定上游对齐记录。

回滚只允许在新Run投入使用前整体回退该change提交；已经由新schema创建或推进的Run不降级解释为旧状态，避免伪造恢复事实。
