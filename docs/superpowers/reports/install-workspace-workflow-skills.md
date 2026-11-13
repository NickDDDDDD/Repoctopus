# Workspace 工作流 Skill 验收

## 安装包与宿主

- Windows 上以 npm pack 构建候选 tgz，再用 npm install 安装生产依赖。从独立的 Workspace、frontend、backend 三个 Git 仓接入。预览和批准共绑定 85 个 Skill 目标，安装完成 85 个，两个业务仓均无 Skill。候选 SHA-256 为 6EF28D92BF998A9EEF82E320EFB09E27B378805FF0435C789E78CDF6883143CA。另用候选包验证了现有 Workspace 补装。
- CodeBuddy CN 的项目菜单可发现阶段 Action、Matt 方法和 OpenSpec Explore。对选中的 repoctopus-open-change 执行原生只读加载，IDE 显示 UseSkill 成功。
- CodeArts 码道在「技能与规则」项目级列表发现 code-review、codebase-design、grilling、openspec-explore。TRAE 中国版在「技能与命令」项目列表发现 repoctopus-archive-change、diagnosing-bugs、tdd、pr 和 openspec-explore。两者也完成了 repoctopus-open-change 的原生只读调用，工具轨迹分别显示 SkillTool 和「调用技能」。TRAE 国际版未参加本轮原生验收。
- 三个 IDE 的调用轨迹均未提供实际文件的内容摘要。因此，名称调用仍使用正文交付。原生精确来源验证的协议已实现，其证据来自 CLI 对应的路径和字节检查。

## 执行与恢复

- CLI Open/Design 端到端回归使用提交并推送的 Workspace Skill。Open 领取返回静态引用；换进程读取返回同一层。替换文件触发冻结回退，CRLF 转换保持内容身份，错误 Runner、不同宿主和已结束的 invocation 被拒绝。动态规格协议与阶段审批继续由 Runtime 提供。
- 最终安装包在三仓实验里通过真实 CLI 领取 Open。另一个进程读取 Workspace 内容，替换文件后返回原 packet 的同一正文和摘要，五个动态 Provider 层仍在包内。跨 autocrlf 设置重新检出后，85 个安装目标均识别为 keep，Git 工作区干净。
- Design 的 codebase-design 层引用包含真实 Matt 资源的已安装摘要。读取返回相同冻结层和 DESIGN-IT-TWICE.md。接入与恢复测试也覆盖了资源写入中断、保留团队额外文件并继续同一请求。
- 独立 Build 审查发现行尾、部分安装期间 Provider 判定、恢复 Runner、管理目录和临时文件问题。均已修正。复核无 P0/P1；随后补齐已安装字节摘要、稳定 Runner 和资源级 CLI 验证。
- 初次本地全量检查发现独立 worktree 缺少 Electron 二进制。使用 desktop:prepare 补齐，桌面激活和同批 Host CLI 测试复跑通过。Comet Build 和 Verify 的最终结果以对应检查收据为准。

## Comet 检查中断

首个 Build Check 在测试断言 lint 校验中失败，已修复并复跑单项检查。随后手动中断第二个 Build Check，以补齐打包报告。Comet 保留了已部分执行的原 Action。检查进程已停止且没有完整收据。通过公开 Runtime 接口将该 Action 标记为结果未知。Comet 0.5.1 要求原检查收据才能接受回填，公开重试仅适用于未执行的尝试。另行运行的项目完整检查与这个 Runtime Action 分开记录。
