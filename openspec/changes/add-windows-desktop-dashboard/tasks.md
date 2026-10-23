# Tasks

## 1. 固定基线与桌面依赖

- [x] 1.1 在干净主线记录 Node、npm、Windows、现有遥测测试和构建基线，执行 `npm run check:upstream`、`npm run verify` 与 `npm run test:tracer-e2e` 并确认全部通过。
- [x] 1.2 选择并精确锁定 Electron、React、Vite 和 `electron-builder` 版本，审计固定 DSH Desktop 基线并登记许可证、来源、安装脚本、采用文件、修改方式与排除范围；更新 `third_party/dsh-adoption.json` 后执行 `npm install`、`npm run check:provenance` 和许可证检查，证明没有未登记依赖或 Comet 源码复制。
- [x] 1.3 在 `app/desktop` 建立 thin-main、preload、renderer、desktop-host 和共享契约边界；只在 Node-mode Desktop Host 子进程建立统一 App Boot 与 desktop composition。执行桌面 typecheck、lint、composition/进程契约测试和开发构建，证明 Application Plugin 只在必需 Service 就绪后激活，Electron Main 不承载 Cordis 产品 composition，Renderer 没有 Node/Cordis 权限。

## 2. 交付首个真实 OTLP 到桌面纵切

- [x] 2.1 定义版本化 `ObservationEnvelope`、稳定身份、规范摘要和纯领域映射，用 golden fixture 验证同一事件重复映射结果一致且不包含凭据、绝对路径、正文或命令输出。
- [x] 2.2 实现原子 Envelope Store 与每目的地独立 Cursor，使用故障注入测试覆盖远端成功/本地失败、本地成功/远端失败、进程退出和重放，并证明一个目的地不能推进另一个目的地。
- [x] 2.3 在可独立运行的 Desktop Host 中实现仅绑定回环地址的 headless OTLP/HTTP Trace、Log、Metric receiver 和会话认证，以协议测试验证合法请求、未授权、错误方法、错误 content type、超限、畸形请求和无正文诊断。
- [x] 2.4 实现最小 change projection reducer 与稳定事件去重，用乱序、重复和缺失 fixture 验证 active change、Run、阶段、新鲜度和 gap 状态确定性收敛。
- [x] 2.5 由 Electron Main 启动 Desktop Host，把 Host 的 receiver/projection snapshot 与 delta 通过私有 Node IPC、Main 和类型化 Preload 桥接到最小 Renderer；运行桌面集成测试证明一个真实 OTLP Run 事件无需轮询即可在窗口显示，Host 崩溃时 Shell 保持错误/重试能力。
- [x] 2.6 在 Runtime 的开发 Run preflight 接入最小 Desktop Launcher，在 Windows 开发 Run 持久化前启动或激活 Dashboard 并唤醒本地目的地重放；运行进程外纵切测试验证 Dashboard 启动失败只产生 warning，远端 mock 仍收到同一 envelope。
- [x] 2.7 把 Runtime 侧 Desktop Launcher 与本地目的地作为内置 Service/Contributor 加入 builtin catalog 和 project composition，把 Receiver、Projection 与 Desktop Application Plugin 加入 Desktop Host composition；Electron Main 只使用显式 Shell owner 管理原生资源。运行零桌面、正常桌面、依赖缺失、Host 重启和插件卸载测试，证明没有旁路构造或第二套产品容器。

## 3. 收敛完整遥测映射与多目的地恢复

- [x] 3.1 将 Workflow Run 的 Trace、Log 和 Metric exporter 迁移到共享 envelope 映射与 OTLP encoder，执行现有 tracer E2E 和新双目的地测试证明事件身份、允许列表属性与原语义一致。
- [x] 3.2 将 Evidence Attempt、节点、Artifact 与 Gate 映射迁移到共享 envelope，运行 Evidence 重放、superseded、Receipt 复用和隐私测试证明本地与远端投影一致。
- [x] 3.3 将 App 生命周期、平台事件、Delivery 和 Post-merge 映射迁移到共享 envelope，运行各领域现有测试与 golden fixture 证明 exporter 不再分别解释领域对象。
- [x] 3.4 补齐 Workspace、change、Run、父子执行、阶段、执行主体、任务、验证、阻塞、下一步动作和观测时间的可信属性映射，以正反 fixture 证明只导出已持久化事实且 Metric 不使用高基数实体身份。
- [x] 3.5 实现目的地启用、暂停、移除、保留上限、积压健康与 gap 记录，使用小容量故障测试验证超限可诊断、远端 Cursor 不重置且系统不宣称 exactly-once。
- [x] 3.6 更新遥测开发文档和配置示例，执行文档命令冒烟测试证明单远端、远端加桌面、桌面关闭和恢复四种配置按说明工作。

## 4. 完成桌面状态投影与开发者界面

