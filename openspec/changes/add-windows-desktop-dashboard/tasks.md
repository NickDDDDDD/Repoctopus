# Tasks

## 1. 固定当前主线与候选复用边界

- [x] 1.1 安装锁定依赖并记录全新 worktree 的主线、工具链与 Runtime 基线。
      **Blocked by:** None
      **Acceptance:** `npm ci` 使用 lockfile 成功；`main`、Node、npm、Windows 和 workflow schema 已记录；`npm run check:upstream`、`npm run verify` 与 `npm run test:tracer-e2e` 具有可复现结果
      **Requirements:** development-telemetry#Trajectory 先于遥测导出持久化
- [x] 1.2 为两个旧 Dashboard 分支建立按行为切片的 salvage ledger。
      **Blocked by:** 1.1
      **Acceptance:** 每个候选记录来源提交、文件、当前规格映射、外部前提、过时语义、重写范围、核验方法和采用结论；没有整体导入、批量 cherry-pick 或旧任务完成度继承
      **Requirements:** desktop-observability-dashboard#桌面状态只由接收到的观测数据投影
- [x] 1.3 对候选代码执行旧语义负向扫描并处置发现。
      **Blocked by:** 1.2
      **Acceptance:** 独立修复阶段、merge 后自动化、已完成 Task 回退、旧 task action、旧 Run schema 和旧数据 reader 均被拒绝或重写；误报与处置已进入 ledger
      **Requirements:** desktop-observability-dashboard#主视图呈现完整五阶段与 Build 子动作
- [x] 1.4 审计 DSH 基线并复核已锁定的桌面依赖。
      **Blocked by:** 1.1
      **Acceptance:** Electron、React、Vite 与 `electron-builder` 使用精确版本；许可证、来源、安装脚本、DSH 行为切片、修改与排除范围已登记；provenance、漏洞和许可证检查通过
      **Requirements:** plugin-composition#桌面能力使用跨进程 Cordis composition, desktop-observability-dashboard#首个发布只承诺 Windows x64 支持

## 2. 建立桌面进程与插件骨架

- [x] 2.1 收敛现有 thin-main、preload、renderer、desktop-host 和共享协议边界。
      **Blocked by:** 1.3, 1.4
      **Acceptance:** 现有 foundation 复用清单已记录且没有平行 Shell；桌面 typecheck、lint 与开发构建通过；Electron Main 不承载 Cordis 产品 composition；Renderer 没有 Node 或 Cordis 权限
      **Requirements:** plugin-composition#外部入口作为 Application Plugin 接入, desktop-observability-dashboard#桌面界面保持最小权限边界
- [x] 2.2 深化现有 Node-mode Desktop Host App Boot 与专用 Cordis composition。
      **Blocked by:** 2.1
      **Acceptance:** 现有 `bootDesktopComposition()` 扩展后组合 Receiver、Projection Store 和 Desktop Application Plugin；依赖缺失时不发布 ready；正常启动契约测试通过
      **Requirements:** plugin-composition#桌面能力使用跨进程 Cordis composition, plugin-composition#桌面插件资源遵循 Cordis 生命周期
- [x] 2.3 在 Runtime composition 中注册 Desktop Launcher 与本地遥测目的地 Contributor。
      **Blocked by:** 2.2
      **Acceptance:** 无桌面、桌面可用和插件卸载测试通过；入口只经版本化应用服务；不存在旁路构造
      **Requirements:** plugin-composition#外部入口作为 Application Plugin 接入, plugin-composition#桌面能力使用跨进程 Cordis composition
- [x] 2.4 定义 Shell、Host、Preload 与 Renderer 的版本化协议。
      **Blocked by:** 2.1
      **Acceptance:** 协议声明版本、大小上限和错误分类；未知版本、未知 channel、错误 sender/origin 与超限 payload 均 fail closed
      **Requirements:** desktop-observability-dashboard#桌面界面保持最小权限边界, plugin-composition#外部入口作为 Application Plugin 接入
- [x] 2.5 扩展现有 Desktop Host 串行启动、重试和停止控制器。
      **Blocked by:** 2.2, 2.4
      **Acceptance:** ready deadline、stderr 上限、优雅停止和强制终止升级均有测试；Host 崩溃后 Shell 可恢复；退出后没有孤儿 Host
      **Requirements:** plugin-composition#桌面插件资源遵循 Cordis 生命周期
