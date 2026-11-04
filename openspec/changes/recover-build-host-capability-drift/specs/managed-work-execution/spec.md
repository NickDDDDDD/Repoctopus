# managed-work-execution Delta

## MODIFIED Requirements

### Requirement: Build Configure 产生可批准的不可变配置

Runtime MUST 从已通过 Design Human Decision 的版本化 `BuildStrategy` 读取 execution/TDD/review/isolation intent，并根据当前 Run、仓库拓扑、隔离事实与协调 Host identity 解析独立 `ExecutionBinding`。Binding MUST 固定 repository、branch、初始 head、worktree ownership、可移植 semantic digest 和只在本地保存的 path/local overlay，但 MUST NOT 把任一 Work invocation 的 capability list或 digest作为跨 Work 语义身份。Configure Host MUST 在 claim 前满足当前 `build.configure` Work 的 capabilities；未来 Plan、Execute和Check MUST 分别按自己的 Work capabilities执行claim preflight。

#### Scenario: Configure 只验证当前 Work 和 Workspace Binding

- **WHEN** Host满足 `build.configure` 的读取、Strategy协调和Workspace观察能力，但没有为当前claim声明未来Execute所需的写入能力
- **THEN** Runtime可以验证并接受ExecutionBinding；该接受不授予未来Work权限，也不保证下一Work已有兼容Host

#### Scenario: 多仓任务选择 subagent 模式

- **WHEN** 任务可按仓库和依赖边界形成Work Package，用户在Design approval中接受subagent Strategy，Configure Host满足当前协调Work的能力
- **THEN** Runtime固定该Strategy并把模式绑定全部Build Action；Configure只验证当前Work和实际ExecutionBinding，不授予后继Work能力

#### Scenario: Host 不支持批准配置

- **WHEN** 当前Host不满足当前Build Work的capability contract
- **THEN** Runtime在持久化claim和副作用前等待兼容Host，不静默降级Strategy；只有请求改变策略语义时才需要新Human Decision

#### Scenario: 多仓 isolation binding 通过验证

- **WHEN** Runner为批准的current、branch或worktree intent提供受影响仓库的本地checkout facts
- **THEN** Runtime以稳定repository identity、branch、初始head、worktree identity和Workspace ownership验证Binding；绝对路径只保存在本地Run overlay

#### Scenario: 绑定变化但策略未变

- **WHEN** 同isolation intent下coordinator Host、checkout、初始HEAD或本机路径发生兼容变化
- **THEN** Runtime生成新Binding identity、使依赖旧Binding-owned输入的Plan/Evidence失效并自动重验，不创建Build Strategy approval

#### Scenario: 下一 Work 暂时没有兼容 Host

- **WHEN** ExecutionBinding有效且Runtime已派发`build.execute`，但当前Host声明的能力不覆盖该Work requirements
- **THEN** Runtime在持久化claim和invocation前返回结构化capability blocked continuation，保留当前Work和Binding，不返回Configure、不降级Strategy

#### Scenario: Binding-owned事实变化

- **WHEN** coordinator Host identity、repository topology、branch/worktree ownership、isolation或local overlay发生变化
- **THEN** Runtime按现有精确失效规则派发Build Configure revalidation；当前Work capability声明不同本身不得触发该路径

### Requirement: Plan Evidence 在执行前证明计划可行

Runtime MUST 在创建Execute Work前验证BuildPlan对批准Tasks、验收、仓库拓扑、依赖、repository/write scope、terminal report ownership、ExecutionBinding、有效Skill composition和BuildStrategy的完整覆盖，并持久化绑定当前输入的Plan Evidence。Evidence MUST验证每类后继Work声明了所需capability contract，但MUST NOT把某次Plan或Configure invocation的Host capability digest作为Execute可用性的长期证明；实际Host availability只在对应Work claim时验证。

#### Scenario: 低风险计划声明完整Execute能力合同

- **WHEN** Plan覆盖全部Task和验收、仓库边界与write scope合法，并且派生Execute Work声明其repository/process能力
- **THEN** Runtime接受Plan Evidence并创建第一个就绪Execute Work；Host是否可领取由该Work的claim preflight决定

#### Scenario: 低风险计划自动通过

- **WHEN** Plan Validator证明全部Task/acceptance、仓库边界、write scope、报告归属、后继Work capability contract、Binding和composition被覆盖，且风险策略不要求暂停
- **THEN** Runtime接受Plan Evidence并生成第一个就绪Execute Work，不创建虚假人工审批

#### Scenario: 计划的 write scope 与任务不一致

