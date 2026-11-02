# Spec Delta

## ADDED Requirements

### Requirement: Change Run 创建前固定合法的工作区启动绑定

Runtime MUST 在持久化 Change Run、Work、Skill binding、Desktop activation 或成功遥测事实之前，从可信 Workspace Repository inspection 形成启动绑定，并验证 checkout 已附着到 source branch、source 与 target 不同、repository identity 和拓扑与本次 project snapshot 一致。Runner 负责准备 checkout；Runtime 不创建、切换或修复 Git branch/worktree。

#### Scenario: 从目标分支启动 Change

- **WHEN** Runner 请求以当前 checkout 的 `main` 作为 source，并以 `main` 作为 target 启动新 Change
- **THEN** Runtime 返回结构化 `workspace-binding-invalid`，且 Run Store、Work execution、Desktop activation 和 lifecycle trajectory 均不存在该 Change 的新成功事实

#### Scenario: 从已准备的功能分支启动 Change

- **WHEN** Runner 已准备 attached source branch，source 与 target 不同，且所有 Workspace Repository facts 与 project snapshot 匹配
- **THEN** Runtime 创建唯一 Change Run，并把规范化的 source、target 与 repository identity 作为稳定启动身份的一部分

#### Scenario: detached HEAD 启动 Change

- **WHEN** Workspace Repository inspection 返回 detached HEAD 或无法证明当前 source branch
- **THEN** Runtime 在创建 Run 前拒绝请求并返回可定位的 binding 诊断，不把错误延迟到 Specification Provider 或 Archive

### Requirement: 稳定启动只能幂等恢复同一绑定

相同 Workspace/change 的重复启动 MUST 先比较已冻结的 workflow、trigger、project snapshot 和 workspace binding identity。完全等价时返回原 Run 和当前 continuation；任一绑定事实不同时返回结构化 conflict，保持原 checkpoint 不变，不构造或记录候选 Work，不通过再次启动重绑活动 Run。

#### Scenario: 等价启动请求重放

- **WHEN** Runner 因响应丢失而以相同 trigger、project snapshot、source、target 和 repository identity 重放 `run start`
- **THEN** Runtime 返回原 Run、原 current Work/attempt 和逻辑等价 continuation，不新增 `work.created`、Human Decision 或 Host invocation

#### Scenario: 启动后切换分支再重试

- **WHEN** 已有 Run 绑定了一个 source branch，而调用方切换 checkout 后再次启动相同 Workspace/change
- **THEN** Runtime 返回 `workspace-binding-conflict` 和原 Run identity，不以新 project snapshot 创建 Work，也不把新 binding 写入旧 Run

### Requirement: Open 观察错误按可判定性分类

Runtime MUST 将创建前工作区输入无效、Provider 明确返回的规格无效、Provider 暂时不可用和外部执行结果未知分为不同事实。只有无法判定原外部执行结果时进入 Host reconciliation；已接受 Open Outcome 后的暂时 Provider 故障只重新观察原 checkpoint，确定性输入错误不得投影为 `open-observation-unavailable`。

#### Scenario: Provider 暂时不可用后恢复

- **WHEN** Open Host Outcome 已接受，首次 Provider inspection 因暂时基础设施错误无法返回有效或无效结论，随后同一 Provider 恢复
- **THEN** Runtime 保留原 Work、Outcome、attempt 和 invocation，在下一次受保护 pull 重新观察并继续原 gate，不重放 Host 或创建 repair Work

#### Scenario: Provider 明确返回 strict invalid

- **WHEN** Provider 成功返回当前四类规划工件 strict invalid 和可定位诊断
- **THEN** Runtime 通过单次 revision-bound transition 安装唯一 Open repair Work并退役旧 execution，不进入 Host reconciliation

#### Scenario: 分支约束错误在 Open inspection 中被发现

- **WHEN** 遗留或并发状态使 Provider inspection 发现 source 与 target 相同等确定性启动输入错误
- **THEN** Runtime 返回受限 binding/input conflict并保持原 checkpoint，不把该错误标记为 Provider unavailable，也不调用只适用于未知 Host 结果的 reconciliation