- [x] 2.6 扩展现有 Electron 单实例以转交启动上下文。
      **Blocked by:** 2.5
      **Acceptance:** 两个并发 Run 只产生一个 Shell 和一个有效 Receiver；临时第二进程只转交 Workspace/change/Run 后退出
      **Requirements:** desktop-observability-dashboard#Windows 开发 Run 自动激活单实例桌面应用

## 3. 交付统一 envelope 与双目的地纵切

- [x] 3.1 定义当前唯一的 `ObservationEnvelope` 与允许列表映射。
      **Blocked by:** 1.1
      **Acceptance:** schema 版本、稳定身份和规范摘要已定义；golden fixture 证明重复映射稳定；结果不包含凭据、绝对路径、正文、Prompt 或命令输出
      **Requirements:** development-telemetry#每个领域事实只产生一份规范观测 envelope
- [x] 3.2 建立工作流权威事实的关联 fixture。
      **Blocked by:** 3.1
      **Acceptance:** fixture 覆盖五阶段、Build 五个 action、Work、Task、attempt、Host、Validator、continuation、Skill、Human Decision、验证与恢复；缺失字段保持缺失；没有第二套生命周期解释
      **Requirements:** development-telemetry#规范 envelope 保留桌面投影所需的权威关联
- [x] 3.3 实现原子 Envelope Store 与每目的地独立 Cursor。
      **Blocked by:** 3.1
      **Acceptance:** 远端成功/本地失败、本地成功/远端失败、进程退出和重放故障注入通过；一个目的地不能推进另一个目的地
      **Requirements:** development-telemetry#Trajectory 先于遥测导出持久化, development-telemetry#遥测目的地独立确认和恢复
- [x] 3.4 实现受保护的本机 OTLP/HTTP receiver。
      **Blocked by:** 2.2, 3.1
      **Acceptance:** Receiver 只绑定回环地址并验证会话凭据；Trace、Log、Metric 合法请求通过；未授权、错误方法、错误 content type、超限和畸形请求被拒绝且诊断不含正文；Receiver 与 Projection 在 Desktop Host App Boot 中由专用 composition 注册并通过启动测试
      **Requirements:** desktop-observability-dashboard#桌面接收器接纳标准 OTLP 上报
- [x] 3.5 实现确定性 projection reducer 与 snapshot/delta 序列。
      **Blocked by:** 3.2, 3.4
      **Acceptance:** 乱序、重复、缺失和重启 fixture 对 active change、阶段、Build action、新鲜度与 gap 产生确定性结果；重复事件收敛为 no-op
      **Requirements:** desktop-observability-dashboard#重放和重复投递收敛为一致投影, desktop-observability-dashboard#桌面状态只由接收到的观测数据投影
- [x] 3.6 把 Receiver 投影经类型化 IPC 桥接到最小 Renderer。
      **Blocked by:** 2.4, 3.5
      **Acceptance:** 真实 OTLP 事件无需轮询即可显示；snapshot 后只应用更高序列 delta；序列缺口请求新 snapshot；采用自 DSH 的桌面实现逐文件登记 provenance 并通过来源校验
      **Requirements:** desktop-observability-dashboard#接收驱动桌面实时更新
- [x] 3.7 接入最小 Desktop Launcher 与本地目的地重放。
      **Blocked by:** 2.3, 2.6, 3.3, 3.6
      **Acceptance:** Windows 开发 Run 可以通过 Runtime composition 与 builtin catalog 中已注册的 Contributor 启动或激活 Dashboard 并唤醒重放；Dashboard 启动失败只产生 warning；远端 mock 仍收到同一 envelope；外部 Host 可经 CLI 上报结构化 planning finding，防止实现越过批准的 Package 作用域
      **Requirements:** desktop-observability-dashboard#Windows 开发 Run 自动激活单实例桌面应用, development-telemetry#本地实时消费不改变远端 OTLP 契约

## 4. 收敛完整遥测映射与恢复

