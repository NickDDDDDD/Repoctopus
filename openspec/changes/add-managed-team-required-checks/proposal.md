# Proposal

## Why

团队 Skill composition 能向现有 Work 添加 guidance 或替换方法层，但不能表达一个拥有独立 Outcome、Validator、Evidence 和 Gate 结果的团队检查。把检查伪装成 guidance 会让失败无法可靠阻断流程，也无法区分核心 Action 失败和团队策略失败。

本 Change 在 `add-auditable-team-skill-composition` 完成后，把 `required-check` 作为普通受管 Work 接入 definition 声明的安全 checkpoint，复用唯一 Runtime、claim、Host、Outcome、Validator、Evidence 与恢复协议。

## What Changes

- 共享配置增加受约束 `required-check` binding。
- 将 binding 编译为 Lifecycle Extension、Work 和 Validator Contributor 身份。
- 在安全 checkpoint 物化并调度检查 Work；核心 Runtime 根据验证结果决定是否继续。
- 增加插件准入、漂移、卸载排空、恢复、遥测和桌面投影。

## Capabilities

### Modified Capabilities

- `plugin-composition`: 准入和冻结 required-check Contributor。
- `development-telemetry`: 记录检查调度、结果和 Gate。
- `desktop-observability-dashboard`: 展示独立团队检查及阻断原因。

## Dependencies

本 Change 依赖 `add-auditable-team-skill-composition` 提供共享 binding、Compiler、有效组合 identity 和团队 Skill 来源边界。

## 非目标

- 不增加第二 Runtime、Child Workflow 或团队自定义 phase transition。
- 不允许 Extension 绕过 Design、Verify 或 Archive 核心门禁。
- 不实现通用 Method Receipt；检查使用自身版本化 Outcome/Evidence contract。

## 第三方与许可证

只加载共享 composition 明确登记并通过 Descriptor 校验的插件；插件许可证和来源继续进入既有 provenance 审计。
