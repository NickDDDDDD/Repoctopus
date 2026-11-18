# Proposal

## Why

当前入口未指定执行策略时，CLI 和 Service 会在 `run start` 把 `autonomous + tdd` 写成完整偏好；Design 审批和 Build Configure 随后复用该值。用户无法分辨这是结合任务场景作出的建议，还是未审查的默认值；多 Agent 与 TDD 的实际能力约束虽然存在，选择过程却没有接通。

## What Changes

- 在 Design 审批前，由当前 Host 根据已核对的任务范围、依赖、可委派边界、宿主能力和测试切面，分别推荐执行模式与 TDD，并说明依据；Runtime 校验并将最终选择绑定到当前 Design 决定。
- **BREAKING**：未提供执行模式或 TDD 的启动请求不再隐式冻结默认策略。明确输入只表达本次偏好，不能单独代替可信批准；缺项由受管 Design 路径补齐，不能阻止正常 Open。
- 保持现有两种执行模式与两种 TDD 选择、固定审查要求及五阶段协议。正常流程沿用 Open 和 Design 两次审批，不增加常规 Build 配置批准。
- 保留 Strategy 与机器 Binding 分离：Build Configure 核验真实能力及隔离绑定，冷恢复复用原选择；实际能力不满足时阻断，不静默换模式。
- 对齐入口、阶段 Skill、CLI 帮助和 Workspace 内教程，并用真实安装包多仓 Change 验证选择、执行、冷恢复及归档。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：补齐未决偏好、可审查建议、最终策略批准与冻结之间的生产流程。
- `skill-integration`：入口与 Design Skill 根据真实场景解释并推荐两个独立配置轴，执行仍消费 Runtime 冻结的当前 Skill 组合。

## Impact

- 涉及 `app/cli/main.ts`、`services/workflow-runs.ts`、Build Strategy/配置与生命周期决定协议，以及入口和 Design/Configure Skill。
- 更新相关 CLI 文档、Workspace 教程与执行配置说明；不新增配置中心、规划文档或遥测体系。
- 本次交付从公开入口到 Design 决定、Build Configure 与实际执行的完整切片；不新增执行模式、Hotfix profile、自动模式升级、团队策略语言或复杂度评分器。
- 参考固定 Comet 0.5.1 与本次核对的上游 0.5.5，采用其 Host 提案、Runtime 校验、当前决定绑定及恢复思想；不引入其 SDK、Superpowers 工作流或新依赖，不更新产品上游固定版本。沿用现有参考来源和许可证管理，若实施直接采用源码片段则同步 provenance 与必要声明。
