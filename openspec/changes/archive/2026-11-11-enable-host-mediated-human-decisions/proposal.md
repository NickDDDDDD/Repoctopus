# Proposal

## Why

当前 Open、Design 等生命周期人工决定已经生成有效请求，但公开 `run decide` 只接受交互式终端，Host 无法把宿主原生问答中的真实用户选择提交给 Runtime。用户因此被要求离开 Agent 对话手工执行命令；升级版本也不能补齐这条交互链路。

## What Changes

- 提供同一 Run 当前 Human Decision 的只读结构化交互材料，以及绑定该请求的公开 Host-mediated 决定提交入口。
- 采用 Comet 的职责分工：Host 收集真实用户选择，Runtime 验证当前请求、提案身份、规划事实与决定边界并推进；非交互命令本身不构成用户授权。
- 优先使用宿主原生结构化提问工具；工具不可用时在对话中展示明确选项并等待答复。没有可用用户交互上下文时保留交互式终端回退。
- 第一条可交付纵切覆盖 Open 与 Design 两个独立审批，以及 Open 的 isolation 选择；同一 `run decide` 已支持的执行意图修订与 Build Plan 风险审批沿用一致的交互材料和提交路径。
- 保留阶段边界、Provider 严格校验、授权检查及真实选择来源记录；覆盖过期请求、不同提案、冲突决定、重复提交和中断后的结果核对。
- 更新 lifecycle Action 与公开使用指南，区分禁止 Agent 自行批准和允许 Host 传递真实用户决定。增加真实安装包、多仓和宿主交互验收。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：生命周期人工决定支持宿主交互与正式回传，保持现有阶段转换和终端回退。
- `specification-authority`：Open／Design 的宿主回传绑定当前规划提案，并保留 Provider 重验及独立批准边界。

## Impact

- 影响公共 CLI、Run 的只读交互视图、Human Decision 提交协调、相关类型与审计记录、lifecycle Skill 和使用文档；复用 Cordis Command Router、Specification Planning 与现有 Run 持久化边界。
- 不新增阶段、Work kind、Runtime、守护进程、审批服务器或专用 IDE SDK。Desktop／OTLP 仍是观测来源，不作为审批凭据；项目接入、旧 delivery 审批入口及其他未归档提案不纳入本次改造。
- 参考固定 Comet 0.5.1 的决策点 Skill、公开决定命令与 Runtime Wait 解析方案，适配 Repoctopus 多仓身份与规划权威；不引入 Comet SDK 或新的第三方实现依赖。行为参考继续记录来源与 MIT 许可证边界。
- 后续是否扩展到其他审批入口另行评估；本 Change 的完成不声明所有 IDE 已具有独立认证插件，也不把模拟问答当作真实宿主验收。
