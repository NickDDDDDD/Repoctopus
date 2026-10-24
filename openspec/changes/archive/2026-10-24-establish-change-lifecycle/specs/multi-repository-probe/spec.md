# multi-repository-probe Specification

## ADDED Requirements

### Requirement: 探测生成只读的 OpenSpec Store 绑定计划

`project probe` MUST 在不写入候选仓的前提下检查 Workspace 和每个业务仓的 OpenSpec 状态，并生成待人工决定的 Store binding proposal；proposal 必须包含可编辑的 kebab-case Store ID、Workspace Repository identity、每个目标的分类以及拟应用的精确 pointer 差异。分类至少区分未配置、已指向同一 Store、指向其他 Store、存在本地 `specs`/`changes` 权威、配置损坏、不可写和用户退出。

#### Scenario: 业务仓尚未配置 OpenSpec

- **WHEN** 探测发现可写业务仓没有 `openspec/config.yaml`、本地规格或 change
- **THEN** proposal 将其标为可安装 pointer 并展示拟新增内容，但业务仓文件树保持不变

#### Scenario: 业务仓已有本地规格

- **WHEN** 探测发现业务仓包含本地 `openspec/specs` 或 `openspec/changes`
- **THEN** proposal 将其标为 authority conflict，不提出覆盖写入并要求独立迁移决定

#### Scenario: Store ID 由用户自定义

- **WHEN** 用户在首次批准前把默认 Store ID 改为另一个合法 kebab-case 值
- **THEN** proposal、Workspace 配置和所有待安装 pointer 使用同一值，且该值成为后续改名迁移的稳定 identity

### Requirement: 批准后的 onboarding 逐仓应用 Store 绑定

Repoctopus MUST 仅在可信人工批准 Store binding proposal 后登记当前 Workspace Repository 为本机 OpenSpec Store，并为用户选中的业务仓逐仓执行 pointer Intent；每个写入必须产生可核对 Receipt、支持幂等恢复并遵守正常 Git publication 流程，不得宣称跨仓原子事务。已绑定同一 Store 必须 no-op，冲突或输入漂移必须 fail closed。

#### Scenario: 进程在部分 pointer 写入后中断

- **WHEN** 两个业务仓的 binding proposal 已批准，第一个仓已有成功 Receipt 而第二个尚未执行
- **THEN** 恢复时核对第一个仓的精确结果并只继续第二个仓，不重复改写或回滚已完成仓

#### Scenario: 批准后目标配置发生变化

- **WHEN** 业务仓的 OpenSpec 配置与已批准 proposal 的输入摘要不同
- **THEN** 对该仓的 Intent 不执行并返回新的冲突诊断，其他独立目标可按各自 Receipt 状态恢复

#### Scenario: 用户退出业务仓 pointer 安装

- **WHEN** 用户保留 Workspace Store 但明确不向某个业务仓安装 pointer
- **THEN** onboarding 不修改该仓，Runtime 仍通过显式 `--store` 使用同一权威规格根

### Requirement: Store 登记生命周期不得删除 Workspace

Repoctopus MUST 将每机 OpenSpec Store 登记视为可恢复配置而非 Workspace 所有权；自动化 MAY 校验、登记或无损 unregister，但 MUST NOT 调用会删除 Store 根目录的操作。Workspace 删除只能由独立、明确授权且经过目标校验的 Repoctopus 危险操作执行。

#### Scenario: Store registry 需要重建

- **WHEN** 当前 Runner 的 registry 丢失但 Workspace checkout 和 metadata 完整
- **THEN** onboarding 或恢复 Work 可在核对 identity 后重新登记，不删除或重新创建 Workspace 文件
