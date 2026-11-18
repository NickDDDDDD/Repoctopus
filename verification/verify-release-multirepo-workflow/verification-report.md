# Windows 多仓候选包执行验证

Tested implementation commit: `1c24e6fb65ac8cee902a8b41f4c5e366575447c4`

Package content SHA-256: `e6a8287722f6fc7b9019179d89697acac8febdf36a6cad42c5d1f6f417a15644`

Package files: `487`

Package content bytes: `6578150`

## 实际安装包

[验收收据](acceptance-receipt.json)记录实际 tarball 的传输摘要、字节数和完整生命周期结果。上列规范化内容摘要由同一份实际安装过的 tarball 计算，绑定打包路径、类型、权限和内容。仓库现有检查器会从当前源码重新打包，核对这份摘要。

安装包由 `d69e938` 生成，随后增加了封存集成测试及流程证据。上列实现提交包含这些测试，并已完成 1294 项通过、4 项跳过的全仓测试。当前产品内容是否一致由包内容检查实际核验。

## 三仓生命周期与恢复

候选包通过公共 CLI 从空 Git 仓完成 Init、Open、Design、Build、Verify 和 Archive，用时 270731 毫秒。第一驱动进程完成首包后退出，第二进程恢复同一 Run、Plan、checkpoint 和首包完成记录。两个任务分别执行真实 RED、GREEN 与回归检查，机器 Verify 各执行一次。

托管夹具使用实际 Git smart HTTP 和本机 GitHub 兼容 HTTPS。规格 PR 持久化后断开创建响应并暂时隐藏查询。未知结果期间，通过新 CLI 进程调用 resume、next 和原发布入口，保持 reconcile。恢复可见性后采纳原规格 PR。三个 PR 创建请求、一次规格分支推送均可由原始入口账本核对，等待及恢复期间新增写请求为零。

四次终态 resume、next 读取保留 Run、checkpoint、trajectory 的字节摘要及原 PR 和远端 OID。最终收据为 completed。测试只允许 Open、Design 各审批一次，并核对完整 Work 序列。

## 代码与发布门禁检查

34 项针对性检查通过。真实 seal 命令的隔离集成测试覆盖有效、缺失及摘要不符的收据。缺失或不符时，校验和与候选记录均未生成。Prepare 接线把实际候选文件传给同一独立入口，诊断保存到候选目录之外，封存检查摘要、字节数及四项通过结果。

独立审查和增量复核均无重要未决问题。审查推动修复了进程树超时清理、额外审批的自动接受，以及默认诊断进入后续打包的问题。

第二轮完整检查的 1294 项测试以及生成物、品牌、架构、来源、Dashboard 清单和严格规格检查全部通过。最后的报告检查要求本文件，现补齐规范格式和包身份绑定。首轮一项既有集成测试在 30 秒预算下超时，单独复跑约 6.5 秒通过；后续完整检查采用 `VITEST_MAX_WORKERS=2`，原记录保留。

完整 GitHub Prepare 作业将在合入后的下一份发布候选上运行。本次验收使用本机托管夹具及确定性测试 Host。
