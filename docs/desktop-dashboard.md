# Repoctopus Desktop Dashboard

Repoctopus Desktop 是当前开发者的只读工作流观测入口。它展示当前 change 的 Open → Design → Build → Verify → Archive、Work/Task、Skill、Evidence、Human Decision 和遥测投递健康；阶段选择与推进权仍属于 Runtime。

Desktop 与远端 SigNoZ 接收相同的标准 OTLP 信号和 Repoctopus 属性。Desktop 不查询 SigNoZ，不扫描 Workspace、Git 或 `.repoctopus/`，也不靠周期轮询维持状态。Receiver 接受事件后，Host 生成有序 snapshot/delta 并主动推送给 Renderer。

## 平台支持矩阵

平台支持是产品契约，不由 Electron 是否能在某个平台编译来推断。能够编译或打包不等于正式支持；只有安装、启动、单实例、托盘、OTLP、退出与卸载都经过端到端验证的目标才能标记为 `supported`。

| 平台目标          | 状态        | 分发目标 | 说明                                     |
| ----------------- | ----------- | -------- | ---------------------------------------- |
| Windows 10/11 x64 | supported   | NSIS x64 | 正式支持并完成 Windows x64 端到端验证。  |
| Windows ARM64     | unsupported | —        | 尚无 ARM64 安装产物与端到端验证。        |
| macOS x64         | unsupported | —        | 尚未实现 macOS Shell、分发与端到端验证。 |
| macOS ARM64       | unsupported | —        | 尚未实现 macOS Shell、分发与端到端验证。 |
| Linux x64         | unsupported | —        | 尚未实现 Linux Shell、分发与端到端验证。 |
| Linux ARM64       | unsupported | —        | 尚未实现 Linux Shell、分发与端到端验证。 |

`repoctopus desktop support --json` 和 Desktop UI 直接读取同一领域矩阵。未知平台或架构默认返回 `unsupported`；未来只有完成对应验证后才能显式升级为 `experimental` 或 `supported`。

## 先判断数据状态

数据状态回答“当前画面有多新、是否完整”，不回答“工作流是否正确”。判断优先级是 gap、未知、追平、过期、实时；更高优先级状态不会被较低优先级状态掩盖。

<!-- dashboard-data-state:live -->

| 显示 | 触发事实                                                                                       | 可以判断                              | 不能据此判断                                           |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| 实时 | workflow 序列连续、已知当前 phase、本地 Desktop backlog 为零，且最近观测未超过五分钟新鲜度预算 | 画面已追上 Desktop 当前收到的连续事实 | Run 一定健康、远端 SigNoZ 一定健康或当前 Work 一定成功 |

<!-- dashboard-data-state:catching-up -->

| 显示     | 触发事实                                  | 可以判断                                    | 不能据此判断                                |
| -------- | ----------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 正在追平 | 本地 Desktop 目的地存在尚未确认的 backlog | Receiver 正在重放保留期内的至少一次投递事件 | 当前画面已包含 backlog 中尚未投影的最新事实 |

<!-- dashboard-data-state:stale -->

| 显示     | 触发事实                                                     | 可以判断                     | 不能据此判断                              |
| -------- | ------------------------------------------------------------ | ---------------------------- | ----------------------------------------- |
| 数据过期 | 序列仍连续且 backlog 为零，但活动 Run 的最近观测已超过五分钟 | 不能再把画面当作精确实时状态 | Run 已停止、Host 已崩溃或某个 Work 已失败 |

Renderer 根据最近 OTLP 观测时间设置一次性新鲜度截止计时；截止时只重新解释已有投影，不发起查询或周期轮询。

<!-- dashboard-data-state:unknown -->

| 显示 | 触发事实                                                                          | 可以判断                       | 不能据此判断                                     |
| ---- | --------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------ |
| 未知 | phase、时间、Gate、工具报告或某类健康事实尚未上报；界面相应显示“尚未上报”或“未知” | 当前 OTLP 事实不足以支持该结论 | 缺失值为零、正常、失败，或可从其他 Run/Work 补值 |

