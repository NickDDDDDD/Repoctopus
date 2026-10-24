# Spec Delta

## ADDED Requirements

### Requirement: 远端副作用前完成无副作用 Preflight

Repoctopus MUST 在创建受保护 Action Intent、领取 Work 或消耗 attempt 之前完成只读 preflight，核对所需凭据存在性、Git 作者身份、平台能力、Provider/Store、Evidence profile、远端 OID、临时空间和发布策略；preflight 不得读取或记录凭据值，也不得产生 Git、平台或规格副作用。

#### Scenario: 平台 Token 未配置

- **WHEN** Archive 发布需要托管平台凭据但 Credential Provider 无法提供所需值
- **THEN** Run 进入可恢复的 `archive/blocked` 配置诊断，且 Action Store 中没有新增 Intent 或 attempt

#### Scenario: 全部发布依赖可用

- **WHEN** preflight 对当前 Archive input 的全部检查通过
- **THEN** Runtime 保存绑定检查摘要的准备事实，再允许分配 attempt 和创建受保护 Action Intent

### Requirement: 外部动作按稳定身份协调未知结果

每个 push、MR 创建或更新、平台状态读取和最终化动作 MUST 具有由 change、generation、Work、规范输入和目标资源组成的稳定身份；执行中断且副作用结果未知时，Runtime 必须先查询平台或远端权威事实，再复用成功、继续未完成动作或进入人工修复，不得盲目重复。

#### Scenario: 最终 MR 创建响应丢失

- **WHEN** 平台已创建最终 Change MR，但 Adapter 在 Receipt 持久化前断开
- **THEN** 任一恢复 Runner 通过稳定 head/base 与仓库身份找回唯一 MR，核对精确 head 后追加恢复 Receipt

#### Scenario: 远端存在不等价结果

- **WHEN** 恢复查询发现相同稳定动作身份对应的远端 head、目标分支或内容摘要不匹配当前输入
- **THEN** Runtime fail-closed 并报告差异，不覆盖远端、不分配盲重试 attempt

### Requirement: 多仓 Archive 输入保持逐仓可证明

Archive 发布与最终化 MUST 绑定冻结 Business MR 集合中每个仓库和每个 MR 的平台身份、目标分支、权威 merge commit 与核对时间；同一仓库有多个 MR 时，系统必须保留全部 merge evidence，并明确用于隔离验证的最终检出 commit。

#### Scenario: 多仓集合中一个 merge commit 漂移

- **WHEN** 恢复时任一业务仓的权威 MR merge commit 与冻结 Archive input 不同
- **THEN** Runtime 使当前发布授权失效并要求重新准备完整集合，不用其他仓库的成功掩盖漂移

#### Scenario: 不同 Runner 恢复同一多仓集合

- **WHEN** 新 Runner 取得相同 Change Run 和 Journal，并重新查询到全部逐仓 merge facts 一致
- **THEN** 它从首个未确认动作继续，已确认的逐仓动作保持幂等且无需原开发者在线
