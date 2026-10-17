# delivery-governance Specification

## Purpose

定义 Repoctopus 如何在多仓开发中自动保存本地检查点、把验证结果绑定为可批准的交付快照，并以可恢复、可审计且不自动合入的方式发布代码和 MR。

## Requirements

### Requirement: Change 显式选择交付仓库

Repoctopus MUST 要求每个交付 change 显式列出受影响仓库、源分支、目标分支和期望远端动作，不得把扫描到的其他脏仓库自动加入交付集合。

#### Scenario: 未选择的仓库存在修改

- **WHEN** 项目快照发现未被 change 选择的仓库存在 staged、unstaged 或 untracked 修改
- **THEN** Runtime 报告警告并保持该仓库不在提交、验证和发布计划中

#### Scenario: 选择不存在的仓库

- **WHEN** change 引用的仓库不在当前项目快照中
- **THEN** Runtime 阻断交付准备并指出缺失的仓库身份

### Requirement: 自动 checkpoint commit 由策略控制

Repoctopus MUST 只在项目策略显式启用自动提交、当前分支不受保护、提交格式有效且匹配改动的快速检查通过时创建本地 checkpoint commit，创建该 commit 不需要人工批准。

#### Scenario: 功能分支满足自动提交条件

- **WHEN** 选定仓库位于允许的功能分支且提交信息与快速检查满足策略
- **THEN** Runtime 创建本地 checkpoint commit 并记录提交身份和检查结果

#### Scenario: 当前分支受到保护

- **WHEN** 选定仓库当前分支匹配项目策略中的保护分支
- **THEN** Runtime 拒绝自动提交且不修改 Git 历史

#### Scenario: 自动提交配置不完整

- **WHEN** 项目未启用自动提交或未配置提交格式
- **THEN** Runtime 不创建 commit 并返回可操作的配置诊断

### Requirement: 验证报告先于交付快照提交

Repoctopus MUST 在请求批准前生成验证报告、通过项目验证要求并把报告与实现提交为本地 checkpoint，使交付集合中的每个仓库都具有可重复捕获的代码状态。

#### Scenario: 报告尚未提交

- **WHEN** 验证报告或属于本次 change 的实现仍未进入本地 commit
- **THEN** Runtime 不生成待批准快照并返回未完成项

#### Scenario: 验证失败

- **WHEN** 项目配置要求的验证命令存在失败结果
- **THEN** Runtime 保留失败证据且不创建 Human Decision 请求

### Requirement: 交付快照绑定全部批准事实

Repoctopus MUST 使用稳定摘要绑定 change、选定仓库代码树、源与目标分支、远端基线、验证报告、交付策略和远端动作计划；相同规范输入必须产生相同摘要。

#### Scenario: 多仓快照生成

- **WHEN** 所有选定仓库和验证结果满足交付准备条件
- **THEN** Runtime 生成包含逐仓事实与整体 `sha256` 摘要的不可变交付快照

#### Scenario: 快照规范输入相同

- **WHEN** Runtime 对键顺序或扫描顺序不同但语义相同的输入生成快照
- **THEN** 两次生成的整体摘要相同

### Requirement: 人工批准通过结构化决策交互完成

Repoctopus MUST 发布版本化 `HumanDecisionRequest` 并只接受由可信 Adapter 或交互式 CLI 返回的 `HumanDecisionResponse`；请求必须展示验证报告、仓库集合、目标分支和计划的远端动作。

#### Scenario: IDE 支持原生交互

- **WHEN** 当前 IDE Adapter 声明支持 Human Decision 交互
- **THEN** Adapter 展示批准、要求修改和拒绝选项并把用户选择映射为结构化响应

#### Scenario: IDE 不支持原生交互

- **WHEN** 当前 Adapter 不支持 Human Decision 交互但存在交互式终端
- **THEN** Runtime 保持待批准状态并提供 CLI 评审入口，不要求用户复制摘要命令

#### Scenario: 没有可信交互通道

- **WHEN** Runtime 无法确认响应来自可信用户交互上下文
- **THEN** Runtime 拒绝记录批准且 Agent 不得代替用户批准

### Requirement: 批准绑定快照并在漂移后失效

Repoctopus MUST 记录批准决定、可信主体、时间和快照摘要，并在代码树、验证报告、仓库选择、分支、远端基线、策略或动作计划变化后拒绝使用旧批准。

#### Scenario: 批准后没有漂移

- **WHEN** 发布前重新捕获的事实与已批准快照一致
- **THEN** Runtime 允许执行该快照的远端动作计划

#### Scenario: 任一仓库发生漂移

- **WHEN** 已批准交付集合中的任一仓库代码树或分支与快照不同
- **THEN** Runtime 把批准标记为失效并返回需要重新验证的差异

#### Scenario: 目标基线发生漂移

- **WHEN** 远端目标分支已不再指向快照绑定的基线
- **THEN** Runtime 阻断发布且不得静默变基或强推

### Requirement: 多仓发布计划可恢复且幂等

Repoctopus MUST 按稳定顺序执行逐仓 push 和 MR 动作，在每个动作后持久化结果，并在重试时跳过已确认成功且远端事实仍一致的动作。

#### Scenario: 中途发布失败

- **WHEN** 一个仓库的远端动作失败且此前仓库已有动作成功
- **THEN** Runtime 保存部分完成状态、停止后续动作并明确说明不存在跨仓事务回滚

#### Scenario: 从失败点继续

- **WHEN** 失败原因解决后恢复同一交付计划
- **THEN** Runtime 核对已完成动作并从第一个未完成动作继续

#### Scenario: MR 创建响应丢失

- **WHEN** 托管平台已经创建 MR 但 Runtime 未持久化成功响应
- **THEN** Adapter 通过仓库、源分支和目标分支查询已有 MR 并复用其身份

### Requirement: MR 由平台端口管理但不自动合入

Repoctopus MUST 通过平台无关端口创建或更新 MR 并读取 CI、评审、会话解决和合入状态；Runtime 与任何 Adapter 都不得执行 merge 动作。

#### Scenario: GitHub 仓库发布

- **WHEN** 已批准计划为 GitHub 仓库创建或更新 MR
- **THEN** GitHub Adapter 使用托管平台 API 完成动作并返回稳定 MR 身份和可审计状态

#### Scenario: MR 已由人合入

- **WHEN** Adapter 读取到 MR 的合入提交和合入时间
- **THEN** Runtime 记录合入证据并把该仓库标记为已合入

#### Scenario: 请求自动合入

- **WHEN** 工作流或调用方要求 Repoctopus 执行 merge
- **THEN** Runtime 拒绝该动作并保持人工合入边界

### Requirement: 平台能力不足产生明确诊断

Repoctopus MUST 区分平台未配置、权限不足、套餐不支持和暂时故障；分支保护不可用时必须报告真实降级状态，不得把本地检查或 CI 失败伪装成服务端保护。

#### Scenario: 私有仓库套餐不支持分支保护

- **WHEN** 托管平台明确返回当前套餐不支持分支保护
- **THEN** Runtime 记录非阻断能力警告并把服务端保护状态标记为不可用

### Requirement: 交付状态不泄露凭据

Repoctopus MUST 从受控凭据提供器读取托管平台凭据，并禁止把 Token、Authorization Header、Cookie、完整远端 URL 凭据或环境变量值写入配置、快照、Journal、日志和遥测属性。

#### Scenario: 平台请求失败

- **WHEN** 包含认证信息的平台请求返回错误
- **THEN** Runtime 只记录脱敏错误类别、平台、仓库身份和请求关联身份
