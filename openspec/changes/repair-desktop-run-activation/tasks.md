# Tasks

## 1. 固定断链并定义启动契约

- [x] 1.2 定义 `DesktopLaunchTarget`、`DesktopActivationResult`、reason enum 和稳定诊断映射，限制所有字段与文本上限。
      **Blocked by:** None
      **Acceptance:** schema/类型测试拒绝路径、命令正文和未知 reason；四类结果具有确定诊断 code
      **Verification:** 运行 Launcher 契约测试与 TypeScript typecheck
      **Requirements:** development-telemetry#桌面激活结果形成有界观测事实
- [x] 1.3 为启动上下文增加安装协议编码/解析，并与现有参数协议共享 schema、大小和版本校验。
      **Blocked by:** 1.2
      **Acceptance:** 两种载体 round-trip 为同一上下文；畸形、超限、未知版本和非 repoctopus URL 被拒绝
      **Verification:** 运行 launch-context 表驱动单元测试
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用

## 2. 重建 Launcher 深边界

- [x] 2.1 实现固定优先级目标解析，覆盖显式 override、源码 Product Root 和 Windows 安装协议，不把 Workspace 路径作为可执行来源。
      **Blocked by:** 1.2, 1.3
      **Acceptance:** 表驱动测试覆盖每个来源、缺失 artifact、无 handler、非 Windows 和路径脱敏；等价输入产生相同 target kind
      **Verification:** 运行目标解析测试，并检查所有启动目标均为 executable + arguments 数组
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 2.2 将 Launcher 改为异步 process adapter，等待 `spawn` 或有界失败并捕获异步 error/timeout。
      **Blocked by:** 2.1
      **Acceptance:** fake child process 证明同步 throw、异步 error、spawn、timeout 各映射一次且无未处理 error；安全 discovery 区分 started/activated；所有调用使用参数数组
      **Verification:** 运行 Launcher fake-process 与 instance-probe 测试，并在进程级测试中启用未处理 error 失败钩子
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 2.3 给 Project composition 注入稳定 Product Root，更新 plugin descriptor/source digest 和恢复兼容测试。
      **Blocked by:** 2.1
      **Acceptance:** composition identity 只绑定 Product Root 逻辑身份，不包含本机绝对路径；缺少或漂移配置 fail closed
      **Verification:** 运行 composition identity、plugin recovery 与路径脱敏测试
      **Requirements:** plugin-composition#生产组合中的桌面-Launcher-必须被权威用例消费

## 3. 接通 Change Run 生产入口

- [x] 3.1 增加生产入口 characterization test，证明 `run.change.start` 当前未调用 Launcher、未返回 Desktop diagnostic，且 catalog membership 不能满足验收。
      **Blocked by:** 2.2, 2.3
      **Acceptance:** 新断言在旧实现上失败，并精确定位 `WorkflowRuns.startChange` 到 Launcher 的缺失调用
      **Verification:** 单独运行该测试并保存 red 失败摘要；实现后重跑为 green
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 3.2 在 `WorkflowRuns.startChange()` 成功创建/恢复 Run 后调用 Launcher，并传递 Runtime 确认的 Workspace/change/run identity。
      **Blocked by:** 3.1
      **Acceptance:** composition 集成测试从 `run.change.start` 捕获一次精确调用；generic run、status、doctor 和参数错误零调用
      **Verification:** 运行生产 Command Router → WorkflowRuns → Launcher 纵切测试
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用, plugin-composition#生产组合中的桌面-Launcher-必须被权威用例消费
- [x] 3.3 将 activation 结果并入 `RuntimeResult.diagnostics`，确保 unavailable/unsupported 不回滚 Run 或丢失初始 Work receipt。
      **Blocked by:** 3.2
      **Acceptance:** started/activated 返回 info；unavailable/unsupported 返回 warning；四种结果下 Run identity、phase 和 Work 相同
      **Verification:** 运行四类结果的参数化集成测试并比较 Run checkpoint
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 3.4 持久化 activation Trajectory 并映射到统一 Observation envelope/OTLP 允许列表。
      **Blocked by:** 3.3
      **Acceptance:** 重放不重复、事件先持久化后导出；捕获 exporter 只看到稳定结果/reason，不含路径、URL payload、命令或错误正文
      **Verification:** 运行 Run Store crash/replay、Observation envelope 和捕获 OTLP exporter 测试
      **Requirements:** development-telemetry#桌面激活结果形成有界观测事实

