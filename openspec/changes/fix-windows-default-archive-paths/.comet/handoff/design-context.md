# Comet Design Handoff

- Change: fix-windows-default-archive-paths
- Phase: design
- Mode: compact
- Context hash: 47453448e2ef9b884b905bb8a59e907f7fa7255724057bbd8428ae341c72d7e8

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/fix-windows-default-archive-paths/proposal.md

- Source: openspec/changes/fix-windows-default-archive-paths/proposal.md
- Lines: 1-36
- SHA256: 084e3b1ed699b3adb998c7d678beeb996718177eab104d469a2d551e64c632b6

```md
# Windows 归档路径与跨实现恢复

## Why

真实多仓验收中，Build、Verify 与证据恢复均已通过，但 Archive 创建隔离 checkout 时因 Git for Windows 的默认路径限制失败，尚未产生规格关闭或发布结果。此前短目录验收没有覆盖这一边界；要求用户修改系统或 Git 持久配置会把产品内部路径开销转嫁给团队。

Design 复核又发现，恢复层接受兼容实现后，发布层仍要求当前组合严格等于 Archive 冻结的旧摘要，违反已有的组合兼容性与规划审批分离契约。用户已选择在同一 Change 修复两者，并用修复包完成原失败 Run，不能以另建验收 Run 替代。

## What Changes

- 为 Runtime 管理的规格归档 Git 操作提供 Windows 进程级长路径支持，覆盖隔离 checkout 的创建、观察、清理以及规格变更检查、索引、提交和发布恢复。
- 保留用户的 Git 本地、全局、系统配置及 Windows 设置；不改变用户配置的检查命令。
- 保持现有冻结 OID、允许路径、调用者工作树隔离、Journal 和发布身份约束；失败保留原 Run 与已接受证据，通过公开入口恢复。
- 让恢复与 Archive 副作用入口共同消费现有组合兼容性权威：冻结交付来源继续保留，当前执行实现经精确采纳及受保护入口核验后接续；不把旧来源摘要作为当前执行器的等值条件。
- 补齐真实 Cordis 生产入口的跨实现归档回归，不 mock 掉规划审批或发布校验；覆盖不兼容实现、执行前再次漂移和部分副作用恢复的拒绝与幂等行为。
- 增加真实 Git 长路径回归和 Windows 默认设置下的多仓验收，分别证明 checkout 和归档后索引可以完成，并检查恢复不会重复发布。

当前垂直切片是由修复包从原失败 Archive checkpoint 完成长路径规格关闭与多仓发布。后续如发现其他受管 Git 流程有同类实证，再单独评估扩展。系统设置修改、任意外部工具的长路径支持、改变五阶段状态机、重新设计 Journal、通用旧版兼容或历史数据迁移、更换归档目录布局均不在本次范围。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `delivery-governance`：规定 Windows 默认配置下的归档路径行为，以及原冻结交付来源与获准执行实现分离后的 Archive 恢复边界；组合兼容性判定继续遵守已有 `plugin-composition` 契约。

## Impact

涉及平台 Git 适配、`domains/runtime/workflow-runs.ts` 的受保护执行入口、WorkflowRuns 与 Delivery Service 内部执行上下文、`plugins/delivery/file-delivery-provider.ts`、内置实现身份登记及对应测试。内部端口区分执行上下文和冻结来源；不新增 CLI/共享配置字段、持久状态格式或第二套 adoption 协议。

借鉴固定 Comet 基线 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的平台 Git 执行边界；其 `platform/process/git.ts` 没有自动开启长路径，相关 `native-portable-archive` 测试显式设置 `core.longpaths`，因此不把上游测试视作本需求已经解决。使用 Git for Windows 官方能力，独立实现局部适配，本提案不引入或复制第三方源码，不新增依赖或许可证义务。

恢复部分借鉴同一 Comet 基线对 Action 原输入、attempt、审批及真实证据分别核验的方式；Comet Classic 没有本项目的 Cordis 组合摘要等值门槛。本次修复本项目适配契约，不宣称直接移植一个上游已有的 Cordis 升级功能。

```

