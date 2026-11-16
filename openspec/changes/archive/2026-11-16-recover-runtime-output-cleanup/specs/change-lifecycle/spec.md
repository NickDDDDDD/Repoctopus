# Spec Delta

## ADDED Requirements

### Requirement: Build 冻结仓库绑定前检查运行时文件跟踪

Repoctopus MUST 在接受 Build Configure 并持久化初始 Execution Binding 与 workspace checkpoint 前，检查登记 checkout 中由现有仓库输入策略识别为运行时输出的 Git 跟踪文件。发现冲突时 MUST 报告对应仓库与路径，保留当前 Run、配置和 Work，等待开发者清理后重试。检查 MUST 通过 Runtime 的 Git 观察完成。

#### Scenario: 已有仓库误跟踪运行时文件

- **WHEN** 登记 checkout 的 Git index 或将要绑定的 HEAD 包含由运行时输出规则判定为冲突的文件
- **THEN** Runtime 指出冲突路径并阻止冻结 Binding 和初始 workspace checkpoint
- **AND** 开发者提交清理后，可以通过同一 Run 的公开 CLI 入口继续 Build Configure

#### Scenario: 正常的本地运行时文件

- **WHEN** 本地存在运行时输出，但这些文件未纳入 Git 跟踪
- **THEN** 该检查允许合法 Configure 继续，现有 Evidence 输入分类照常执行

### Requirement: Build 恢复仅接纳可证明的运行时文件清理提交

对已有 Build workspace checkpoint 的活动 Run，`run resume` 与 `run next` MUST 使用同一受管判定。Runtime 只有在核对原 Run、登记仓库、绑定分支和 checkout 身份，且以真实 Git 对象证明 Workspace 的前向提交只解除现有运行时输出文件的跟踪，并确认相关原执行没有未决副作用时，才可接纳新的 Workspace HEAD。接受必须与 checkpoint 更新、恢复事实和有效 blocker 处置原子提交，并在提交时确认原证据仍有效。

#### Scenario: 待执行工作包期间清理 Workspace

- **WHEN** 当前 Build Work 的包只涉及业务仓，Workspace 越过冻结 HEAD 的提交仅解除运行时输出文件的跟踪
- **AND** 绑定身份、其他登记仓库和当前工作包的有效输入通过复核
- **THEN** 新 CLI 进程可使同一 Run 接纳清理提交并继续执行待执行的工作
- **AND** Runtime 保留有效审批、Build Plan、已接受工作包和原执行收据，等价恢复重放不重复应用 checkpoint 更新

#### Scenario: HEAD 变化夹带其他内容

- **WHEN** Workspace 的提交还修改了业务代码、规划、共享配置、运行时文件内容，或存在未授权的其他仓变化、分支变化和历史改写
- **THEN** Runtime 阻止该清理恢复，保留原接受的 workspace checkpoint，并报告实际需处理的冲突

#### Scenario: 原执行结果未知或观察已过期

- **WHEN** 同一 Run 还有结果未知的相关执行，或者核对期间另一个进程改变了 Run revision 或 checkout
- **THEN** Runtime 仍通过原执行核对或重试最新观察处理，禁止使用过期证据更新 checkpoint 或重放原执行