## 4. 闭合源码自举与 Windows 安装

- [x] 4.1 让标准源码构建生成 Desktop runtime artifact，并验证固定 Electron executable 的 Product Root 解析。
      **Blocked by:** 2.1
      **Acceptance:** 干净 `npm ci && npm run build` 后无需 `REPOCTOPUS_DESKTOP_EXECUTABLE` 即可解析开发启动目标；生成检查能发现 stale artifact
      **Verification:** 在临时 checkout 运行干净安装、标准 build 与 generated check
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 4.2 在 NSIS 配置登记 Repoctopus 激活协议，并让 Electron Main 把首次/第二实例 URL 上下文交给同一 single-instance owner。
      **Blocked by:** 1.3, 2.2
      **Acceptance:** package contents/config 检查和 Windows 安装 E2E 证明首次启动与已有实例均聚焦正确 change，且只存在一个有效 Host/Receiver
      **Verification:** 运行 desktop package check 与 Windows install/second-instance E2E
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 4.3 建立公共 CLI 自举 tracer：启动真实 Change Run、观察 Desktop 进程/上下文/Receiver，并验证 Dashboard 关闭时 Run 与远端 OTLP 不受影响。
      **Blocked by:** 3.4, 4.1, 4.2
      **Acceptance:** 进程外测试覆盖首次启动、二次转交、无 handler warning 和远端继续投递；测试结束无 Electron/Host/receiver/discovery 临时残留
      **Verification:** 运行公共 CLI tracer E2E，并执行 teardown 后进程/文件残留断言
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用, development-telemetry#桌面激活结果形成有界观测事实

## 5. 验证与交付

- [x] 5.1 更新 Desktop、自举、构建和故障诊断文档，删除正常使用必须手配 executable 的暗示。
      **Blocked by:** 4.3
      **Acceptance:** 文档命令在干净源码环境和安装环境可执行，明确 unsupported/unavailable 不阻断 Run
      **Verification:** 按文档从干净源码 checkout 和已安装应用各执行一次启动路径
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 5.2 运行 OpenSpec strict、类型、lint、架构、provenance、单元、package/tracer E2E 和 Windows Desktop 验证。
      **Blocked by:** 5.1
      **Acceptance:** 全部正式检查通过；受控删除 `WorkflowRuns` 调用会使生产入口测试失败，证明测试对原断链敏感
      **Verification:** 保存正式验证命令、退出码与 mutation 失败摘要到 Evidence/验证报告
      **Requirements:** plugin-composition#生产组合中的桌面-Launcher-必须被权威用例消费
- [x] 5.3 清理临时安装目录、Electron/Host 进程、receiver、discovery、日志和 payload，提交并推送验证 HEAD。
      **Blocked by:** 5.2
      **Acceptance:** 工作树干净、无临时进程或调试残留、远端分支包含验证提交
      **Verification:** 检查进程、临时路径、git status 与远端 branch OID
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用

## 6. Build Check 返工闭环

- [x] 6.1 正式化并验证已持久化外部 Host Outcome 的稳定内容幂等重放。
      **Blocked by:** None
      **Acceptance:** 同一 invocation 的等价重放保留原 `completedAt`、不重复 `work.host-completed` 并继续 Validator；status、summary、layers、result、findings 或 delegation receipts 任一漂移均 fail closed
      **Verification:** 运行 ManagedWorkExecutor 等价/冲突参数化测试与中断恢复进程测试
      **Requirements:** managed-work-execution#受管-Work-必须从原执行断点恢复
