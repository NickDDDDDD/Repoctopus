# 修复 OpenSpec Store checkout 路径身份

## Why

首版 Release 的 Windows 验收从短路径访问 Workspace，OpenSpec 返回实际目录路径，Repoctopus 却把两种写法识别成不同 checkout。相同错误已用真实 OpenSpec Store 和 Windows 目录别名复现，会阻塞已登记项目的规格访问。

## What Changes

- 让项目探测、Store 登记核验和规格读取按实际 checkout 判断路径身份。Windows 短路径和其他能解析到同一目录的别名得到一致结果。
- 保留显式 Store ID、健康根和登记冲突门禁。另一个 checkout、失效路径和身份不一致仍按现有失败路径处理。
- 用真实 CLI 回归覆盖同一目录别名与不同 checkout。用新的 `main` 提交重跑首版发布的现有 Windows 验收和公开下载验证。

## Capabilities

### New Capabilities

### Modified Capabilities

- `specification-authority`：明确 Store 和 Workspace 的 checkout 一致性以实际目录为准，路径写法本身不构成身份冲突。

## Impact

影响 Repoctopus 的 OpenSpec 平台适配、接入探测和相关测试。保持现有 CLI 参数、配置 Schema、Store 注册表格式、运行流程和 Release 门禁。参考 OpenSpec 与 Comet 的路径解析做法，使用本仓已有 Node.js 文件系统接口，无第三方源码复制或许可证变更。本次交付包含修复和 `v0.1.0` 发布验证，无单独的后续切片。
