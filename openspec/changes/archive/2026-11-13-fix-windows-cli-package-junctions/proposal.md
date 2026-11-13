# Proposal

## Why

CodeBuddy CN IDE 在 Windows 上执行直接安装的 Repoctopus 发布包时，无法访问 npm 为本地 Cordis 依赖创建的目录链接，CLI 在接入流程之前即启动失败。普通终端能启动同一安装，现有验证因此漏掉了这个故障。

## What Changes

- 使用已核对的官方 npm 精确版本安装 Cordis Core 和 Loader。
- 在实际安装包测试中检查 CLI 使用的两个依赖都是普通目录。
- 将发布 npx 烟测的 Git 仓置于扫描根之下，覆盖实际 `project detect` 入口。

## Capabilities

### Modified Capabilities

- `product-distribution` 明确发布包的 Cordis 依赖安装约束和 Windows 消费验收。

## Impact

涉及 npm 包声明、锁文件、发布烟测及安装包回归。Cordis 固定版本和来源快照继续用于来源校验。
