# 设计讨论摘要

状态：用户已明确选择 B，并明确授权 Agent 代理本次修复、合入 main 和后续验证循环中的中间确认；正式 Design 决定仍通过 Comet Runtime 记录，依据该委托执行，不伪称逐项人工点击。

规格与技术设计权威分别为本 Change 的 `specs/delivery-governance/spec.md` 与 `design.md`；本文件只保存 Comet 阶段恢复所需的讨论索引，不定义额外需求、任务或审批。

- 目标：修复 Windows 默认配置下受管规格归档的路径阻塞，保留原 Run、证据、Journal 和远端事实。
- 路径方案：专用平台 Git 适配在 Windows 使用命令级 `core.longpaths`，完整覆盖 checkout 与 publication 的 Git 操作；保留原始 NUL 输出，不改通用进程执行或检查命令。
- 不采用：修改宿主持久配置、缩短或移动目录、全局重写 Git 执行；理由见 `design.md` 的 Decisions。
- 独立复核确认：唯一精确前驱可以使组合采纳通过，却不能解除 Archive 发布阶段对旧 `planningCompositionDigest` 的等值检查；公开 preflight 也不能替换该冻结字段。当前没有已证明的原 Run 跨实现完整恢复路径。
- 验证：真实 checkout RED/GREEN、归档后长路径索引、授权拒绝及隔离、配置不变、Journal 各中断点恢复；最终以新包公开恢复原失败多仓 Run。
- 已确认 B：原失败 Run 必须由修复包完成，不能以新 Run 替代。依据用户对范围选项的明确选择，已更新 Proposal、Delta Spec、Design 和 Tasks；原路径与配置隔离要求不降级。
- 恢复候选：保留冻结来源，现有组合权威采纳当前执行实现；在原受保护入口核对最新 Run，构造进程内执行上下文交给 Delivery，避免历史来源与执行器作等值比较，不新增持久凭证或迁移框架。
- Archive 依赖覆盖真实规格关闭与发布端口，不能把 Work capability 与 Provider authority 名称直接等同。回归禁止 mock 掉核心规划或发布校验。
- 提交/push 规则保留：Git OID 与源码/配置组合摘要分开判断，不把延迟备份作为规避恢复缺陷的方法。
- 任务由原 8 项细化为 12 项；独立设计复核后通过正式 Design Wait 记录委托决定，采用 autonomous + TDD + thorough，沿用原 worktree，不另加常规确认。
- 交付授权：修复及 CI 通过后归档、push、创建 PR 并合入 main；随后从 main 构建包直接进行真实多仓验证，失败则继续修复与复验直到通过。此授权不允许假定检查成功、修改 Store 绕过或丢弃原失败证据。
