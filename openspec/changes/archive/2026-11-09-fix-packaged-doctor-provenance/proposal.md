# Proposal

## Why

安装后的 `doctor` 把源码开发所需的 lockfile 和 Electron 准备脚本当成必需运行资源，而 npm 发布包不提供这些文件，导致健康安装也无法完成诊断。需要明确开发审计与安装后诊断的职责，并用真实发布包回归守住这条边界。

## What Changes

- 安装后来源诊断检查随包发布的来源清单、受保护文件及实际生产依赖，不再读取开发 lockfile 或开发准备脚本。
- 保留 CI 对依赖锁、integrity、开发依赖和准备脚本的完整审计。
- 为真实 tarball 隔离安装后的 `doctor` 增加成功与损坏反例；异常诊断不写 Run、Checkpoint 或 Trajectory。
- 补充用户诊断文档及验证报告；沿用现有 CLI 和 JSON envelope，不新增迁移、兼容别名或配置开关。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `product-distribution`: 安装包的健康诊断应独立于源码开发环境，并能识别实际资源损坏。

## Impact

涉及来源诊断、包 E2E、相关单元回归和诊断说明；不改工作流阶段推进、持久状态 schema、Desktop 生命周期或业务仓配置。参考固定 Comet 0.5.1 的随包 manifest 检查与实际安装包 doctor 验收，仅借鉴实现思路，不引入 SDK 或复制新上游源码。
