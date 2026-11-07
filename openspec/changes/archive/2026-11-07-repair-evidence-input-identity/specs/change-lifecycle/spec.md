## MODIFIED Requirements

### Requirement: Archive 关闭前必须重验冻结输入

Repoctopus MUST 在执行 `specification.close` 或 publication 副作用前，使用与 Verify 相同的输入依赖权威比较当前事实与冻结 Verification Input。等价收尾 MUST 保留有效验证证据，发布坐标仍由独立 preflight 核对。声明的证据依赖确实漂移且尚无 Closure 或 Publication Receipt 时，Runtime MUST 退役失效 close execution、清除相应 Archive input 并返回 Verify，只重采受影响证据；规划授权同时失效时 MUST 按既有最高受影响权威规则直接恢复 Design。副作用已经开始后 MUST 使用既有 journal/reconciliation，不得回滚或伪造重验。

#### Scenario: Close Work 冻结后源树漂移

- **WHEN** `specification.close` Work 已创建或验证，当前事实使冻结 Verification Input 声明的产品内容依赖失效，且尚未开始关闭或发布副作用
- **THEN** Runtime 在调用 Specification provider 前返回 Verify、创建新的 `evidence.verify` Work 并退役旧 execution checkpoint，只要求重采受影响的检查

#### Scenario: 漂移同时改变规划语义

- **WHEN** Archive 的同一次受保护观察同时发现批准的规划语义失效与其下游 Evidence 依赖漂移
- **THEN** Runtime 复用既有最高受影响权威判定，只建立一次 Design 恢复及下游失效事实，不先退回 Verify 再因相同根因退回 Design

#### Scenario: Closure 已经产生

- **WHEN** Specification Closure 或 Publication Receipt 已存在
- **THEN** Runtime 不回退到 Verify，而继续既有 publication journal/reconciliation 流程

#### Scenario: Verify 后只提交完成复选框

- **WHEN** 当前 Run 已合法完成 Task 并通过 Verify，随后 Workspace 仅暂存和提交相同完成状态，Provider 证明规划语义未变，检查也未声明消费该 Git 身份或 checkbox
- **THEN** 新进程的恢复和 Archive preflight 保留已接受的有效 Gate、Bundle 和完成事实，不创建额外的 Verify Work或重跑检查；发布坐标未变时保持当前 Archive Work，首次准备或合法更新发布 checkpoint 的正常 transition 仍可递增 epoch

#### Scenario: 等价收尾改变已冻结发布坐标

- **WHEN** 验证依赖仍有效，但实际发布提交与已冻结 Archive input 不同，且关闭或发布副作用尚未开始
- **THEN** Runtime 阻断使用旧发布输入，重新执行受保护 preflight，核对批准的分支、远端、提交范围、当前发布坐标及验证证据；只有重验通过才建立匹配的发布 checkpoint，不因发布来源变化使有效 Verify Evidence 失效

#### Scenario: 收尾提交影响显式 Git 依赖

- **WHEN** 相同收尾提交改变了某个检查明确声明消费的 Git 身份，而规划语义仍有效
- **THEN** Runtime 只使该检查及其证据后继失效，返回合法 Verify checkpoint，不以等价规划语义跳过该项重验

#### Scenario: 重验期间输入来源暂时不可用

- **WHEN** Archive preflight 无法读取 Provider 或实际依赖，尚不能证明有效或失效
- **THEN** Runtime 保留当前证据、Work 和副作用边界并返回受限重试或 reconciliation，不把不可用误判为实现失败或规划返工
