# change-lifecycle Specification Delta

## ADDED Requirements

### Requirement: 规划授权失效必须原子恢复 Design checkpoint

当 Build、Verify 或尚未发生不可逆副作用的 Archive 观察到当前 Specification Provider 的规划语义或 trusted Design approval 不再授权 lifecycle 的 `planningDigest` 时，Runtime MUST 通过一个带 `semantic | approval-authority` 分类的受保护 transition 回到 Design。该 transition MUST 在同一次权威 Run 提交中设置新的 `specification.plan` Work 与 `checkEpoch`，清除旧 Tasks、Build Protocol、Verification、Archive 输入和未完成 Closure，并退役不匹配的新旧 execution checkpoint；Runtime MUST NOT 暂停在缺少当前 Work 的 Design 中间态、复用旧 approval、创建第二个 Run 或要求手改 Store。

#### Scenario: Verify 收尾提交改变规划语义

- **WHEN** Change 已进入 Archive，但 Verify 收尾提交改变 Proposal、Design、Delta Specs、Tasks 语义或 Change metadata
- **THEN** 下一个受保护 Runtime pull 在任何关闭或发布副作用前一次提交 Design phase、新 `specification.plan` Work、新 epoch 与下游证据失效事实

#### Scenario: 当前 approval 不再有效但语义摘要相同

- **WHEN** Archive preflight 能读取相同 planning semantic digest，但无法证明与该 Run 绑定的 trusted Design approval 仍有效
- **THEN** Runtime fail closed 并回到新的 Design approval Work，不把 lifecycle 中的旧 planning digest 单独视为发布授权

#### Scenario: 重复观察相同失效

- **WHEN** 进程在恢复提交后退出，另一个 Runner 对同一 revision 再次观察相同规划失效
- **THEN** Runtime 返回已经存在的 Design checkpoint 或明确 revision conflict，不创建第二个 Work、第二次 invalidation 或重复副作用

#### Scenario: 陈旧 Runner 提交失效观察

- **WHEN** planning invalidation observation 的 `expectedRevision/fromPhase` 不再匹配 CAS 内读取的当前 Run
- **THEN** Runtime 拒绝该陈旧观察并要求调用方重读当前 Action，不覆盖较新的 phase、Work 或批准结果