<!-- dashboard-data-state:gap -->

| 显示       | 触发事实                                                              | 可以判断                                         | 不能据此判断                     |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------- |
| 事件不连续 | workflow 序列缺号，或目的地记录了 retention drop / incomplete history | 当前历史不完整，应从缺失序列或目的地诊断继续排查 | gap 前后的状态可以拼接成完整历史 |

重复事件不会制造第六种状态：稳定 event ID 使至少一次重放收敛。若 snapshot 后收到旧 delta，Renderer 丢弃它；若 delta 版本跳号，Renderer 只重新取得一次 snapshot，不启动轮询。

## Skill 状态表示什么

Dashboard 按当前 Work 和 attempt 区分 action 与 augmentation Skill。前者定义当前 Action 的执行方法，后者补充横切约束；两者都来自 Runtime 交付的不可变执行包。

| 状态      | 证据边界                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Resolved  | Runtime 已根据当前 phase、Work 和 composition 解析出该 Skill 及其版本摘要；不表示 Host 已收到内容。                                   |
| Delivered | 完整 Skill 内容已进入绑定 invocation、Host 与 packet digest 的执行包；不表示 Host 已使用它。                                          |
| Consumed  | Host 声明并经 Runtime 校验该 Skill digest 属于本次已交付执行包；表示可审计的消费声明，不代表 Agent 的内部思考过程，也不证明产出正确。 |

未出现 Consumed 时只能说“尚未收到可信消费声明”。不得把 Delivered 提前显示为 Consumed，也不得把缺失解释为“未使用”。自定义 Skill 与内置 Skill 使用相同三态协议。

## 四类健康信号

四类信号彼此独立，没有合成一个不透明总分。每个 warning/critical 诊断都带有事件身份和下钻目标；`unknown` 表示证据尚未到达，未知不等于正常。

| 健康维度 | 回答的问题                                                      | 主要事实                                                                  | 下钻目标    |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| 流转健康 | 五阶段是否按 Runtime 允许的方向推进，是否发生等待、阻塞或返工？ | phase entered/completed/reopened、continuation、blocker                   | phase       |
| 执行健康 | 当前 Work、Host 与 Validator 是否成功完成，是否重试或结果未知？ | Work attempt、Host boundary、Outcome、Validator                           | work        |
| 质量健康 | Evidence Gate 是否通过，Verify 是否触发返工？                   | Evidence Attempt、Bundle、Gate outcome、Verify → Build                    | evidence    |
| 遥测健康 | Receiver 和每个目的地是否接收、追平并保留完整历史？             | cursor lag、backlog、retry、receiver result、gap、retention drop、latency | destination |

一类异常不会改写另一类结论。例如远端 SigNoZ backlog 增长时，遥测健康可以为 warning，而流转、执行和质量仍各自保持原状态；遥测失败也不会回滚领域 Run。

## 数据从哪里来

- Log/Span 携带 Run、change、phase、Work、Task、attempt、Host、Validator、Skill、Evidence 与目的地的稳定关联身份。
- Metric 只使用 phase、Work kind、结果、Skill role、等待/返工/失败类别等低基数维度，不使用自由名称或高基数 ID 作为标签。
- Receiver accepted 只证明请求通过本机会话边界并被耐久接受，不等于 Projection 已成功解释全部记录。
- Recent events 是允许列表内的最近投影事实，不包含 Prompt、回复、命令输出、绝对路径或 Artifact 正文。
- Desktop 和 SigNoZ 的语义来源相同，但用途不同：Desktop 面向当前 change 的即时诊断，SigNoZ 面向团队历史、趋势与流程改进。

## 故障诊断顺序