- [x] 4.1 将 Workflow Run exporter 迁移到共享 envelope 映射与 OTLP encoder。
      **Blocked by:** 3.3
      **Acceptance:** 现有 tracer E2E 与双目的地测试通过；事件身份、允许列表和主规格语义保持一致；目的地不再解释领域对象
      **Requirements:** development-telemetry#每个领域事实只产生一份规范观测 envelope
- [x] 4.2 映射 Build action 与 fallback 事实。
      **Blocked by:** 3.2, 4.1
      **Acceptance:** Configure、Plan、Plan Evidence、Execute、Check 与 fallback 均可投影；Verify finding 只失效受影响 Evidence、Package 或 Check；已完成 Task 保持完成
      **Requirements:** development-telemetry#规范 envelope 保留桌面投影所需的权威关联, desktop-observability-dashboard#主视图呈现完整五阶段与 Build 子动作
- [x] 4.3 映射 Skill、Work Package、Host Outcome 与 Validator 事实。
      **Blocked by:** 3.2, 4.1
      **Acceptance:** 正反 fixture 区分 resolved、delivered、consumed、消费校验失败和未上报；记录不包含 Skill 正文或 Agent 内部思考
      **Requirements:** development-telemetry#规范 envelope 保留桌面投影所需的权威关联, desktop-observability-dashboard#当前 Work 显示 Skill 装填与消费状态
- [x] 4.4 将 Evidence、Artifact 与 Gate 映射迁移到共享 envelope。
      **Blocked by:** 4.1
      **Acceptance:** Evidence 重放、superseded、Receipt 复用和隐私测试通过；本地与远端获得相同关联语义
      **Requirements:** development-telemetry#每个领域事实只产生一份规范观测 envelope, desktop-observability-dashboard#桌面界面保持最小权限边界
- [x] 4.5 将 App 生命周期、平台事件和轻量 Archive 映射迁移到共享 envelope。
      **Blocked by:** 4.1
      **Acceptance:** exporter 不再分别解释领域对象；事件模型不包含 Webhook、等待远端合入或 merge 后自动化状态
      **Requirements:** development-telemetry#规范 envelope 保留桌面投影所需的权威关联
- [x] 4.6 实现目的地保留、积压与 gap 治理。
      **Blocked by:** 3.3
      **Acceptance:** 启用、暂停、移除、容量上限、积压健康和 gap 均有测试；超限可诊断；远端 Cursor 不重置；文档不宣称 exactly-once
      **Requirements:** development-telemetry#遥测目的地独立确认和恢复, desktop-observability-dashboard#重放和重复投递收敛为一致投影
- [x] 4.7 更新遥测配置与开发文档。
      **Blocked by:** 4.2, 4.3, 4.4, 4.5, 4.6
      **Acceptance:** 文档命令冒烟测试覆盖单远端、远端加桌面、桌面关闭、追平和移除五种配置
      **Requirements:** development-telemetry#本地实时消费不改变远端 OTLP 契约

## 5. 完成开发者 Dashboard 体验

- [x] 5.1 扩展权威 projection read model，并在其上建立语义组件、设计 token、窗口结构与状态矩阵。
      **Blocked by:** 3.6, 4.2, 4.3, 4.4, 4.6
      **Acceptance:** Desktop Projection、Desktop Application/Host、共享 snapshot/delta 契约、Renderer 与测试共同覆盖五阶段及尝试历史、Build 五个 action、Work/Task/attempt、Host、Validator、continuation、Skill 生命周期、Decision、Evidence、fallback、目的地健康和四类健康原因；可执行 fixture 覆盖启动、空、稀疏、追平、实时、过期、gap、错误、停滞、等待、返工、完成和失败；缺失事实保持 `not-reported`，Renderer 不读取 raw envelope 或推断领域状态，组件不依赖 Comet 源码
      **Requirements:** desktop-observability-dashboard#桌面状态只由接收到的观测数据投影, desktop-observability-dashboard#主视图呈现完整五阶段与 Build 子动作, desktop-observability-dashboard#当前 Work 显示 Skill 装填与消费状态, desktop-observability-dashboard#Dashboard 区分四类可解释健康状态
- [x] 5.2 实现 Workspace/change 导航与选择保持。
      **Blocked by:** 5.1
      **Acceptance:** 多 Workspace、多 change fixture 证明新上报不抢占当前视图；首次无选择时才聚焦启动来源
      **Requirements:** desktop-observability-dashboard#桌面状态只由接收到的观测数据投影
