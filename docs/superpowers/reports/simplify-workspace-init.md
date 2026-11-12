# Workspace 轻量初始化与 Verify 配置验证报告

## 安装与接入

在 Windows 独立安装从固定实现提交构建的候选包。真实 Codex 0.154.0 和 OpenCode 1.19.5 用各自原生机制加载个人级 Init Skill。通过本地确定性模型驱动，两者在各自未接入的 Git 根执行已安装 CLI，取得真实、待决定的单仓接入计划。独立的包级测试在含空格的单仓和三仓项目回传实验用批准，检查最小配置、Store 和项目入口，随后从公开 CLI 启动各自的 Open Run。两个候选均为零 Profile。审批选择使用实验夹具，宿主原生选择交互由此前的交付验收覆盖。

接入回归覆盖缺少构建文件、Git 子目录、遗漏 Workspace 根、候选与草稿混淆、缺失 Store binding、其他 checkout、拒绝无写入、配置漂移以及同一请求恢复。Verify 配置回归覆盖真实候选验证、必需覆盖、批准范围、拒绝无改动和已有 Profile 保留。README、安装文档和 Workspace 内引导均展示最小接入及按需配置的实际命令。

## 多仓运行与恢复

最终实现的三仓 Windows 集成用例运行实际构建出的公开 CLI。Run 完成 Build Check 后因缺 Profile 停在 Verify 准备边界。退出进程后，新的 CLI 进程仍读到原 Run 和已接受的检查。独立获批的 Profile 正常提交并 push 到实验 Git 远端。再次启动进程后，Runtime 保留已完成工作包、批准和 Build Check，编译实际 Profile、执行 Verify，并以真实 Evidence Gate 完成 Archive。Git 远端为本地 bare 仓，交付使用实验适配器。

额外回归确认 Run 启动基线和 Build Check 基线分别验证：Check 前已批准并提交 Profile、Check 后再次获批修订时，仍可保留有效 Build。混入代码或交付配置变化时按原恢复规则处理，已有无效覆盖在 Design 阶段拦截。

## TDD 和独立复核

新增回归在旧行为上暴露了入口缺失、空 Profile 阻断、Build Check 与 Verify 耦合、两次批准之间的 Git 基线混用。实现后回归转绿。独立审查分别核对接入和运行恢复。发现的稳定仓库 ID、审批重放、配置作用域、审批预览和多次 Profile 提交问题已修复，最终候选重新执行安装包和真实多仓验收。

[安装包验收](../../../verification/simplify-workspace-init/verification-report.md) 绑定实现提交和包内容身份。完整仓库检查由 Comet Guard 使用仓库登记的 Windows 命令执行并保存收据。

首轮正式 Verify 的 lint 拒绝了两处测试中的未校验 JSON。两处改用共享配置解析器后，接入回归通过，重新打出的包与已实测候选字节一致。
