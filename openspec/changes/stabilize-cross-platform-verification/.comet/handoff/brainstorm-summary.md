# Brainstorm Summary

## 已确认事实

- PR #66 的 GitHub Linux `verify` 在精确 HEAD `2c885b75b2edf76b64be86941acb594ed2a152b6` 上失败，不能在门禁失败时合入。
- 失败收敛为三类：固定 Windows checkout 测试夹具、Windows discovery 使用宿主路径语义、POSIX recovered termination 提前报告成功。
- 现有 `product-distribution`、`desktop-observability-dashboard`、`feedback-collection` 与 `managed-work-execution` 规格已经覆盖期望行为，因此本 change 使用 `skip_specs: true`。
- 用户已确认在当前公开 PR 分支创建独立 change，保留已归档 change 的不可变性。

## 候选方案比较

### 采用：保持生产边界，修正夹具与平台适配器

- 测试用宿主原生绝对路径，不放宽 Execution Binding。
- Windows discovery 显式使用 `path.win32`。
- POSIX 进程终止经过有界状态确认。
- 本地 Windows 与 GitHub Linux 共同提供验证证据。

该方案修复根因，并保持当前 Runner Binding、Windows 首发平台与安全终止语义。

### 不采用：生产领域同时接受 Windows 与 POSIX 路径

Linux Runner 会接受实际不可访问的 Windows checkout，削弱本地 Binding 的真实性。

### 不采用：仅在 Windows CI 运行完整验证

会掩盖平台中立领域代码和纯 Windows 路径函数对宿主语义的意外依赖，也无法证明干净 Linux checkout 的仓库验证契约。

## 风险与验证

- 路径批量替换只改变夹具表示，必须保留 topology、branch、HEAD 和 digest 断言。
- POSIX 终止超时必须返回保守状态，不能通过固定 sleep 或测试等待伪造成功。
- 相关 Vitest 提供快速证据；完整 `npm run verify` 与 GitHub PR `verify` 作为最终集成证据。

## 当前状态

方案已由用户确认；Design Wait 仍需绑定 Runtime 生成的精确 proposal hash。没有待决的规格或架构问题。
