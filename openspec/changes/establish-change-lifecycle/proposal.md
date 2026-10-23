# Proposal

## Why

Repoctopus 已经具备可恢复 Run、Action/Receipt、Evidence、Delivery、Webhook 和 Post-merge 等基础能力，但缺少一个由 Runtime 强制执行的 change 生命周期。当前默认 workflow 只是若干通用 checkpoint；规划批准、实施 Run、Delivery 和 Post-merge Run 分别维护状态，因此 Agent 可以在未完成或未批准 OpenSpec 规划时开始实施，Dashboard 也无法从单一事实回答“当前 change 在哪个阶段、为什么等待、下一步是什么”。

Comet 0.5.0 已把这类问题收敛为一个持久 Change Run：`Open → Design → Build → Verify → Archive`，阶段转换由领域规则和验证证据决定，Skill、写入范围、人工批准与恢复身份都绑定到当前 Action。Repoctopus 应采用这些经过成熟产品验证的原则，同时保留自己的 Cordis 组合、多仓 Workspace、Business MR 集合和平台事件能力，而不是复制 Comet 的产品外壳或建立第二套插件系统。

## What Changes

- 建立唯一权威的 Change Run，以 `Open → Design → Build → Verify → Archive` 表达 change 生命周期；阶段与执行状态分离，等待人工批准、等待 MR 合入或等待重试不再伪装成新阶段。
- 让 Runtime 根据版本化 lifecycle definition 和当前事实决定下一项 Work；每项 Work 固定 Skill、能力、允许副作用、写入范围、输入摘要和所需验证，Agent 不能由调用方参数任意选择或自述成功。
- 把 OpenSpec 四类规划产物的严格校验和人工批准变成 Design 出口；批准绑定语义产物摘要，任务 checkbox 的完成状态不改变规划摘要，任务文字、结构和需求映射变化会使批准失效。
- 把 Task 作为 Build 的稳定工作单元；完成 Task 需要当前 Action 的受约束 Outcome 和相应 Validator/Evidence，修改需求语义或任务结构时退回 Design。
- 把 Evidence Gate 和正式验证报告作为 Verify 出口；失败、输入漂移或实现变化返回 Build，而不是继续交付。
- 把分支发布、Business MR、合入等待、精确 merge commit 验证、规格同步、归档和最终 Change MR 收敛为同一 Change Run 的 Archive 子步骤；Webhook、主动核对和补偿启动只唤醒同一个等待 Run，不再创建独立 Post-merge Run。
- 将现有 Delivery、Post-merge、Git/MR Adapter、Action/Receipt、Evidence、Specification Provider 和平台事件能力保留为 lifecycle 的执行器、验证器或外部事实来源，移除它们对并行生命周期状态的所有权。
- 通过 Cordis 提供 lifecycle definition、Work Contributor、Validator 和 checkpoint extension；扩展只能挂接到声明的安全点，不能替换核心规划批准、Evidence Gate 或归档前置条件。
- 让 CLI、Desktop Dashboard 与 OTLP 从同一 Change Run 投影 phase、status、当前 Work、wait reason、blocker 和 next action，不再分别推断 change 状态。
- 为已有 generic Run、Delivery 和 Post-merge 状态建立显式兼容读取、迁移栅栏和恢复方案；无法唯一映射的活动状态 fail closed，不静默伪造成新生命周期事实。

## Capabilities

### New Capabilities

- `change-lifecycle`: 定义权威 Change Run、五阶段状态机、阶段/执行状态正交模型、固定 Work、转换守卫、回退循环、恢复与兼容边界。

### Modified Capabilities

- `runtime-foundation`: 让 WorkflowRuns 承载权威 Change Run，并让平台事件恢复同一 Run，而不是创建 Post-merge Run。
- `specification-authority`: 把四类规划产物校验和人工决定纳入 Design 出口，并以语义摘要替代整条分支 OID 作为规划失效条件。
- `skill-integration`: 由当前 Work 固定 Skill 快照、能力和调用范围，并由运行时 Hook 在受领 Action 内执行写入策略。
- `delivery-governance`: 把 Delivery 定位为 Archive 的交付计划和平台执行能力，不再拥有独立批准生命周期。
- `post-merge-automation`: 平台事件、主动核对和补偿恢复同一 Change Run 的 Archive 阶段，不再创建第二个 Run。
- `plugin-composition`: 增加 lifecycle definition、Work、Validator 和安全 checkpoint extension 的 Cordis 组合边界。
- `development-telemetry`: 从同一 Change Run 导出阶段、执行状态、等待和证据，不再把 Post-merge 表达为独立 Run。

## Impact

- 这是核心工作流语义变更，会影响 `domains/workflow`、`app/runtime`、Action、Evidence、Delivery、Post-merge、CLI、平台事件、OTLP 投影和后续 Desktop Dashboard。
- 持久模型需要版本化迁移。已有完成状态保留为审计事实；已有活动状态只有在身份、输入与下一动作可唯一映射时才迁移，否则进入 `migration_required` 并给出人工修复计划。
- 现有 Git、MR、Webhook、Inbox、Specification Provider 和多 Runner 收敛能力继续复用；它们不再定义自己的 change 状态机。
- Comet 0.5.0（固定 commit `aeb1a6598034e28ce46b8422d4dbd8785e607bd7`，MIT）作为生命周期、Action claim、approval hash、稳定 task revision 和 extension checkpoint 的行为参考，不引入运行时依赖或复制其 CLI/UI 产品层。
- DSH `dsh-v0.2.1-rc.3`（tag commit `1f81c047fc48fa190a683e469daa699857e9afe8`，MIT）继续作为 Cordis、Skill 与平台组合参考；未发布 master 变化只进入审计候选，不混入固定快照。
- 本 change 不实现任意 workflow 生成器、Comet Any/Classic 外壳、独立 ADR/implementation notes、Dashboard 视觉改版，也不顺带处理审计中记录的其他进程与文件存储维护项。
