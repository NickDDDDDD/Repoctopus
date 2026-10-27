# Proposal

## Why

Repoctopus 已经建立权威五阶段 Change Run，但 Build 仍把 OpenSpec Tasks 直接压缩成逐 Task 实施，缺少经批准的执行策略、Runtime Build Plan、计划证据与明确的 Build Check；Verify 失败又依赖重开 Task 或特殊 Repair Work，导致自举 Run 的阶段、任务和真实实现反复失配。现在需要在正式版前破坏性收敛这套协议，使 Runtime 真正决定当前合法 Action，并让 Agent 只执行当前 Work。

## What Changes

- **BREAKING** 用完整的 `Build Configure → Build Plan → Plan Evidence → Build Execute → Build Check` 协议替换现有逐 Task 直接调度和特殊 `implementation.repair` 路径。
- 只保留一条 `Open → Design → Build → Verify → Archive` 完整流程；本次不增加 Hotfix、Tweak 或其他 workflow profile。
- Full Build 只允许 `autonomous` 与 `subagent-driven-development` 两种执行策略。前者允许当前 Host 在批准计划内自主组织工作，后者要求主 Agent 按 Runtime 工作包协调实现 Agent；`direct` 不作为执行策略。
- TDD 方法只允许 `tdd` 与 `direct`；`direct` 仅表示不强制逐任务 RED/GREEN，仍要求相关测试、缺陷回归、Build Check 和 Verify。
- Review 第一版固定为 `standard`，不向用户提供关闭或降低审查的选项；Isolation 继续支持 `current`、`branch`、`worktree`，在 Open 绑定并由 Build Configure 复核。
- Build Configuration 成为绑定 Run revision、能力快照和人工批准的 Runtime 决定；配置批准后在本次版本内冻结，不实现运行中策略升级或降级。
- OpenSpec Tasks 继续作为唯一任务与完成声明权威；Runtime Build Plan 只引用稳定 Task identity，描述依赖、工作包、仓库边界、验收和执行顺序，不复制第二套 checkbox。
- Verify 失败或 Build 输入失效时回到 Build Plan 修订和普通 Execute/Check，不猜测并重开 Task，不创建特殊 Repair lifecycle；已完成且输入仍有效的 Outcome 与 Evidence 可复用。
- 更新 Skill 装填规则：Autonomous 与 Sub-Agent 使用不同的执行方法，但都由 Runtime 交付真实 action/augmentation 内容、能力与输出合同；Agent 不得选择 phase、Action 或下一执行策略。
- 扩充 Trajectory 与 OTLP 事实，记录配置提案/批准、计划 revision/evidence、执行策略、TDD 方法、工作包、Build Check、返工原因和恢复，不把自由文本或高基数身份放入 Metric。
- 删除为预发布旧协议提供的生产兼容分支；旧开发 Run 只保留为只读审计证据，不迁移或继续执行。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`: 增加 Build 内部协议、配置冻结、计划修订与 Verify 返工规则，并移除 Task reopen 和特殊 Repair lifecycle。
- `managed-work-execution`: 增加 Build Configuration、Build Plan、工作包和 Check 的受管执行合同。
- `skill-integration`: 为 Autonomous 与 Sub-Agent 两种执行策略固定不同的方法装填，同时保持 OpenSpec 工件和任务权威唯一。
- `specification-authority`: 明确 Tasks 与 Runtime Build Plan 的权威边界、稳定引用和完成声明规则。
- `development-telemetry`: 增加 Build 配置、计划、策略、工作包、Check 与计划修订的可复算观测事实。

## Impact

- 主要影响 `domains/change-lifecycle`、`domains/work-execution`、`services/workflow-runs`、Skill Provider、CLI continuation、Trajectory 与 OTLP 映射。
- Change Run、Work Descriptor、Validator profile、事件 schema 和 Dashboard 投影将发生预发布破坏性变化；不提供旧 Run 执行兼容。
- OpenSpec Provider 与 Matt Skills 继续通过现有适配边界使用，不复制其模板或建立第二套任务权威。
- Comet 只作为固定上游的行为参考；本次不复制 Comet 源码，不产生新的第三方许可证义务。
- Desktop Dashboard change 保持冻结，待本 change 合入后适配新的 Build 观测语义并重新 Verify/Archive。

## 非目标

- Hotfix、Tweak 或其他 workflow profile。
- `executing-plans`、Full Direct、Autonomous 与 Sub-Agent 的运行中切换。
- `review_mode=off|thorough`、可配置 Verify 强度或自动风险降级。
- 新的规格文件、ticket、ADR、implementation notes 或外部任务系统权威。
