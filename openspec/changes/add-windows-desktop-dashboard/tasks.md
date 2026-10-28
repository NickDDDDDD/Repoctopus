# Tasks

## 1. 固定当前主线与候选复用边界

- [ ] 1.1 在全新 worktree 记录 `main`、Node、npm、Windows 和当前 Runtime workflow schema 基线；执行 `npm run check:upstream`、`npm run verify` 与 `npm run test:tracer-e2e`，保存可复现的通过结果。
- [ ] 1.2 对两个旧 Dashboard 分支建立 salvage ledger，逐行为记录来源提交、候选文件、当前规格映射、依赖、过时语义、重写范围、验证方法和采用结论；证明没有整体 merge、批量 cherry-pick 或继承旧任务勾选。
- [ ] 1.3 对候选代码执行负向语义扫描，拒绝独立修复阶段、merge 后自动化、已完成 Task 回退、旧 task action、旧 Run schema 和旧数据 reader；把误报与最终处置记入 ledger。
- [ ] 1.4 审计固定 DSH Desktop 基线并精确锁定 Electron、React、Vite 与 `electron-builder`；登记许可证、来源、安装脚本、采用行为切片、修改方式与排除范围，更新 `third_party/dsh-adoption.json`，并通过 provenance、漏洞与许可证检查。

## 2. 建立桌面进程与插件骨架

- [ ] 2.1 在 `app/desktop` 建立 thin-main、preload、renderer、desktop-host 和共享协议边界；运行 typecheck、lint 与开发构建，证明 Electron Main 不承载 Cordis 产品 composition，Renderer 没有 Node/Cordis 权限。
- [ ] 2.2 在 Node-mode Desktop Host 中建立统一 App Boot 与专用 Cordis composition，组合 Receiver、Projection Store 和 Desktop Application Plugin；通过依赖缺失与正常启动测试证明 Application Plugin 只在所需 Service 就绪后发布 ready。
- [ ] 2.3 在 Runtime composition 中注册 Desktop Launcher 与本地遥测目的地 Contributor；通过无桌面、桌面可用和插件卸载测试证明所有入口只经版本化应用服务，不存在旁路构造。
- [ ] 2.4 定义 Shell ↔ Host、Main ↔ Preload 与 Preload ↔ Renderer 的版本化协议、大小上限和错误分类；以未知版本、未知 channel、错误 sender/origin 和超限 payload 负向测试证明 fail closed。
- [ ] 2.5 实现串行 Host start/retry/stop controller、ready deadline、stderr 上限、优雅停止和强制终止升级；通过崩溃与退出测试证明 Shell 可恢复且没有孤儿 Host。
- [ ] 2.6 实现 Electron 单实例锁和第二实例启动上下文转交；用两个并发 Run 验证临时第二进程只转交 Workspace/change/Run 后退出，始终只有一个 Shell 和一个有效 Receiver。

## 3. 交付统一 envelope 与双目的地纵切

- [ ] 3.1 定义当前唯一的版本化 `ObservationEnvelope`、稳定身份、规范摘要和允许列表映射；用 golden fixture 验证同一领域事实重复映射结果一致且不包含凭据、绝对路径、正文、Prompt 或命令输出。
- [ ] 3.2 为五阶段、Build 五个 action、Work、Task、attempt、Host、Validator、continuation、Skill、Human Decision、验证与恢复事实建立关联 fixture；证明缺失字段保持缺失且没有第二套生命周期解释。
- [ ] 3.3 实现原子 Envelope Store 与每目的地独立 Cursor；以远端成功/本地失败、本地成功/远端失败、进程退出和重放故障注入证明一个目的地不能推进另一个目的地。
- [ ] 3.4 在 Desktop Host 实现仅绑定回环地址的 OTLP/HTTP Trace、Log、Metric receiver 和会话认证；协议测试覆盖合法请求、未授权、错误方法、错误 content type、超限、畸形请求和无正文诊断。
- [ ] 3.5 实现最小 projection reducer、稳定事件去重和 snapshot/delta 序列；用乱序、重复、缺失和重启 fixture 验证 active change、阶段、Build action、新鲜度与 gap 确定性收敛。
- [ ] 3.6 把 Receiver snapshot/delta 经私有 Node IPC、Main 和类型化 Preload 桥接到最小 Renderer；集成测试证明真实 OTLP 事件无需轮询即可显示，序列缺口会请求新 snapshot。
- [ ] 3.7 接入最小 Desktop Launcher 并唤醒本地目的地重放；进程外纵切测试证明 Dashboard 启动失败只产生 warning，远端 mock 仍收到同一 envelope。

## 4. 收敛完整遥测映射与恢复

- [ ] 4.1 将 Workflow Run 的 Trace、Log 和 Metric exporter 迁移到共享 envelope 映射与 OTLP encoder；现有 tracer E2E 和双目的地测试必须证明事件身份、允许列表与主规格语义不变。
- [ ] 4.2 将 Build Configure、Plan、Plan Evidence、Execute、Check 与 fallback 映射接入共享 envelope；fixture 必须证明 Verify 返回 Build 时失效的是受影响 Evidence/Package/Check，而不是重开已完成 Task。
- [ ] 4.3 将 Skill resolved/delivered/consumed、Work Package、Host Outcome 和 Validator 映射接入共享 envelope；正反测试必须区分已交付、已消费、消费校验失败和未上报。
- [ ] 4.4 将 Evidence Attempt、节点、Artifact 与 Gate 映射迁移到共享 envelope；运行重放、superseded、Receipt 复用和隐私测试，证明本地与远端语义一致。
- [ ] 4.5 将 App 生命周期、平台事件和轻量 Archive 映射迁移到共享 envelope；证明 exporter 不再分别解释领域对象且没有 Webhook、等待远端合入或 merge 后自动化状态。
- [ ] 4.6 实现目的地启用、暂停、移除、保留上限、积压健康和 gap 记录；小容量故障测试必须证明超限可诊断、远端 Cursor 不重置且系统不宣称 exactly-once。
- [ ] 4.7 更新遥测开发文档和配置示例；冒烟测试覆盖单远端、远端加桌面、桌面关闭、追平和移除五种配置。

