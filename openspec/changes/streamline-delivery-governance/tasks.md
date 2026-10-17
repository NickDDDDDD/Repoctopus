# Tasks

## 1. 交付契约与策略

- [x] 1.1 定义 `DeliveryPolicy`、`DeliveryIntent`、仓库选择和托管平台映射的版本化类型及 YAML 校验，使用单元测试验证缺少自动提交开关、提交格式、仓库或目标分支时 fail-closed。
- [x] 1.2 定义交付状态、Publication Action、Journal Event 和稳定 action id，使用状态转换测试验证非法跳转、跨 change 引用和重复事件被拒绝。
- [x] 1.3 记录 `repoctopus.yaml` 的交付配置示例和默认安全行为，运行文档中的配置校验命令确认示例可加载。

## 2. 本地 checkpoint commit

- [x] 2.1 扩展 Git 端口以读取保护分支、HEAD tree、精确工作树和远端引用，使用临时仓库测试 clean、dirty、detached、保护分支和远端缺失场景。
- [x] 2.2 实现策略控制的 checkpoint 编排，只在功能分支、提交格式有效且快速检查通过时暂存并提交选定仓库，使用真实 Git E2E 验证成功提交和所有拒绝路径均不修改非选定仓库。
- [x] 2.3 为 checkpoint 结果增加结构化诊断和脱敏遥测，使用映射测试确认命令输出、绝对路径和环境变量值不会进入普通属性。

## 3. 交付快照与 Human Decision

- [x] 3.1 实现规范化 `DeliverySnapshot` 和 SHA-256 摘要，使用乱序等价输入、多仓漂移、报告漂移、策略漂移和目标基线漂移测试验证稳定性与失效规则。
- [x] 3.2 实现 `HumanDecisionRequest/Response`、可信主体上下文和追加式批准记录，使用测试验证 approve、request_changes、reject、重复响应、伪造主体和摘要不匹配。
- [x] 3.3 实现交互式 CLI 评审入口和 Adapter capability 协商，使用伪 TTY 测试三种选择，并验证非交互环境保持 `awaiting_approval` 且不存在自动批准参数。
- [x] 3.4 编写 Human Decision 协议和 IDE Adapter 接入文档，使用 JSON schema fixture 验证请求与响应示例。

## 4. 可恢复的多仓发布

- [x] 4.1 实现 Publication Planner 和原子 Journal Store，使用崩溃注入测试验证每个动作边界可恢复、部分完成状态可见且已确认动作不会重复执行。
- [x] 4.2 实现普通 Git push Adapter，发布前核对源 HEAD、远端源 OID 和目标基线，使用多个本地 bare remote 的 E2E 测试验证顺序发布、远端漂移阻断和失败后继续。
- [x] 4.3 实现批准有效性核对和发布 Guardrail，使用测试验证 merge、force push、分支删除、新增仓库和计划外动作始终被拒绝。
- [x] 4.4 记录多仓部分发布、恢复和人工修复方法，并通过故障演练确认文档步骤能恢复一个中途中断的本地 E2E。

## 5. GitHub MR Adapter

- [x] 5.1 实现平台无关 `MergeRequestPort` 和 Credential Provider，使用契约测试确认端口不暴露 merge 且凭据不进入输入快照或持久化结果。
- [x] 5.2 实现 GitHub REST Adapter 的 capability、find、create、update 和 status，使用 mock HTTP 测试已有 MR 复用、响应丢失恢复、CI/评审/会话/合入状态规范化。
- [x] 5.3 区分套餐不支持、权限不足、配置错误和暂时故障，使用 401、403、404、429、5xx 与网络失败测试验证诊断；确认私有免费仓的分支保护限制只产生真实警告。
- [x] 5.4 使用脱敏测试确认 Token、Authorization、Cookie、带凭据 URL、请求正文和平台原始错误不会写入日志、Journal 或遥测属性。

## 6. Runtime 与 CLI 纵切

- [x] 6.1 在 Runtime 组合 Delivery Service、Git、Human Decision、Journal、MR 与遥测端口，使用双 Run 和双 change 测试验证状态、批准和发布结果相互隔离。
- [x] 6.2 增加 `delivery checkpoint`、`delivery prepare`、`delivery status`、`approval review`、`delivery publish`、`delivery resume` 和 `delivery refresh` CLI，使用版本化 JSON envelope 与退出码测试覆盖成功、待批准、漂移、部分失败和已合入状态。
- [x] 6.3 使用两个业务仓、两个 bare remote 和 mock GitHub API 完成独立进程 E2E：自动 checkpoint、验证快照、交互批准、断点发布、MR 复用、人工合入事实刷新，全程确认 Runtime 未调用 merge。
- [x] 6.4 更新 Runtime 架构、状态机和 README 快速示例，执行文档中的最小交付流程并确认命令与实际 CLI 一致。

## 7. 集成验证与交付报告

- [x] 7.1 运行类型检查、Lint、单元测试、Git/GitHub E2E、确定性构建、品牌、来源和 OpenSpec 严格校验，记录所有命令、结果和未覆盖的真实平台限制。
- [ ] 7.2 生成绑定当前干净代码树、策略和测试结果的正式验证报告，确认 Runtime 能创建 Human Decision 请求且只有用户交互批准后才允许远端发布。

## Workflow follow-up

- 用户通过 Human Decision 交互批准验证报告后，由 Runtime 发布功能分支并创建或更新 MR。
- MR 由人评审和合入；Runtime 读取合入证据后，再同步主规格并归档本 change。
