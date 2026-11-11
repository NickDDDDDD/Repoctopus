# Comet Design Handoff

- Change: install-workspace-entry-skill
- Phase: design
- Mode: compact
- Context hash: 59dffca5285d150d21a971c068121e1efd1656c994ef8d5b146465258dce57fe

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/install-workspace-entry-skill/proposal.md

- Source: openspec/changes/install-workspace-entry-skill/proposal.md
- Lines: 1-27
- SHA256: 33eab64cb1399ba085529d2f6ae4a0295eb1f3cdfe930caa5d45565d2de3fbb1

```md
# 安装 Workspace 工作流入口 Skill

## Why

项目接入会生成本地引导，但新会话仍要自行从说明里找工作流命令；现有的手动 Skill 投影也不能把一个用户入口和 Runtime 按 Action 交付的执行 Skill 区分开。初始化后应能在宿主直接调用 Repoctopus，并在同一 Run 里由宿主装填 Runtime 返回的当前 Action Skill。

## What Changes

- 获批接入时，在 Workspace 内为支持的宿主安装一个名为 `repoctopus` 的入口 Skill。首次接入和已接入团队补齐沿用现有项目接入路径，保留团队文件和可恢复的写入边界。
- 用户在宿主调用入口后，可以按明确意图启动 Change 或恢复已有 Run。Runtime 决定下一步；宿主在可执行响应中加载当前 Action 的真实 Skill 正文、所需资源和固定组合，沿用当前 claim 的消费与 Outcome 校验。
- 首个可交付切片从实际 CLI 安装包和全新的 Workspace 开始，贯通宿主发现、显式调用、Open 当前 Skill 装填、人工等待及冷恢复后的 Design 装填。覆盖独立多仓 Workspace 与单仓接入。
- 本次沿用现有宿主适配边界。更多宿主、全局安装、自动接管普通对话、独立 Skill 发布和替换阶段 Action 不在本次范围。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-configuration`：在获批接入中预检、安装和验证 Workspace 入口 Skill，并沿用原请求恢复。
- `skill-integration`：定义宿主显式入口及从 Runtime continuation 到当前 Action 实际装填的行为，复用现有受管执行包。

## Impact

影响 CLI 包资产、接入候选与完成校验、Workspace 引导、宿主入口和公开 continuation 的消费方式。参考 Comet Classic 0.5.1 的项目级安装与按 Action 加载思路，沿用 Repoctopus 的实现和许可证；不复制上游源码、Skill 正文或增加运行依赖。

```

## openspec/changes/install-workspace-entry-skill/design.md

- Source: openspec/changes/install-workspace-entry-skill/design.md
- Lines: 1-48
- SHA256: d8a544bc88d51c2a9f9e86d0dde8f7e24c771ed64672cd9a711c419397376fea

```md
# Workspace 入口与受管 Action 装填设计

## Context

接入事务已有候选、预检、审批、物化和完成校验。CLI 包已有固定阶段 Skill 与方法资产。Runtime 的公开 claim 响应已经包含受管层正文；当前快照会校验目录资源摘要，但执行包没有把引用文件交给宿主，例如 `codebase-design` 引用的设计参考。手动 `skill project` 的目标是导出有效目录；该目录与当前 Action 的授权范围不同。

## Goals / Non-Goals

入口的安装和发现属于宿主适配；Change 的阶段、可执行 Work、写入授权、人工门禁和证据接受沿用 Runtime。保持一套 Skill 组合和同一 Run。入口遵循用户的明确调用，不接管普通对话，不引入常驻进程。

## Decisions

### 1. Workspace 接入安装入口，安装计划随原审批冻结

