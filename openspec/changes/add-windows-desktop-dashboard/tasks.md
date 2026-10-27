# Tasks

## 1. 固定基线与桌面依赖

- [x] 1.1 在干净主线记录 Node、npm、Windows、现有遥测测试和构建基线，执行 `npm run check:upstream`、`npm run verify` 与 `npm run test:tracer-e2e` 并确认全部通过。
      **Blocked by:** none
      **Acceptance:** 基线记录包含精确版本、命令与结果，三条基线命令在干净主线上成功且无未解释差异
- [x] 1.2 选择并精确锁定 Electron、React、Vite 和 `electron-builder` 版本，审计固定 DSH Desktop 基线并登记许可证、来源、安装脚本、采用文件、修改方式与排除范围；更新 `third_party/dsh-adoption.json` 后执行 `npm install`、`npm run check:provenance` 和许可证检查，证明没有未登记依赖或 Comet 源码复制。
      **Blocked by:** 1.1
      **Acceptance:** lockfile 与采用清单固定全部桌面依赖和 DSH 来源，provenance 与许可证检查拒绝未登记依赖或源码复制
- [x] 1.3 在 `app/desktop` 建立 thin-main、preload、renderer、desktop-host 和共享契约边界；只在 Node-mode Desktop Host 子进程建立统一 App Boot 与 desktop composition。执行桌面 typecheck、lint、composition/进程契约测试和开发构建，证明 Application Plugin 只在必需 Service 就绪后激活，Electron Main 不承载 Cordis 产品 composition，Renderer 没有 Node/Cordis 权限。
      **Blocked by:** 1.2
      **Acceptance:** 桌面构建和边界测试通过，只有 Desktop Host 装配产品 composition，Main 与 Renderer 的禁止依赖由负向检查覆盖

## 2. 补齐权威工作流遥测契约

- [x] 2.1 在 `design.md` 与类型化测试中建立五阶段、Work、Task、Skill、Decision、Tool/Host、Validator/Evidence、Recovery 和 Telemetry pipeline 覆盖矩阵；冻结事件 schema、Log/Span 精确关联、Metric 低基数维度和隐私边界，并用负向测试拒绝自由文本或高基数身份进入 Metric。
      **Blocked by:** 1.1
      **Acceptance:** 覆盖矩阵中的每类事实都有版本化事件、Log/Span 与 Metric 策略，负向测试拒绝自由文本和高基数 Metric 标签
- [x] 2.2 引入由当前权威 Work/claim 构造的统一 Execution Context，让 context-delivered、Host、Skill、Tool、Outcome、Validator、Wait、Reconcile 和 Continuation 事件完整携带 phase、Work kind/id、attempt、checkEpoch 与可用的 Task identity；用乱序事件测试证明映射器无需相邻事件或最新 Run 补值。
      **Blocked by:** 2.1
      **Acceptance:** 所列执行事件携带同一权威 Execution Context，乱序映射不读取相邻事件或最新 Run 快照也能还原关联
- [x] 2.3 增加 Task started/completed/failed/reopened 及 revision 关联，把 Build、Verify fallback 和 Archive fallback 绑定到原 Task、Evidence 和新 Work；以多 Task、Verify→Build、Archive→Design fixture 验证进度和返工链可确定重建。
      **Blocked by:** 2.2
      **Acceptance:** 多 Task 与两类 fallback fixture 可从事件确定重建 Task revision、原 Evidence、新 Work 和返工链
- [x] 2.4 增加 Open、Design、adopt-existing 与 design-revision Human Decision 请求/结果边界，区分 human、retry、external-fact 等等待类别并记录真实等待时长；证明自由文本 reason、审批正文和 Actor 敏感身份不会进入 Metric。
      **Blocked by:** 2.2
      **Acceptance:** 四类 Decision 均产生可配对的等待边界和真实时长，Metric 只包含有界类别且不泄露正文或敏感 Actor 身份
- [x] 2.5 增加 Validator started/completed 边界以及 phase 驻留、主动执行、人工/外部等待、返工、retry、unknown、reconcile 和 recovery 的有界指标；修复零时长 Run/Evidence/Validator Span，并用可控时钟测试真实持续时间。
      **Blocked by:** 2.2
      **Acceptance:** 可控时钟测试证明 Run、Evidence、Validator 和等待持续时间非伪造零值，所有指标维度来自固定枚举
