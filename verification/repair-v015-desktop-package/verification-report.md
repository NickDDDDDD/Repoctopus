# v0.1.5 桌面安装包修复验证

Tested implementation commit: `ae797f3a6941c8022bc655739604c8b2afdab5e5`

Package content SHA-256: `9ef7e762f504fe5502601efe9b54cb28644fb3e5dc218c51f184c7b9ea305101`

Package files: `493`

Package content bytes: `6756113`

首轮 Release Prepare（`45612221193`）通过 CLI、npx 和 Windows 三仓流程。安装包核验发现 `projection-view.ts` 未复制到 `resources/product`。新增的构建前检查用原配置复现失败，同时报告另一份缺失的 `delegation-activity.ts`。补齐两处映射后，桌面构建通过。

在 Windows 构建实际 NSIS x64 安装器，并核对 6 个必需包条目和运行资源清单中的 16 个文件。安装态验收覆盖安装、Run 激活、OTLP 接收、单实例转交、托盘隐藏和恢复、完整退出、卸载和注册表恢复，全部通过。桌面打包及激活契约共 7 项测试通过。

重新打包确认 CLI 的规范化内容摘要、文件数和字节数与原 `v0.1.5` 验收包一致。本地 npx 和三仓验收见[版本准备报告](../prepare-v0-1-5/verification-report.md)。正式发布工件将从合入后通过 CI 的提交重新执行 Release Prepare。
