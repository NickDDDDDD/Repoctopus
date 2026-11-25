## ADDED Requirements

### Requirement: 工作台同时展示多条 Run

桌面应用 MUST 用自适应宫格同时展示收到的活动 Run，并以 Workspace、Change、Run 三者区分身份。每张卡 MUST 展示当前阶段、当前工作、已知的执行配置和可信的工作包进度。界面 MUST 保留历史 Run 的入口和现有五阶段及诊断详情。

#### Scenario: 多个 Workspace 的 Run 同时可见

- **WHEN** Receiver 收到多个 Workspace 或同一 Change 的多个 Run
- **THEN** 工作台为每个活动 Run 提供独立的卡片，按窗口宽度减少列数，并能区分同名 Change 的不同 Run

#### Scenario: 放大和返回

- **WHEN** 用户激活卡片名称或展开按钮
- **THEN** 同一窗口展示该 Run 的五阶段、整行当前工作、子 Agent 列表和可展开的运行与诊断详情
- **AND** 用户通过返回入口或 Escape 回到原宫格位置与有效的键盘焦点

#### Scenario: 状态更新时保留查看上下文

- **WHEN** IPC 推送同一 Run 的新状态或另一条 Run 的活动
- **THEN** 用户正在查看的 Run 随观测更新且身份保持不变，其他卡片的更新不会抢走查看和键盘焦点

### Requirement: 卡片通过视觉层级提示人机交接

桌面应用 MUST 结合颜色、文字与形状区分当前需要人工决定、Agent 执行、等待外部结果、受阻和状态未确认。只在 Runtime 投影存在当前有效决定时提供对应宿主交接指引。

#### Scenario: 并行 Run 各自等待

- **WHEN** 一条 Run 等待有效的人工决定，而另一条 Run 正在执行或等待外部结果
- **THEN** 工作台突出前者并显示其对应审阅内容和宿主交接方式，后者仍展示自己的状态
- **AND** 决定解决、失效或无法确认时撤下原决定提示，按当前观测解释状态

### Requirement: 多 Agent Run 展示可信的子 Agent 活动

桌面应用 MUST 使用同一 Run 的受管委派观测展示子 Agent 与当前 Work 的关系。已知人数、任务、仓库、状态和进展 MUST 对应真实事实。数据缺失或过期时 MUST 表示未知或最后观测状态。

#### Scenario: 多位子 Agent 同时执行

- **WHEN** 当前 Work 的受管委派观测确认有多位活跃子 Agent
- **THEN** Run 卡片显示人数与可交互的子 Agent 摘要，鼠标、触摸和键盘均可查看每位的任务、仓库和已知进展
- **AND** 放大后直接展示各位子 Agent，按窗口宽度自动换行

#### Scenario: 委派已结束或父工作被替换

- **WHEN** 子 Agent 的结果已确认、父工作结束或替换，或者观测连续性无法确认
- **THEN** 桌面更新状态和即时人数，保留可证实的历史，且不把历史委派显示为当前执行

#### Scenario: 未报告活动或使用自主执行

- **WHEN** Runtime 只确认了多 Agent 策略，尚无当前委派事实，或者当前策略为自主执行
- **THEN** 界面按实际情况显示未知状态或主 Agent 工作，不推算子 Agent 数量、任务、仓库或进度
