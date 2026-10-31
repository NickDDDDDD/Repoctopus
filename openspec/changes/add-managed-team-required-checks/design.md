# Design

## Context

当前 `LifecycleExtensions` 能注册、安全检查和快照 Contributor，但 WorkflowRuns 尚未把 `extension.works` 和 `validations` 物化到生产调度。现有核心 Work 已具备 claim、packet、Host、Outcome、Validator 与 Evidence 链，可直接承载团队检查。

## Goals / Non-Goals

- 在 definition 安全 checkpoint 调度团队检查，并让失败可靠阻断后续核心 Action。
- 复用现有 Run 和受管 Work 协议，保持核心 Runtime-authoritative。
- 不允许 Extension 创建 phase、transition、审批旁路或额外执行循环。

## Decisions

### 1. Required check 是独立 Work

Compiler 将 binding 与已准入 Extension/Validator contract 结合，产生稳定 check identity、checkpoint、capability、side-effect class、write scope、output schema 和依赖。核心 scheduler 在到达 checkpoint 时物化普通 `WorkDescriptor`；检查与核心 Action 使用同一 Dispatcher 和 Execution Authority。

### 2. Checkpoint 由 definition 白名单控制

团队只能选择 definition 已声明的 extension checkpoint。Extension 不返回目标 phase，只返回结构化 Outcome。核心 lifecycle handler 聚合必需检查结果，并决定继续、重试、回到 Build 或失败。

### 3. Contributor 在执行前准入

Plugin Descriptor 在模块执行前声明包身份、契约版本、配置 Schema、capability、side effect、write scope、Outcome/Validator schema、代码摘要和兼容范围。只有共享配置引用的 Contributor 进入有效组合和 Run snapshot；仅安装不会改变活动 Run。

### 4. 恢复与卸载 fail closed

未完成检查恢复时必须解析同一或显式兼容 Contributor。删除或不兼容升级进入 drift/migration 诊断；已领取 Work 在终止或完成前不卸载其执行依赖。原 Evidence 保持只读。

### 5. 观测语义保持独立

Trajectory/OTLP 记录 check scheduled/claimed/completed/validated/gate blocked，关联 checkpoint、Work、Contributor 与有界结果。Desktop 把 required check 显示为当前 checkpoint 的独立卡片，不伪装成核心 Action 或新 phase。

## Multi-Repository and Recovery

检查的 repository selector 与 write scope 经核心 materializer 展开；共享身份不包含绝对路径。测试覆盖单仓、多仓、重启、Contributor 漂移和检查失败后的精确重试。

## Stop Conditions

- 检查需要直接触发 phase transition 或修改核心 Gate；
- 插件 Descriptor 无法在执行模块前完成静态准入；
- 检查需要超出 definition 白名单的 write scope 或未知副作用。
