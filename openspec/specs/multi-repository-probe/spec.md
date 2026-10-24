# multi-repository-probe Specification

## Purpose

定义 Repoctopus 在不修改业务仓的前提下探测平级 Git 仓库并生成可用于 Run 和恢复的稳定快照。

## Requirements

### Requirement: 探测只读取直接子目录中的 Git 工作树

`project probe` MUST 扫描用户明确指定父目录的直接子目录，只读取可验证的 Git 工作树事实，不得递归接管未知目录或修改被探测仓库。

#### Scenario: 父目录包含多个仓库和普通目录

- **WHEN** 父目录包含两个 Git 工作树、一个普通目录和 Repoctopus 工作区
- **THEN** 结果稳定列出两个业务仓库，普通目录不被识别为仓库，工作区按显式规则包含或排除

#### Scenario: 探测完成

- **WHEN** 探测命令成功返回
- **THEN** 业务仓的文件树、索引、HEAD、分支和工作树状态均未被命令改变

### Requirement: 仓库快照包含可协调身份

每个仓库快照 MUST 包含规范化仓库标识、本地路径、可用的远端身份、当前分支、HEAD 和工作树摘要，并使用稳定规则排序和计算项目快照摘要。

#### Scenario: 仓库没有远端或处于 detached HEAD

- **WHEN** Git 工作树没有远端或没有当前分支
- **THEN** 快照显式记录缺失值和 HEAD，不猜测远端或分支

#### Scenario: 工作树包含未提交变化

- **WHEN** 仓库有 staged、unstaged 或 untracked 变化
- **THEN** 工作树摘要反映变化类型且不读取或上传不必要的文件正文

### Requirement: 探测路径受作用域约束

探测器 MUST 规范化和校验父目录及仓库路径，拒绝路径逃逸、重复身份和无法安全读取的工作树，并返回逐仓诊断。

#### Scenario: 子目录解析到作用域外

- **WHEN** 符号链接或路径规范化使候选仓库位于指定父目录外
- **THEN** 探测器拒绝该候选并报告路径原因

### Requirement: 恢复时刷新外部仓库事实

`run resume` MUST 重新探测与 Run 关联的仓库，并把当前快照与 Checkpoint 快照比较；外部变化不得被旧缓存覆盖。

#### Scenario: 仓库在会话中断期间产生新提交

- **WHEN** 当前 HEAD 与 Checkpoint 不同
- **THEN** Runtime 报告仓库和差异类型，并重新解析所有依赖旧 HEAD 的下一动作

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