参考 [Comet 0.5.1 的项目级安装](https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/domains/skill/platform-install.ts)。入口资产和生命周期 Skill 随同一个 CLI 包发布，入口资产独立于生命周期 Provider 的扫描根。接入默认预览 Codex 和 OpenCode 两个现有项目目标，分别位于 `.agents/skills/repoctopus/` 和 `.opencode/skills/repoctopus/`；允许在探测时明确缩小宿主集合，不从机器上的 IDE 安装情况猜测团队需求。两个目标使用同一份入口正文。Codex 使用宿主显式 Skill 调用；OpenCode 允许用户显式要求使用该 Skill，由其原生 `skill` 工具加载；本次无需另外维护斜杠命令包装器。参见 [OpenCode Skill 发现与加载](https://opencode.ai/docs/skills/)。

`project detect` 提供预览，`project prepare` 重新核对目标，`project review` 展示宿主、相对路径及新增、更新或冲突。准备的请求冻结目标、待装内容摘要与各目标前态，并纳入现有 `snapshotDigest`。审批后只应用该计划，包资产与批准摘要不一致时提示重新准备；旧请求不能隐式授权新增安装。宿主选择和安装事实不额外进入业务配置或 Run 的组合身份；安装文件仍按现有 Git 和 Evidence 输入规则分类，入口文件更新不豁免既有证据失效检查。项目配置领域保留候选与批准，平台层处理目标路径、内容与恢复，Cordis 组装服务，Engine 不依赖宿主布局。

### 2. 只管理入口，所有权可随 Workspace 提交

入口目录用可提交的、版本化的 Repoctopus 所有权标记记录相对文件与内容摘要。新的 checkout 可以核对所有权；本机接入日志不作为跨机器所有权依据。只有缺失的目标或经标记证明仍为受管原内容的文件可以安装或更新；不可从文件同名或内容碰巧相同推定所有权。标记只在预定目录中有效，路径、符号链接、非普通文件、意外文件及前态变化在写入前检查。

复用安全写入工具与接入状态。首次写入前先保存原请求进入 applying；续接只接受批准的原前态，或同一请求已写出的目标内容，其他情况报告冲突。全部入口写完并复核后，才允许本次接入发布配置并完成。完成请求的重放不做新写入。已有团队通过重新接入补齐；原 Store、业务仓指向和 Run 保留。手动全目录投影仍是独立功能，不收编或清理接入受管入口；仅复用宿主路径映射与适用的文件工具。回退只处理确认未修改且属本次安装的入口文件。

### 3. 公开 claim 响应驱动当前 Action 装填

参考 [Comet Classic 的 continuation 消费方式](https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/assets/skills/comet-classic/SKILL.md)。宿主从 Workspace 进入，通过现有 `run start` 或 `run resume` 取得同一 Run，再按公开 continuation 处理。收到 `execute` 才领取对应的当前受管 Work；Runtime 管理的动作仍通过 Runtime 原入口执行。人工等待使用已有的原生宿主提问与决定回传；待核对或待纠正走原 Work 恢复，`done` 停止。入口不把状态标签当作可以执行的 Action，也不代替用户批准。

宿主以当前受信任的 Runner 身份及实际可用能力领取。入口使用稳定、绑定当前 Workspace、Run 和当前调用方的 Runner 标识，经现有 `--runner` 跨 CLI 进程复用，不用临时 PID；Build Configure 已冻结其他身份或能力时，走 Runtime 返回的恢复或重绑定路径，不复制其他执行者的身份来通过校验。只有 `executionAcquired: true` 才授权本次宿主执行；未取得执行权时按返回的恢复事实处理。

宿主用 `run work-claim --json` 取得公开执行包，按 `packet.context.layers` 顺序实际加载正文。对新 claim，Runtime 从同一次精确 Provider 解析中取得正文与目录资源，在持久化 claim、标记交付或启动 Host 前校验并组装。资源按 Skill 层和相对路径编入同一个冻结包，可读文本或明确编码的字节纳入该包身份；校验现有资源集合摘要，动态加入的诊断层也在首次交付时冻结资源身份。拒绝越界、符号链接、缺失和漂移，并限制资源总量；资源内容不作为遥测字段，也不授予执行其中脚本的能力。

既有执行包维持原身份与接受事实；重发使用已冻结的内容。只有旧包已有相应资源快照时才允许按其核验补齐；无法证明旧资源身份时报告缺口并沿原 Action 恢复，不能为旧包追记新内容。Outcome 仍使用现有 packet、invocation、Host 身份和实际装填的 Skill layer digest，不另建消费回执。入口不查全局同名 Skill、不读私有状态路径，也不因交付失败创建第二个 Work。

### 4. 验收从真实宿主发起

用实际 CLI 安装包在产品源码外获批接入，在真实宿主新会话确认入口来自 Workspace 并显式调用。沿同一 Run 观察 Open 的正文、人工等待及冷恢复后的 Design 正文和资源读取；用现有受管回执、轨迹与 `skill.consumed` 遥测对应到各 claim。在 Configure 冻结后再启动进程，验证稳定 Runner 可领取下一 Work，并覆盖 Build 代表性的资源引用与诊断层；对 OpenCode 至少实测原生 Skill 工具发现并加载入口。用契约测试覆盖完整 continuation 分支以及安装中断、冲突、单仓和多仓隔离。实际宿主记录用来核对是否读取了正文和资源，遥测消费声明不证明 Agent 完全遵守了方法。证据进入 Evidence 和正式 Verify 报告。

## Risks / Trade-offs

- 宿主可能缓存 Skill 或优先解析同名项目外定义。验收使用新会话并核对加载来源，文档说明用户可观察的恢复路径。
- 冷恢复时 Provider 资源可能已变化。沿现有冻结身份检查并报告明确差异，不能以新内容替代；旧执行包与消费记录不改写。
- 路径规划后可能发生并发修改。沿用安全写前重验，不对团队文件进行强制覆盖；明确区分中断续写和未经批准的写入。
- 规划产物、现有规格、公开 CLI 契约或宿主实际行为存在实质冲突时停止对应工作，先核对或经批准调整。

## Migration Plan

新 Workspace 随获批接入安装；已有 Workspace 通过原接入流程获批补齐。公开 CLI 仍可独立使用，既有 Run 无需为安装入口重建。为已签发包保留原身份，补齐资源时核对该包已经绑定的 Skill 快照。

```

## openspec/changes/install-workspace-entry-skill/tasks.md

- Source: openspec/changes/install-workspace-entry-skill/tasks.md
- Lines: 1-18
- SHA256: ddc97b85c16d82aad6609383f5cb928fe02daa750b66144a6bd8103ceb92f85a

```md
# 实施任务

## 1. 贯通 Workspace 入口

- [ ] 1.1 随 CLI 包交付 `repoctopus` 入口资产，将宿主目标纳入接入候选与审批；以新装包检查候选可见、批准前无写入、批准后 Codex 能发现入口。 <!-- comet-task:b0a5fbc8-83f7-4b67-8664-4b10e7b33c90 -->
- [ ] 1.2 让入口经公开 CLI 按明确意图启动 Change 或恢复原 Run；在真实宿主调用，核对 Run 身份，并验证缺少必要输入时先停下澄清。 <!-- comet-task:f6a52240-5e08-4210-9042-5c03495c571f -->
- [ ] 1.3 接通可执行 continuation、当前 Work claim、真实正文和资源装填以及现有回执；测试资源校验失败不启动 Host，动态诊断资源绑定当前包，且同名 Skill、旧包和仅有名称均不能替代当前内容。 <!-- comet-task:6949290a-69fe-4a87-9172-f412699dcc1f -->
- [ ] 1.4 接通人工决定、等待、核对与完成的处理，更新 Workspace 引导；验证 Open 等待时无 Design 装填，冷恢复后沿同一 Run 装填当前 Design。 <!-- comet-task:1f872953-a072-4f23-9046-8f14fdef0ef8 -->

## 2. 扩展安装覆盖与保护

- [ ] 2.1 补齐 OpenCode 宿主路径和单仓、多仓的接入覆盖；实测 OpenCode 发现并加载入口，验证入口只安装在指定 Workspace，不改业务仓宿主配置、用户目录或其他 Skill。 <!-- comet-task:157d89ad-92a9-40e6-9a86-eb97cd048e53 -->
- [ ] 2.2 复用所有权和写前重验，测试同名团队文件、本地修改、并发变化及不安全路径的拒绝与原样保留。 <!-- comet-task:85014b1f-3791-4a2c-85e2-3eee98caf56b -->
- [ ] 2.3 验证中断后续接、已确认请求幂等重放与既有 Workspace 获批补齐；比对 Store、业务仓指向和已有 Run 的身份，并更新补齐说明。 <!-- comet-task:ddc2b0f8-b3a2-4644-b5ab-9a0b43164b30 -->

## 3. 整体验收

- [ ] 3.1 用实际安装包和隔离的多仓 Workspace 完成真实宿主验收，记录入口调用、正文装填、审批停留、同一 Run 的跨进程恢复及 Build Configure 后领取，以及实际消费回执和遥测的对应关系；汇总结果到 Evidence 与正式 Verify 报告。 <!-- comet-task:83b0006c-5d17-44e7-b319-ffd16d69fdae -->

```

## openspec/changes/install-workspace-entry-skill/.openspec.yaml

- Source: openspec/changes/install-workspace-entry-skill/.openspec.yaml
- Lines: 1-2
- SHA256: b8f20def63a86ae4075c5499ff9ed413265d8704692a8493712424dc3f28d8e3

```md
schema: spec-driven
created: 2026-11-11

```

## openspec/changes/install-workspace-entry-skill/specs/project-configuration/spec.md

- Source: openspec/changes/install-workspace-entry-skill/specs/project-configuration/spec.md
- Lines: 1-37
- SHA256: 5a14506dda1abb358a1604c89620c4ff4aa8467ab2d2ba368077cab281b4f885

```md
# Workspace 入口 Skill 接入规格

## ADDED Requirements

### Requirement: 获批接入安装 Workspace 工作流入口 Skill

Repoctopus MUST 在项目接入候选中显示支持的宿主及入口安装目标。接入获批后，Repoctopus MUST 在 Workspace 内为批准的宿主安装可发现的 `repoctopus` 入口 Skill，并在报告接入完成前验证安装结果。安装 MUST 限定到受管入口及其资源，不修改用户级 Skill 目录、独立业务仓的宿主配置或其他 Skill。

#### Scenario: 新团队获批接入

- **WHEN** 团队从已安装 CLI 完成包含受支持宿主的单仓或多仓接入
- **THEN** 从 Workspace 打开的对应宿主新会话能发现并显式调用 `repoctopus`，无需执行完整 Skill 目录投影或检出产品源码
- **AND** 多仓接入仅在 Workspace 安装入口，单仓接入在兼任 Workspace 的业务仓安装入口

#### Scenario: 预览或未批准接入

- **WHEN** 接入处于探测、准备、待批准、拒绝或请求修改
- **THEN** 入口路径及管理记录保持原状

### Requirement: 入口安装保留团队文件并可恢复

Repoctopus MUST 在入口写入前校验目标、所有权和已有内容。对同名的非受管 Skill、受管文件的本地修改或不安全路径，Repoctopus MUST 报告可定位冲突、保留原文件且不宣布本次接入完成。重复应用同一获批请求 MUST 幂等；中断后 MUST 能在同一请求上继续并保留已确认的接入事实。

#### Scenario: 已接入团队补齐入口

- **WHEN** 团队用现有共享配置重新准备并批准接入
- **THEN** Repoctopus 补齐入口并复用健康的 Store 和既有登记，不要求重新初始化业务仓或 Run

#### Scenario: 团队已有同名 Skill

- **WHEN** 安装目标由团队维护、存在本地修改或指向不安全位置
- **THEN** Repoctopus 报告冲突路径及解决方式，原内容不变，且不报告接入完成

#### Scenario: 多个安装目标之间中断

- **WHEN** 获批请求已完成部分入口安装，但尚未报告接入完成
- **THEN** 续接同一请求时核对已完成目标，仅补齐剩余目标，并在全部通过校验后报告完成

```

## openspec/changes/install-workspace-entry-skill/specs/skill-integration/spec.md

- Source: openspec/changes/install-workspace-entry-skill/specs/skill-integration/spec.md
- Lines: 1-38
- SHA256: 9b98cbf3d240ab20baffb8e0f28730c08cbb6e050607bf079ca8b55eb0fd6e4a

```md
# 工作流入口与 Action Skill 装填规格

## ADDED Requirements

### Requirement: 宿主通过 Repoctopus Skill 进入工作流

Workspace 的 `repoctopus` 入口 Skill MUST 通过公开接口按明确用户意图启动 Change 或恢复已识别的 Run。入口 MUST 以 Runtime 返回的 continuation 为准；无法确定目标时 MUST 提示用户补足身份或意图，不得猜测并创建第二个 Run。入口 Skill 不持有阶段、审批或写入授权。

#### Scenario: 在宿主显式调用入口

- **WHEN** 用户在已接入 Workspace 的宿主里调用 `repoctopus`，并给出启动所需的 Change 和目标信息
- **THEN** 宿主经公开 CLI 启动该 Change，沿 Runtime 返回的 Run 和当前 continuation 执行
- **AND** 不要求宿主预先发现全部阶段 Skill

#### Scenario: 从新会话恢复已有 Run

- **WHEN** 用户调用入口并给出已有 Run 的身份
- **THEN** 宿主恢复原 Run，并按当前 continuation 处理，不基于本地文档重建阶段或新建 Run

### Requirement: 宿主仅装填 Runtime 指定的当前 Action Skill

对已领取的可执行 Action，Runtime MUST 交付当前 claim 绑定的固定 Skill 正文和所需资源；宿主 MUST 在执行前装填该内容及按序交付的其他受管层，并只对实际装填的层回报消费。宿主 MUST 按 Runtime 指示处理人工决定、等待、待核对或完成状态；不可从阶段名称、同名 Skill 或旧执行包自行选择执行内容。

#### Scenario: 从 Open 推进到 Design

- **WHEN** 宿主从同一 Run 取得并领取 Open Action，随后当前 Open Outcome 被接受且人工批准完成，Runtime 返回 Design Action
- **THEN** 宿主先装填 Open 的受管内容；审批前不装填 Design；领取 Design 后装填该 Action 自己的受管内容
- **AND** 消费回执与各自的 claim 及执行包绑定

#### Scenario: 当前内容无法装填

- **WHEN** 所需内容缺失、宿主无法加载，或拿到的是其他 Action、旧 attempt 的执行包
- **THEN** 宿主报告缺口并停止该 Action，不回报未消费内容、不改用同名 Skill，不让 Runtime 将其视为成功

#### Scenario: 恢复时存在待决定项或未知结果

- **WHEN** Runtime 返回人工决定、等待、待核对或已完成
- **THEN** 宿主处理该返回状态，不以入口调用为由重新领取或重放已执行的 Action

```
