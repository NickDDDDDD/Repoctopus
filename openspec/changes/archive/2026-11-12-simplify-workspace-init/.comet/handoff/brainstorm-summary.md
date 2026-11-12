# 轻量 Workspace 初始化的设计摘要

## 已确认范围

单仓和多仓使用同一个 Init Skill。首次接入只建立可启动工作流的 Workspace 与 Store，Verify 另行配置。已批准的 Open 范围允许完成 Build，缺少默认 Profile 时保留同一个 Run。

## 候选方案

- 个人级 Init 在未接入项目前可见，项目级入口和 Verify 配置入口随接入安装。宿主一次提交真实接入选择，Runtime 完成预览、批准绑定与事务。
- 初次候选允许空 Profile。现有配置继续生效，构建命令和覆盖只在独立 Verify 配置时核对。
- Build Check 与 Verify 输入冻结分开持久化；缺 Profile 时保留通过的 Check，用户配置后用同一 Run 继续。
- 只接受可证明的配置更新。核对实际 composition、执行 checkout、批准的变更和 Evidence fingerprint，保留真正有效的成果。
- 用发布候选包在 Windows 上验证两个宿主、真实多仓冷恢复、正常 commit/push 后续跑，以及 Issue #85/#86 的失败诊断。

详细候选见 [design.md](../../design.md)。本轮未修改 Open delta specs，正式设计决定待当前 Comet 提案确认。
