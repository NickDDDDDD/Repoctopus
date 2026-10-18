# Spec Delta

## Purpose

强化 Repoctopus 唯一 Runtime 入口、第三方能力归属和旧工作流隔离约束，防止后续纵切形成并行内核或重新引入模板仓的 IDE Hook 状态机。

## MODIFIED Requirements

### Requirement: Runtime 组合领域与平台端口

Runtime MUST 作为唯一组合入口加载工作流、调用 Engine、持久化 Run 与 Trajectory、刷新项目事实、采集 Evidence Gate 并调用平台适配器；CLI、Evidence、Delivery 和后续客户端适配器不得复制工作流状态转换规则或绕过当前 Gate。

#### Scenario: 文本 CLI 与 JSON CLI 查询同一 Run

- **WHEN** 用户分别请求文本和 JSON 状态
- **THEN** 两种输出由同一个 Runtime 结果渲染，并报告一致的当前步骤、诊断和合法后继

#### Scenario: 普通成功记录尝试绕过 Evidence

- **WHEN** 当前工作流步骤声明需要 Evidence Profile 且调用方只提交普通 `succeeded` 结果
- **THEN** Runtime 拒绝推进，直到同一项目输入和 Run 下存在 `satisfied` Gate

## ADDED Requirements

### Requirement: 能力来源和旧工作流隔离可机器检查

Repoctopus MUST 为全部生产源码声明唯一能力归属和采用方式，登记从 Comet 复制、实质改写或行为重建的边界，并拒绝旧 `agents-workspace` 的 Hook、Skill、阶段常量、批准口令、客户端配置和项目专有路径进入产品面。

#### Scenario: 新增生产模块没有能力归属

- **WHEN** `app`、`domains` 或 `platform` 出现未被能力账本唯一覆盖的源码
- **THEN** 架构检查失败并报告缺失或冲突的能力归属

#### Scenario: 旧工作流文件或口令被复制

- **WHEN** 产品目录出现旧 Hook、旧阶段常量、中文动作批准口令或旧模板配置路径
- **THEN** 架构检查失败并定位文件或路径
