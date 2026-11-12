# Workspace 宿主扩展候选包验收

Tested implementation commit: `081a1aa4e453f1c7f1732f4ad7c4894d022f54ee`
Package content SHA-256: `6d70e30e5e789d40af800820e6c159eedd00ae3ff51195cd9dc6695c448bb096`
Package files: `481`
Package content bytes: `6271603`
Archive SHA-256: `9ccdf5ea39137c7787b8e053888dc32c9fda1ecdd422b2ce68bfd3de0f84f700`

## 已取得的证据

- 从实现提交构建并安装 Windows CLI 候选包。CodeBuddy Code 2.183.0 使用原生 Skill 工具装填个人 Init、Workspace 工作流入口和 Verify 配置。确定性的本地模型驱动测试宿主，CLI 由宿主工具实际执行。分别观察到 Init 审批请求、Open Run 和独立 Verify 配置审批请求。Init 的实验批准通过本地夹具回传。
- 在这个活动 Run 的实验 Workspace 请求补装 CodeArts 与 TRAE 项目级入口。批准后生成 4 个文件，配置、Store、引导和原 Run 的 8 个文件摘要相同。新进程恢复同一 Run，当前 Work 为 `change.intake`。两个 TRAE 选择值在计划中共用两个项目文件。
- 从同一候选安装包在四个独立 Git 根分别预览并批准 CodeBuddy、CodeArts、TRAE 国际版与中国版的单仓接入。每次仅写入该宿主批准的两个项目 Skill，批准前两份文件均不存在。两种 TRAE 选择值各自使用相同的项目目录。

- Codex 和 OpenCode 从同一候选包安装个人级 Init，分别通过原生 Skill 选择和原生 `skill` 工具读到已安装正文。
- 自动化覆盖显式宿主、共享目标去重、审批摘要篡改、拒绝无写入、配置在首文件写入后发生变化、原请求恢复，以及既有接入回归。独立审查复核了补装作用域。

完整仓库检查 npm run verify 已通过，1234 项测试通过、4 项跳过。生成产物、名称、架构、来源、Dashboard、19 项 OpenSpec 严格校验和安装包证据检查均通过。该结果覆盖当前候选代码与自动化检查，原生宿主矩阵仍待完成。

## 待验证的宿主行为

CodeBuddy CN IDE 4.12.4、CodeArts Agent 26.11.100 和 TRAE CN 3.4.18 已打开同一隔离实验 Workspace，均停在宿主的文件夹信任确认。TRAE CN 在更新日志中明确说明，受限模式下不加载项目 Skill。CodeArts 曾显示登录成功通知，智能体面板仍显示登录入口，需在确认目录信任后核对。TRAE 国际版 3.5.55 未在本轮打开，原生验收仍待完成。

[验收回执](acceptance-receipt.json) 保存已验证的候选包和运行身份。
