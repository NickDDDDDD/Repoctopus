# 预览团队 Skill 的工作流绑定

## Why

团队可以用共享 YAML 将自定义 Skill 绑定到 Work，但目前只有单个 Skill 的查询入口。维护者在启动 Run 前需要知道配置最终会解析成什么、具体影响哪些 Work，以及错误应在哪修复。初始化生成的本地教程也缺少一套可以照做的示例。

## What Changes

- 新增启动 Run 前的只读预览，按 Work 列出 Skill、实际来源和装填顺序。对随执行配置变化的 Skill 显示条件。
- 返回可定位的配置错误，覆盖无效绑定、未知 Work 或 slot，以及当前环境无法加载或不允许参与团队生命周期的 Skill。
- 在生成的 Workspace 教程里串起 Skill 文件、共享 YAML、预览和团队提交，并说明如何刷新已有引导。

## Capabilities

### Modified Capabilities

- `skill-integration` 提供共享配置下的有效 Skill 组合预览。
- `project-configuration` 为 Workspace 本地引导提供完整的团队 Skill 示例。

## Impact

涉及 Repoctopus CLI、现有 Skill 组合服务和 Workspace 教程模板。团队继续使用 `lifecycle.skillBindings` 和当前 Skill Provider。IDE 手动安装和调用属于后续可独立交付的需求。
