## ADDED Requirements

### Requirement: Build Host capability drift 必须在当前 checkpoint 可恢复

Runtime MUST 在接受 Build Plan、Execute 或 Check Host submission 前，把持久 invocation 的 Host ID 与 capability identity 和当前 Execution Binding 比较。Host 缺少批准 Strategy 所需能力或 capability digest 变化 MUST 被分类为 `capability` drift，并在同一 Run 派发 Build Configure revalidation；Runtime MUST 保留旧 claim、packet、invocation 和 submission，不得让能力前置条件异常逃逸、接受依赖旧 Binding 的结果、覆盖 Binding 或要求手改 Store。

#### Scenario: Plan Host 只声明当前 Work 最小能力

- **WHEN** 完整能力 Host 已建立 Execution Binding，而相同 Host ID 以 `build.plan` 所需的只读最小能力领取 Work并提交结构化 candidate
- **THEN** Runtime 把 capability identity 变化分类为 Binding drift，保留该 submission并在同一 Run 派发唯一的 Build Configure revalidation，不接受 Plan Evidence或创建 Execute Work

#### Scenario: 缺失能力不会在漂移分类前抛错

- **WHEN** 持久 invocation 的能力集合缺少 `process.execute` 或 `repository.write`
- **THEN** Runtime 返回有界 `capability` revalidation 状态，不抛出未处理的 Execution Binding capability exception，且重复 pull 保持幂等

#### Scenario: 相同能力身份继续正常计划

- **WHEN** Plan invocation 的 Host ID 与规范化 capability digest 都匹配当前 Execution Binding，且 checkout identity 没有漂移
- **THEN** Runtime 继续验证并接受合法 Plan candidate，不创建 Configure Work

#### Scenario: Configure 后重新规划

- **WHEN** capability drift 已使旧 Plan checkpoint 失效，兼容 Host 通过新 Configure 建立下一 Binding revision
- **THEN** Runtime 创建绑定新 Binding 的新 Plan Work；旧 claim与 submission只作为历史保留，不被自动重放或视为新 Plan completion

#### Scenario: 不同 Host 或能力不足 Configure 继续阻断

- **WHEN** Runner ID 不匹配当前 Binding Host，或 Configure 观察到的 Host 不满足批准 Build Strategy
- **THEN** Runtime 在任何 repository/process 副作用前 fail closed或等待兼容 Host，不静默降级 Strategy、不授予写权限，也不复用旧 Plan candidate