- [x] 2.6 扩展 Tool 遥测契约：保留 Runtime 受保护操作，允许 Host 上报版本化有界类别、结果、耗时和可选模型/Token 聚合；以支持和不支持 Tool observation 的 Host fixture 证明缺失显示 unknown、命令/路径/Prompt/输出永不进入 envelope。
      **Blocked by:** 2.2
      **Acceptance:** 两类 Host fixture 分别呈现可信 Tool 事实或 unknown，任何命令、路径、Prompt、回复和输出都不会进入 envelope
- [x] 2.7 增加每目的地 cursor lag、backlog 数量/字节/最老年龄、最近结果、重试、gap、retention drop、Receiver 接受/拒绝与投递延迟事实；用远端失败、本地成功和 retention overflow 测试证明遥测健康可本地诊断且不改变领域结果。
      **Blocked by:** 2.1
      **Acceptance:** 远端失败、本地成功和 retention overflow 均产生独立可解释健康事实，且领域 Run 结果保持不变
- [x] 2.8 用真实自举 Trajectory 和合成故障 fixture 验证完整覆盖：不用扫描 Workspace、OpenSpec、Git 或最新 Run 快照即可重建五阶段、当前 Work/Task、Skill 链、审批、Evidence、返工和恢复；生成覆盖报告并把遗漏事件作为失败处理。
      **Blocked by:** 2.3, 2.4, 2.5, 2.6, 2.7
      **Acceptance:** 覆盖测试仅凭规范观测记录重建全部列举状态，任一必需事件缺失都会使覆盖报告失败

## 3. 交付首个真实 OTLP 到桌面纵切

- [x] 3.1 定义版本化 `ObservationEnvelope`、稳定身份、规范摘要和纯领域映射，用 golden fixture 验证同一事件重复映射结果一致且不包含凭据、绝对路径、正文或命令输出。
      **Blocked by:** 2.8
      **Acceptance:** golden fixture 对重复输入生成字节级稳定 envelope，隐私测试拒绝凭据、绝对路径、正文和命令输出
- [x] 3.2 实现原子 Envelope Store 与每目的地独立 Cursor，使用故障注入测试覆盖远端成功/本地失败、本地成功/远端失败、进程退出和重放，并证明一个目的地不能推进另一个目的地。
      **Blocked by:** 3.1
      **Acceptance:** 四类故障与重放测试证明 Store 原子恢复且每个 destination cursor 只能由自身确认推进
- [x] 3.3 在可独立运行的 Desktop Host 中实现仅绑定回环地址的 headless OTLP/HTTP Trace、Log、Metric receiver 和会话认证，以协议测试验证合法请求、未授权、错误方法、错误 content type、超限、畸形请求和无正文诊断。
      **Blocked by:** 1.3, 3.1
      **Acceptance:** receiver 协议矩阵覆盖三类 OTLP 信号和全部拒绝场景，只绑定回环地址且错误响应不泄露正文
- [x] 3.4 实现最小五阶段 change projection reducer 与稳定事件去重，用乱序、重复和缺失 fixture 验证 active change、Run、phase、Work、Skill、新鲜度和 gap 状态确定性收敛。
      **Blocked by:** 3.1
      **Acceptance:** reducer 对乱序和重复事件确定性收敛，缺失序列产生 gap 而不是猜测状态
- [x] 3.5 由 Electron Main 启动 Desktop Host，把 Host 的 receiver/projection snapshot 与 delta 通过私有 Node IPC、Main 和类型化 Preload 桥接到最小 Renderer；运行桌面集成测试证明一个真实 OTLP Run 事件无需轮询即可在窗口显示，Host 崩溃时 Shell 保持错误/重试能力。
      **Blocked by:** 3.3, 3.4
      **Acceptance:** 桌面集成测试证明真实 OTLP 事件经私有桥实时显示且无轮询，Host 崩溃可见并可重试
- [x] 3.6 接入最小 Desktop Launcher，在 Windows 开发 Run 开始前启动或激活 Dashboard 并唤醒本地目的地重放；运行进程外纵切测试验证 Dashboard 启动失败只产生 warning，远端 mock 仍收到同一 envelope。
      **Blocked by:** 3.2, 3.5
      **Acceptance:** Windows 进程外测试覆盖启动与激活，桌面失败只产生 warning 且远端仍接收相同 envelope identity
- [x] 3.7 把 Runtime 侧 Desktop Launcher 与本地目的地作为内置 Service/Contributor 加入 builtin catalog 和 project composition，把 Receiver、Projection 与 Desktop Application Plugin 加入 Desktop Host composition；Electron Main 只使用显式 Shell owner 管理原生资源。运行零桌面、正常桌面、依赖缺失、Host 重启和插件卸载测试，证明没有旁路构造或第二套产品容器。
      **Blocked by:** 3.6
      **Acceptance:** composition 测试覆盖五种装配状态，所有能力来自已登记 Contributor 或 Application Plugin 且不存在第二套产品容器

