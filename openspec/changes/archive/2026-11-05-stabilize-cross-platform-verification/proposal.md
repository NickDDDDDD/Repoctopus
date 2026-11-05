# Proposal

## Why

PR #66 首次在 GitHub Linux 干净 checkout 中执行完整验证时暴露 39 个失败：部分测试夹具把 Windows 路径误当作跨平台绝对路径，Windows Desktop discovery 使用了宿主路径语义，POSIX 恢复终止在进程真正退出前就报告成功。当前实现因此尚未满足已经归档的 `product-distribution`、`desktop-observability-dashboard`、`feedback-collection` 与 `managed-work-execution` 需求。

## What Changes

- 将涉及 Execution Binding 的纯领域测试夹具改为使用当前宿主生成的绝对路径，保留生产校验只接受当前宿主真实绝对路径的边界。
- 让 Windows Desktop discovery 明确使用 `path.win32` 解析 `LOCALAPPDATA` 和显式覆盖路径，不因 CI 宿主为 Linux 而改变 Windows 契约。
- 让 POSIX 恢复终止在有界时间内确认进程组退出后才报告 `terminated`，未知或未退出状态保持保守结果。
- 增加最小回归测试，并以本地 Windows 验证和 GitHub Linux `verify` 检查共同证明修复。
- 不改变 CLI、配置 schema、OpenSpec 需求、Repoctopus Runtime 状态机或桌面正式支持平台。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本次是实现与测试可移植性修复；既有规格已经要求干净 checkout 完整验证、Windows Desktop 路径边界、自有进程树安全终止和本地 Execution Binding。

## Impact

- 受影响代码：Execution Binding 测试夹具、Desktop receiver discovery 路径解析、POSIX 进程树终止确认。
- 受影响验证：GitHub Linux `npm run verify`、本地 Windows 相关测试与完整验证。
- 不新增第三方依赖或第三方源码，不产生额外许可证影响。
- 本次可交付切片仅让现有 PR 的跨平台验证契约真实转绿；Linux/macOS Desktop 正式支持、CI 矩阵扩展和 Runtime 功能增强均不在范围内。