## 5. 完成开发者 Dashboard 体验

- [ ] 5.1 建立 Repoctopus Desktop 的语义组件、设计 token、响应式窗口结构和完整状态矩阵；可执行 fixture 覆盖启动、空、稀疏、追平、实时、过期、gap、错误、停滞、等待、返工、完成和失败。
- [ ] 5.2 实现 Workspace/change 导航与选择保持；多 Workspace、多 change fixture 必须证明新上报不抢占当前视图，首次无选择时才聚焦启动来源。
- [ ] 5.3 实现 `Open → Design → Build → Verify → Archive` 主阶段 rail、阶段尝试与时间信息；缺失事实显示“尚未上报”，不得扫描 OpenSpec、Git 或领域 Store。
- [ ] 5.4 在 Build 展开 `Configure → Plan → Plan Evidence → Execute → Check`，并显示当前 Work、Task、attempt、Host、Validator、Runtime continuation 与最近活动；fallback fixture 必须保留历史尝试。
- [ ] 5.5 实现 action/augmentation Skill 的 resolved、delivered、consumed 与失败状态；UI 文案必须说明 consumed 是 Runtime 校验的 Host 证明，不宣称读取 Agent 内部思考。
- [ ] 5.6 实现 Evidence、Gate、Human Decision、Artifact 元数据和下一步动作界面；脱敏 fixture 必须证明不显示正文、绝对路径、Prompt、回复或命令输出。
- [ ] 5.7 实现流转、执行、质量、遥测四类可解释健康状态和下钻；fixture 必须区分远端积压、Work 停滞、Verify 返工与阶段阻塞，不生成无依据总分。

## 6. 完成 Windows 生命周期、安全与本地恢复

- [ ] 6.1 实现随机端口、会话凭据、Windows 用户级 discovery 文件和所有者/freshness/进程验证；伪造 discovery、过期进程、端口劫持和错误凭据测试必须失败。
- [ ] 6.2 实现 `quit`、`tray`、`ask` 用户级关闭偏好和托盘“完全退出”；Windows 自动化测试覆盖隐藏、重新打开、保存偏好、会话退出、Host 关闭和完全退出。
- [ ] 6.3 强化 Renderer sandbox、`contextIsolation`、CSP 和 IPC allowlist；架构负向测试拒绝 Renderer 访问 Node/Cordis、Electron Main 承载产品 composition、入口绕过 Application Plugin 和桌面代码进入 Engine。
- [ ] 6.4 实现 projection journal、原子 snapshot、重复收敛和阈值压缩；高事件量基准验证重启恢复、内存上限、启动时间和损坏诊断满足记录的预算。
- [ ] 6.5 完成键盘导航、可见焦点、可访问名称、长文本、大数值和高 DPI Windows 布局验证；运行组件测试、自动化可访问性检查和关键状态截图审查。
- [ ] 6.6 更新桌面状态语义、安全、数据保留、关闭行为和故障诊断文档；文档 fixture 必须帮助用户区分实时、追平、过期、缺口与未知事实。

## 7. 打包、自举与交付

- [ ] 7.1 使用精确锁定的 `electron-builder` 配置 Windows x64 打包、产品元数据、图标和确定性资源清单；生成安装产物并通过品牌、来源和 package contents 检查。
- [ ] 7.2 在干净 Windows 用户环境安装候选，运行启动、Run 自动激活、OTLP 接收、单实例、托盘、直接退出和卸载端到端测试并保存 Evidence。
- [ ] 7.3 使用两个进程外 OTLP 目的地执行同一真实开发 Run；比较 envelope identity、信号语义和允许列表，证明任一端故障不影响另一端。
- [ ] 7.4 用安装后的 Dashboard 执行本 change 的真实自举 Run；验证五阶段、Build 子动作、Skill、验证、等待、恢复和四类健康状态实时呈现，且没有 SigNoZ 查询、本地文件扫描或周期轮询。
- [ ] 7.5 执行完整验证、平台矩阵和正式报告，证明 macOS、Linux 与 Windows ARM64 明确返回 unsupported/experimental，并记录架构约束、恢复实验、安全检查、资源预算、未连接真实 SigNoZ 与未迁移旧数据；清理临时安装目录、日志、端口、discovery、托盘进程、mock receiver 与 scratch Artifact。

## Workflow follow-up

- Open 与 Design 分别通过 Runtime 的 Human Decision 审查后进入 Build；Build 按 Configure、Plan、Plan Evidence、Execute、Check 推进，Runtime 校验 Outcome 后才转换状态。
- 完整 change 通常使用一个实现 MR；必要时允许多个实现 MR，但不得把一次 Work 或一次 commit 误当作完整 change。
- 实现 MR 合入后，在独立的轻量 Archive 分支/MR 中由 OpenSpec Provider 同步主规格并归档 change；不等待业务 MR，不使用 Webhook 或 merge 后自动化。
- 桌面纵切稳定后，在可访问团队服务的环境中把远端 OTLP endpoint 指向已部署 SigNoZ，验证查询结果与固定 envelope；该验证不部署本地 Docker Compose，也不阻塞本 change 的首个实现 MR。
