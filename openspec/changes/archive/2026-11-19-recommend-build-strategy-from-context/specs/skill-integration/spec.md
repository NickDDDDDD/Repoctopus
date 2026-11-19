## ADDED Requirements

### Requirement: 入口和 Design Skill 按真实任务场景推荐执行策略

Repoctopus 的入口与 Design Skill MUST 引导 Host 核对当前 Change 的受影响范围、任务依赖、可委派边界、实际宿主能力及测试切面，分别解释 execution mode 与 TDD mode 的建议，并保留当前明确用户偏好。建议 MUST 在 Design 决定前可见，不得以仓库总数、任务数量或固定默认值替代分析。Host MUST 只通过当前 Work 的受管 Outcome 提交建议，不获得决定阶段、冻结配置或绕过审批的权限。

#### Scenario: 多仓 Workspace 只改一个紧耦合功能

- **WHEN** Workspace 登记多个仓库，但本次工作范围小、耦合强或缺少可独立委派边界
- **THEN** Host 可以推荐 autonomous，说明实际范围和选择理由，不仅因 Workspace 多仓而强制多 Agent

#### Scenario: 有明确可并行或分工边界

- **WHEN** 经代码与 Tasks 核对，工作可按清晰契约分为独立责任边界，且存在支持受管委派的宿主
- **THEN** Host 可以推荐 subagent-driven-development，并说明边界、依赖与委派能力依据；建议本身不构成已派发或已执行证明

#### Scenario: 行为变更或可复现缺陷

- **WHEN** 当前任务改变可观察行为，或具有可表达的缺陷回归条件
- **THEN** Host 通常推荐 tdd，指明可验证的行为与测试入口；缺少测试基础设施时展示需要补齐的条件，不把缺测试静默等同于无需测试

#### Scenario: 无可执行行为的文档修改

- **WHEN** 当前任务仅改文档等无可执行行为内容，核对后没有适用的失败行为测试
- **THEN** Host 可以推荐 direct 并解释原因，仍保留适用的内容校验、回归、Build Check 和 Verify，不伪造 RED/GREEN 证据

#### Scenario: 两个配置轴独立

- **WHEN** 当前场景适合多 Agent 分工，但不适合行为测试先行，或适合单 Agent 实施且需要缺陷回归
- **THEN** Host 分别解释 subagent-driven-development + direct 或 autonomous + tdd 的建议，不把执行模式绑定到固定 TDD 选择

#### Scenario: 执行阶段消费已冻结选择

- **WHEN** 当前 Design 与策略已获可信批准，Runtime 派发 Execute Work
- **THEN** Host 消费 Runtime 按冻结策略装填的 Action 与方法 Skill，只有 tdd 模式装填 TDD augmentation，且真实委派和测试证据仍由原有执行协议校验
