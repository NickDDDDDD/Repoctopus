# Spec Delta

## MODIFIED Requirements

### Requirement: 项目探测只生成候选草稿

接入探测 MUST 只读检查显式范围内的 Git 仓库、Workspace Git 根与 Store，在本地生成最小可审阅候选，正式共享配置保持原状。首次接入 MUST 独立于构建文件识别、测试命令推断和 Verify coverage 配置。已接入 Workspace 的候选 MUST 保留已配置的 Profile 和不在本次更新范围内的共享字段。

#### Scenario: 首次探测项目

- **WHEN** 用户在单仓业务 Git 根或独立的多仓 Workspace 选择接入
- **THEN** Repoctopus 根据所选布局生成含明确 Git 根、仓库及 Store 的接入候选
- **AND** 无可识别的构建文件或 Verify Profile 时仍可准备审批

#### Scenario: 无效 Workspace 布局

- **WHEN** Workspace 是业务仓普通子目录，或扫描范围中无法识别所选 Workspace Git 根
- **THEN** Repoctopus 在审批前报告实际路径、预期布局和恢复操作
- **AND** 不生成缺失 Store binding 的可批准接入请求

#### Scenario: 已存在共享配置

- **WHEN** 用户重新运行接入或补齐受管入口
- **THEN** Repoctopus 输出相关 diff 并保留已有 Verify Profile 和其他未授权修改的配置

### Requirement: 用户确认后才能写入共享配置

Repoctopus MUST 把候选、作用范围及现有配置差异作为 Human Decision 输入，只有可信用户确认后才生成或更新 `repoctopus.yaml`。首次接入 MAY 无 Verify Profile；配置一个 Verify Profile 时 MUST 校验其结构和 required coverage 声明。已选 Profile 的 Run coverage 校验沿用 Evidence 权威。

#### Scenario: 首次调用的接入确认

- **WHEN** Runtime 已形成包含 Workspace、仓库、Store 和入口目标的有效候选
- **THEN** 用户在同一宿主调用中审阅一次计划并选择
- **AND** 可信批准后 Runtime 应用同一请求，无需用户搬运草稿或候选路径

#### Scenario: 没有可信确认通道

- **WHEN** Runtime 未获得可信批准
- **THEN** 接入或配置请求保持待确认，正式配置保持原状

#### Scenario: 传错候选或缺少绑定

- **WHEN** 用户把探测草稿交给候选参数，或请求缺少可验证的 Workspace Store binding
- **THEN** Repoctopus 在审批前报告对应的输入或绑定错误，并引导重新获取正确候选

#### Scenario: Verify Profile 没有 required coverage

- **WHEN** 候选 Verify Profile 没有声明非空 coverage 的 required 验证节点
- **THEN** Repoctopus 在写共享配置前报告缺少 required coverage
#### Scenario: 前置节点不直接覆盖 Acceptance

- **WHEN** Profile 有带 coverage 的 required 验证节点，且有服务或准备节点不直接覆盖 Acceptance
- **THEN** 静态校验接受该结构，精确覆盖由当前 Run 的 preflight 校验

## ADDED Requirements

### Requirement: Verify Profile 可按需独立配置

Repoctopus MUST 提供独立 Verify 配置流程，在用户选定范围内检查实际命令和 Acceptance coverage，展示 Profile 变更，经可信批准后更新共享配置。生成的 required 检查 MUST 明确声明 coverage，推断的 coverage MUST 作为待确认内容。此流程 MUST 保留 Workspace、Store、其他共享配置和既有 Run。

#### Scenario: 初始化后补配 Verify

- **WHEN** 已接入 Workspace 的用户调用 Verify 配置流程
- **THEN** Repoctopus 展示拟用的命令、仓库和覆盖范围
- **AND** 仅获批后更新相关 Profile，返回当前 Run 的继续方式（如有）
