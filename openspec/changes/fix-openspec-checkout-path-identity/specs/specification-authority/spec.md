# 规格权威增量

## MODIFIED Requirements

### Requirement: Workspace Store 是规划根的稳定权威

Repoctopus MUST 将当前 Workspace Repository 登记为 OpenSpec Store，并以稳定的 `storeId` 和 `workspaceRepositoryId` 标识 Specification Root。Runtime MUST 显式选择该 Store 并校验当前 Runner 的 registry、Store metadata 与 Workspace checkout 一致。接入探测、登记核验和规格读取 MUST 以可解析的实际目录校验 checkout 一致性，并对无法验证的身份拒绝继续。Runtime MUST NOT 依赖绝对路径、nearest root、default Store、Workset 或业务仓 pointer 推断权威根。单仓场景 MAY 让 Workspace、Store 与实现仓物理合一。多仓场景 MUST NOT 因此新增独立规格仓。

#### Scenario: 单仓自举使用同一个物理仓

- **WHEN** Workspace Repository 同时承载 Repoctopus 实现与 OpenSpec Store
- **THEN** Runtime 以不同 repository role 表达相同物理仓，并从显式 Store 读取唯一四类规划产物

#### Scenario: Runner 尚未登记 Store

- **WHEN** 当前 Runner 的 OpenSpec registry 没有该 `storeId` 或指向另一个 checkout
- **THEN** Runtime 阻塞受保护转换并返回可恢复的登记诊断，不回退到默认或最近的规格根

#### Scenario: 业务仓存在本地规格根

- **WHEN** 业务仓已有本地 `specs` 或 `changes`，其解析优先级会遮蔽 Store pointer
- **THEN** Runtime 将其报告为 authority conflict 并要求显式迁移，不覆盖、合并猜测或把两个根都视为权威

#### Scenario: 同一 checkout 使用不同路径写法

- **WHEN** Workspace 输入与 OpenSpec 返回路径写法不同，但两者解析到同一实际 checkout，且登记的 Store ID 与 metadata 一致
- **THEN** 项目探测识别该 Workspace，登记核验复用现有登记，规格读取和验证继续使用该显式 Store

#### Scenario: checkout 路径无法核验

- **WHEN** 受保护操作无法解析 Workspace 或已登记的 Store checkout 路径
- **THEN** Runtime 停止读取或写入该 Store，保留诊断且不覆盖现有登记或选择其他规格根
