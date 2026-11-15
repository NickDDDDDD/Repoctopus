# 团队 Skill 预览设计摘要

## 已确认的范围

用户要求单独启动 Change，沿用已有 YAML，为 Workspace 教程添加可直接执行的示例，并在启动 Run 前按 Work 预览 Skill、来源、顺序与配置错误。IDE 手动调用由后续需求处理。

## 候选技术方案

- 以 `repoctopus skill preview --workspace .` 为入口，支持 `--json`。通过专用查询装配读取项目配置、生命周期定义和 Skill Provider，避免启动 Run、遥测、Desktop 和交付服务。
- 复用现有技能组合编译和 Build 方法选择函数。Build Check 显示运行时追加的 `code-review`，Build Execute 分别展示 TDD 与 direct。通过真实领取的 Work 核对来源、角色和顺序。预览包含元数据及可定位的错误。
- Workspace 教程用 `.agents/skills/team-api-review/SKILL.md` 和 `build.check` 展示完整接入。验证候选安装包的公开预览、新旧引导生成及失败诊断。

当前候选覆盖已确认的范围，未提出 Spec Patch。
