---
comet_change: stop-stagnant-verify-repair
role: technical-design
canonical_spec: openspec
---

# Design

## 现有行为

Windows 五仓实验用 v0.1.5 运行了两轮机器检查。A 仓首次失败后只重做了 A，B、C、D 的完成事实仍有效。第二轮仍以相同声明输入在同一检查失败，Runtime 再次派发 Build Plan。现有局部失效机制保住了无关包，但没有比较两轮修复是否取得进展。GitHub #120 最初失败的机器记录仍未取得。

## 比较机器证据

采用 Comet Native 的失败签名、持久暂停和明确续行。首次可信实现失败沿现有 `revise-implementation` 路径局部返工。从当前 Build Protocol 的修复来源读取上一轮受管 Attempt 和 Bundle，与当前 `EvidenceCoordinator.verifyRepairFacts` 结果比较。核对 Run、Profile、各自的 Verify 绑定、冻结输入和回执归属。比较规范化后的声明输入、验收集合、失败与因果阻断范围，以及失败检查和其依赖实际消费的生产者内容指纹。Work、epoch、Attempt、Bundle、恢复决定和包完成记录的标识用于追溯。

一次自动返工后，当前和上一轮的可信证据均表明失败范围与实际输入相同时，Runtime 暂停继续自动派工。有实质变化时保持现有局部返工规则，证据暂时无法确认时保留原 Work 待重观。本次沿用现有 Evidence 的实际输入权威。显式声明的 Git 和运行环境输入按原策略参与比较。

## 暂停和继续

机器执行前持久化当前 Run、Work、epoch 的 Attempt 绑定。机器结果产生与生命周期结算之间的中断或竞争复用此 Attempt。直接机器检查入口也遵守绑定。旧 Work 的错误不能向更新的 Work 写恢复指引。

同一受保护转换保存 Verify 等待、原因及相关证据，保留 Work、epoch、Host 审查、Attempt、机器结果及有效工作包。读取和继续命令从同一事实展示原检查、失败证据和现有人工决定入口。只有当前 Verify 可以接收针对这次失败的继续答复。其他执行入口在等待期间不派发机器检查或 Build。

批准一次局部返工时，复核当前 Run 版本、Work、epoch、Attempt、Host 审查及两轮可比较证据。原子登记答复并执行 `revise-implementation`，由 Runtime 派发普通 Build Plan。重复提交同一答复保持幂等，过期和竞争答复无法重复派发。再次失败且仍无进展时停在新 Verify，用户可以根据新一轮证据再决定。

暂停后的输入复核使用现有 Evidence 实际输入观察，包括派生依赖。发现变化时通过受保护的证据失效转换清理原等待并重观；提交前再次核对转换绑定的输入。项目、规划和权限异常仍走原路径。重观失败则保留原等待和证据。生命周期定义若新增转换，使用已有摘要兼容机制处理本次改动前的活动状态。验收要求候选包内冷恢复。

## 验证

- 先用生产入口锁定原版重复派工的回归，再覆盖首次失败、同输入同失败、只变运行标识、真实声明或派生输入变化，以及未知证据。
- 从新进程测试机器结果已写成但暂停未提交、正常等待恢复、直接 Verify、并发 Attempt、冲突或重复答复。断言没有新检查或重复派发，且不误接受已过期的决定。
- 用 Windows 五仓实际安装包验证 A 重复失败而无关包完成保留，使用同一 Run 完成受管续行和真实修复后进入 Archive。
