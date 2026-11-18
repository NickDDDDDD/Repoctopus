# Windows 多仓候选包验收验证报告

独立入口接受显式 CLI tarball，通过已安装包的公共 CLI 初始化三仓 Workspace，并执行一条 Change 的 Open、Design、Build、Verify 和 Archive。测试 Host 读取当前 Action Skill，执行两个真实 RED/GREEN 标记任务与机器 Verify。

首包完成后，第一驱动进程退出。第二进程恢复原 Run，核对原计划和首包完成记录。托管服务在验证远端分支并持久化规格 PR 后断开响应、隐藏查询结果。未知结果期间，resume、next 和原发布入口保留同一 invocation；恢复可见性后采纳原 PR。原始 PR 创建请求和 Git receive-pack 请求计数覆盖等待、恢复与终态读取。

[安装包验收收据](../../../verification/verify-release-multirepo-workflow/acceptance-receipt.json)保存最终候选身份、恢复记录、发布计数和终态。原始 CLI 输出、Skill 消费和请求账本由独立入口保存在收据所在的外部证据目录，Prepare 使用单独的诊断 artifact 保留这些文件。

独立审查发现并解决了进程树清理的三个入口、额外审批被测试自动接受，以及默认诊断落入打包目录的问题。监督器与内部命令统一等待 Windows 进程树终止，服务退出等待 Git 子树结束。测试只允许 Open、Design 各一次审批，并核对完整 Work 序列。默认诊断保存在系统临时目录。

针对性回归覆盖候选输入错误、诊断目录隔离、收据缺失和不匹配、关键检查缺失、退出码及 JSON 管道转发、两层监督器的子孙进程超时清理，以及 Prepare 接线和 seal 校验。34 项针对性检查通过。独立 Git 夹具直接执行真实 seal 命令，确认有效收据允许封存，缺失或不同候选的收据阻止校验和及候选记录生成。最终独立集成审查及其增量复核均无重要未决问题。

Comet 使用精确命令 `npm.cmd run build` 执行 Build Check，并使用 `npm.cmd run verify` 执行完整 Verify，正式检查收据由当前 Change Run 保存。

首轮完整检查为 1293 项通过、4 项跳过，一项既有 Evidence 输入集成测试超过其 30 秒预算，实际耗时约 34 秒。该测试单独复跑在约 6.5 秒通过。后续完整检查设置 `VITEST_MAX_WORKERS=2`，该变量由现有检查策略绑定，测试保持原有范围和断言。首轮失败记录与原始日志保留在当前 Run。

第二轮为 1294 项测试通过、4 项跳过，其后生成物、品牌、架构、来源、Dashboard 清单和严格规格检查全部通过。最后一项检查要求规范的[托管执行报告](../../../verification/verify-release-multirepo-workflow/verification-report.md)，本次最初仅提供了验收收据与本报告。补齐实现提交和实际 tarball 的规范化内容摘要后，由原检查器核对当前产品与测试包的绑定关系。

本次托管服务在本机实现 Git smart HTTP 和 GitHub 兼容 HTTPS，审批使用测试 Host 的确定性答复。完整 GitHub Prepare 作业随合入后的下一份发布候选执行。本次的接线与封存正反例验证覆盖实际候选文件参数、执行顺序及通过收据与候选摘要的绑定。