## openspec/changes/fix-windows-default-archive-paths/design.md

- Source: openspec/changes/fix-windows-default-archive-paths/design.md
- Lines: 1-130
- SHA256: 0c0e609276d66af4aaee7d4229da06d193e2ad62cda553e248bded1690db3062

[TRUNCATED]

```md
# Windows 归档路径与跨实现恢复设计

状态：用户已选择 B，在同一 Change 修复路径和跨实现 Archive 恢复；下述技术方案等待正式 Design Wait 确认。没有修改产品代码或实验 Run。

## Context

路径失败和范围见 proposal.md。真实多仓 Run 已完成 Build、Verify，在创建隔离 checkout 时因 Git for Windows 默认路径处理失败；没有规格关闭或发布结果。另一历史案例在归档后索引阶段失败，因此要覆盖 checkout 到发布的完整链路。

跨实现恢复暴露了已有契约的遗漏：组合权威可以采纳兼容实现，但 FileDeliveryProvider.assertPlanningApproval 仍把当前组合与冻结的 archive.planningCompositionDigest 作严格等值比较。PlanningSnapshot 没有这个字段；它记录的是 Archive prepare 当时的执行组合来源，不能替代人工审批语义。公开 preflight replacement 也不能改这个冻结字段。

历史定位：stabilize-runtime-continuation 的提交 2fb0da8 已尝试分离规划和组合，却留下上述比较。此前 CLI adoption 测试在 Open 后改变无状态遥测插件；部分 Archive 纵切又 mock 掉 validateArchiveIntent，没有证明受保护 Delivery 实现在 Archive 中途更新后仍能发布。

## Goals / Non-Goals

**Goals:**

- 原失败 Run 使用修复包，经公开入口完成真实长路径归档与多仓发布。
- 由既有组合权威证明当前执行实现可接续，受保护副作用入口消费这一结论；冻结来源、审批、证据、Journal 和发布身份保持可核验。
- 用真实生产校验及冷恢复、漂移、故障注入矩阵证明闭环，避免只测试单个分类函数或投影。

**Non-Goals:**

- 不修改五阶段生命周期，不新增 adoption 状态机、持久 Receipt、迁移工具或通用历史版本兼容。
- 不修改用户 Git/系统持久配置，不移动或缩短 checkout，不改写 check policy 精确 argv，不接管 hooks 或外部工具。
- 不削弱规划、仓库、OID、证据、允许路径及结果未知的检查，不用新 Run 替代原 Run 的恢复验收。

## Decisions

### 1. 按 Comet 的真实边界借鉴，明确本项目适配责任

固定基线为 35c9860b77b42bafa0c2d80d8d695889f888a924。

- platform/process/git.ts：集中 Git 执行，未自动开启长路径；native-portable-archive 测试显式启用 core.longpaths。只借鉴执行边界，Windows 默认支持由本次真实验证负责。
- domains/engine/runtime-action.ts：保持 Action 原输入、attempt、claim 与 Outcome 绑定。
- domains/comet-classic/classic-sdk-archive-preflight.ts：发布前核对 Run、原审批、绑定分支、检查 argv、环境及实际输入证据，而非以执行器完全未变化代替这些事实。

Comet Classic 没有本项目的 Cordis 组合等值门槛。我们复用其身份分离和副作用前复核思路，使用已有 compareCompositions 与 Coordinator 采纳协议适配 Cordis，不宣称移植了上游现成的 Cordis 升级方案。

### 2. 冻结来源与当前执行上下文分开

| 身份                                             | 职责                                    | 修复包接续时的处理                                        |
| ------------------------------------------------ | --------------------------------------- | --------------------------------------------------------- |
| Planning semantic 与可信 approval                | 证明范围和设计获批                      | 语义不变则保留原决定                                      |
| Verify Input、Gate、Bundle                       | 证明原业务输入已验证                    | 实际依赖不变则保留，继续核对原 evidenceCompositionDigest  |
| Archive input、publication checkpoint 与 Journal | 证明精确发布集合、OID、策略和已发生事实 | 保留原摘要与稳定身份                                      |
| 当前 Run composition                             | 证明当前实现能解释并执行既有事实        | 既有权威精确判断 same、compatible 或 migration_required   |
| 副作用调用的执行上下文                           | 绑定此次调用与受保护的最新 Run          | 在入口内从最新已采纳状态取得，不接受 Host 或 CLI 提供摘要 |

保留 archive.planningCompositionDigest 的持久字段及其原值，作为冻结时的执行来源记录；不改名迁移、不抹平旧来源、不将其替换为 current。它不再被用来要求当前执行实现与历史完全相同。

内部 Delivery Archive 端口使用明确的执行上下文命名，包含当前获准执行的组合身份；不复用 planningCompositionDigest 参数表达两个不同含义。这个上下文只在进程内传递，不增加 CLI 参数、Host Outcome 字段、持久协议或第二份权威状态。

### 3. 单一组合权威，完整覆盖 Archive 的真实执行依赖

继续由 WorkflowRunCoordinator 的 compareCompositions 和 prepareWritableComposition 做兼容判定及既有原子采纳，保留 composition.changed 审计事实。领域层不读取 Git、文件或 Cordis Context。

Archive 的依赖范围包含 Run/Lifecycle 权威以及实际规格关闭和发布端口拥有者，包括 specification-authority 与 delivery-state-write。不能把 Work capability 名称直接当成插件 authority 的完整映射：specification.close 的 specification.write 与 delivery.publish 的 git.publish，并不等于相应 Provider 的受保护 authority。关闭阶段已经使用受管 Git checkout，并会在同一冻结 Archive 接续发布，因此采纳前就要覆盖这些真实依赖。

只为本次直接基线中确实变化且受影响的实现登记唯一精确前驱；新 Git 适配纳入实际代码摘要。预计涉及 workflow-runs 与 delivery-file，以生产 catalog 和原包观察确认，不无差别更新其他插件。缺失/错误/多个前驱，配置、authority、schema 或当前 Work 契约不兼容时仍阻断；不增加通配版本或旧版执行分支。

未进入本次 Archive 真实依赖闭包的无关组件变化继续按既有规则处理；不为解决局部遗漏改为整包变化一律禁止。

### 4. 受保护入口把已采纳实现绑定到副作用

保留并加强现有 withArchiveEffectAuthority，不另建执行授权 Service 或持久 token：

1. 公开 Archive 入口先通过既有 Coordinator 恢复/采纳，再读取权威 Run。
2. 在现有 commitGuarded 边界核对 Run、phase、Work、epoch、冻结 Archive input 以及最新 Run composition 与当前执行组合一致。
3. 继续核对规划审批、仓库/OID、实际证据依赖和已有副作用状态。
4. 只有通过上述检查后，callback 才从最新状态构造本次执行上下文并调用关闭、业务发布或规格发布端口。
5. Delivery 继续核对实际 Provider 组合与收到的执行上下文一致，并核对原 Planning approval 和实时分支；不自行发明另一套兼容判定。

只读 validateArchiveIntent 也区分冻结来源和当前执行上下文，但不因只读检查通过就缓存写权限。每次真正副作用仍走受保护入口。非 Archive 的 checkpoint/prepare/publish 行为保留原契约，不借此次改动放宽通用 Delivery。

这不是简单删除等值检查：当前执行器与可信 Run 的一致性仍检查，只是不再把历史来源当成当前执行身份。缺少真实上下文、跨 Run、旧 Work、期间再次组合漂移或未获准采纳，都在副作用之前被拒绝。

不依赖扫描历史 trajectory 重新决定当前状态；现有已提交 Run 与采纳事实是恢复依据。并发执行者改变 composition 后，旧执行者不能凭手中旧视图写入。原 Journal 对结果未知的观察、采用、拒绝盲重试规则继续生效。

### 5. 局部 Git 进程级长路径支持


```

