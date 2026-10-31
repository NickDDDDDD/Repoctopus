# project-configuration Delta

## ADDED Requirements

### Requirement: 团队 Skill binding 属于共享配置

Repoctopus MUST 在 Git 跟踪的 `repoctopus.yaml` 中用版本化 Schema 声明团队 lifecycle Skill binding，并把 binding identity、目标 Work、角色、逻辑 Skill 名、顺序和 replaceable slot 纳入共享配置摘要。第一版 MUST 只允许 `guidance` 和 `augmentation-replacement`；配置 MUST NOT 包含 Provider 文件路径、任意模块路径、内嵌代码、Cordis Loader 内部字段或本机绝对路径。

#### Scenario: 团队为 Design 增加 guidance

- **WHEN** 共享配置把已登记团队 Skill 以 `guidance` 绑定到 definition 允许的 Design Work
- **THEN** 两名成员在不同父目录检出项目后编译出相同 binding identity、顺序和共享摘要，不需要修改 lifecycle 源码

#### Scenario: 配置尝试替换 Action

- **WHEN** 团队配置把 Skill 绑定到 Action、未知 Work/slot 或内嵌任意执行代码
- **THEN** Schema 或 composition validation 在 Work claim 前拒绝配置并返回可定位字段诊断

#### Scenario: 配置声明尚未支持的 required check

- **WHEN** 当前版本的共享配置声明 `required-check` 角色
- **THEN** Schema 明确拒绝该角色，不把它静默解释为 guidance 或普通 augmentation

### Requirement: 个人 Skill 不得改变团队生命周期组合

Repoctopus MUST 把用户级 Skill、个人学习目录和 `.repoctopus/local.yaml` 排除在团队 `EffectiveSkillComposition` 的语义输入之外；本机覆盖不得新增、删除、替换或重排团队 binding。团队采用个人 Skill 时 MUST 先通过项目 Provider 和共享配置的正常评审路径登记。

#### Scenario: 个人目录存在同名 Skill

- **WHEN** 开发机用户目录提供与团队 binding 逻辑名相同的 Skill，但该 Provider 未进入项目共享 composition
- **THEN** 团队 Run 不解析该个人实现，且另一台没有该目录的机器得到相同 effective composition

#### Scenario: 本机覆盖删除团队 guidance

- **WHEN** `.repoctopus/local.yaml` 试图删除、替换或重排团队 binding
- **THEN** 配置合并失败并指出禁止的覆盖路径，团队共享配置保持不变
