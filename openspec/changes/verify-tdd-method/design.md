# Design

## Context

当前 Build Execute 可以按配置装填 TDD augmentation，Host outcome 可回报消费层，测试命令 Evidence 也已有存储边界；缺少的是把某个 Task/package 的实现输入与 RED、GREEN、regression receipt 组成可验证因果序列。

## Decisions

### 1. TDD Receipt 引用命令 Evidence

`TddCycleReceipt` 绑定当前 Run、Work、package/Task、代码输入摘要、测试目标，以及 RED、GREEN、regression command receipt identities。Validator 从 Evidence Store 读取真实命令、退出状态、输入摘要和采集时间，不接受复制的自由摘要。

### 2. RED 必须是预期行为失败

RED Evidence 必须早于对应实现输入变化，且失败分类匹配待实现行为。依赖缺失、语法错误、环境不可用、超时或无关测试失败不能作为 RED。

### 3. GREEN 与回归绑定当前输入

GREEN 和 regression 必须在实现后绑定当前代码输入并成功；同一成功 receipt 不能同时充当 RED 和 GREEN。输入漂移后旧 Receipt 失效。

### 4. TDD 与 direct 使用不同合同

`tddMode=tdd` 要求每个适用 package 的有效 TDD Receipt 才能通过 Execute/Check Gate。`tddMode=direct` 不要求先红后绿，但仍必须声明相关测试并通过 Build Check 与 Verify。

### 5. 观测只暴露有界状态

OTLP/Desktop 展示 cycle submitted/accepted/rejected、阶段、duration 和有界失败分类；不上传命令输出、源码片段、本机路径或自由测试名作为 Metric label。

## Recovery

恢复时按当前 Work/package/代码输入重新解析 Receipt。只重跑受漂移影响的循环，不使无关 package Evidence 失效，也不创建第二 Run。

## Stop Conditions

- 命令 Evidence 缺少可验证输入身份或时间关系；
- RED 分类只能依赖模型自由解释而无法由 Validator 核对；
- TDD Gate 会降低现有 Build Check 或 Verify 要求。