- [x] 4.1 建立 Repoctopus Desktop 的语义组件、设计 token、窗口信息架构和完整状态矩阵，用可执行 Story/fixture 覆盖启动、空、稀疏、实时、追平、过期、gap、错误、完成和失败状态。
- [x] 4.2 实现 Workspace/change 导航与选择保持，用多 Workspace、多 change fixture 验证新上报不会抢占用户当前视图，首次无选择时才聚焦启动来源。
- [x] 4.3 实现 Run 概览、阶段、执行主体、任务进度和活动任务界面，用 OTLP fixture 验证字段缺失显示“尚未上报”且不扫描 OpenSpec、Git 或领域 Store。
- [x] 4.4 实现 Evidence、Gate、Artifact 元数据、blocker/Human Decision 和下一步动作界面，用脱敏 fixture 验证不显示正文、绝对路径、Prompt、回复或命令输出。
- [x] 4.5 实现最近事件、接收状态、目的地健康、新鲜度、重放和 gap 诊断，用 IPC 序列测试证明 snapshot 之后只应用更高版本 delta，序列缺口会重新取得 snapshot 而非开始轮询。
- [ ] 4.6 完成键盘导航、可见焦点、可访问名称、长文本、大数值和高 DPI Windows 布局验证；运行 Renderer 组件测试、自动化可访问性检查和关键状态截图审查并修复发现。
- [ ] 4.7 编写桌面状态语义、数据来源和故障诊断文档，以文档 fixture 证明用户可以区分实时、追平、过期和数据缺口，而不会把未知值理解为工作流事实。

## 5. 完成 Windows 生命周期、安全与本地恢复

- [ ] 5.1 实现随机端口、会话凭据、Windows 用户级 discovery 文件和所有者/freshness/进程验证，运行伪造 discovery、过期进程、端口劫持和错误凭据测试证明本地状态不能被未授权请求改变。
- [ ] 5.2 基于固定 DSH 的 Host process/backend controller、Node-mode 环境与 single-instance 模式实现 Electron 单实例锁、第二实例上下文转交、串行 start/retry/stop、有界 ready、优雅停止和强制终止升级；运行两个并发 Run 与 Host 崩溃恢复测试，证明只有一个 Shell 和一个有效 Receiver，两个 change 都可达且孤儿 Host 不会残留。
- [ ] 5.3 基于固定 DSH 的 Tray 与 Shell settings ownership 模式实现 `quit`、`tray`、`ask` 用户级关闭偏好和托盘“完全退出”，运行 Windows 自动化测试验证隐藏、重新打开、保存偏好、会话退出、Host 关闭和完全退出语义。
- [ ] 5.4 强化 Renderer sandbox、`contextIsolation`、CSP、IPC sender/origin 校验和版本化 allowlist，并扩展架构检查拒绝 Renderer 访问 Cordis/Node、Electron Main 承载产品 composition、入口绕过 Application Plugin 和桌面代码进入 Engine；以负向 fixture 证明每条边界都会失败。
- [ ] 5.5 实现投影 journal、原子 snapshot、重复收敛和阈值压缩，以高事件量基准验证重启恢复、内存上限、启动时间和 journal 损坏诊断满足记录的性能预算。
- [ ] 5.6 更新桌面安全、数据保留、关闭行为和恢复文档，执行卸载/重装 fixture 证明默认不误删 Workspace 事实并明确用户级 Dashboard 数据处理方式。

## 6. 生成并验证 Windows x64 安装产物

- [ ] 6.1 使用精确锁定的 `electron-builder` 配置 Windows x64 桌面打包、产品元数据、图标和确定性资源清单，把 Desktop Host 与 Renderer 作为显式资源打包；执行打包命令生成可安装产物并通过品牌、来源和 package contents 检查。
- [ ] 6.2 在干净 Windows 用户环境安装候选，运行启动、Run 自动激活、OTLP 接收、单实例、托盘、直接退出和卸载端到端测试并保存 Evidence。
- [ ] 6.3 为 macOS、Linux 和 Windows ARM64 返回明确 unsupported/experimental 状态，用平台矩阵测试证明构建能力不会被文档、CLI 或 UI 误报为正式支持。
- [ ] 6.4 测量安装体积、冷启动、空闲内存、活动内存和 receiver 吞吐，把预算与实测结果写入正式验证报告；超出预算时先消除非必要依赖和后台工作再重新验证。

## 7. 自举验证与交付

- [ ] 7.1 使用两个进程外 OTLP 目的地运行同一真实 Repoctopus 开发 Run，比较 envelope identity、信号语义和允许列表属性，证明桌面与远端 mock 接收相同规范数据且任一端故障不影响另一端。
- [ ] 7.2 用打包后的 Repoctopus 和安装后的 Dashboard 执行本 change 的真实自举 Run，验证窗口从接收上报实时呈现 change、Agent、任务、验证、阻塞和下一步状态，且没有 SigNoZ 查询、本地文件扫描或周期轮询。
- [ ] 7.3 执行 `npm run verify`、`npm run test:package-e2e`、`npm run test:tracer-e2e` 和 Windows Desktop E2E，生成正式验证报告并记录架构约束、恢复实验、安全检查、资源预算、未连接真实 SigNoZ 和未支持平台。
- [ ] 7.4 清理测试产生的临时安装目录、日志、端口监听、用户级 discovery、托盘进程、mock receiver 和 scratch Artifact；复查 Git 状态与运行进程证明没有遗留调试产物。

## Workflow follow-up

- 规划产物通过严格校验后先公开 Change 分支，并取得绑定精确远端 OID 的 Planning Approval；规划阶段不创建 Change MR。
- 剩余实现默认使用一个 Business MR；既有已合入的基础切片只作为目标分支历史，不替代本次批准，也不作为继续拆分 MR 的理由。
- Business MR 合入并完成 Post-merge Evidence 后，由 OpenSpec Provider 合入锁定目标、同步主规格并归档 change；关闭分支发布成功后才创建最终 Change MR。
- 桌面纵切稳定后，在能够访问团队服务的环境中把远端 OTLP endpoint 指向已部署 SigNoZ，验证查询结果与固定 envelope；该验证不部署本地 Docker Compose，也不阻塞本 change 的首个实现 MR。
