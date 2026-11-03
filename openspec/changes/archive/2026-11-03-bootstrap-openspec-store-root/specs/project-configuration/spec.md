## ADDED Requirements

### Requirement: 获批项目接入以可恢复事务物化规格根

Repoctopus MUST 在项目配置候选中区分精确已登记、健康未登记、缺失、不健康和登记冲突的 Workspace Specification Root，并把 Root disposition、Provider identity、Store identity 与允许执行的动作绑定到 Human Decision；获批 apply MUST 先以持久 Intent 和重新观察创建或验证健康根，再登记 Store、安装业务仓 pointer，最后发布共享项目配置。apply 不得扩大批准权限、手工拼装 Provider 私有文件、覆盖既有根或在根与登记未验证时提前发布 `repoctopus.yaml`。

#### Scenario: 全新非空 Workspace 获批接入

- **WHEN** 获批候选证明 Workspace 中不存在 `openspec/`，但仓库包含其他项目文件
- **THEN** Repoctopus 通过固定 OpenSpec Provider 的官方初始化入口物化最小健康根，重新验证后登记 Store，并只在两者成功后安装 pointer 与共享配置

#### Scenario: apply 前 Root disposition 发生变化

- **WHEN** 用户批准缺失根方案后，`openspec/` 被其他进程创建或 Store identity 发生变化
- **THEN** Repoctopus 使旧决定失效并返回可定位 reconcile 诊断，不把新目录当成本事务所有、不强制初始化且不发布共享配置

#### Scenario: 初始化结果未知后重启

- **WHEN** Root 初始化已经落盘但进程结果或 Receipt 尚未持久化
- **THEN** Repoctopus 从同一 request 的 Intent重新观察根身份和受限 manifest，只在可证明属于该初始化且健康时写恢复 Receipt并继续，既不重复创建也不删除用户文件

#### Scenario: 已有根不健康

- **WHEN** Workspace 已存在 `openspec/`，但固定 Provider不能证明它是健康根
- **THEN** Repoctopus 在人工确认前将其标记为 blocker，并在 apply 时继续 fail closed，不自动修复、覆盖或改用另一个规格根

#### Scenario: 中途失败保持配置最后发布

- **WHEN** Root bootstrap、Store registration或任一业务仓 pointer安装失败
- **THEN** Repoctopus 保留可恢复的 Intent/Receipt 和结构化诊断，且不存在声称接入完成的 `repoctopus.yaml` 更新
