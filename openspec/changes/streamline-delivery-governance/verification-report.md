# streamline-delivery-governance 验证报告

## 报告状态

- 结论：实现与本 change 的 Proposal、Design 和 Delta Spec 一致，建议批准交付。
- 状态：待用户通过 Human Decision 交互批准。
- 验证日期：2026-10-17。
- 实现基线：`cea378688b05bcacb5fc63ff6c7a178aa20fcfaa`。
- 实现代码树：`6e2cf92a7be26e6e3772cc7be48e2bde87fe2f8b`。
- 远端状态：尚未 push，尚未创建或更新 MR。

## 交付结果

本变更把本地开发保存与远端共享发布拆成两个信任边界：

1. 项目策略可以允许功能分支创建本地 checkpoint commit，无需逐次人工批准。
2. Delivery Intent 显式选择交付仓库、源分支、目标分支和远端动作，未选择仓库不会被自动纳入。
3. 验证报告、代码树、策略、仓库集合、目标基线和 Publication Plan 被规范化为稳定交付快照。
4. Runtime 通过版本化 Human Decision 协议请求批准；CLI 降级入口仅接受交互式 TTY，不提供自动批准参数。
5. 一次有效批准授权快照内的普通 push 与 MR create/update，代码或交付事实漂移后批准立即失效。
6. 多仓发布逐动作持久化，可在部分失败后核对远端事实并继续，不宣称跨仓事务回滚。
7. GitHub Adapter 通过平台无关端口管理 MR 和读取状态；端口与 CLI 均不提供 merge。
8. 交付状态、日志和 OpenTelemetry 属性使用允许列表，凭据、报告正文、MR 正文和绝对路径不进入普通遥测属性。

## 需求映射

| 规格能力                | 实现证据                                                  | 验证证据                                                                   |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Change 显式选择交付仓库 | `DeliveryIntent` 与仓库选择校验                           | 缺失仓库、未选择脏仓库和多仓排序测试                                       |
| 策略控制 checkpoint     | Git Delivery Port 与 `delivery checkpoint`                | 功能分支、保护分支、提交格式、快速检查和真实临时 Git 仓测试                |
| 报告先提交再生成快照    | `DeliveryService.prepare` 的 clean 与 tracked report 门禁 | 未跟踪报告、脏工作树和验证失败拒绝测试                                     |
| 快照绑定全部批准事实    | 规范 JSON、SHA-256 摘要和稳定 action id                   | 乱序等价输入及代码、报告、策略、目标基线漂移测试                           |
| 结构化人工决定          | `HumanDecisionRequest/Response`、可信 actor context       | approve、request_changes、reject、伪造主体、非 TTY 拒绝和 JSON Schema 测试 |
| 漂移后批准失效          | 发布前重新捕获事实与批准摘要核对                          | 仓库 dirty、报告变化、远端基线变化和动作计划变化测试                       |
| 可恢复多仓发布          | Publication Planner、原子 Store 和 Journal                | 崩溃恢复、部分发布、稳定动作顺序和真实 bare remote push 测试               |
| MR 平台端口且不自动合入 | `MergeRequestPort` 与 GitHub REST Adapter                 | 已有 MR 复用、响应丢失恢复、状态规范化和无 merge 方法契约测试              |
| 平台能力诊断            | GitHub HTTP 错误分类与 capability                         | 401、403、404、429、5xx、网络失败和私有免费套餐限制测试                    |
| 凭据与内容最小化        | Credential Provider 与 Delivery 遥测映射                  | Token、Header、Cookie、URL、正文、路径和环境值脱敏测试                     |

## 验证结果

| 命令                          | 结果                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run verify`              | 通过；类型检查、Lint、确定性构建、16 个测试文件、54 项测试、品牌、来源和 OpenSpec 严格校验全部通过 |
| `npm run format:check`        | 通过                                                                                               |
| `git diff --check`            | 通过                                                                                               |
| `npm audit --omit=dev --json` | 通过；生产依赖漏洞 0                                                                               |
| `npm pack --dry-run --json`   | 通过；包内包含 Delivery CLI、领域代码、文档、配置示例和 Human Decision Schema                      |

测试覆盖真实临时 Git 仓和本地 bare remote、独立 CLI 进程、mock GitHub REST API、崩溃恢复、重复执行和遥测脱敏。完整验证在实现 checkpoint `cea3786` 上执行；报告加入后再次执行格式、规格和完整项目验证。

## Human Decision 与授权边界

正式交付准备会在报告进入本地 checkpoint 且工作树干净后生成 `HumanDecisionRequest`。请求展示本报告、明确选择的仓库、目标分支和计划远端动作。只有用户通过可信 IDE Adapter 或交互式 CLI 选择批准后，Runtime 才能执行快照内的普通 push 与 MR create/update。

批准不授权 merge、force push、删除分支、静默 rebase、改变目标分支或把新仓库加入计划。任何代码树、报告、策略、仓库选择、分支、远端基线或动作计划变化都会废止旧批准并要求重新验证。

## 遥测与敏感数据

交付遥测记录 change、snapshot、仓库数量、动作类型、状态、重试次数和耗时等结构化维度。验证报告正文、Git diff、MR 正文、Token、Authorization、Cookie、带凭据 URL、绝对路径和环境变量值不会进入普通属性。遥测发送失败发生在本地状态持久化之后，只产生 warning，不回滚交付事实。

## 已知限制

- 本轮使用 mock HTTP 验证 GitHub REST 行为，没有为了测试在真实 GitHub 仓库创建临时 MR。用户批准本报告后的正式发布将成为真实 GitHub 纵切。
- GitHub REST 不直接提供统一的未解决 review thread 汇总，当前 `conversationsResolved` 为未知值；不会把未知伪装为已解决。
- 私有个人免费仓库的服务端分支保护可能返回套餐不支持。Adapter 将其记录为非阻断 `feature_unavailable` 能力诊断，不把本地检查冒充服务端保护。
- 本 change 只实现 GitHub Adapter 和交互式 CLI 降级协议，尚未实现 CodeHub Adapter 或具体 IDE 插件。
- 多仓发布按动作顺序执行且可恢复，但不具备跨仓原子回滚。远端发生部分成功时需要保留事实并从失败点继续或人工修复。

## 回退方式

当前尚未产生远端副作用。本地实现由独立 checkpoint commit 保存，可在功能分支上通过普通 revert 回退。正式发布后，代码回退仍使用后续 revert MR；Repoctopus 不自动删除已推分支、关闭已建 MR 或改写远端历史。

## 批准含义

批准本报告表示接受当前实现、验证结论、已知限制以及随后生成的确定性交付快照。批准后 Runtime 可以自动执行该快照明确列出的普通 push 与 MR create/update，无需再为每条 Git 命令请求批准；MR 仍必须由人评审和合入。
