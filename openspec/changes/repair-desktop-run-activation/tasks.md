# Tasks

## 1. 固定断链并定义启动契约

- [ ] 1.1 增加生产入口 characterization test，证明 `run.change.start` 当前未调用 Launcher、未返回 Desktop diagnostic，且 catalog membership 不能满足验收。
      **Blocked by:** None
      **Acceptance:** 新断言在旧实现上失败，并精确定位 `WorkflowRuns.startChange` 到 Launcher 的缺失调用
      **Verification:** 单独运行该测试并保存 red 失败摘要；实现后重跑为 green
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [ ] 1.2 定义 `DesktopLaunchTarget`、`DesktopActivationResult`、reason enum 和稳定诊断映射，限制所有字段与文本上限。
      **Blocked by:** 1.1
      **Acceptance:** schema/类型测试拒绝路径、命令正文和未知 reason；四类结果具有确定诊断 code
      **Verification:** 运行 Launcher 契约测试与 TypeScript typecheck
      **Requirements:** development-telemetry#桌面激活结果形成有界观测事实
- [ ] 1.3 为启动上下文增加安装协议编码/解析，并与现有参数协议共享 schema、大小和版本校验。
      **Blocked by:** 1.2
      **Acceptance:** 两种载体 round-trip 为同一上下文；畸形、超限、未知版本和非 repoctopus URL 被拒绝
      **Verification:** 运行 launch-context 表驱动单元测试
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用

## 2. 重建 Launcher 深边界

- [ ] 2.1 实现固定优先级目标解析，覆盖显式 override、源码 Product Root 和 Windows 安装协议，不把 Workspace 路径作为可执行来源。
      **Blocked by:** 1.2, 1.3
      **Acceptance:** 表驱动测试覆盖每个来源、缺失 artifact、无 handler、非 Windows 和路径脱敏；等价输入产生相同 target kind
      **Verification:** 运行目标解析测试，并检查所有启动目标均为 executable + arguments 数组
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [ ] 2.2 将 Launcher 改为异步 process adapter，等待 `spawn` 或有界失败并捕获异步 error/timeout。
      **Blocked by:** 2.1
      **Acceptance:** fake child process 证明同步 throw、异步 error、spawn、timeout 各映射一次且无未处理 error；安全 discovery 区分 started/activated；所有调用使用参数数组
      **Verification:** 运行 Launcher fake-process 与 instance-probe 测试，并在进程级测试中启用未处理 error 失败钩子
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [ ] 2.3 给 Project composition 注入稳定 Product Root，更新 plugin descriptor/source digest 和恢复兼容测试。
      **Blocked by:** 2.1
      **Acceptance:** composition identity 只绑定 Product Root 逻辑身份，不包含本机绝对路径；缺少或漂移配置 fail closed
      **Verification:** 运行 composition identity、plugin recovery 与路径脱敏测试
      **Requirements:** plugin-composition#生产组合中的桌面-Launcher-必须被权威用例消费

## 3. 接通 Change Run 生产入口

- [ ] 3.1 在 `WorkflowRuns.startChange()` 成功创建/恢复 Run 后调用 Launcher，并传递 Runtime 确认的 Workspace/change/run identity。
      **Blocked by:** 2.2, 2.3
      **Acceptance:** composition 集成测试从 `run.change.start` 捕获一次精确调用；generic run、status、doctor 和参数错误零调用
      **Verification:** 运行生产 Command Router → WorkflowRuns → Launcher 纵切测试
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用, plugin-composition#生产组合中的桌面-Launcher-必须被权威用例消费
- [ ] 3.2 将 activation 结果并入 `RuntimeResult.diagnostics`，确保 unavailable/unsupported 不回滚 Run 或丢失初始 Work receipt。
      **Blocked by:** 3.1
      **Acceptance:** started/activated 返回 info；unavailable/unsupported 返回 warning；四种结果下 Run identity、phase 和 Work 相同
      **Verification:** 运行四类结果的参数化集成测试并比较 Run checkpoint
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [ ] 3.3 持久化 activation Trajectory 并映射到统一 Observation envelope/OTLP 允许列表。
      **Blocked by:** 3.2
      **Acceptance:** 重放不重复、事件先持久化后导出；捕获 exporter 只看到稳定结果/reason，不含路径、URL payload、命令或错误正文
      **Verification:** 运行 Run Store crash/replay、Observation envelope 和捕获 OTLP exporter 测试
      **Requirements:** development-telemetry#桌面激活结果形成有界观测事实

## 4. 闭合源码自举与 Windows 安装

- [ ] 4.1 让标准源码构建生成 Desktop runtime artifact，并验证固定 Electron executable 的 Product Root 解析。
      **Blocked by:** 2.1
      **Acceptance:** 干净 `npm ci && npm run build` 后无需 `REPOCTOPUS_DESKTOP_EXECUTABLE` 即可解析开发启动目标；生成检查能发现 stale artifact
      **Verification:** 在临时 checkout 运行干净安装、标准 build 与 generated check
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [ ] 4.2 在 NSIS 配置登记 Repoctopus 激活协议，并让 Electron Main 把首次/第二实例 URL 上下文交给同一 single-instance owner。
      **Blocked by:** 1.3, 2.2
      **Acceptance:** package contents/config 检查和 Windows 安装 E2E 证明首次启动与已有实例均聚焦正确 change，且只存在一个有效 Host/Receiver
      **Verification:** 运行 desktop package check 与 Windows install/second-instance E2E
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [ ] 4.3 建立公共 CLI 自举 tracer：启动真实 Change Run、观察 Desktop 进程/上下文/Receiver，并验证 Dashboard 关闭时 Run 与远端 OTLP 不受影响。
      **Blocked by:** 3.3, 4.1, 4.2
      **Acceptance:** 进程外测试覆盖首次启动、二次转交、无 handler warning 和远端继续投递；测试结束无 Electron/Host/receiver/discovery 临时残留
      **Verification:** 运行公共 CLI tracer E2E，并执行 teardown 后进程/文件残留断言
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用, development-telemetry#桌面激活结果形成有界观测事实

## 5. 验证与交付

- [ ] 5.1 更新 Desktop、自举、构建和故障诊断文档，删除正常使用必须手配 executable 的暗示。
      **Blocked by:** 4.3
      **Acceptance:** 文档命令在干净源码环境和安装环境可执行，明确 unsupported/unavailable 不阻断 Run
      **Verification:** 按文档从干净源码 checkout 和已安装应用各执行一次启动路径
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
- [ ] 5.2 运行 OpenSpec strict、类型、lint、架构、provenance、单元、package/tracer E2E 和 Windows Desktop 验证。
      **Blocked by:** 5.1
      **Acceptance:** 全部正式检查通过；受控删除 `WorkflowRuns` 调用会使生产入口测试失败，证明测试对原断链敏感
      **Verification:** 保存正式验证命令、退出码与 mutation 失败摘要到 Evidence/验证报告
      **Requirements:** plugin-composition#生产组合中的桌面-Launcher-必须被权威用例消费
- [ ] 5.3 清理临时安装目录、Electron/Host 进程、receiver、discovery、日志和 payload，提交并推送验证 HEAD。
      **Blocked by:** 5.2
      **Acceptance:** 工作树干净、无临时进程或调试残留、远端分支包含验证提交
      **Verification:** 检查进程、临时路径、git status 与远端 branch OID
      **Requirements:** desktop-observability-dashboard#Windows-开发-Run-自动激活单实例桌面应用
