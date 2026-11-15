# 团队 Skill 预览设计

## Context

`lifecycle.skillBindings` 已经将团队 Skill 绑定到 Work。现有 `skill get` 查单个 Skill，运行时则统一解析来源、验证绑定并编译 Work 的有效 Skill 组合。Build Execute 还有由 TDD 模式决定的运行时方法层。

## Goals / Non-Goals

维护者可以在启动 Run 前查看当前 Workspace 配置会如何生效，并据诊断修复配置。Workspace 受管教程提供从创建 Skill 到预览和提交的示例。本 Change 的入口只服务工作流接入，IDE 手动调用属于独立需求。

## Decisions

- 以 `repoctopus skill preview --workspace .` 为候选命令，提供终端视图和 `--json`。命令读取当前 Workspace 与同一生命周期定义，复用现有 Provider 解析和组合编译。
- 展示 Work 顺序、层的实际装填位置、Skill 名称、角色、选中的 Provider、来源类别及绑定或 slot。区分绑定的 `order` 与最终装填位置。运行时条件层沿用同一方法选择规则，直接显示 Build Execute 在 TDD 和 direct 下的差异。
- 预览阶段只查询有效定义和 Skill 资料，诊断沿现有 CLI 约定返回。预览输出使用必要的元数据，避免把正文、资源和本机绝对路径带入机器输出。
- Workspace 教程用一个独特的 API 兼容性审查 Skill 演示 `build.check` 的 guidance。示例列出文件内容、应合并的 YAML、实际预览命令及提交清单。已有 Workspace 复用受管引导刷新。
- 验收用真实 CLI 在隔离 Workspace 比较预览与实际领取的 Work；用无效配置核对退出码和错误定位，同时检查预览前后工作区和 Run 状态。

## Risks / Trade-offs

预览发生在 Run 和具体 Work 形成之前。能由配置与定义推导出的 Skill 层需要和真实派发一致，取决于执行配置的层则要显示条件。诊断应给出用户可以修改的字段或绑定，同时保留原组合校验的拒绝语义。已有独立的 IDE 补装流程继续负责宿主文件。
