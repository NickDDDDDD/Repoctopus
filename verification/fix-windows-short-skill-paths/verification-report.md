# Windows 短路径安装包验证

Tested implementation commit: `bec5c4cd0528eb078500ee60e050da43d1a23e2c`

Package content SHA-256: `6e6899d5041a7f94b22fcc1f1a9e015cf3cb51dc3111f061dacc2690a1b71bbc`

Package files: `489`

Package content bytes: `6625255`

GitHub Release Prepare 45085303195 从 NTFS 8.3 短路径启动已安装的 CLI，首次领取 `change.intake` 时返回 `Unsafe Work Skill resource directory: .`。在本机把验收的临时目录设为真实的 NTFS 短路径，用同一旧候选包和验收入口复现同样的结果。系统原生解析确认短路径指向同一目录。

CLI 现在用 Node 的原生 `realpath` 把自身安装根交给内置插件。内置 Skill 的文件路径因此与资源读取器检查的规范路径一致。改动未触及 Workspace 和团队 Skill 的解析边界，相关资源校验由原有代码执行。

构建、Prettier、Git diff 检查和 6 项 Skill provider 测试通过，包含对链接资源的拒绝。重建的 `repoctopus-0.1.4.tgz` 的文件 SHA-256 为 `22d91ff0a35f7328e858022e06b7ddd1bf3913aec92258499ddfc3673e4609b9`。

实包 npx 验证通过，覆盖版本、帮助和项目探测 JSON。Windows 短路径多仓 Run change-workspace-verify-package-workflow-1084f1a8861b28e9 已完成，验收收据记录从 Init 到 Archive、首包冷恢复、PR 响应丢失后去重和终态恢复四项均通过，耗时 234 秒。
