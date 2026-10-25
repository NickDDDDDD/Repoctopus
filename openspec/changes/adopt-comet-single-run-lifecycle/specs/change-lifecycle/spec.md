# change-lifecycle Delta

## ADDED Requirements

### Requirement: 阶段转换建立检查证据 epoch

Change Run MUST 维护从零开始且只由 Runtime 写入的 `checkEpoch`；每次接受 lifecycle transition 时必须与 phase/status 事实原子递增。阶段相关检查和验证结果必须绑定其启动 epoch，执行期间 epoch 改变或不可复用证据的 epoch 与当前值不一致时不得用于当前转换。

#### Scenario: 检查执行期间阶段改变

- **WHEN** 检查在 `checkEpoch=3` 启动，但完成前另一个合法转换把 Run 推进到 `checkEpoch=4`
- **THEN** Runtime 持久化该尝试及 `phase-changed` 失效原因，但不把结果接受为当前阶段证据

#### Scenario: Verify 失败回到 Build

- **WHEN** Verify Gate 失败并通过定义声明的转换回到 Build
- **THEN** 同一 `runId` 的 `checkEpoch` 递增，旧 Verify Evidence 保留审计但不能证明修复后的输入

#### Scenario: 可复用检查跨越阶段边界

- **WHEN** 检查被策略显式标记为 reusable，且命令、输入、环境、Provider 和证据摘要在新 epoch 下仍通过全部新鲜度校验
- **THEN** Runtime 可以记录复用事实；仅有 reusable 标记或旧成功结果不足以跨 epoch 接受证据

### Requirement: Open 与 Design 必须分别形成受审查边界

Change Run MUST 把 Open 和 Design 实现为两个独立的受管阶段。Open 必须在核对仓库、现有规格和输入事实后创建或修复 proposal、delta specs、design、tasks 四类 OpenSpec 工件，经严格 Provider 校验后建立绑定其语义摘要的 Human Decision；只有可信批准才能进入 Design。Design 必须从已批准 Open 基线深化同一四类工件，经独立校验和第二个 Human Decision 批准后才能进入 Build。两个批准不得互相替代、合并或由 `auto_transition`、文件存在和 checkbox 状态推断。

#### Scenario: Open 四类工件通过严格校验

- **WHEN** Open Work 交付四类官方工件且 Specification Provider strict validation 接受当前语义摘要
- **THEN** Runtime 在 Open 建立稳定 Human Decision 并停止；在收到绑定该摘要的可信批准前不得创建 Design Work或转换 phase

#### Scenario: Open 被拒绝或要求修订

- **WHEN** 用户拒绝 Open proposal 或要求修订其中任一受控语义
- **THEN** Run 保持 Open、使过期 proposal hash 不可提交，并恢复或创建受管 Open Work，而不是进入 Design

#### Scenario: Design 深化同一 OpenSpec 工件

- **WHEN** 已批准 Open 进入 Design并补足工程边界、决策、验证策略或可执行 Tasks
- **THEN** Design 只更新同一 Change 的四类 OpenSpec 工件，严格校验后建立独立 Human Decision，不创建第五份 Design Doc、Build Plan、ADR 或 implementation notes

#### Scenario: 只有 Open approval

- **WHEN** Open approval 已接受但 Design Work、Validator 或 Design approval 任一缺失
- **THEN** Runtime 不得进入 Build，也不得把 Open approval 解释为整个规划阶段已获批

### Requirement: 失败分类必须决定真实返工路径

Runtime MUST 根据持久化的有界失败分类和当前副作用边界选择 continuation；Host、Agent 与调用方不得直接指定目标 phase。普通实现失败、设计假设失效、规划语义漂移、验证行为失败、Evidence/基础设施失败、未知外部结果和 Archive 前置重验必须走 definition 声明的不同路径，并在同一 Run 中保留旧事实、失效不再适用的批准/claim/evidence并递增合法 transition 的 `checkEpoch`。

#### Scenario: Verify 发现实现行为失败

- **WHEN** Verify review 或 Gate 将失败分类为实现行为不满足当前批准规格
- **THEN** Runtime 记录失败 Evidence、重开有依据的 task revision、转换到 Build并创建真实 Repair Work，不只改变 phase 或等待旁路文件变化