- [x] 5.3 实现五阶段主体导航。
      **Blocked by:** 4.2, 5.1
      **Acceptance:** `Open → Design → Build → Verify → Archive` 显示状态、尝试与可信时间；缺失事实显示尚未上报；实现不扫描 OpenSpec、Git 或领域 Store
      **Requirements:** desktop-observability-dashboard#主视图呈现完整五阶段与 Build 子动作
- [x] 5.4 实现 Build action 与当前执行详情。
      **Blocked by:** 5.3
      **Acceptance:** Configure、Plan、Plan Evidence、Execute、Check 及当前 Work、Task、attempt、Host、Validator、continuation 与最近活动可见；fallback 保留历史尝试
      **Requirements:** desktop-observability-dashboard#主视图呈现完整五阶段与 Build 子动作
- [x] 5.5 实现 Skill 装填与消费状态。
      **Blocked by:** 4.3, 5.1
      **Acceptance:** action/augmentation Skill 分角色显示 resolved、delivered、consumed、失败和未上报；文案说明 consumed 是 Runtime 校验的 Host 证明
      **Requirements:** desktop-observability-dashboard#当前 Work 显示 Skill 装填与消费状态
- [x] 5.6 实现 Evidence、Human Decision 与下一步详情。
      **Blocked by:** 4.4, 5.1
      **Acceptance:** Evidence、Gate、Human Decision、Artifact 元数据和下一步动作可见；脱敏 fixture 不显示正文、绝对路径、Prompt、回复或命令输出
      **Requirements:** desktop-observability-dashboard#桌面界面保持最小权限边界
- [x] 5.7 实现四类可解释健康状态与下钻。
      **Blocked by:** 4.6, 5.2, 5.3, 5.4, 5.5, 5.6
      **Acceptance:** 流转、执行、质量和遥测健康分别显示原因；远端积压、Work 停滞、Verify 返工与阶段阻塞可区分；不生成无依据总分
      **Requirements:** desktop-observability-dashboard#Dashboard 区分四类可解释健康状态

## 6. 完成 Windows 生命周期、安全与本地恢复

- [x] 6.1 实现 Windows discovery 与本机会话验证。
      **Blocked by:** 2.5, 3.4
      **Acceptance:** 随机端口、会话凭据、用户级 discovery、所有者、freshness 和进程验证已实现；伪造 discovery、过期进程、端口劫持和错误凭据测试失败
      **Requirements:** desktop-observability-dashboard#桌面接收器接纳标准 OTLP 上报, desktop-observability-dashboard#桌面界面保持最小权限边界
- [x] 6.2 实现关闭偏好与托盘生命周期。
      **Blocked by:** 2.6, 6.1
      **Acceptance:** `quit`、`tray`、`ask` 和托盘完全退出覆盖隐藏、重新打开、保存偏好、Windows 会话退出、Host 关闭与完全退出
      **Requirements:** desktop-observability-dashboard#用户可以选择窗口关闭行为
- [x] 6.3 强化 Renderer sandbox 与 IPC 权限边界。
      **Blocked by:** 2.4
      **Acceptance:** `contextIsolation`、sandbox、CSP 和 IPC allowlist 已启用；负向测试拒绝 Renderer 访问 Node/Cordis、Main 承载产品 composition、入口绕过 Application Plugin 和桌面代码进入 Engine
      **Requirements:** desktop-observability-dashboard#桌面界面保持最小权限边界, plugin-composition#外部入口作为 Application Plugin 接入
- [x] 6.4 实现 projection journal、原子 snapshot 与压缩。
      **Blocked by:** 3.5, 6.1
      **Acceptance:** 高事件量基准覆盖重启恢复、内存上限、启动时间、重复收敛、阈值压缩和损坏诊断；结果满足已记录预算
      **Requirements:** desktop-observability-dashboard#重放和重复投递收敛为一致投影
- [x] 6.5 完成 Windows 可访问性与高 DPI 验证。
      **Blocked by:** 5.7, 6.3
      **Acceptance:** 键盘导航、可见焦点、可访问名称、长文本、大数值和高 DPI 通过组件测试、自动化检查与关键状态截图审查
      **Requirements:** desktop-observability-dashboard#首个发布只承诺 Windows x64 支持
