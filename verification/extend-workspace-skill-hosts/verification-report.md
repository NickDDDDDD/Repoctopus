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

## Windows IDE 原生 Skill

| 宿主 | 原生菜单发现 | 正文装填 |
| --- | --- | --- |
| CodeBuddy CN IDE 4.12.4 | Skills 列表显示全部三个入口 | 三次 `UseSkill` 成功 |
| CodeArts Agent 26.11.100 | 斜杠菜单显示全部三个入口 | 三次 `SkillTool` 成功 |
| TRAE CN 3.4.18 | 斜杠菜单显示全部三个入口 | Agent 轨迹记录三次技能调用 |
| TRAE 国际版 3.5.55 | 工作区已信任，Agent 仍显示独立登录入口 | 待验证 |

上述三个已登录 IDE 返回的工作流、个人 Init 和 Verify 配置原句均与候选包正文一致。CodeArts 和 TRAE CN 在第一次只附加工作流入口、限制工具的试验中报告未加载。显式允许并请求宿主使用原生 Skill 加载器后，三个正文均可读取。此次 IDE 对话没有触发 Repoctopus CLI。

在四个已接入的独立实验仓，通过同一安装包分别发起 Verify 配置请求。四次均生成独立审批请求，批准前 `repoctopus.yaml` 摘要保持一致。该结果来自直接执行 CLI。CodeArts 和 TRAE 原生宿主实际执行候选 CLI 的 Init、Run continuation 和 Verify 配置仍待取证，当前 Comet Build 保留已完成项。

[验收回执](acceptance-receipt.json) 保存已验证的候选包和运行身份。