## 4. 收敛完整遥测映射与多目的地恢复

- [x] 4.1 将 Workflow Run 的 Trace、Log 和 Metric exporter 迁移到共享 envelope 映射与 OTLP encoder，执行现有 tracer E2E 和新双目的地测试证明事件身份、允许列表属性与原语义一致。
      **Blocked by:** 2.8, 3.2
      **Acceptance:** tracer E2E 与双目的地测试证明 Workflow 信号共享同一 envelope identity、允许列表和既有语义
- [x] 4.2 将 Evidence Attempt、节点、Artifact 与 Gate 映射迁移到共享 envelope，运行 Evidence 重放、superseded、Receipt 复用和隐私测试证明本地与远端投影一致。
      **Blocked by:** 4.1
      **Acceptance:** Evidence 四类场景在本地与远端得到相同规范投影，隐私测试拒绝 Artifact 正文和敏感数据
- [x] 4.3 将 App 生命周期、平台事件和 Delivery 映射迁移到共享 envelope，运行各领域现有测试与 golden fixture 证明 exporter 不再分别解释领域对象。
      **Blocked by:** 4.1
      **Acceptance:** App 与 Delivery 的 golden fixture 只经过共享领域映射，exporter 中不存在领域对象二次解释
- [x] 4.4 补齐 Workspace、change、Run、父子执行、五阶段、执行主体、任务、Skill、验证、阻塞、下一步动作和观测时间的可信属性映射，以正反 fixture 证明只导出已持久化事实且 Metric 不使用高基数实体身份。
      **Blocked by:** 4.1
      **Acceptance:** 正反 fixture 覆盖全部列举属性，只导出持久化事实并拒绝高基数实体身份成为 Metric label
- [x] 4.5 实现目的地启用、暂停、移除、保留上限、积压健康与 gap 记录，使用小容量故障测试验证超限可诊断、远端 Cursor 不重置且系统不宣称 exactly-once。
      **Blocked by:** 3.2, 4.2, 4.3, 4.4
      **Acceptance:** 小容量故障测试覆盖目的地生命周期、超限与 gap，远端 cursor 保持且公开语义明确为可重放而非 exactly-once
- [x] 4.6 更新遥测开发文档和配置示例，执行文档命令冒烟测试证明单远端、远端加桌面、桌面关闭和恢复四种配置按说明工作。
      **Blocked by:** 3.7, 4.5
      **Acceptance:** 四种配置的文档命令均由冒烟测试执行成功，示例只使用当前公开配置字段

## 5. 完成五阶段桌面投影与开发者界面

- [x] 5.1 建立 Repoctopus Desktop 的语义组件、设计 token、窗口信息架构和完整状态矩阵，用可执行 Story/fixture 覆盖启动、空、稀疏、实时、追平、过期、gap、等待人工、阻塞、返工、错误、完成和失败状态。
      **Blocked by:** 3.4
      **Acceptance:** 可执行 Story 或 fixture 覆盖全部列举状态并复用统一语义组件与设计 token
- [x] 5.2 实现 Workspace/change 导航与选择保持，用多 Workspace、多 change fixture 验证新上报不会抢占用户当前视图，首次无选择时才聚焦启动来源。
      **Blocked by:** 3.5, 5.1
      **Acceptance:** 多 Workspace 与多 change 测试证明已有选择不被新事件抢占，仅首次无选择时自动聚焦启动来源
- [ ] 5.3 实现 `Open → Design → Build → Verify → Archive` 主体、阶段时间线、当前 Work/Task/attempt/Host/Validator/continuation，并用正常推进、Verify→Build、Archive→Verify/Design fixture 证明返工历史不会丢失或伪装为首次执行。
      **Blocked by:** 4.4, 5.1
      **Acceptance:** 正常和三类返工 fixture 均准确显示五阶段、当前执行与历史尝试，不把返工伪装为首次执行
- [ ] 5.4 实现 action/augmentation Skill 的 resolved/delivered/consumed 状态与语义说明，用 OTLP fixture 验证已交付不会提前显示已消费、自定义 Skill 不破坏投影且界面不宣称观察 Agent 内部思考。
      **Blocked by:** 5.3
      **Acceptance:** OTLP fixture 区分 Skill 三态与两种角色，自定义 Skill 可展示且 UI 明确 consumed 仅表示 Host 声明并经 Runtime 验证
