# Spec Delta

## ADDED Requirements

### Requirement: 多仓接入显式解决同一远端的 checkout 歧义

多仓接入 MUST 在探测结果中展示同一远端的候选 checkout、实际目录及解决方式。对参与本次接入的远端，候选 MUST 绑定唯一可验证的路径。对已有登记，Repoctopus MUST 优先核对已登记路径；无法核实时报告冲突。正式写入 MUST 绑定原审批所审阅的路径与仓库身份，并在应用前验证。

#### Scenario: 首次接入发现多个 checkout

- **WHEN** 多仓扫描发现两个直接子目录指向同一远端，且没有已登记或明确指定的路径
- **THEN** 探测候选列出同组 checkout 及各自目录，并说明如何选定一项或明确排除整组
- **AND** 未解决且属于接入范围的组不会被静默略过，也不能进入可批准的配置请求

#### Scenario: 用户选择一个 checkout

- **WHEN** 用户通过 Init Skill 或 CLI 指定同组中一个有效目录，或明确限定范围排除整组
- **THEN** 原接入请求只包含最终选定路径及其 Store 绑定计划
- **AND** 批准后仅配置所选仓库，其他 checkout 的文件保持原状

#### Scenario: 已登记 checkout 旁新增另一份克隆

- **WHEN** 一个已有 Workspace 的已登记路径仍可核对为原仓库，且扫描发现同远端的新 checkout
- **THEN** 重新接入保留已登记路径和仓库 ID，并核对现有配置差异

#### Scenario: 路径选择无效或身份变化

- **WHEN** 所选路径越界、同一组选择多个目录、已登记路径无法核实，或审批中的目标不再对应原路径和仓库身份
- **THEN** Repoctopus 报告冲突及重新探测或选择的方法，阻止为该目标写入共享配置或 Store pointer