- [x] 6.6 更新桌面状态、安全、保留与故障文档。
      **Blocked by:** 4.7, 5.7, 6.2, 6.4, 6.5
      **Acceptance:** 文档 fixture 能区分实时、追平、过期、缺口和未知事实；关闭、恢复、保留与用户级数据处理方式明确
      **Requirements:** desktop-observability-dashboard#重放和重复投递收敛为一致投影, desktop-observability-dashboard#用户可以选择窗口关闭行为

## 7. 打包、自举与交付

- [x] 7.1 配置并生成 Windows x64 安装产物。
      **Blocked by:** 1.4, 2.5, 6.3
      **Acceptance:** `electron-builder` 使用精确版本和确定性资源清单；产物包含声明的 Desktop Host 与 Renderer；品牌、来源和 package contents 检查通过
      **Requirements:** desktop-observability-dashboard#首个发布只承诺 Windows x64 支持
- [x] 7.2 在干净 Windows 用户环境执行安装候选 E2E。
      **Blocked by:** 3.7, 6.2, 6.4, 7.1
      **Acceptance:** 安装、启动、Run 自动激活、OTLP 接收、单实例、托盘、直接退出和卸载均通过并产生 Evidence
      **Requirements:** desktop-observability-dashboard#Windows 开发 Run 自动激活单实例桌面应用, desktop-observability-dashboard#用户可以选择窗口关闭行为, desktop-observability-dashboard#首个发布只承诺 Windows x64 支持
- [x] 7.3 执行双目的地真实开发 Run。
      **Blocked by:** 4.7, 7.2
      **Acceptance:** 本地桌面与远端 mock 收到相同 envelope identity、信号语义和允许列表；任一目的地故障不影响另一端
      **Requirements:** development-telemetry#每个领域事实只产生一份规范观测 envelope, development-telemetry#遥测目的地独立确认和恢复
- [x] 7.4 使用安装后的 Dashboard 自举本 change。
      **Blocked by:** 5.7, 7.2, 7.3
      **Acceptance:** 五阶段、Build action、Skill、验证、等待、恢复和四类健康实时呈现；没有 SigNoZ 查询、本地文件扫描或周期轮询
      **Requirements:** desktop-observability-dashboard#主视图呈现完整五阶段与 Build 子动作, desktop-observability-dashboard#当前 Work 显示 Skill 装填与消费状态, desktop-observability-dashboard#Dashboard 区分四类可解释健康状态, desktop-observability-dashboard#接收驱动桌面实时更新
- [x] 7.5 完成平台矩阵、正式验证报告与临时产物清理。
      **Blocked by:** 6.6, 7.4
      **Acceptance:** 最终发布验证 Work Package 明确拥有 `verification/add-windows-desktop-dashboard/**` 和 `verification/restore-runtime-build-orchestration/verification-report.md` 写入范围，并在全部产品代码提交完成后刷新两个报告；macOS、Linux 和 Windows ARM64 明确为 unsupported/experimental；报告记录架构、安全、恢复、资源预算、未连接真实 SigNoZ 与未迁移旧数据；临时安装目录、日志、端口、discovery、托盘进程、mock receiver 和 scratch Artifact 已清理
      **Requirements:** desktop-observability-dashboard#首个发布只承诺 Windows x64 支持

## Workflow follow-up

- Open 与 Design 分别通过 Runtime 的 Human Decision 审查后进入 Build；Build 按 Configure、Plan、Plan Evidence、Execute、Check 推进，Runtime 校验 Outcome 后才转换状态。
- 完整 change 通常使用一个实现 MR；必要时允许多个实现 MR，但不得把一次 Work 或一次 commit 误当作完整 change。
- 实现 MR 合入后，在独立的轻量 Archive 分支/MR 中由 OpenSpec Provider 同步主规格并归档 change；不等待业务 MR，不使用 Webhook 或 merge 后自动化。
- 桌面纵切稳定后，在可访问团队服务的环境中把远端 OTLP endpoint 指向已部署 SigNoZ，验证查询结果与固定 envelope；该验证不部署本地 Docker Compose，也不阻塞本 change 的首个实现 MR。
