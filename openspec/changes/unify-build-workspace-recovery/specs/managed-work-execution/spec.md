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

- **WHEN** 批准的执行意图与当前 Run 证据能证明，同isolation intent下coordinator Host、checkout、初始HEAD或本机路径发生已授权的兼容变化
- **THEN** Runtime生成新Binding identity、使依赖旧Binding-owned输入的Plan/Evidence失效并自动重验，不创建Build Strategy approval

#### Scenario: 下一 Work 暂时没有兼容 Host

- **WHEN** ExecutionBinding有效且Runtime已派发`build.execute`，但当前Host声明的能力不覆盖该Work requirements
- **THEN** Runtime在持久化claim和invocation前返回结构化capability blocked continuation，保留当前Work和Binding，不返回Configure、不降级Strategy

#### Scenario: Binding-owned事实变化

- **WHEN** coordinator Host identity、repository topology、branch/worktree ownership、isolation或local overlay发生变化，且批准的执行意图与当前 Run 证据证明变化属于已授权兼容重绑定
- **THEN** Runtime按现有精确失效规则派发Build Configure revalidation；当前Work capability声明不同本身不得触发该路径

#### Scenario: 未授权 checkout 漂移不得触发重新绑定

- **WHEN** 实际分支、路径、worktree、远端或仓库集合偏离已接受 Binding 的执行边界，且当前 Run 没有可核对的授权证据
- **THEN** `run resume` 与 `run next` 均保留原 Binding、Plan、已完成工作包和当前执行记录并阻断继续执行，不以 Configure 自动接受当前 checkout
