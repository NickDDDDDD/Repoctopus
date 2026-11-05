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

## Verify finding 后的候选修订

### 新事实

- 独立最终审查证明 recovered 路径当前只轮询 leader PID ownership；leader 先退出、descendant 仍存活时会把整棵树误报为 `terminated`。
- 同一模块已经有 `waitForPosixGroupExit()`，普通 child 路径使用 `kill(-pgid, 0)` 判断整个 group 是否消失；问题来自 recovered 路径维护了第二套成功定义。
- GitHub Linux 还先后证明浅克隆无法做 tested commit ancestry 校验、npm tar mode 会随宿主变化。这两项实现已经转绿，但尚未进入 canonical Design。

### 采用：统一复用 process-group probe

- 发送信号前继续以 leader creation identity 授权破坏性操作。
- 发送信号后复用 `waitForPosixGroupExit()`；只有 group probe 返回 `ESRCH` 才报告 `terminated`，超时或权限不确定保持 `unknown`。
- 增加 leader 已消失但 group 仍存在的 RED，避免 future regression 再把 PID liveness 当作 tree liveness。

该方案改动最小，并把同一平台适配器的终止成功语义统一到一个 helper。

### 不采用：在 recovered ownership 轮询上叠加 group probe

仍会保留两份截止时间、轮询和错误分类代码；即使本次转绿，未来仍可能再次分叉。

### 不采用：枚举 `/proc` 或调用 `ps`

平台依赖和竞态更多，且没有比内核 process-group probe 更强的退出证明。

### 门禁身份修订

- CI 使用完整 Git 历史完成报告 commit ancestry 校验。
- package-content v2 排除 host-derived tar mode，但继续绑定 path、type、file size/content digest 与 link target；不新增公共 API 或规格能力。

### Comet 当前实现与测试复核

- 固定 Comet 0.5.1 与当前上游 HEAD 的 `platform/process/terminate-process-tree.ts` 都提供相同的 `waitForPosixGroupExit()` 原语，但没有 Repoctopus 的 recovered-process API；因此不能声称直接复制了完整 recovered 修复。
- 当前 Comet 的 `test/platform/process/owned-command-termination.test.ts` 使用真实 detached parent/descendant、孤儿后代与超时清理场景，能够补足纯 mock 对内核 process-group 行为覆盖不足。
- 修订候选同时采用确定性竞态单测与 Comet 式真实 POSIX 集成验收；二者分别证明分类边界和真实后代清理，不能互相替代。

## 当前状态

原方案已由用户确认；第一版 Verify finding 提案因未明确采用 Comet 的真实 process-tree 测试而被拒绝。补齐双层测试后的方案是当前候选，仍需新的 Design Wait 绑定精确 proposal hash。没有待决的 Spec Patch。
