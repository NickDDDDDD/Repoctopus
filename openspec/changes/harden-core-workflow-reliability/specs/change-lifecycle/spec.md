# change-lifecycle Delta

## MODIFIED Requirements

### Requirement: Change Run continuation 必须来自同一权威 checkpoint

Runtime、CLI、Dashboard 和 Telemetry MUST 从同一持久 Change Run checkpoint 投影当前 phase/status、Work attempt、packet identity、Wait、blocker 和 `execute|ask|wait|reconcile|done` continuation；恢复方不得根据阶段名、OpenSpec目录、Git diff、当前可变内容或历史对话另行推断下一动作。

#### Scenario: 新 Runner恢复活动 Change

- **WHEN** 原 Runner退出且另一个 Runner加载同一 Run
- **THEN** 新 Runner得到与 checkpoint一致的当前 Work/Wait 和 continuation，并在完成 packet、兼容性与多仓核对前不创建第二个 attempt

#### Scenario: 当前 Work 已改变规划文件

- **WHEN** 当前 Work 的 packet 已冻结且该 Work 在中断前按授权改变了 Change 规划文件
- **THEN** 新 Runner继续使用 checkpoint 引用的原 packet 与 attempt，不从已改变文件构造另一 continuation或执行包

### Requirement: Open 与 Design 必须分别形成受审查边界

Change Run MUST 把 Open 和 Design 实现为两个独立的受管阶段。Open 必须在核对仓库、现有规格和输入事实后创建或修复 proposal、delta specs、design、tasks 四类 OpenSpec 工件协议，经 Provider 确认各类为 `ready` 或依据官方 schema 规则为 `skipped`，并在严格校验后建立绑定其语义摘要的 Human Decision；只有可信批准才能进入 Design。Design 必须从已批准 Open 基线深化同一四类工件，经独立校验和第二个 Human Decision 批准后才能进入 Build。两个批准不得互相替代、合并或由 `auto_transition`、文件存在和 checkbox 状态推断。

#### Scenario: Open 四类工件通过严格校验

- **WHEN** Open Work 交付当前 schema 适用的官方工件，Provider 对四类协议均报告已满足且 strict validation 接受当前语义摘要
- **THEN** Runtime 在 Open 建立稳定 Human Decision 并停止；在收到绑定该摘要的可信批准前不得创建 Design Work或转换 phase

#### Scenario: Open 官方跳过 Delta Specs

- **WHEN** Provider 依据当前 schema 与 Change 元数据把 Delta Specs 规范化为带稳定 identity 的 `skipped`，其余适用工件为 `ready`
- **THEN** Runtime 把四类工件协议视为已满足并继续严格校验，不自行读取元数据、查找第四个文件或把 `skipped` 改写为 `missing`

#### Scenario: Open 被拒绝或要求修订

- **WHEN** 用户拒绝 Open proposal 或要求修订其中任一受控语义
- **THEN** Run 保持 Open、使过期 proposal hash 不可提交，并恢复或创建受管 Open Work，而不是进入 Design

#### Scenario: Design 深化同一 OpenSpec 工件

- **WHEN** 已批准 Open 进入 Design并补足工程边界、决策、验证策略或可执行 Tasks
- **THEN** Design 只更新同一 Change 的四类 OpenSpec 工件协议，严格校验后建立独立 Human Decision，不创建第五份 Design Doc、Build Plan、ADR 或 implementation notes

#### Scenario: 只有 Open approval

- **WHEN** Open approval 已接受但 Design Work、Validator 或 Design approval 任一缺失
- **THEN** Runtime 不得进入 Build，也不得把 Open approval 解释为整个规划阶段已获批