- **WHEN** Work Package请求写入未被Task、definition或目标仓库允许的路径
- **THEN** Plan Evidence返回结构化planning finding并留在Plan revision，不等到Execute工具调用后才失败

#### Scenario: 计划触发可选人工暂停

- **WHEN** 计划包含definition声明的高风险副作用、跨仓不可逆顺序或其他暂停条件
- **THEN** Runtime建立绑定Strategy、Binding与plan digest的Human Decision，在可信决定前不创建Execute Work

#### Scenario: 计划输入漂移

- **WHEN** Tasks、验收、仓库拓扑、Strategy、Binding-owned facts、Skill composition或计划identity与Plan Evidence输入不一致
- **THEN** Runtime使旧Evidence失效并按变化权威返回Plan revision、Design或`migration_required`；当前Work Host capability list不同不得单独触发该失效

#### Scenario: Plan遗漏后继Work能力合同

- **WHEN** Plan或Work派生规则无法为某个有副作用package确定完整required capabilities
- **THEN** Plan Evidence在创建Execute Work前fail closed并返回结构化finding，不从Configure Host的历史能力推断缺失值

#### Scenario: Plan invocation能力与Configure invocation不同

- **WHEN** 合法Plan claim只声明当前只读Work所需能力，且其coordinator Host identity与ExecutionBinding一致
- **THEN** Runtime按原claim验证并接受Plan candidate，不使Binding或Plan Evidence仅因能力集合不同而失效

### Requirement: BuildStrategy 与 ExecutionBinding 使用独立身份

Repoctopus MUST分别持久化可移植`BuildStrategy`和本机可重建`ExecutionBinding`，并让Work input同时引用两者。Strategy变化表示人/团队语义变化；Binding变化表示Workspace、repository、branch/worktree ownership、local overlay或声明的协调Host identity变化。Runtime MUST使用不同digest、Validator和失效规则处理二者；ExecutionBinding MUST NOT拥有跨Work Host capability snapshot，本机绝对路径也不得进入Strategy、OpenSpec工件、共享配置摘要或OTLP。

#### Scenario: 相同 Strategy 在另一台机器恢复

- **WHEN** 同一Run在具有兼容coordinator Host和仓库checkout的另一台Runner恢复
- **THEN** 已批准Strategy保持有效，Runtime为新机器验证新Binding；每个后继Work仍独立执行capability preflight

#### Scenario: 同一协调Host执行不同Work

- **WHEN** 相同coordinator Host ID依次领取Configure、Plan、Execute和Check，并且每次只声明当前Work要求的能力
- **THEN** Runtime分别验证四次claim，不把前一次capability list冻结为后续Work必须重复的Binding identity

## ADDED Requirements

### Requirement: Host capability 必须以当前 Work 为作用域

Runtime MUST把当前不可变Work声明的required capabilities作为Host claim能力的唯一权威。Host MUST明确声明本次claim可用能力；Runtime MUST在持久化claim、packet ownership或Host invocation前验证完整覆盖。Outcome acceptance MUST绑定原`runId`、`workId`、attempt、`checkEpoch`、claim token、packet digest、invocation和submission identity，MUST NOT用Configure invocation或其他Work的capability list重新判断原claim合法性。

#### Scenario: 只读Plan Host合法领取当前Work

- **WHEN** 当前Work是`build.plan`，Host满足该Work声明的Strategy、repository read和specification read能力
- **THEN** Runtime持久化唯一claim和invocation；Host不需要为本次claim重复声明`repository.write`或`process.execute`

#### Scenario: 能力不足在claim前失败

- **WHEN** Host缺少当前Work任一required capability
- **THEN** Runtime返回结构化`capability-required`或`executor-required` continuation，不持久化claim、invocation或伪造Binding drift

#### Scenario: 合法Plan submission进入原validator

- **WHEN** 只读Plan Host使用原claim identity提交结构化candidate
- **THEN** Runtime直接执行当前Plan result validator；它不得创建Configure Work、新Plan Work或因Configure invocation能力更多而拒绝submission

#### Scenario: 已claim外部Work结果未知

- **WHEN** Runtime已持久化Host invocation但无法确认外部执行结果
- **THEN** Runtime保留原claim、packet和invocation并reconcile原Work；没有权威未执行证据时不得重配Binding、新建attempt或重放副作用

#### Scenario: 可纠正candidate与未知执行保持不同状态

- **WHEN** Runtime收到确定的Host Outcome但candidate validator拒绝其内容
- **THEN** Runtime沿用同一claim/attempt/invocation的correction协议接收新submission identity；该状态不得被误投影为unknown execution或Binding drift
