---
comet_change: install-workspace-workflow-skills
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-13-install-workspace-workflow-skills
status: final
---

## Context

Comet 将静态阶段 Skill 与所选外部方法安装到宿主目录，由 Runtime 指定当前 Action。Repoctopus 已有按宿主安装 Workspace 入口的审批及恢复机制，也已有冻结 Work packet、团队 binding 和 OpenSpec Provider 工件协议。阶段正文现由 Work packet 直接交付。

## Goals / Non-Goals

**Goals**

- 初始化后可在已选择的 IDE 中发现项目级工作流 Skill。
- 在能确认实际来源和内容的宿主中减少重复传输，并在切换进程和版本变化时保持同一 Work 身份。

**Non-Goals**

- 扩大 Matt 工作流方法集合、任意替换阶段 Action、复制 OpenSpec 规划权威或在业务仓批量安装 IDE 文件。
- 改动 Verify Profile 的单独配置流程。

## Decisions

1. 复用 Workspace 入口的宿主路径、接入候选和批准范围。静态资产由 Repoctopus Action、已采用的 Matt 方法及所用 OpenSpec Provider 提供，维护各自来源和版本。补装沿用 Workspace 接入的只补 Skill 能力。
2. 保留 Runtime 已冻结的组合、正文、资源和消费回执身份。在领取的宿主交付边界选择引用或完整正文，回退沿用原 Work。引用绑定来源及正文、资源身份，当前 Action 仍由 Runtime 选择。
3. 仅按 Skill 名称调用而无法确认实际读取来源的宿主，使用现有正文交付。项目文件经过校验、宿主实际使用该内容后才回报当前层已消费。
4. OpenSpec 动态路径、模板与操作约束继续作为当前 Work 的 Provider 层交付。静态 Skill 作为项目工具入口。

## Risks / Trade-offs

- IDE 的同名解析和来源可见性不同。验收逐宿主核对并报告实际使用的交付方式。
- Git 行尾、工作区链接、本地修改和资源缺失可能影响同一内容的判定。设计阶段明确规范化与资源校验规则，验收覆盖回退与冷恢复。
- 当前 Change 以未合入的宿主扩展为基底，同时包含最新 main 的 Windows 安装修复。两项交付按依赖顺序处理。

## 实施约束

### 安装

- 用现有接入预览与批准、宿主目录映射、原子写入及同请求恢复机制处理静态 Skill 文件和资源。新增目标随候选一起冻结；冲突检查先于副作用，保存用户文件。
- 阶段 Action 来自内置 Lifecycle Provider，Matt 来自现行采纳清单及当前 Runtime 使用的增强 Skill。明确排除行为参考。工作流投影保留原正文和资源字节，额外安装元数据不进入冻结正文。受管投影不注册为独立团队或个人 Provider。
- OpenSpec 从 CLI 已固定版本生成可发现的静态探索入口，作为独立查看与讨论的工具。工作流中的规划、Apply、Verify 与 Archive 都由现有 Action 和 Provider 执行，避免原生 OpenSpec 写入指令在 Repoctopus Work 中成为另一条路径。Provider 切换后不新增 OpenSpec 入口。

### 派发与恢复

- 权威 packet、身份摘要和持久化保持现有表示。外部宿主显式协商支持本地已验证引用后，Runtime 在领取成功的交付视图中逐层计算可用引用。引用提供明确项目相对路径、名称、正文摘要与有序资源身份，并绑定本次 packet。失败回到对应内联层，其他层不受影响。
- 合格宿主必须能把校验过的同一份实际内容装填到上下文。直接读取并验证指定文件的宿主可使用引用；只有名称调用或成功提示的宿主使用内联。是否在 IDE 的原生 Skill 菜单可发现，分别验证。
- 通过公开只读接口按 Run、invocation、host 和 packet digest 取回同一冻结执行包。回退不再领取、不改变执行权、审批、phase 或已交付/已消费身份。旧宿主和内部 Host 继续使用原有完整 packet。上报消费沿用现有当前 invocation 的真实回执，不把发现、验证或交付自动当作消费。
- 继续内联动态 OpenSpec Store、模板、操作与工件协议。自定义的团队 Skill 沿原有 Work composition 与信任边界交付。

### 验收

- TDD 覆盖预览不写文件、资源冲突与可恢复安装、包内资产完整性、技能解析不覆盖冻结 Provider、混合层顺序与 digest、本地缺失/修改/同名覆盖、旧回执与冷恢复。
- 从安装包初始化真实多仓 Workspace，在已支持的 IDE 中验证原生发现，区分能够验证来源的引用路径与内联路径，含 CodeBuddy、CodeArts 与 TRAE 中国版。单仓同样通过接入入口，业务仓和用户配置保持原状。

### 独立复核后的实现约束

- 引用交付使用独立的传输协商字段，不参与 Build 能力绑定。宿主入口可使用公开 CLI 读取指定文件并校验实际返回给宿主的字节。若宿主的原生调用可同时证明读取路径与实际内容，可使用同一引用；读取另一个文件或按名称重新查找不满足条件。
- 安装记录与资源身份分开。管理信息放在 Skill 内容与资源集合之外，逐文件核对先前和期望摘要。相同请求重试只写缺失或尚未更新的受管文件。本地编辑、非受管同名目录、额外资源、路径逃逸一律保留并给出诊断。显式升级仅移除已批准计划中身份一致的旧受管资源。
- 冻结内容回退仅对当前活动的外部 invocation 开放，核对工作区、Run、原 actor 和稳定 Runner、invocation 与 packet 摘要；活动 invocation 的结果待核对时保持原有恢复语义，已结束或已被取代的 invocation 无权借读取重新执行。
- Matt 可安装集合从固定生命周期默认组合和诊断补充项推导。当前包括 grilling、codebase-design、pr、tdd、code-review、diagnosing-bugs，引用仅限实际冻结为该 Provider 的组合层。OpenSpec 这次安装固定版本的只读探索入口。使用公开生成接口或固定来源资产，保留来源版本，明确禁止该入口在受管 Run 外另写规划工件。
