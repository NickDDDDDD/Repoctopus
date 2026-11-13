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

完整仓库检查 npm run verify 已通过，1234 项测试通过、4 项跳过。生成产物、名称、架构、来源、Dashboard、19 项 OpenSpec 严格校验和安装包证据检查均通过。该结果是当前候选代码的完整仓库检查。以下记录实际宿主验收及差异。

## Windows IDE 原生验收

| 宿主 | 原生正文装填 | 候选 CLI |
| --- | --- | --- |
| CodeBuddy CN IDE 4.12.4 | 三次 `UseSkill` 成功 | Init、恢复、Verify 配置通过，使用普通目录安装 |
| CodeArts Agent 26.11.100 | 三次 `SkillTool` 成功 | Init、恢复、Verify 配置通过 |
| TRAE CN 3.4.18 | Agent 轨迹记录三次技能调用 | Init、恢复、Verify 配置通过 |

用户明确将本轮 TRAE 原生验收限定为中国版。国际版安装映射保留，未参与此次原生验收。CodeBuddy Code CLI、Codex 和 OpenCode 已有的回归证据继续有效。

三个 IDE 均在原生菜单发现三份入口，通过宿主的 Skill 工具装填正文，并返回与候选包一致的正文原句。在限制工具的探测中，CodeArts 和 TRAE CN 只附加工作流入口时曾返回未加载，显式调用各自的原生 Skill 加载器后通过。

三个 IDE 均通过候选 CLI 从未接入的 Git 根生成 Init 请求，在既有 Workspace 生成独立 Verify 配置请求，并恢复到同一 Run 的 `open / change.intake`。核对了六个不同的请求 ID、持久化的请求摘要和待批准状态。三次恢复返回同一个 Work ID 和 `execute` 续行。Runtime 同时提示实验 Workspace 自 checkpoint 后发生变化，后续阶段会重验依赖的证据。实验未批准 Init 或 Verify 请求，也未推进该 Run。

CodeBuddy IDE 的初次 CLI 启动失败发生在 npm 将打包的 Cordis 本地依赖安装为 Windows junction 时。直接对 .tgz 使用 npm `--install-links` 返回 ENOENT。把同一个候选包解压后，从解压目录通过 npm `--install-links` 安装，两个 Cordis 依赖均成为普通目录。包清单、入口和 CLI bundle 与原安装逐字节一致。CodeBuddy IDE 在这个条件下完成三项调用，默认 .tgz 安装下的 IDE 启动问题仍存在。

[验收回执](acceptance-receipt.json) 保存已验证的候选包和运行身份。
