# Build 工作区恢复包验收

## 可复现输入

- Tested implementation commit: `fad6bab89e4fe00ca116f0280ab9e76179e844bf`
- Package files: `460`
- Package content bytes: `5702006`
- Package content SHA-256: `e278ccdbd117fbb278ade189b54e948f615e17ff589e3e10e94b7ebb3ec15f9d`
- 实际安装候选产品提交：`a26e1c3146cb81b618ce85ee1f8d3a743a27d89c`。
- 原始 tarball SHA256：`47acb61b60e965fec61421d382343de6b2ff311896812eaba34331d0a59038dd`。
- 平台 Windows x64，Node.js `24.21.0`，控制器 Comet Classic `0.5.1`。

实现提交与安装候选之间仅增加测试、规格和验证记录，发布产品源码保持一致。上列包内容摘要直接从实际安装的 tarball 计算，仓库 `check:managed-execution-report` 将重新构建当前包并核对文件数、字节数及内容摘要。tarball 摘要包含传输元数据，与规范化包内容摘要用途不同。

## 真实多仓与生命周期验证

完整测试过程、TDD、独立审查及外部证据哈希见 [Comet 验证报告](../../docs/superpowers/reports/unify-build-workspace-recovery.md)。真实安装包专项使用 Workspace 与四个业务 checkout，完成两个 README 工作包；十三个独立恢复进程验证正常断点保留、未授权分支阻断及切回后继续。首包的 completion、Plan、Binding 和当前 Work 始终保留，两个 execute Work 均只接受一次。

外部原始报告位于 `C:/Users/User/Desktop/PP/agent-lab-build-recovery-acceptance-20261107/round2/verification-report.md`，SHA256 为 `f7ed529ed76ed3b770293f4393fa55ea8c63c356f3fe8874b59316ce29ec2bc5`。完整测试 Run 为 `change-agent-lab-v010-workspace-verify-build-workspace-recovery-20261107-r2-fdfbcf36b8971b4a`。同目录 `evidence/` 保留每条实际命令、进程标识、恢复矩阵、接受事件和 Git 发布结果。

真实专项最终保留在未领取的 Build Check，不声明该测试 Run 已完成 Verify 或 Archive。生产组合回归独立覆盖完整五阶段及 protected Plan correction。首轮正式 `npm.cmd run verify` 的 196 个测试文件、1025 项测试通过，1 个文件和3项测试按既有条件跳过。随后文档架构扫描失败，本轮还补齐了当前候选包的这份可复现报告；最终全量结果以修正后 Comet Guard 收据为准。

本报告没有修改测试 Run Store，也没有放宽架构或包校验规则。原验收现场的五仓 HEAD、clean 状态和140个 Store 文件逐文件摘要保持不变。
