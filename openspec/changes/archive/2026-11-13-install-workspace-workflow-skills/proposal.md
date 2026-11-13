## Why

Workspace 初始化已能安装工作流入口，但阶段 Skill 正文与资源仍在每次 Work 领取时随 JSON 重复交付，IDE 也不能直接发现这些阶段 Skill。采用 Comet 的本地安装方式，让宿主就近加载已安装的静态 Skill，同时保留 Runtime 对当前 Work 与版本的校验。

## What Changes

- 在获批初始化或补装时，把 Repoctopus 阶段 Action、工作流已采用的 Matt 方法 Skill，以及 OpenSpec Provider 支持的静态 Skill 安装到所选宿主的项目 Skill 目录。
- Runtime 按当前 Work 顺序交付 Skill。可核对实际本地正文和资源时，宿主使用绑定内容身份的引用。无法核对时使用随包正文和资源。
- OpenSpec Provider 继续提供当前 Change 的 Store 路径、模板、操作与产物约束。Matt 参考方法和团队 Skill 继续遵守现有生命周期绑定。
- 验证真实安装包、Windows 宿主发现与调用、跨进程恢复，以及本地缺失、修改或同名覆盖时的安全回退。

## Capabilities

### New Capabilities

### Modified Capabilities

- `project-configuration`：接入或补装时预览并安全安装所选宿主的工作流 Skill。
- `skill-integration`：允许 Runtime 按同一 Work 身份交付可校验的本地引用。

## Impact

涉及 Workspace 接入、宿主 Skill 安装、Runtime Work 领取、入口 Skill、安装包资产和使用文档。多仓项目沿用共享 OpenSpec Store，Verify Profile 继续独立配置。
