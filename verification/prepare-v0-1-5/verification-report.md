# Repoctopus v0.1.5 候选验证

Tested implementation commit: `492a803376003b3529b2e018a4b7b87b1650f500`

Package content SHA-256: `9ef7e762f504fe5502601efe9b54cb28644fb3e5dc218c51f184c7b9ea305101`

Package files: `493`

Package content bytes: `6756113`

版本准备将 CLI 版本、锁文件中的产品版本及安装文档同步到 `0.1.5`。锁文件与基线逐项比较，依赖版本范围、下载地址和完整性摘要一致。

CLI 和 Electron 构建通过，来源清单核验通过。实际候选 `repoctopus-0.1.5.tgz` 通过隔离 npx 检查，覆盖版本、帮助和项目探测的 JSON 协议。

同一候选通过 Windows 三仓完整验收。Run `change-workspace-verify-package-workflow-1084f1a8861b28e9` 从 Init 走到 Archive，验证首包后换进程恢复、规格 PR 响应丢失后的发布去重和终态复读，耗时 255.16 秒。实际归档的文件 SHA-256 为 `423c14c324d7cfaabd8434db9edffef903f2515fc9700ae96a137e215a2d1a8e`。

GitHub Release Prepare 从通过 CI 的 main 提交构建和核验发布工件。实际公开下载使用 Prepare 封存的同一批资产。