#### Scenario: Verify 依赖暂时不可用

- **WHEN** 失败来自 Evidence Provider、命令环境或其他基础设施而未证明实现错误
- **THEN** Runtime 保持 Verify blocked/retry 或 reconcile，不重开 Build Task、不使 Design approval 失效

#### Scenario: Archive 前发现验证输入陈旧

- **WHEN** Archive 尚未开始规格关闭或外部 publication 副作用且当前 Verify identity 已失效
- **THEN** Runtime 回到 Verify并要求当前输入的新 Evidence；若副作用已经开始，则保持 Archive并从稳定 Journal reconcile而不回滚 phase

## MODIFIED Requirements

### Requirement: 每个活动 Change 使用唯一权威 Run

Repoctopus MUST 为一个 Workspace 中的一个 change 建立至多一个权威 Change Run，并由稳定 `runId` 和该 Run 的版本化事实唯一表达阶段、执行状态、当前工作、等待条件、阻塞原因和合法下一步；调用方不得提供 lifecycle generation 或选择替代 Run，Specification、Delivery、CLI、Dashboard 和 Telemetry 不得建立平行的 change 生命周期。

#### Scenario: 两个 Runner 同时启动同一 Change

- **WHEN** 两个 Runner 使用相同 Workspace 和 change 请求开始或恢复工作
- **THEN** RunStore 通过稳定 runId 和 CAS 只保留一个权威 Change Run，两个请求获得同一快照或明确的 revision conflict

#### Scenario: 重复启动携带不同语义输入

- **WHEN** 已有 Run 的固定 definition、Specification Root、仓库拓扑或目标分支与新的启动请求不同
- **THEN** Runtime 返回 `RUN_CONFLICT` 或 `migration_required`，不得创建第二个 generation 或静默替换原输入

#### Scenario: 展示端尝试推断阶段

- **WHEN** Dashboard 或 CLI 从目录、Git 分支或 MR 状态推断出与 Change Run 不同的阶段
- **THEN** 展示端只报告 Run 投影和可定位的数据新鲜度诊断，不把推断结果写回领域状态

### Requirement: 生命周期回退保留审计历史

Design revision、规划语义漂移、Verify 失败、实现输入漂移和 Archive 前置验证失效 MUST 在同一 Run 中通过追加 invalidation、递增 `checkEpoch` 与定义声明的回退转换处理；旧批准、Task Outcome、Evidence 和 Receipt 必须保留但不得用于不匹配的新输入，普通回退不得创建替代 Run。外部或规格关闭副作用开始后的 Archive 不得回滚，只能 reconcile。

#### Scenario: Verify 发现实现失败

- **WHEN** 完整 verification input 下的阻断 Gate 不满足
- **THEN** 同一 Run 记录失败 Evidence、递增 epoch 并回到 Build 或进入 Build blocked，旧 Gate 不可用于后续修复输入

#### Scenario: Build 中修改规划语义

- **WHEN** Tasks 文字、结构、需求映射或其他规划产物语义变化
- **THEN** Runtime 在原 Run 中使旧 Design approval 和受影响 Work 失效、递增 epoch 并返回 Design

### Requirement: 旧状态迁移必须显式且可证明

Repoctopus MUST 将预发布 lifecycle generation、generic Run、旧 Delivery 和旧 Post-merge 状态视为只读历史，不得双读、双写、自动升级或继续执行；新协议只在稳定 Workspace/change 身份尚无当前 Run 时创建单一 Run。新协议 Run 的 definition、composition 或 Provider 不兼容时必须原地进入 `migration_required` 或经显式操作终结，旧事实和外部 Receipt 不得删除或伪造。

#### Scenario: 发现预发布 generation 文件

- **WHEN** 新 Runtime 扫描到旧 `.repoctopus` 中带 generation 的 Run、Publication 或 Journal
- **THEN** 当前 Change locator 忽略其执行资格并可报告只读 legacy 诊断，但不改写文件、不继续旧 Run且不要求调用方选择下一代次

#### Scenario: 当前 Run 的固定定义不兼容

