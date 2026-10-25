# specification-authority Delta

## MODIFIED Requirements

### Requirement: 规格关闭先形成隔离候选再签发 Receipt

Specification Provider MUST 在隔离的 Workspace checkout 中把关闭计划应用为候选结果，并在签发 Closure Receipt 前核对活动 change 已移除、恰好新增一个预期归档目录、继续存在的受影响主规格已同步、显式退役的 capability 主规格已删除、允许路径差异成立且全局严格校验通过；Closure Receipt MUST 绑定不透明 candidate checkout identity 与创建候选时的 base OID。Provider 在最终规格发布达到可远端恢复终态前不得把候选复制到调用者工作树、移动调用者 branch/HEAD、修改其 index，或删除唯一候选 checkout。

#### Scenario: OpenSpec 已移动目录但主规格无效

- **WHEN** 官方 archive 命令已移动 change 目录，但继续存在的受影响主规格、退役集合或全局严格校验失败
- **THEN** Provider 保留可恢复 Journal 和诊断，不签发 Closure Receipt、不允许发布候选结果

#### Scenario: 关闭候选满足全部后置条件

- **WHEN** 预期归档唯一存在、活动 change 不再存在、Purpose、继续存在的受影响主规格、退役能力缺席和允许差异均通过严格核对
- **THEN** Provider 返回绑定关闭计划、文件身份、内容摘要与隔离候选身份的关闭结果，供 Archive 发布步骤使用

#### Scenario: 关闭候选通过但尚未发布

- **WHEN** 隔离候选满足全部关闭后置条件并签发 Closure Receipt，但规格 commit、remote branch 或 MR 尚未形成完整 Receipt
- **THEN** Provider 保留候选 checkout，调用者 branch、HEAD、index 和 worktree 与关闭前完全相同

#### Scenario: 已提交的候选由远端事实恢复

- **WHEN** 规格发布已经达到可由精确 commit、remote OID 和 MR identity 恢复的终态
- **THEN** Provider 可以清理短命 checkout，后续重放使用持久 Journal 与远端事实而不重新执行 OpenSpec archive

### Requirement: 规格关闭副作用只使用窄范围可恢复 Journal

Provider MUST 在调用官方 archive 副作用前持久化包含输入文件身份和预期输出的 prepared Journal，并只在隔离 checkout 内单调推进 applying、rolling-back、rolled-back 或 committed；committed Receipt MUST 保留 candidate identity，且 Journal 不得保存 MR 等待、平台事件、跨仓发布或生命周期终态。

#### Scenario: 进程在 change 目录移动后中断

- **WHEN** 恢复入口发现活动 change 不存在且 prepared/applying Journal 没有完成 Receipt
- **THEN** Provider 根据归档目录、主规格文件身份和预期输出判断继续验证、回滚或进入人工修复，不盲目再次 archive

#### Scenario: 相同关闭计划重放

- **WHEN** 已存在匹配输入摘要且后置条件仍成立的 committed Journal 与 Closure Receipt
- **THEN** Provider 返回同一逻辑关闭身份，不再次调用 archive 或创建第二个归档目录

#### Scenario: 隔离 checkout 出现并发修改

- **WHEN** 当前文件 CAS identity 不再匹配 before 或 expected manifest
- **THEN** Provider 保留现场并返回人工修复 blocker，不覆盖文件且不写入开发者工作树

#### Scenario: committed Journal 的 checkout 仍待发布

- **WHEN** 关闭 Journal 已 committed 但规格发布 Journal 尚未 completed
- **THEN** 恢复入口重新定位同一 candidate checkout 并返回同一 Closure Receipt，不清理候选或复制到开发者工作树

#### Scenario: 候选身份与 checkout 不一致

- **WHEN** checkout HEAD、base OID、plan digest 或 checkout identity 与 committed Receipt 不同
- **THEN** Provider 保留现场并进入人工修复 blocker，不从调用者工作树重建或猜测候选
