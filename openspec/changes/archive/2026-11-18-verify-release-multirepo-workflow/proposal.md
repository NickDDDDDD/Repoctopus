# Proposal

## Why

Release Prepare 已验收候选包的安装、CLI 协议和桌面安装器。完整的 Windows 多仓生命周期和中断恢复目前仍依赖独立实验的驱动脚本，下一份候选包缺少同样的自动化验收。

## What Changes

- 增加可独立执行的 Windows 安装包端到端测试，接受指定的候选 `.tgz`，用已安装的公共 CLI 驱动隔离多仓 Workspace。
- 自动运行一条小 Change，从 Init 到 Archive，在首个 Build 工作包完成后换进程续跑，并模拟规格 PR 已创建但响应丢失。
- 核对同一 Run 完成、已完成工作包保留、规格 PR 被采纳，以及恢复和终态复读期间没有重复推送或创建请求。
- 让 Release Prepare 在封存和上传前用实际候选包运行这条测试。失败时保留可定位的阶段和验收证据。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `product-distribution` 增加一条 Windows 多仓安装包验收，并把它绑定到 Release Prepare 的候选文件。

## Impact

涉及安装包测试、Windows 实验环境、Release Prepare 和维护者文档。范围限定为一个小型多仓场景及其发布门禁。日常 PR CI 继续使用标准 Verify。Runtime 生命周期、公开 CLI 和正式发布渠道沿用现有实现。
