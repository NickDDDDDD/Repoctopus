# Workspace 入口 Skill 接入规格

## ADDED Requirements

### Requirement: 获批接入安装 Workspace 工作流入口 Skill

Repoctopus MUST 在项目接入候选中显示支持的宿主及入口安装目标。接入获批后，Repoctopus MUST 在 Workspace 内为批准的宿主安装可发现的 `repoctopus` 入口 Skill，并在报告接入完成前验证安装结果。安装 MUST 限定到受管入口及其资源，不修改用户级 Skill 目录、独立业务仓的宿主配置或其他 Skill。

#### Scenario: 新团队获批接入

- **WHEN** 团队从已安装 CLI 完成包含受支持宿主的单仓或多仓接入
- **THEN** 从 Workspace 打开的对应宿主新会话能发现并显式调用 `repoctopus`，无需执行完整 Skill 目录投影或检出产品源码
- **AND** 多仓接入仅在 Workspace 安装入口，单仓接入在兼任 Workspace 的业务仓安装入口

#### Scenario: 预览或未批准接入

- **WHEN** 接入处于探测、准备、待批准、拒绝或请求修改
- **THEN** 入口路径及管理记录保持原状

### Requirement: 入口安装保留团队文件并可恢复

Repoctopus MUST 在入口写入前校验目标、所有权和已有内容。对同名的非受管 Skill、受管文件的本地修改或不安全路径，Repoctopus MUST 报告可定位冲突、保留原文件且不宣布本次接入完成。重复应用同一获批请求 MUST 幂等；中断后 MUST 能在同一请求上继续并保留已确认的接入事实。

#### Scenario: 已接入团队补齐入口

- **WHEN** 团队用现有共享配置重新准备并批准接入
- **THEN** Repoctopus 补齐入口并复用健康的 Store 和既有登记，不要求重新初始化业务仓或 Run

#### Scenario: 团队已有同名 Skill

- **WHEN** 安装目标由团队维护、存在本地修改或指向不安全位置
- **THEN** Repoctopus 报告冲突路径及解决方式，原内容不变，且不报告接入完成

#### Scenario: 多个安装目标之间中断

- **WHEN** 获批请求已完成部分入口安装，但尚未报告接入完成
- **THEN** 续接同一请求时核对已完成目标，仅补齐剩余目标，并在全部通过校验后报告完成