1. 先看数据状态。`gap` 先定位缺失序列或 retention drop；`正在追平` 等待 backlog 归零；`数据过期` 检查 producer、Desktop Host 与投递健康；`未知` 查缺少哪类事实。
2. 再看遥测健康。分别核对本地 Desktop 与远端目的地的 cursor lag、backlog、retry、最近结果和 complete history，不能用一个目的地的成功替代另一个。
3. 数据连续后再看流转与执行。沿 phase 或 work 下钻，核对 attempt、Host、Validator、continuation、blocker 与 Human Decision。
4. 最后看质量健康。Gate 未通过时进入对应 Evidence Attempt；Dashboard 只显示脱敏元数据，原始 Artifact 仍受本机保留策略管理。
5. 不要通过编辑本地状态、猜测 MR 状态或重启窗口来“修正” phase。修复输入或故障后，让 Runtime 选择下一 Action；结果未知时走 reconcile。

传输语义是可重放的 at-least-once，不是 exactly-once。只要 retention 尚未造成 gap，重复投递会按稳定身份收敛；一旦发生永久缺口，界面会持续保留不完整诊断，不会静默恢复为“实时”。

## 本地安全与数据生命周期

<!-- desktop-data:security -->

Dashboard 只接收当前 Windows 用户经会话凭据认证后发送到随机 loopback 端口的 OTLP；Renderer 没有 Node、Cordis、文件系统或任意 IPC 权限。会话凭据只存在于受当前用户保护的 discovery 文件与进程内存，不进入日志、遥测或界面。Dashboard 不查询 SigNoZ，也不会扫描 Workspace。

<!-- desktop-data:retention -->

三类数据必须分开理解：

| 所有者             | Windows 位置                                      | 内容                                                    | 保留语义                                                            |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| Workspace          | 各项目自己的 `.repoctopus/` 与 `openspec/`        | Run、Trajectory、Evidence、规格等权威事实               | Dashboard 不会读取或删除 Workspace；备份与保留由团队策略管理        |
| Dashboard 用户数据 | `%APPDATA%\Repoctopus`                            | `desktop/settings.json`、projection snapshot 与 journal | 仅用于关闭偏好和本地可重建投影；默认跨升级、卸载和重装保留          |
| 临时发现记录       | `%LOCALAPPDATA%\Repoctopus\desktop-receiver.json` | 当前进程、端点和短期会话凭据                            | Host 停止或会话结束时删除；过期、进程不匹配或非当前用户记录一律拒绝 |

projection journal 只保存遥测允许列表中的结构化观测，不保存规格、Artifact、Prompt、回复或命令输出。达到条数或字节阈值时生成原子 snapshot 并压缩 journal；重复事件按稳定 `eventId` 收敛。

<!-- desktop-data:close -->

关闭偏好是 `ask`、`quit` 或 `tray`。`tray` 只隐藏窗口，Shell、Desktop Host 和 Receiver 继续运行；托盘“完全退出”、`quit`、Windows 会话结束和应用退出都会先停止接纳，再有界关闭 Receiver/Host，最后退出 Shell。`ask` 中只有明确勾选“记住我的选择”才会持久化 `quit` 或 `tray`。

<!-- desktop-data:recovery -->

异常退出后，Host 先加载校验过的原子 snapshot，再按 journal 顺序重放。重复记录是 no-op；损坏记录会产生明确的 journal corruption 诊断，并在可推断时保留 sequence gap，绝不把不完整历史显示成实时。删除用户级投影不会修改权威事实；后续只有仍在遥测保留期内的事件可以重新上报，超出保留期的历史可能保持 gap。

<!-- desktop-data:uninstall -->

默认卸载只删除安装目录，不删除 `%APPDATA%\Repoctopus`，更不会读取或删除 Workspace。重装会复用关闭偏好和可校验的本地投影。若用户明确选择“同时清理 Dashboard 用户数据”，只能删除用户级 settings、snapshot 与 journal；这仍不得触碰任何 Workspace。临时 discovery 不属于保留数据，并由进程退出或清理检查移除。
