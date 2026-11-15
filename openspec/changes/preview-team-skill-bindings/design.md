# 团队 Skill 预览设计

## Context

`lifecycle.skillBindings` 已经将团队 Skill 绑定到 Work。现有 `skill get` 查单个 Skill，运行时则统一解析来源、验证绑定并编译 Work 的有效 Skill 组合。Build Execute 还有由 TDD 模式决定的运行时方法层。

## Goals / Non-Goals

维护者可以在启动 Run 前查看当前 Workspace 配置会如何生效，并据诊断修复配置。Workspace 受管教程提供从创建 Skill 到预览和提交的示例。本 Change 的入口只服务工作流接入，IDE 手动调用属于独立需求。

## Decisions

- 使用 `repoctopus skill preview --workspace .` 提供终端视图和 `--json`。复用项目配置和生命周期定义的读取，以及现有 Provider 解析和组合编译。以查询所需的服务为装配范围，排除 Run Store、遥测、桌面和交付的启动路径。
- 展示 Work 顺序、层的实际装填位置、Skill 名称、角色、选中的 Provider、来源类别及绑定或 slot。区分绑定的 `order` 与最终装填位置。复用 `buildActionSkillComposition` 和动态方法层的插入规则，在 Build Check 显示追加的 `code-review`，在 Build Execute 显示 TDD 与 direct 两种结果。
- 将现有配置和组合错误映射为可定位的 CLI 诊断，采用非零退出码。预览输出包含必要的元数据，省略正文、资源和本机绝对路径。现有接入流程支持声明可执行的团队 Provider。若该 Provider 无法在只读装配中安全查询，命令应指出该 Provider 并停止，避免静默切换到其他来源。
- Workspace 教程用一个独特的 API 兼容性审查 Skill 演示 `build.check` 的 guidance。示例列出文件内容、应合并的 YAML、实际预览命令及提交清单。已有 Workspace 复用受管引导刷新。
- 验收用真实 CLI 在隔离 Workspace 比较预览与实际领取的 Work。使用无效配置核对退出码和错误定位，对比预览前后的文件与 Run 状态，并检查宿主 Skill 目录没有产生新文件。

## Risks / Trade-offs

预览发生在 Run 和具体 Work 形成之前。能由配置与定义推导出的 Skill 层需要和真实派发一致，取决于执行配置的层则要显示条件。诊断应给出用户可以修改的字段或绑定，同时保留原组合校验的拒绝语义。已有独立的 IDE 补装流程继续负责宿主文件。