Full source: openspec/changes/fix-windows-default-archive-paths/design.md

## openspec/changes/fix-windows-default-archive-paths/tasks.md

- Source: openspec/changes/fix-windows-default-archive-paths/tasks.md
- Lines: 1-27
- SHA256: c5de40fe2684ebb4beb81022cc9052f0dc34d011e7c6dd74833504f3eb9cf364

```md
# Windows 归档路径与跨实现恢复任务

## 1. 统一 Archive 恢复与执行权威

- [ ] 1.1 先建立跨实现 Archive RED 回归：生产 Cordis 组合中冻结来源 A，合法采纳 B 后调用真实规划与发布校验，确认当前失败来自历史组合等值检查；不 mock validateArchiveIntent、组合判定、Planning approval 或核心 publishArchive。 <!-- comet-task:eaf35d6b-14b6-499e-825d-cedcf8df9b4a -->
- [ ] 1.2 区分原冻结来源与本次执行上下文，在既有受保护入口内核对最新 Run/Work/epoch/Archive input 和当前组合，再交给 Delivery；让 1.1 转 GREEN，断言原输入、审批、Verify 与 Journal 身份不变，过期或跨 Run 上下文无副作用。 <!-- comet-task:dadbb228-3ace-4f5f-a456-e1770063eb63 -->
- [ ] 1.3 补齐 Archive 真实 Provider 依赖及竞争回归：specification.close 与 delivery.publish 均覆盖受保护 Delivery；验证不兼容、错误/多个前驱、配置/authority/schema 漂移及入口前再次漂移被拒绝，未知执行仍先协调，不增加重复审批。 <!-- comet-task:a709c446-2677-4d2a-8117-5a528b58bae3 -->
- [ ] 1.4 对实际变更实现登记新源文件和唯一精确直接前驱，以源基线、旧包和原 Run 的生产代码/descriptor 摘要核对；运行 composition compatibility 正负回归，不扩大其他插件兼容范围或固定伪造当前摘要，最终实现完成后复核。 <!-- comet-task:c3d049cc-18b6-4291-9e24-e89fffbe965e -->
- [ ] 1.5 更新现有 Runtime/插件文档及当前 design.md 的身份职责、公开恢复步骤、commit/push 与组合变化的区别；回读并核对示例不要求手改 Store、重复审批或延迟 push，文档不包含具体宿主或绝对路径。 <!-- comet-task:c69cbbf0-19fe-4c16-9a88-c7ae21f47d9d -->

## 2. Windows 长路径归档链路

- [ ] 2.1 增加真实 Git checkout 长路径 RED，再实现局部 Windows 命令级适配转 GREEN；覆盖创建、观察、清理、非 Windows argv 和原始 NUL 输出，并验证成功/失败后持久配置与父进程环境不变。 <!-- comet-task:21d48cd8-e38d-4dc6-9d80-d1174d52889b -->
- [ ] 2.2 增加归档文件超过默认完整路径边界的真实索引 RED，收拢 publication 全部 Git 调用转 GREEN；断言实际 diff、add、commit、push、清理、索引内容和远端 OID，覆盖空格路径与配置不变。 <!-- comet-task:a6ec55d6-082b-4b4d-80c7-d4daaf04d5ff -->
- [ ] 2.3 运行并补齐 checkout 授权、冻结 OID、受管根、调用者 HEAD/branch/index 隔离，以及规格提交/push/MR 各中断点和 completed 重放回归；越权或漂移仍拒绝，恢复不重复已确认副作用，边界记录在 design.md。 <!-- comet-task:1dc12635-41cc-46b3-9fbe-12b272a62fbd -->

## 3. 原 Run 与完整集成验收

- [ ] 3.1 从最终修复提交构建并独立安装候选包，记录实际源提交、包摘要和 CLI 入口；保留原已验证旧包、失败日志、registry 和实验现场，不改变验收仓 Git 配置或系统设置。 <!-- comet-task:62e65c6f-2762-4a91-bf7b-feda48bc36c0 -->
- [ ] 3.2 使用候选包公开 CLI 接续原失败多仓 Run，验证精确组合采纳、原工作包/审批/Verify Input/Gate/Bundle/Archive input 保留，以及真实规格关闭和完整既定 MR 集合；记录实际默认设置、路径长度及命令/副作用次数，不以新 Run 替代。 <!-- comet-task:8dd9ab1c-ebc2-4294-98c3-6bcfb80257ac -->
- [ ] 3.3 在成功关闭、部分发布和完成边界验证新进程恢复与 resume/next 顺序，核对原 Journal、精确 OID/MR、调用次数及终态不重复执行；关联既有 Run/Work/组合采纳遥测，缺失证据如实列为未验证。 <!-- comet-task:84ba5edb-a748-4af4-8e10-d40850f724ed -->
- [ ] 3.4 按 Comet check policy 精确命令完成全量验证和独立 thorough 审查，修复阻断项；提交正式验证报告，区分自动化契约夹具与真实旧包到新包的结果，确认临时测试目录清理且原失败证据保留。 <!-- comet-task:7594fa72-e6c3-4ec2-b7ec-abd6e0d629f2 -->

## Workflow follow-up

- Verify 通过后经真实授权归档并交付本 Change，每次 commit 后立即 push；CI 通过后按用户授权创建及合入 PR。
- 原实验 MR 的合入仍按实验交付授权决定；产品 Archive 不等待业务 MR 合入。

```

