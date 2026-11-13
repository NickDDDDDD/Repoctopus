## Context

Comet 将静态阶段 Skill 与所选外部方法安装到宿主目录，由 Runtime 指定当前 Action。Repoctopus 已有按宿主安装 Workspace 入口的审批及恢复机制，也已有冻结 Work packet、团队 binding 和 OpenSpec Provider 工件协议。阶段正文现由 Work packet 直接交付。

## Goals / Non-Goals

**Goals**

- 初始化后可在已选择的 IDE 中发现项目级工作流 Skill。
- 在能确认实际来源和内容的宿主中减少重复传输，并在切换进程和版本变化时保持同一 Work 身份。

**Non-Goals**

- 扩大 Matt 工作流方法集合、任意替换阶段 Action、复制 OpenSpec 规划权威或在业务仓批量安装 IDE 文件。
- 改动 Verify Profile 的单独配置流程。

## Decisions

1. 复用 Workspace 入口的宿主路径、接入候选和批准范围。静态资产由 Repoctopus Action、已采用的 Matt 方法及所用 OpenSpec Provider 提供，维护各自来源和版本。补装沿用 Workspace 接入的只补 Skill 能力。
2. 保留 Runtime 已冻结的组合、正文、资源和消费回执身份。在领取的宿主交付边界选择引用或完整正文，回退沿用原 Work。引用绑定来源及正文、资源身份，当前 Action 仍由 Runtime 选择。
3. 仅按 Skill 名称调用而无法确认实际读取来源的宿主，使用现有正文交付。项目文件经过校验、宿主实际使用该内容后才回报当前层已消费。
4. OpenSpec 动态路径、模板与操作约束继续作为当前 Work 的 Provider 层交付。静态 Skill 作为项目工具入口。

## Risks / Trade-offs

- IDE 的同名解析和来源可见性不同。验收逐宿主核对并报告实际使用的交付方式。
- Git 行尾、工作区链接、本地修改和资源缺失可能影响同一内容的判定。设计阶段明确规范化与资源校验规则，验收覆盖回退与冷恢复。
- 当前 Change 以未合入的宿主扩展为基底，同时包含最新 main 的 Windows 安装修复。两项交付按依赖顺序处理。