- [ ] 5.5 实现 Evidence、Gate、Artifact 元数据、blocker/Human Decision 和下一步动作界面，用脱敏 fixture 验证不显示正文、绝对路径、Prompt、回复或命令输出。
      **Blocked by:** 4.2, 5.3
      **Acceptance:** 状态界面可定位 Evidence、Gate、blocker、Decision 与下一步动作，脱敏 fixture 中不渲染任何受限内容
- [ ] 5.6 实现流转、执行、质量、遥测四类可解释健康状态，以及最近事件、接收状态、目的地健康、新鲜度、重放和 gap 诊断；用 IPC 序列测试证明异常可下钻、snapshot 之后只应用更高版本 delta，序列缺口会重新取得 snapshot 而非开始轮询。
      **Blocked by:** 4.5, 5.3
      **Acceptance:** IPC 序列测试证明四类健康可追溯，旧 delta 被拒绝且序列缺口触发一次 snapshot 恢复而非轮询
- [ ] 5.7 完成键盘导航、可见焦点、可访问名称、长文本、大数值和高 DPI Windows 布局验证；运行 Renderer 组件测试、自动化可访问性检查和关键状态截图审查并修复发现。
      **Blocked by:** 5.2, 5.4, 5.5, 5.6
      **Acceptance:** 组件、自动化可访问性和截图检查覆盖键盘、焦点、名称、长文本、大数值与高 DPI，发现的问题均有回归测试
- [ ] 5.8 编写桌面状态、Skill consumption、健康指标、数据来源和故障诊断文档，以文档 fixture 证明用户可以区分实时、追平、过期、未知和数据缺口。
      **Blocked by:** 5.7
      **Acceptance:** 文档 fixture 能按公开说明区分五种数据状态并解释 Skill consumption 与四类健康的证据边界

## 6. 完成 Windows 生命周期、安全与本地恢复

- [ ] 6.1 实现随机端口、会话凭据、Windows 用户级 discovery 文件和所有者/freshness/进程验证，运行伪造 discovery、过期进程、端口劫持和错误凭据测试证明本地状态不能被未授权请求改变。
      **Blocked by:** 3.3
      **Acceptance:** 四类攻击 fixture 全部被拒绝，合法当前用户会话可发现 receiver 且凭据不会进入日志或遥测
- [ ] 6.2 基于固定 DSH 的 Host process/backend controller、Node-mode 环境与 single-instance 模式实现 Electron 单实例锁、第二实例上下文转交、串行 start/retry/stop、有界 ready、优雅停止和强制终止升级；运行两个并发 Run 与 Host 崩溃恢复测试，证明只有一个 Shell 和一个有效 Receiver，两个 change 都可达且孤儿 Host 不会残留。
      **Blocked by:** 3.7, 6.1
      **Acceptance:** 并发与崩溃测试证明单 Shell、单有效 Receiver、两个 change 可达，并且停止升级后无孤儿 Host
- [ ] 6.3 基于固定 DSH 的 Tray 与 Shell settings ownership 模式实现 `quit`、`tray`、`ask` 用户级关闭偏好和托盘“完全退出”，运行 Windows 自动化测试验证隐藏、重新打开、保存偏好、会话退出、Host 关闭和完全退出语义。
      **Blocked by:** 6.2
      **Acceptance:** Windows 自动化覆盖三种关闭偏好、托盘恢复与完全退出，设置持久化且完全退出终止 Shell、Host 和 receiver
- [ ] 6.4 强化 Renderer sandbox、`contextIsolation`、CSP、IPC sender/origin 校验和版本化 allowlist，并扩展架构检查拒绝 Renderer 访问 Cordis/Node、Electron Main 承载产品 composition、入口绕过 Application Plugin 和桌面代码进入 Engine；以负向 fixture 证明每条边界都会失败。
      **Blocked by:** 3.5, 6.1
      **Acceptance:** 每条安全与架构边界都有独立负向 fixture，合法 IPC 只通过版本化 allowlist 和可信 sender/origin
- [ ] 6.5 实现投影 journal、原子 snapshot、重复收敛和阈值压缩，以高事件量基准验证重启恢复、内存上限、启动时间和 journal 损坏诊断满足记录的性能预算。
      **Blocked by:** 3.4, 6.4
      **Acceptance:** 高事件量基准满足 design 记录的启动、内存与压缩预算，损坏 journal 产生可诊断 gap 且不会静默丢状态
