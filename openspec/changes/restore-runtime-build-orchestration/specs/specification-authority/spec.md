# specification-authority Specification Delta

## ADDED Requirements

### Requirement: OpenSpec Tasks 与 Runtime BuildPlan 分层而不平行

OpenSpec Tasks MUST 继续作为 Change 的工作范围、依赖、验收映射和完成权威；Runtime BuildPlan MUST 只把已批准 Tasks 投影成可执行 Work Packages，并通过稳定 Task IDs、planning semantic digest 与 Provider identity 保持追溯。BuildPlan 不得成为 Specification Provider artifact、包含第二套 checkbox、覆盖 Task completion、增加需求或改变批准语义。

#### Scenario: 一个 Task 映射多个 Work Package

- **WHEN** 多仓、隔离或依赖边界要求把一个 Task 分为多个执行包
- **THEN** 每个包引用同一稳定 Task ID，Runtime 只在所有 required package 与 Task acceptance Evidence 均有效后请求 Provider 更新该 Task completion

#### Scenario: Plan revision 不改变规划语义

- **WHEN** Build Check 或 Verify 只要求调整包边界、执行顺序、仓库绑定或 Validator，而 Task 的文字、依赖、验收与需求映射不变
- **THEN** Runtime 可以修订 BuildPlan 且不使 Design approval 失效，旧计划保留为审计历史

#### Scenario: Plan revision 需要改变 Task

- **WHEN** 返工需要新增、删除或修改 Task 的范围、依赖、验收或 requirement mapping
- **THEN** Runtime 返回 Design，并要求通过 Specification Provider 更新四类 OpenSpec 工件及重新批准，不在 BuildPlan 中隐藏语义变更

#### Scenario: BuildPlan 写入 OpenSpec change 目录

- **WHEN** Agent 尝试把 Runtime BuildPlan 保存为 OpenSpec change 的第五份 Markdown、ticket 或 checkbox 清单
- **THEN** Specification Validator 拒绝该并行权威，Runtime 仅接受其受管状态存储中的版本化计划