- [x] 6.2 抽取中立的 receiver health contract、serializer/parser 与有界响应规则，让 producer 和 discovery consumer 共享。
      **Blocked by:** None
      **Acceptance:** 单一 protocol 常量和 parser 拒绝未知字段/版本、错误 pid、content type 与超限响应；producer 不再复制 response shape
      **Verification:** 运行 shared contract、OTLP receiver 与 discovery fallback 测试，并检查重复协议字符串为零
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 6.3 建立 `DesktopInstanceProbe` seam，由 Project composition 注入 receiver discovery adapter，移除 Launcher 对 `app/desktop/host` 的反向依赖。
      **Blocked by:** 6.2
      **Acceptance:** `services/desktop-launcher.ts` 不导入或构造 Host 实现；生产 composition 与测试 adapter 均穿过同一窄 interface；安全 discovery 行为保持不变
      **Verification:** 运行 Launcher/composition/discovery 测试与 architecture source-boundary 检查
      **Requirements:** plugin-composition#生产组合中的桌面-Launcher-必须被权威用例消费
- [x] 6.4 用 Windows 标准 `App Paths` 替换 Explorer 安装目标，并直接启动经过校验的 `Repoctopus.exe` 与受控 URI 参数。
      **Blocked by:** None
      **Acceptance:** 安装器在当前 scope 登记协议与 `App Paths\Repoctopus.exe`；Launcher 仅通过绝对 `reg.exe` 读取默认值并校验绝对路径、basename、可访问性和 handler；缺失或伪造登记返回 bounded unavailable；启动使用 executable + URI 参数数组且诊断不泄漏路径
      **Verification:** 运行 installer contract、Windows registry target-resolution 表驱动测试、Launcher process 测试与 lint/typecheck
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 6.5 修改 Windows 安装 E2E，使冷启动和第二实例请求穿过真实 `App Paths` 发现、产品 executable 与 single-instance owner。
      **Blocked by:** 6.3, 6.4
      **Acceptance:** 测试不注入 executable override、不硬编码安装路径且不伪造 registry；首个 URI 经冷启动 `argv` 到达 Shell，第二个 URI 经 `second-instance` 选择正确 Run；协议/App Paths 原状态在 finally 精确恢复且只有一个有效 Host/Receiver
      **Verification:** 构建/安装当前包并运行 Windows installed-activation E2E、package check 与 registry/进程/目录残留检查
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [x] 6.6 增加 public CLI 无 handler 的进程级验收，证明 warning、Run 持久化和远端 OTLP 独立继续。
      **Blocked by:** 6.3, 6.4
      **Acceptance:** 隔离环境没有 source target、override、App Paths 或 handler 时返回 `desktop.activation.unavailable`；同一命令仍创建权威 Change Run并向捕获 receiver 投递非桌面依赖的远端事实
      **Verification:** 运行 public CLI tracer E2E，并核对退出码、诊断、Run checkpoint、OTLP payload 与 teardown
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用, development-telemetry#桌面激活结果形成有界观测事实
- [ ] 6.7 重新运行完整验证、更新 Evidence/验证报告并清理所有本轮临时进程、registry、安装目录、日志和 payload 后推送验证 HEAD。
      **Blocked by:** 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
      **Acceptance:** OpenSpec strict、类型、lint、架构、provenance、单元、package/tracer/Windows E2E 与 mutation 全部通过；报告绑定新实现 commit/包摘要；工作树和外部临时状态干净且远端 OID 等于 HEAD
      **Verification:** 运行正式 verify/package/tracer/desktop 命令、干净 checkout、mutation、残留和 Git/remote 检查并保存 Evidence
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用, managed-work-execution#受管-Work-必须从原执行断点恢复
