## MODIFIED Requirements

### Requirement: 主视图呈现完整五阶段与 Build 子动作

桌面应用 MUST 以 `Open → Design → Build → Verify → Archive` 五阶段作为当前 Change 的主体导航，清楚区分当前阶段和它的已观察状态。阶段详情 MUST 保留进入时间、尝试及可信可用的持续时间。处于 Build 时 MUST 能查看 `Configure → Plan → Plan Evidence → Execute → Check`，以及当前 Work、Task、attempt、Host、Validator、Runtime continuation 和最近活动。其他阶段默认折叠 Build 历史。

#### Scenario: Change 正在 Build Execute

- **WHEN** 投影收到已完成 Open/Design、已完成 Build Configure/Plan/Plan Evidence 和当前 Execute Work 的权威事实
- **THEN** 主视图标识 Build 为当前阶段和 Execute 为当前动作，并能从详情查看当前 Task、Work attempt、Host、Validator 和 Runtime continuation

#### Scenario: Verify 发现问题并返回 Build Plan

- **WHEN** 投影收到 Verify finding、受影响 Plan Evidence 失效和 Runtime 选择返回 Build Plan 的权威事实
- **THEN** 主视图标识当前 Build 返工和回退的来源与去向，保留已观察的 Verify 尝试、有界 finding 类别和仍有效的完成事实

#### Scenario: Build 子动作尚未上报

- **WHEN** 当前 Run 只上报 Build 阶段而没有可信的 Build action
- **THEN** 主视图显示当前处于 Build 且子动作尚无可信观测

## ADDED Requirements

### Requirement: 首屏说明当前工作和开发者的下一步

桌面应用 MUST 使用收到的同一 Run 的阶段、生命周期、等待、恢复和观测新鲜度解释当前状态与下一步。审批、执行、外部等待、阻塞、返工、终态和不完整数据 MUST 有可区分的文案及适用的操作指引。缺少证据的进度、审批主体、发布结果和详情保持未知。

#### Scenario: 通过现有宿主审核设计

- **WHEN** 当前 Run 在 Design 有权威的待处理审批请求
- **THEN** 首屏说明需要审核的内容及批准后的步骤，提供复制给 Agent 的定位信息，保留现有宿主的审批入口与 Runtime 校验

#### Scenario: 同一 Run 批准后进入 Build

- **WHEN** Runtime 接受原请求中的用户决定并上报新的 Build 事实
- **THEN** 界面即时更新当前阶段和工作提示，已结束的审批入口从首屏移除

#### Scenario: 当前 Run 执行中

- **WHEN** 投影收到当前 Work 或已批准的策略和进度事实
- **THEN** 首屏展示已经证实的工作与策略。工作包总数与完成数都有依据时展示数量进度，当前 Skill 摘要可展开查看来源与消费证明

#### Scenario: 归档或恢复仍在等待外部结果

- **WHEN** Work 已完成但 Runtime 正在等待外部确认、核对发布结果、或仍未接受 Run 终态
- **THEN** 界面说明当前等待与后续路径，仅在 Runtime 上报终态后显示 Run 完成

#### Scenario: 观测存在缺口或过期

- **WHEN** 当前 Run 的本地观测无法确认完整性或时效
- **THEN** 界面说明最后确认的阶段和时间，待处理决定引导宿主核对当前请求，历史状态不能冒充当前已确认状态

#### Scenario: 同一 Change 有多条 Run

- **WHEN** 多条活动或历史 Run 使用相同的 Change ID
- **THEN** 用户可区分和切换这些 Run，新观测到达时保留用户的有效选择
