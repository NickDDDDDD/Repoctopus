# Spec Delta

## ADDED Requirements

### Requirement: Archive 使用单一持久工作协议

同一 Change Run 的 Archive MUST 按 `preflight → publish-business → await-business-merge → verify-merged → close-candidate → publish-final → await-final-merge → finalize` 的受保护顺序推进，并为每项 Work 保存输入摘要、Intent、Receipt、后置核对和恢复状态；不得以旧 Delivery 聚合状态、临时目录存在或单次命令成功替代该协议。

#### Scenario: Runner 在任意边界重启

- **WHEN** Archive 在某项 Work 保存 Intent 后、Receipt 前或后置核对前中断
- **THEN** 新 Runner 从 Journal 和外部权威事实确定首个未确认边界，并继续同一 Change Run 而不重放已确认副作用

#### Scenario: 步骤请求越过顺序

- **WHEN** 调用方在业务 MR 未全部核对合入前请求规格关闭，或在关闭候选未发布前请求最终 MR
- **THEN** Runtime 拒绝该 Work 并保持当前 Archive 状态，返回缺失的前置事实

### Requirement: 最终 Change MR head 漂移使发布证明失效

Repoctopus MUST 在最终 Change MR 创建或恢复时冻结精确 head，并在等待和最终化时重新读取平台权威状态；MR head、目标分支或关闭提交发生变化时，旧 publication Receipt 必须标记为 superseded，并通过新 attempt 重新验证和发布，不得沿用旧合入授权或完成事实。

#### Scenario: 最终 MR 等待期间分支新增提交

- **WHEN** 平台报告最终 Change MR 当前 head 不再等于 publication Receipt 绑定的关闭提交
- **THEN** Run 保持 `archive/blocked` 或返回可恢复验证 Work，使旧 Receipt 失效且不把后续合入误认为原候选已通过

#### Scenario: 最终 MR 合入事实精确匹配

- **WHEN** 平台报告冻结 head 已合入登记目标分支，并返回可核对的 merge commit
- **THEN** Runtime 绑定 MR identity、head、base、merge commit、关闭摘要和审计摘要后才允许 finalize

### Requirement: 临时资源清理不覆盖主结果

Archive MUST 持久化其创建的临时 checkout、目录、锁和其他受管资源；主协议成功后清理失败必须记录为 `cleanup_pending` 并由当前恢复、下一次启动或显式 reconcile 重试，不得把已证明的发布或合入结果改写为未知，也不得把未清理资源视为终态协议完成的替代证据。

#### Scenario: Windows 文件句柄延迟释放

- **WHEN** 关闭 checkout 后删除受管临时目录返回共享冲突或 `EBUSY`
- **THEN** Runtime 使用有界退避重试，仍失败时登记 `cleanup_pending`，保留主结果并允许后续 GC 精确重试该资源

#### Scenario: 后续 Runner 执行 GC

- **WHEN** 新 Runner 启动或维护者执行 reconcile，发现已登记且租约过期的 `cleanup_pending` 资源
- **THEN** 系统只清理受管清单中的精确路径，成功后追加清理 Receipt，不扫描或删除未登记目录

### Requirement: 只读 CLI 命令不得推进生命周期

帮助、版本、状态、inspect、doctor 和其他声明为只读的 CLI 请求 MUST 在解析阶段阻止 Runtime 启动、副作用协调和 Run 创建；未知或缺失参数必须返回用法诊断，不得回退到默认 workflow 执行。

#### Scenario: 请求子命令帮助

- **WHEN** 用户执行 `run start --help`
- **THEN** CLI 只输出该子命令的用法且不创建 Run、不执行 Post-merge reconcile、不写持久状态

#### Scenario: Change 参数缺失

- **WHEN** 用户意图启动 Change Run 但缺少受保护的必需参数
- **THEN** CLI 在装配 Project composition 前返回参数错误，不启动默认 foundation workflow