- **WHEN** 唯一权威 Run 的 definition、composition 或 Provider 快照无法按声明兼容
- **THEN** 同一 Run 进入 `migration_required` 并保留精确差异，不创建替代 Run或重放外部副作用

#### Scenario: 活动 Post-merge 状态可唯一映射

- **WHEN** 旧状态具有唯一 change、完整 MR 集合、精确 merge facts、Provider 身份和下一收尾动作
- **THEN** 新 Runtime 只报告可核对的 legacy audit 投影，不创建新 Change Run、不继续旧副作用，并要求后续工作以普通新 Change 表达

#### Scenario: 两套状态给出不同下一动作

- **WHEN** 旧 Delivery 与 Post-merge 状态对同一 change 的 MR 集合或下一动作不一致
- **THEN** legacy audit 返回 `migration_required` 和精确差异，不启动新副作用、不创建替代 Run且不选择其中一套覆盖

### Requirement: Completion Claim 与验证事实分离

Change lifecycle MUST 区分 pending Task、Runtime Work Outcome 形成的 completion claim 与可信用户在同一 Run 内批准的 `adopt-existing` completion claim；fresh 启动只接受当前 Run 的 Runtime Work completion，发现预先勾选且没有当前 Work Outcome 的 Task 时必须阻断并建立稳定 Human Decision，决定采用既有实现或恢复为 pending。任何 claim 都只允许结束或跳过 Build 调度，不得作为 Acceptance Evidence、Verify Gate 或 Archive 资格。

#### Scenario: 已实现 Change 首次进入 Runtime

- **WHEN** 用户为已获批且 Tasks 已勾选的 Change 启动唯一 Run，并批准采用既有实现边界
- **THEN** Runtime 在同一 Run 记录带来源摘要的 imported claims、避免重复派发 Build，并进入仍需完整 Acceptance Evidence 的 Verify

#### Scenario: Fresh Change 出现预先勾选任务

- **WHEN** fresh Run 读取到已勾选但没有当前 Run Work Outcome 的 Task
- **THEN** Runtime 保持 Build waiting 或 blocked，公开稳定采用决定或恢复任务状态的 continuation，不创建另一 Run

#### Scenario: Agent 只勾选全部 Tasks

- **WHEN** Agent 更新 checkbox 但没有产生当前 Work completion、可信采用决定和满足 Acceptance coverage plan 的 Receipt
- **THEN** Runtime 不得完成 fresh Build、越过 Verify 或进入 Archive

### Requirement: 预发布旧执行协议不得形成兼容债务

Repoctopus MUST 破坏性替换尚未正式发布的 generation、Open 自动推进、不可达 Work 和旧 claim/attempt 协议，删除其生产分支与兼容 fixture；旧开发 Run MAY 保留为只读审计文件，但新 Runtime 不提供 generation 参数、双读、双写、fallback Adapter 或旧 schema 执行路径。

#### Scenario: 加载旧 G1 bootstrap Run

- **WHEN** 旧 Run 的 identity 含 generation、会自动越过 Open 或缺少受管 Work 执行事实
- **THEN** Runtime 不把它解析为当前 Change，不执行旧路径，并允许新协议用稳定 Workspace/change 身份建立唯一 Run

### Requirement: 五阶段必须留下可核对的推进依据

Change Run MUST 为 Open、Design、Build、Verify 和 Archive 的每次前进记录对应 Work Outcome 与 Validator、Human Decision 或阶段专属确定性事实；仅观察到目标文件、checkbox、Git commit 或最终成功状态不得反推前一阶段已按流程执行。

#### Scenario: 最终仓库内容看似正确

- **WHEN** 仓库已有完整规划和实现，但 fresh Run 没有 Open、Design 或 Build 执行事实
- **THEN** Runtime 不得合成这些阶段的成功历史，并要求执行当前阶段 Work 或在同一 Run 提交可信 adopt-existing 决定

#### Scenario: 真实纵切完成

- **WHEN** 每个阶段的推进依据都属于相同 runId、对应 checkEpoch 和当前输入
- **THEN** projection 与 Trajectory 能按顺序定位 Work、决定、Validator 和 transition，不依赖事后目录推断
