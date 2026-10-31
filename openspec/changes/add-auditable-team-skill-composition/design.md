# Design

## Context

当前 lifecycle definition 直接声明 Action 与 augmentation，`WorkflowRuns.resolveLifecycleWorkSkills()` 再按名称解析 Skill。Build Execute 还会按 TDD 模式追加 augmentation。该实现保证核心组合固定，但没有团队级声明入口，也无法区分内置层和团队层的稳定身份。

共享配置已经拥有 Provider reference、Plugin composition 和内容摘要，Work packet 已携带 Skill snapshot/layer digest，Host outcome 已能回报 `consumedLayerDigests`。因此本 Change 在这些边界之间增加一个纯编译步骤，而不是建立另一套 Skill Runtime。

## Goals / Non-Goals

### Goals

- 让团队在共享配置中为允许的 Work 追加 guidance 或替换显式 augmentation slot。
- 让相同共享配置和 Provider 输入在不同机器产生相同有效组合身份。
- 保持 Action、能力、write scope、产物权威与 phase transition 由核心 definition/Runtime 控制。
- 将组合身份和 resolved/delivered/consumed 事实贯穿 Run、Work、恢复、OTLP 和桌面投影。

### Non-Goals

- 不执行团队 required check，不增加 extension Work 或新的 Gate。
- 不验证 Open/TDD 方法是否真正执行。
- 不改变 Build 策略、批准和计划协议。
- 不允许用户级 Skill 或本机 overlay 改变团队生命周期。

## Decisions

### 1. 共享配置只声明可移植意图

`repoctopus.yaml` 增加版本化 `lifecycle.skillBindings`。每项包含稳定 `bindingId`、目标 Work kind、角色、逻辑 Skill 名、顺序和可选 slot；不得出现 Provider 文件路径、任意模块、内嵌代码、Cordis Loader 字段或本机绝对路径。

第一版角色只有：

- `guidance`：追加只读 augmentation；
- `augmentation-replacement`：替换 definition 显式标记为 replaceable 的单个 slot。

Action slot 不进入配置语法，从结构上消除 Action replacement。

### 2. Compiler 是纯领域函数

`SkillCompositionCompiler` 输入固定 lifecycle definition、共享 bindings、活动 Skill catalog 和已解析 Provider/provenance snapshot；输出规范化的 `EffectiveSkillComposition`：

- Action 和内置 augmentation；
- 按 `(order,bindingId)` 排序的 team guidance；
- 每个 replaceable slot 的唯一 replacement 或内置默认项；
- 每层 role、origin、contract 与内容摘要；
- 整体 `compositionDigest`。

Compiler 不读取磁盘、不启动插件、不调用 Host。Provider 发现和内容读取仍由平台 Service 完成，领域编译只消费规范 snapshot。

### 3. Replacement 是窄合同，不是任意替换

Definition 为允许替换的 augmentation 提供稳定 slot identity 及 capability、invocation 和资源合同。Replacement 必须满足同一合同；同一 slot 最多一个 replacement。未知 target、未知 slot、重复 binding、顺序冲突、Provider 歧义、带写权限 guidance 或 Action replacement 都在 claim 前拒绝。

### 4. 有效组合随 Run 冻结

Runtime 在创建首个 Work 前编译组合，把摘要纳入 Cordis composition identity、Run snapshot 和每个 Work input。恢复时重新计算当前候选：

- 摘要相同：继续；
- 仅未参与当前 Run 的已安装 Skill 变化：不影响 Run；
- 活动 binding、Provider 内容或合同不兼容变化：阻止新 claim，产生明确 drift/migration 诊断。

不创建第二 Run，也不静默采用新组合。

### 5. Context 只装填冻结层

Work materialization 从有效组合选择当前 Work 的 Action、内置 augmentation 和团队层；Work Context Assembler 只解析这些已冻结 snapshot，并按冻结顺序交付真实 Skill 内容和资源。调用方、Agent、Host 均不能增删或重排层。

团队 guidance 不继承额外 capability、write scope、产物所有权、Validator 或 transition 权限。Replacement 只替换方法层，不改变 Action input/output contract。

### 6. 个人配置只控制机器资源

`.repoctopus/local.yaml` 和用户 Skill 目录不属于有效组合输入，不能新增、删除、替换或重排团队 binding。团队要采用个人 Skill，必须先把它通过项目 Provider 和共享配置纳入正常评审路径。

### 7. 审计只陈述可证明事实

Trajectory 记录 composition compiled/rejected/drifted、binding resolved、layer delivered/consumed。`consumed` 仍只表示 Host outcome 声明的 layer digest 与当前 packet 匹配，不能描述为方法已执行。自由名称和 digest 只进入 Trace/Event 属性，不进入 Metric label；正文、Prompt、回复、本机路径和个人身份不导出。

Desktop 从相同 OTLP 语义展示 Action、内置 augmentation、team guidance/replacement 及 resolved/delivered/consumed 状态，不新增文件查询或轮询旁路。

## Error Handling

- 配置语法错误在项目配置加载时给出字段路径。
- 合同、Provider 或排序错误在 composition compile 时 fail closed。
- 冻结后漂移在 claim 前阻断，并保留旧 Run/Evidence 只读诊断。
- Host 消费回执引用未知或旧 layer digest 时拒绝 Outcome，不补写 consumed。

## Multi-Repository and Recovery

Bindings 位于 Workspace Repository，目标使用 Work kind/slot，而不是本机仓库路径。多仓 Work 继续由已有 repository selector 和 write scope 约束；组合摘要不包含 checkout 绝对路径。恢复测试必须覆盖不同父目录、Provider 内容漂移和同摘要重启。

## Alternatives Considered

- **直接修改 lifecycle definition**：无法让团队独立配置，且每次方法变化都要求发布产品版本。
- **允许任意 Skill replacement**：会让团队配置获得 Action/权限/transition 权威，破坏 Runtime-authoritative 模型。
- **把 Method Receipt 一起实现**：消费审计和方法证明是不同产品结果，绑定实施会扩大失败面；已拆成后续 change。
- **把 required check 一起实现**：它需要生产调度、Validator 和 Gate，而 guidance/replacement 只改变 packet composition；已拆分。

## Risks / Trade-offs

- **配置复杂度增加**：第一版限制两种角色和显式 slot，不开放通用工作流 DSL。
- **Provider 漂移阻塞恢复**：这是保持可审计性的必要 fail-closed 行为；只读诊断不受影响。
- **consumed 容易被误解为执行证明**：规格、字段和 UI 文案明确限制语义，后续 Method Receipt 独立解决方法证明。

## Migration Plan

1. 先增加 Schema、领域类型和 characterization/red tests；未声明 bindings 的项目编译出与当前相同的组合。
2. 引入 Compiler 和冻结 identity，再切换 Work materialization/Context。
3. 接入恢复检查和 OTLP/Desktop 投影。
4. 用真实单仓和多仓 Workspace 验证后删除临时兼容代码；不保留未发布的影子 Schema。

## Stop Conditions

- OpenSpec 当前 capability spec 与实际共享配置权威发生冲突；
- Skill Provider 无法提供稳定内容/provenance snapshot；
- replacement 需要改变 Action capability、write scope、output contract 或 transition；
- 多仓恢复必须依赖本机绝对路径才能重建组合身份。