- [ ] 6.6 更新桌面安全、数据保留、关闭行为和恢复文档，执行卸载/重装 fixture 证明默认不误删 Workspace 事实并明确用户级 Dashboard 数据处理方式。
      **Blocked by:** 6.3, 6.5
      **Acceptance:** 卸载与重装 fixture 保留 Workspace 事实，文档明确用户级数据位置、保留、清理、关闭和恢复语义

## 7. 生成并验证 Windows x64 安装产物

- [ ] 7.1 使用精确锁定的 `electron-builder` 配置 Windows x64 桌面打包、产品元数据、图标和确定性资源清单，把 Desktop Host 与 Renderer 作为显式资源打包；执行打包命令生成可安装产物并通过品牌、来源和 package contents 检查。
      **Blocked by:** 5.7, 6.6
      **Acceptance:** Windows x64 安装产物可重复生成，品牌、provenance 与 package contents 检查确认 Host、Renderer 和资源清单完整
- [ ] 7.2 在干净 Windows 用户环境安装候选，运行启动、Run 自动激活、OTLP 接收、单实例、托盘、直接退出和卸载端到端测试并保存 Evidence。
      **Blocked by:** 7.1
      **Acceptance:** 干净用户环境端到端矩阵覆盖全部列举行为并保存可关联当前 Task 的 Evidence
- [ ] 7.3 为 macOS、Linux 和 Windows ARM64 返回明确 unsupported/experimental 状态，用平台矩阵测试证明构建能力不会被文档、CLI 或 UI 误报为正式支持。
      **Blocked by:** 7.1
      **Acceptance:** 平台矩阵在文档、CLI 和 UI 中一致呈现 Windows x64 支持级别，其他平台不会被误报为正式支持
- [ ] 7.4 测量安装体积、冷启动、空闲内存、活动内存和 receiver 吞吐，把预算与实测结果写入正式验证报告；超出预算时先消除非必要依赖和后台工作再重新验证。
      **Blocked by:** 7.2
      **Acceptance:** 五项资源指标都有固定测量方法、预算和实测值，超预算项在交付前被优化或明确阻断

## 8. 自举验证与交付

- [ ] 8.1 使用两个进程外 OTLP 目的地运行同一真实 Repoctopus 开发 Run，比较 envelope identity、信号语义和允许列表属性，证明桌面与远端 mock 接收相同规范数据且任一端故障不影响另一端。
      **Blocked by:** 4.6
      **Acceptance:** 双目的地进程外测试比较结果一致，并分别注入单端故障证明另一端和领域 Run 不受影响
- [ ] 8.2 用打包后的 Repoctopus 和安装后的 Dashboard 执行本 change 的真实自举 Run，验证窗口从接收上报实时呈现五阶段、Work/Task、Skill 装填/消费、审批、验证、返工、恢复和遥测健康，且没有 SigNoZ 查询、本地文件扫描或周期轮询。
      **Blocked by:** 5.8, 7.2, 8.1
      **Acceptance:** 自举 Evidence 覆盖全部列举状态，网络与文件访问断言证明 Dashboard 不查询 SigNoZ、不扫描 Workspace 且不轮询
- [ ] 8.3 执行 `npm run verify`、`npm run test:package-e2e`、`npm run test:tracer-e2e` 和 Windows Desktop E2E，生成正式验证报告并记录遥测覆盖、架构约束、恢复实验、安全检查、资源预算、未连接真实 SigNoZ 和未支持平台。
      **Blocked by:** 7.3, 7.4, 8.2
      **Acceptance:** 所有验证命令成功，正式报告关联结果与 Evidence 并明确未连接真实 SigNoZ 和未支持平台而不伪造结论
- [ ] 8.4 清理测试产生的临时安装目录、日志、端口监听、用户级 discovery、托盘进程、mock receiver 和 scratch Artifact；复查 Git 状态与运行进程证明没有遗留调试产物。
      **Blocked by:** 8.3
      **Acceptance:** 清理检查证明没有临时目录、日志、监听、discovery、进程或 scratch Artifact 残留，Git 只包含预期交付文件

## Workflow follow-up

- 规划产物获批后使用独立业务分支和 Business MR 实现；Change MR 与 Business MR 不得复用同一分支或 MR。
- Build 与 Verify 完成后由 Archive 在短生命周期调用中关闭规格、发布既有业务提交并创建或复用最终 MR；不等待 MR 合入，也不启动 Post-merge 自动化。
- 桌面纵切稳定后，在能够访问团队服务的环境中把远端 OTLP endpoint 指向已部署 SigNoZ，验证查询结果与固定 envelope；该验证不部署本地 Docker Compose，也不阻塞本 change 的首个实现 MR。
