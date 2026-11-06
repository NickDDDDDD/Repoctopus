# Proposal

## Why

团队已经可以从构建好的 CLI 包启动 Repoctopus，但 GitHub Releases 还没有可下载的安装资产。建立可重复的发布路径后，成员可以从固定版本的下载地址用 `npx` 启动工作流。

## What Changes

- 建立维护者手动启动的 GitHub Releases 发布路径，从已经通过完整 CI 的 `main` 精确提交生成首版候选。
- 验证并分发同一组 CLI `.tgz`、可选的 Windows x64 Desktop 安装器及 `SHA256SUMS`，先交付可检查的 Release 草稿。
- 用固定版本的 Release 下载地址提供 `npx` 启动路径。README 和安装指南说明版本、CLI 与桌面看板的用途，并保留已有的独立目录安装方式。
- 首版目标为 `v0.1.0` 预发布。发布流程合入且该提交的 CI 通过后，才进入首版发布与实际下载验收。

## Capabilities

### New Capabilities

### Modified Capabilities

- `product-distribution` 定义 Release 候选的提交来源、产物验证与晋升边界，以及安装包的版本化消费方式。

## Impact

涉及 GitHub Actions、现有 CLI 打包和 Windows NSIS 验证入口、用户文档与发布记录。本次沿用现有打包依赖和第三方许可证随包规则。后续切片可独立评估 npm registry、安装器签名、自动更新及其他桌面平台。本次交付范围为 GitHub Releases、CLI `npx` 入口和 Windows x64 桌面包。
