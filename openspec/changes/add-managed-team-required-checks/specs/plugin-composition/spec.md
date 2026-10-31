# plugin-composition Delta

## ADDED Requirements

### Requirement: 团队 required check 复用受管 Work 与安全 checkpoint

Repoctopus MUST 把共享配置中的 `required-check` 编译为已登记 Lifecycle Extension、普通 Work、Validator 与 Evidence contract，并沿唯一 claim、Host、Outcome、validation 和 Gate 链执行。团队 Extension 只能挂接 definition 明确声明的安全 checkpoint，MUST NOT 直接转换 phase、创建或跳过核心 Human Decision、改写核心 Action、把失败 Gate 变成满足，或建立第二 Runtime。

#### Scenario: 团队增加许可证检查

- **WHEN** 已准入插件把许可证检查绑定到 `build.after-check` 安全点并提供完整 Work/Validator contract
- **THEN** Runtime 物化独立受管 Work、验证 Outcome 与 Evidence，再由核心 lifecycle handler 根据 Gate 选择下一 Action

#### Scenario: 检查尝试推进阶段

- **WHEN** 团队 Extension 的 Descriptor 或 Outcome 声明目标 phase、跳过 Design approval 或修改 Gate 结果
- **THEN** composition validation 或 Work Validator 拒绝该贡献，当前 Run 保持原权威状态

### Requirement: required-check Contributor 进入活动组合快照

Repoctopus MUST 在导入前验证检查插件 Descriptor 的包身份、契约版本、配置 Schema、能力、side-effect class、输出 schema、来源、代码摘要与状态兼容范围，并把实际进入有效组合的 Extension/Validator 身份纳入 Run composition digest；仅安装但未被共享配置使用的 Contributor 不得改变活动 Run。

#### Scenario: 未登记团队检查插件

- **WHEN** 项目依赖中存在提供 required check 的插件，但共享 composition 未登记该包
- **THEN** App Boot 不执行其模块代码，binding 编译报告该 Contributor 不可用

#### Scenario: 活动检查插件在恢复前升级

- **WHEN** 未完成 Work 恢复时其 Extension 或 Validator 实现发生不兼容变化
- **THEN** 写操作进入显式 drift/migration 诊断，只读状态和原 Evidence 仍可访问
