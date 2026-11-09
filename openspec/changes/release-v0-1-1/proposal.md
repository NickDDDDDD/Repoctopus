# Proposal

## Why

已合入 main 的 Workspace 本地引导、安装后 doctor 和多仓恢复修复尚未进入公开安装包。团队目前仍只能取得旧版 v0.1.0；同时 CLI 与遥测中散落的产品版本常量会使单独更新 package.json 后的新版仍报告旧版本。

## What Changes

- 准备 v0.1.1，保持现有预发布交付方式；同步根包及 lockfile 的产品版本，并让 CLI、运行时遥测和桌面观测的产品版本由包元数据统一派生。插件自身版本、协议版本、持久化 schema 及第三方版本保持各自语义，不做批量替换。
- 更新面向使用者的固定版本安装示例与本地测量工具的安装器定位，核对实际 tarball 的 --version、npx、初始化入口及遥测版本。
- 沿用已实现的 Release Prepare → Publish → public-smoke：版本维护 Change 先验证、归档并合入 main；再对 main 上 CI 通过的精确提交生成候选，核对同一资产后公开 v0.1.1，并验证公开下载与 npx。
- 保留旧版 v0.1.0、原始实验和已有三个无关提案。发布或上传中断沿用原候选及回执核对恢复，不覆盖已公开资产。

本次不新增发布后台、版本兼容层、生命周期状态、遥测字段重命名或独立版本注册服务。不修改第三方源码或新增依赖。范围内的产品版本统一用于避免这次发布的身份错误，不扩展 Runtime 执行语义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `product-distribution`：明确包版本、CLI 输出和产品遥测版本与候选发布身份一致，保留已有精确提交、同一资产和失败保留规则。

## Impact

- 版本与文档：package.json、根 lockfile 元数据、README、安装指南及 Windows 测量脚本。
- 产品身份：CLI 版本输出、观测发送与桌面 OTLP 编码的产品版本引用；使用受架构所有权审计的小型包元数据模块，保留 Cordis / Service / Host 边界。
- 验证：安装包与版本回归、相关遥测回归、完整仓库 Verify、PR/main CI；合入后的 Release 候选继续接受现有 CLI/npx/Windows 安装器验收与公开下载核对。
- OpenSpec Tasks 覆盖可在合入前完成的版本维护与验收准备。需要 main 成功 CI 的实际发布在 Change 交付后按同一任务执行，不把“发布已完成”提前勾选，也不为等待远端结果改造 Runtime。
- 来源：复用仓库已有发布方案和平台工具；无新的 Comet/DSH 源码采用、依赖或许可证变更。
