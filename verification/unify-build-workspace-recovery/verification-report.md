# Build 工作区恢复包验收

## 可复现输入

- Tested implementation commit: `baba17f6e0ff3d1381b9b10a281696a0cd8d063b`
- Package files: `460`
- Package content bytes: `5690531`
- Package content SHA-256: `e5442745c303009c3ed42978328fa606da1e2ab1db3455a93724d55c4d217615`
- 实际安装候选产品提交：`a26e1c3146cb81b618ce85ee1f8d3a743a27d89c`。
- 原始 tarball SHA256：`47acb61b60e965fec61421d382343de6b2ff311896812eaba34331d0a59038dd`。
- 平台 Windows x64，Node.js `24.21.0`，控制器 Comet Classic `0.5.1`。

实现提交与安装候选之间仅增加测试、规格和验证记录，发布产品源码保持一致。上列包内容摘要直接从实际安装的 tarball 计算，仓库 `check:managed-execution-report` 将重新构建当前包并核对文件数、字节数及内容摘要。tarball 摘要包含传输元数据，与规范化包内容摘要用途不同。

上列规范化包身份使用独立 `npm ci` 后重建的最终候选，tarball SHA256 为 `7d1567425c41890f2ec57b24c886f2d68790dc448aceff9ad0def7dc0e95a9f3`。前述原始候选保留为首轮真实验收证据。

## 真实多仓与生命周期验证

完整测试过程、TDD、独立审查及外部证据哈希见 [Comet 验证报告](../../docs/superpowers/reports/unify-build-workspace-recovery.md)。真实安装包专项使用 Workspace 与四个业务 checkout，完成两个 README 工作包；十三个独立恢复进程验证正常断点保留、未授权分支阻断及切回后继续。首包的 completion、Plan、Binding 和当前 Work 始终保留，两个 execute Work 均只接受一次。

外部原始报告位于 `C:/Users/User/Desktop/PP/agent-lab-build-recovery-acceptance-20261107/round2/verification-report.md`，SHA256 为 `f7ed529ed76ed3b770293f4393fa55ea8c63c356f3fe8874b59316ce29ec2bc5`。完整测试 Run 为 `change-agent-lab-v010-workspace-verify-build-workspace-recovery-20261107-r2-fdfbcf36b8971b4a`。同目录 `evidence/` 保留每条实际命令、进程标识、恢复矩阵、接受事件和 Git 发布结果。

真实专项最终保留在未领取的 Build Check，不声明该测试 Run 已完成 Verify 或 Archive。生产组合回归独立覆盖完整五阶段及 protected Plan correction。首轮正式 `npm.cmd run verify` 的 196 个测试文件、1025 项测试通过，1 个文件和3项测试按既有条件跳过。随后文档架构扫描失败，本轮还补齐了当前候选包的这份可复现报告；最终全量结果以修正后 Comet Guard 收据为准。

本报告没有修改测试 Run Store，也没有放宽架构或包校验规则。原验收现场的五仓 HEAD、clean 状态和140个 Store 文件逐文件摘要保持不变。

## CI 后包身份复验

首轮 [Linux CI](https://github.com/NickDDDDDD/Repoctopus/actions/runs/42355151020) 通过196个测试文件、1024项测试，另有4项按平台条件跳过；其余源码、生成物、架构、来源与18项规格检查通过。最后包复现检查报告原始候选摘要与独立安装环境不一致，整个 CI 因此失败。

本地 `node_modules` 原为指向另一工作区依赖目录的 Junction。Desktop Host bundle 的外部模块路径标签因此包含该工作区的相对路径，独立 CI 安装的标签则相对于当前项目。移走并保留原链接、在当前工作区执行独立 `npm ci` 后重建，得到与 CI 精确相同的上列文件数、字节数和内容摘要。

逐项比较两个 tarball，460个文件中仅 `dist/desktop/host.mjs` 与对应的 `dist/desktop/resource-manifest.json` 不同。Host bundle 将外部依赖根路径标签规范为当前项目路径后与新文件完全相同；资源清单仅更新这一文件的大小及摘要。产品源码、依赖锁文件和检查规则均未改变，已封存的 OpenSpec 归档未修改。原始候选的1/2恢复矩阵保留其原始包身份；最终候选另做实际安装与当前2/2 checkpoint恢复补充验证，不将二者混记为同一次验收。

独立补充验收已通过：新包安装在独立消费者 prefix，8个独立进程覆盖正常恢复4次、未授权分支阻断2次、切回恢复2次。两份 completion、Binding、Plan、Plan Evidence、workspace checkpoint、current Work 和原执行记录保持一致；两包各类执行事件均恰好一次，Build Check claim 为0。原140个 Store 文件、旧安装1284个文件和原始报告哈希保持不变。

补充原始报告为 `C:/Users/User/Desktop/PP/agent-lab-build-recovery-acceptance-20261107/clean-candidate/verification-supplement.md`，SHA256 为 `c5ddb0c43964caaf312013920b26cf588393f4bc13a30c9af6a48ef472dfd4ca`；同目录 `evidence/` 保存完整矩阵和实际命令。独立代码复核也确认包差异不改变执行逻辑，无新增 P1/P2；模块名称可能影响错误栈与诊断显示。

删除备用依赖 Junction 的可选清理被自动审批以 `blocked by policy` 拒绝；链接保留并加入本机 Git exclude，原目标目录未变。验收证据和实际包保留供复核。
