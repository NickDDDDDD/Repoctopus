# Spec Delta

## MODIFIED Requirements

### Requirement: 每次运行绑定实际插件组合

Repoctopus MUST 为规范化 composition 与全部活动 Provider、Contributor 记录稳定标识、版本、配置摘要和代码摘要，并把 composition identity 绑定到 Run、Checkpoint、Evidence、Action Receipt、Delivery Snapshot、Trajectory 与允许列表遥测属性。Runtime MUST 在写操作前根据受影响角色和状态契约判定 `same | compatible-adoption | migration_required`；compatible adoption 必须记录旧新身份及适用 checkpoint，不得刷新 Specification approval 或重建无关 Runtime 状态。

#### Scenario: 恢复时组合完全相同

- **WHEN** 当前 composition identity 与 Run 保存的身份相同
- **THEN** 写操作继续按原 checkpoint 状态契约执行，不追加 adoption 或 invalidation

#### Scenario: 组合发生兼容变化

- **WHEN** 当前组合变化被所有受影响状态契约明确声明为兼容，且 adoption 精确匹配旧新实现身份
- **THEN** Runtime 在同一 Run 记录 `composition.changed` 与 adoption 后恢复原 current Work 或其声明的兼容 successor，不刷新 Planning approval

#### Scenario: 组合发生不兼容变化

- **WHEN** Engine、RunStore、Lifecycle、Evidence Gate、Provider 或 Action Adapter 的变化无法证明兼容当前 Run
- **THEN** 只读查询仍可使用，写操作进入 `migration_required` 且不静默推进、不伪造 planning drift

#### Scenario: 未使用组件发生变化

- **WHEN** 安装目录中的组件未进入当前 composition 或当前 checkpoint 的依赖闭包
- **THEN** 该变化不改变活动 Run 的 continuation，也不触发 adoption、migration 或人工批准

## ADDED Requirements

### Requirement: Composition adoption 必须精确且有界

兼容 adoption MUST 精确声明旧 implementation/code/config identity、新 identity、受影响角色、允许恢复的 lifecycle definition/checkpoint 范围和 successor Work 规则；通配版本、仅比较自由名称、跨多个未知前驱或以当前最新内容重组旧 packet 的 adoption MUST 被拒绝。

#### Scenario: 唯一直接前驱可兼容采用

- **WHEN** 新 Runtime 声明当前活动 Run 的精确旧 composition identity 为唯一可采用前驱，且 current Work 输入契约未改变
- **THEN** Runtime 记录一次 adoption 并从原 checkpoint 继续

#### Scenario: adoption 声明不完整

- **WHEN** adoption 缺少旧代码摘要、配置摘要、definition identity 或受影响 checkpoint 范围
- **THEN** Runtime 返回 `migration_required`，不得把相同组件名称视为兼容证明

### Requirement: Composition compatibility 与规划授权保持正交

Composition compatibility authority MUST 只决定当前 Runtime 实现能否安全解释并继续既有 Run facts；Specification Planning authority MUST 只决定当前规划语义与 Human Decision 是否授权 lifecycle。任一权威不得通过修改另一方摘要、创建另一方请求或选择目标 phase 来规避自身失败。

#### Scenario: 兼容升级后规划语义相同

- **WHEN** composition adoption 成功且 Provider 返回与现有 approval 匹配的 planning semantic identity
- **THEN** Runtime 保留原 approval 和 planning identity，从兼容 checkpoint 继续

#### Scenario: composition 不兼容但规划仍有效

- **WHEN** planning semantic identity 与 approval 均有效，但 composition 无兼容 adoption
- **THEN** Runtime 进入 `migration_required`，不返回 Design，也不请求用户重新批准相同规格
