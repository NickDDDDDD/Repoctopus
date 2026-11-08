# 设计讨论摘要

状态：候选设计；Open 范围已由用户批准，正式 Design Wait 尚未批准。

规格与技术设计权威分别为本 Change 的 `specs/delivery-governance/spec.md` 与 `design.md`；本文件只保存 Comet 阶段恢复所需的讨论索引，不定义额外需求、任务或审批。

- 目标：修复 Windows 默认配置下受管规格归档的路径阻塞，保留原 Run、证据、Journal 和远端事实。
- 候选：专用平台 Git 适配在 Windows 使用命令级 `core.longpaths`，完整覆盖 checkout 与 publication 的 Git 操作；保留原始 NUL 输出，不改通用进程执行或检查命令。
- 不采用：修改宿主持久配置、缩短或移动目录、全局重写 Git 执行；理由见 `design.md` 的 Decisions。
- 独立复核确认：唯一精确前驱可以使组合采纳通过，却不能解除 Archive 发布阶段对旧 `planningCompositionDigest` 的等值检查；公开 preflight 也不能替换该冻结字段。当前没有已证明的原 Run 跨实现完整恢复路径。
- 验证：真实 checkout RED/GREEN、归档后长路径索引、授权拒绝及隔离、配置不变、Journal 各中断点恢复；最终以新包公开恢复原失败多仓 Run。
- 待确认：先决定是否采用设计中的 A（仅修路径、保留原 Run、新建独立验收，推荐）及对应 Spec Patch，或 B（扩大为路径与跨实现恢复）。该决定之前不提交最终 Design Wait、不进入 Build。
- Delta spec 与任务权威尚未调整；任务仍为原 8 项。若选 A，拟调整恢复承诺及验收 Run 归属，不减少长路径全链路、配置不变或同版本中断恢复验证。