## openspec/changes/fix-windows-default-archive-paths/.openspec.yaml

- Source: openspec/changes/fix-windows-default-archive-paths/.openspec.yaml
- Lines: 1-2
- SHA256: 5fd2cc7d290b25cf909218418df74e542dd2eb03ebf67a63a38a9bee04d94037

```md
schema: spec-driven
created: 2026-11-08

```

## openspec/changes/fix-windows-default-archive-paths/specs/delivery-governance/spec.md

- Source: openspec/changes/fix-windows-default-archive-paths/specs/delivery-governance/spec.md
- Lines: 1-89
- SHA256: 469e60ccbf6d3fd678380ccdc32f4dd285dd9c82853bd54804bde38c6b3f1dec

[TRUNCATED]

```md
# 规格归档长路径与执行恢复

## ADDED Requirements

### Requirement: Windows 受管规格归档支持长路径

Repoctopus MUST 在 Git for Windows 支持的文件名与路径范围内完成受管规格 checkout 的创建、观察、清理及规格发布的变更检查、索引和提交，即使 Windows 未开启系统长路径设置且 Git 持久配置未启用长路径；归档自身增加目录层级不得要求用户缩短 Workspace 或 Change 名称。非 Windows 平台 MUST 保持原有 Git 行为。

#### Scenario: 隔离 checkout 的路径超过默认目录边界

- **WHEN** 已冻结的规格树位于合法 Workspace，受管 checkout 增加的目录层级使 Git for Windows 默认路径处理失败
- **THEN** Runtime 使用自身的长路径支持创建 checkout，并继续按同一冻结 OID 进行规格关闭

#### Scenario: 归档文件超过默认完整路径边界

- **WHEN** 主规格同步及 Change 归档后的文件路径超过默认边界，但仍属于受管允许路径且可由底层 Git 和文件系统访问
- **THEN** Runtime 能完成真实索引、提交、普通 push 和精确发布核验，并只在原 Journal 完成后清理 checkout

#### Scenario: 非 Windows 平台执行相同归档

- **WHEN** 相同规格归档在非 Windows 平台执行
- **THEN** Runtime 保持既有 Git 参数语义及发布结果，不要求额外平台设置

### Requirement: 长路径支持不得修改宿主配置与检查契约

Repoctopus MUST 将长路径适配限制在自身管理的规格归档 Git 子进程内，不修改仓库本地、全局、系统 Git 配置或操作系统设置，不污染父进程环境，也不改写 check policy 的精确命令。长路径支持 MUST 保留冻结 OID、允许路径、受管根目录和调用者工作树隔离检查。

#### Scenario: 归档成功或失败后配置保持不变

- **WHEN** 受管规格归档使用长路径支持成功、失败或被中断
- **THEN** 用户的持久 Git 配置、系统设置和父进程环境保持原值，调用者 branch、HEAD 和 index 不因规格提交而改变

#### Scenario: 路径支持不扩大授权

- **WHEN** checkout identity、冻结 OID 或待提交路径不满足原授权约束
- **THEN** Runtime 仍拒绝对应操作，不以长路径支持放行越权 checkout 或提交

#### Scenario: 用户检查命令显式调用 Git

- **WHEN** check policy 指定一个包含 Git 的验证命令
- **THEN** 验证仍使用已派发的精确 argv 和环境契约，不因归档适配被隐式添加 Git 参数或环境覆盖

### Requirement: 归档路径失败沿原交付身份恢复

Repoctopus MUST 在路径操作失败时保留原 Run、有效完成事实、已接受验证证据和已存在的关闭或发布 Journal，不签发虚假完成结果。修复实现经现有组合权威精确采纳后，MUST 从公开 Archive 入口继续采用原冻结交付身份并按现有观察与采纳规则处理已发生的副作用，不通过新建 Run、重复审批或重放已确认发布来绕过失败。

#### Scenario: checkout 创建失败后修复并恢复

- **WHEN** 路径失败发生在规格关闭及远端发布之前，且修复后原冻结输入仍有效
- **THEN** 同一 Run 可从公开入口继续，保留原工作包和 Verify 证据，不伪造失败时尚不存在的 Closure 或 Publication Receipt

#### Scenario: 已提交或部分发布后重新进入

- **WHEN** 恢复的 Journal 已保存规格提交或部分远端发布事实
- **THEN** Runtime 先核验并采用精确匹配结果，只执行尚未确认的步骤，不重复创建 commit、业务 MR 或规格 MR

#### Scenario: 底层仍无法处理路径

- **WHEN** 底层工具或文件系统仍拒绝路径，或原冻结输入已经漂移
- **THEN** Runtime 保留失败与已发生的副作用，返回可操作诊断，不报告归档完成、不自动更改用户配置或选择新发布身份

### Requirement: Archive 执行组合与冻结交付来源分离

Runtime MUST 由既有组合兼容性权威决定当前实现能否接续 Archive，并在受保护副作用入口核对已采纳 Run 与实际执行组合一致。冻结 Archive 来源、原审批、Verify Input、Bundle 和 Journal MUST 保留原身份，不得以历史来源摘要要求当前实现完全相同，也不得用未经 Runtime 核验的当前摘要、Host 声明或人工重复审批替代兼容性证明。

#### Scenario: 受保护实现兼容更新后继续原归档

- **WHEN** Archive 已冻结输入，新的 Runtime 或 Delivery 实现精确匹配允许的前驱且状态、配置、authority 和当前 checkpoint 契约兼容
- **THEN** Runtime 记录既有组合采纳事实，保留原规划审批、完成工作包、验证证据、Archive 输入和发布身份，经公开入口继续关闭及发布；不重跑无变化的 Verify 或追加相同审批

#### Scenario: 当前关闭 Work 尚未调用发布端口

- **WHEN** 当前 Work 是规格关闭，但同一已冻结 Archive 还依赖后续受保护 Delivery 发布实现
- **THEN** Runtime 在采纳与副作用前检查这组真实 Archive 执行依赖，不因当前 Work 的 capability 名称与插件 authority 名称不同而漏掉发布实现；不兼容时先阻断

#### Scenario: 执行入口使用伪造或过期组合

- **WHEN** 调用方提交自述的兼容结论、另一 Run 的执行上下文，或已观察组合在副作用前再次改变
- **THEN** Runtime 在任何受管 checkout 写入、commit、push 或 MR 创建前拒绝执行，不覆盖原输入或执行未知结果的盲重试


```

Full source: openspec/changes/fix-windows-default-archive-paths/specs/delivery-governance/spec.md
