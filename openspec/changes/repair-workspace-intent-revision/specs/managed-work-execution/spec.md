# managed-work-execution Specification Delta

## ADDED Requirements

### Requirement: Intent 修订必须同步退役不匹配的 execution checkpoint

当 Workspace intent 修订 transition 替换或清除 lifecycle current Work 时，Runtime MUST 通过统一的 current execution 判定，在同一次 Run CAS 中比较新 current Work 与 `workExecution` 的 `workId/checkEpoch`；不完全匹配的 checkpoint MUST 从当前 Run state 退役，并在同一 transition event 记录 retirement fact，历史 claim、Host invocation、Outcome、Receipt 与 Validator facts MUST 保留在 trajectory。新的 Design Work MUST 可正常 claim，旧 Build Configure Host MUST NOT 被重放或继续投影为当前 continuation。

#### Scenario: Build Configure Outcome 后返回 Open

- **WHEN** Build Configure Host 已提交成功 Outcome但 binding 证明旧 intent 不可用
- **THEN** Build→Open transition 同一 CAS 清除当前 execution checkpoint并记录 retirement，Open wait 不返回旧 validator-pending

#### Scenario: 新 Design Work 建立

- **WHEN** 用户批准新的可绑定 intent并由 Runtime 创建 `specification.plan` Work
- **THEN** Run 只包含新 Work/epoch 的当前身份，旧 Build Configure execution 仅作为 trajectory 历史可读

#### Scenario: Transition 未替换 current Work

- **WHEN** lifecycle transition 后 current Work 的 `workId/checkEpoch` 仍与 execution checkpoint 完全一致
- **THEN** Runtime 保留 checkpoint且不记录虚假的 retirement

### Requirement: 外部 Build Execute Outcome 必须经过统一的两阶段消费

外部 Runner 为 `build.execute` Work 提交 Outcome 后，Runtime MUST 先把 `submitted` submission 显式接受为当前 attempt 的 Host 结果，再运行 package validator 并决定 validated success、finding recovery 或 halt；成功 submission MUST NOT 在 validator 前完成 package，失败 submission 的结构化 finding MUST NOT 因缺少旧内嵌 Host `outcome` 投影而丢失。重复 `next`、进程重启和同一 submission 重放 MUST 保持幂等，不得重复完成 Specification Task、Receipt 或 package。

#### Scenario: 外部 Runner 提交成功 Outcome

- **WHEN** 当前 Build Execute attempt 收到匹配 invocation/packet/context 的 `submitted/succeeded`
- **THEN** Runtime 接受该 submission并运行 package validator，只有 validator accepted 后才标记 Task 与 package 完成

#### Scenario: 外部 Runner 提交失败 Outcome

- **WHEN** 当前 Build Execute attempt 收到包含结构化 planning 或 implementation finding 的 `submitted/failed`
- **THEN** Runtime 接受该 submission并把 finding 交给正式 recovery 选择，不要求伪造旧内嵌 Host `outcome`

#### Scenario: 重启后重复消费同一 submission

- **WHEN** Runtime 在接受或验证 submission 后重启并再次执行 `next`
- **THEN** 已接受、已验证和已完成的事实不会重复写入，当前 continuation 从持久状态确定

### Requirement: 活动 Run 必须通过精确 adoption contract 采纳新的受保护语义

当自举 Change 修改当前 Run 使用的受保护 lifecycle/Runtime implementation 时，composition catalog MUST 只为该活动 Run 的唯一直接前驱声明精确 `{codeDigest, descriptorDigest}` adoption pair，相关 lifecycle contributor MUST 只声明直接前驱 version 可采用当前唯一语义；未明确列出的 digest pair 或 version MUST 保持 `migration_required`。该 contract MUST NOT 建立长期并行旧行为、通配 digest 或绕过 migration 检查的 Store 编辑路径。

#### Scenario: 当前活动 Run 采纳直接前驱

- **WHEN** 持久 Run 的 protected implementation digest pair 与 contributor version 精确匹配本 Change 声明的直接前驱
- **THEN** composition comparison 返回 compatible且 Run 可由新代码继续执行唯一的新 transition 语义

#### Scenario: 未声明的实现漂移

- **WHEN** 任一 code digest、descriptor digest 或 contributor version 不在精确 adoption contract 中
- **THEN** composition comparison 返回 `migration_required`，不得因只匹配其中一个 digest 或相邻版本而放行
