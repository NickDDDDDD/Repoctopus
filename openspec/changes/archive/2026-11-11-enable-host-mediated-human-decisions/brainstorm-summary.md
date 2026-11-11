# Design 探索摘要

## 已确认

- 用户要求优先修复真实项目里 Open／Design 审批只能转到终端的问题，采用 Comet 成熟的 Host-mediated 方式；三个旧提案后续再收尾。
- 已选择独立 worktree，已批准 Open 四类产物及 10 项任务。Comet 已正式进入 Design。
- 保留 Open／Design 独立人工边界、终端回退、多仓和 isolation 权威；不增加 Dashboard 审批、专用 IDE SDK、后台服务或新的方法 Receipt 框架。

## 已核对源码事实

- `runDecide` 在 CLI 顶层强制 TTY；领域入口已经具有请求和提案身份，缺少 Host 的公开读写闭环。
- Open／Design 的决定写入规划批准 Store；后续 pull 执行严格规划重验及阶段推进。Open 意图选择与规划决定是两个已有受保护写入边界。
- 意图修订及 Build Plan 决定通过 Run guarded commit 与转换 Journal 提交；历史转换可作为结果核对依据。
- 意图修订的非批准当前不应用替换；Plan 的非批准回到 Plan。视图需要如实描述效果，不能统一硬编码一个表单。
- 固定 Comet 0.5.1 的决定点指引优先原生提问、其次对话选择；决定函数核对 Wait／proposalHash，由 Runtime 解析结果，不使用 TTY 作为唯一提交条件。

## 候选工程决定

- 新增只读 `run decision` 与原 `run decide --response-file` Host 模式，未指定文件时保留原终端交互。
- View 提供冻结身份、允许选择、必需输入、响应模板及完整命令 argv，Host 不猜测协议。
- 宿主真实答复属于 Host 信任边界；本机 CLI Actor、宿主交互渠道和授权来源分开记录，不宣称命令文件独立证明人类点击。
- 查询／提交服务复用现有规划批准及 Run 转换权威，扩充最小来源事实，不创建第二个审批 Store。
- 对已经接受的原请求先核对结果再重试，覆盖四类决定和 Open 两段写入；不把跨阶段原成功误报成缺少批准。
- 独立 builder check 指出规划 Store 同摘要复用先于 decisionRunId 生成请求。按现有规划身份政策澄清：保留 change／phase 级共享批准，runId 只绑定交互与执行；查询和提交先核对指定 Run 的当前等待或持久化等待／采纳事实，不凭同名 change 冒领批准。新增原始回传错 Run、合法共享批准、无参与记录及历史来源未知的测试边界，不修改 delta specs。
- 建议 autonomous、TDD、thorough，保留独立设计 builder check 和实施／集成审查。

## 当前状态

正式设计及执行配置尚未获批准；未安装实现依赖、未写产品代码、未执行新功能测试。已批准 delta specs 保持不变。独立 reviewer `host_decision_design_builder_check` 已完成只读 builder check；唯一重要问题是共享规划批准与 Run 交互归属的区分，文档澄清并复核后结论为 `nothing important left`。接下来通过同一 Comet Design Wait 请用户决定。
