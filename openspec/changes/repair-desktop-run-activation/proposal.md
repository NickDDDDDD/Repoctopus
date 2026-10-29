# Proposal

## Why

已归档的 Desktop Dashboard change 要求 Windows 开发 Run 自动启动或激活单实例桌面应用，但当前生产实现只把 `desktop-launcher` 注册进 Project composition：`WorkflowRuns.startChange()` 从未调用 Launcher，Launcher 又只读取手工环境变量 `REPOCTOPUS_DESKTOP_EXECUTABLE`。因此本次真实自举 Run 已经产生完整桌面插件快照，却没有桌面进程、没有启动诊断，也没有对应用例发现这条断链。

这不是可选配置问题，而是已接受需求和已勾选验收没有穿过生产入口。需要用一个窄修复 Change 补齐 Runtime → Launcher → Electron 单实例 → Desktop Host 的真实纵切，并把缺失的启动结果纳入诊断和遥测。

## What Changes

- 在权威 Change Run 创建或恢复并取得稳定 `runId` 后，由 `WorkflowRuns` 调用 Desktop Launcher；CLI 不直接拼装桌面进程，也不建立第二套启动路径。
- 为 Windows 提供确定性的启动目标解析：已安装产品使用安装器登记的应用入口，源码自举使用当前 Product Root 下固定的 Electron 与已构建桌面入口；环境变量只保留为显式覆盖和测试 seam，不再是正常启动的前置条件。
- 已安装协议调用只使用经过校验的绝对 `SystemRoot` Explorer 路径；Windows E2E 必须穿过真实协议 handler，不得把 URL 直接传给产品 executable 冒充协议链路。
- 以注入的 `DesktopInstanceProbe` seam 隔离 Launcher 与 Desktop Host discovery，并让 receiver producer 和 discovery consumer 共用一个版本化 health contract/parser，消除 service → app/host 的反向依赖和协议漂移。
- 把有界 `{ workspaceId, changeId, runId }` 上下文交给 Electron；已有实例继续通过现有 single-instance 协议聚焦对应 change。
- 将 Launcher 改为异步确认进程请求已被操作系统接受，捕获同步和异步 spawn 错误；失败只降低本地可观测性，不回滚或阻断 Change Run。
- 把 `started | activated | unavailable | unsupported` 结果作为稳定诊断和低基数观测事实输出，不泄漏可执行文件路径、命令行或本机目录。
- 增加从公共 `run start` 到真实 Launcher 的 characterization、集成和 Windows 桌面 E2E，防止“插件已注册”再次冒充“能力已接通”。
- 明确外部 Host Outcome 已持久化、但 Validator 尚未完成时的幂等重放语义：稳定内容相同的重复提交复用原 Outcome 与 `completedAt`，任何稳定字段漂移都 fail closed。

## Capabilities

### Modified Capabilities

- `desktop-observability-dashboard`: 强化 Windows Run 自动激活要求，明确 Runtime owner、安装态/源码自举解析、显式诊断和生产入口验收。
- `development-telemetry`: 增加有界 Desktop activation 请求与结果事实，使启动缺失、失败和单实例转交可审计。
- `plugin-composition`: 明确 Launcher Service 进入 composition 后必须由生产 Change Run 用例消费，禁止只注册无调用者的能力。
- `managed-work-execution`: 补齐外部 Host Outcome 在持久化边界中断后的幂等恢复、冲突拒绝和回滚边界。

## Impact

受影响范围包括 `WorkflowRuns`、Desktop Launcher、实例探测 seam、receiver health contract、项目 composition 配置、Electron 启动上下文、Windows 打包登记、`ManagedWorkExecutor` 重放、构建脚本、CLI 诊断、Trajectory/OTLP 映射、桌面启动测试与自举文档。不会修改五阶段状态机、Desktop 投影输入、SigNoZ 契约或 Renderer 权限边界；不会引入 daemon、轮询器或浏览器 UI。

DSH 仍只作为薄 Electron Shell、开发启动器和相邻测试的固定 MIT 参考；本修复不复制新的上游源码。若实现需要采用新的 DSH 文件，必须先更新 provenance 和摘要。
