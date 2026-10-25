# Proposal

## Why

`establish-change-lifecycle` 建立了持久五阶段状态与 Work 身份，但当前生产链路只把 Skill 的名称和摘要写入 claim，没有把完整阶段指导交给宿主 Agent，也没有让 Open、Design 和 Verify 都经过可执行 Work。结果是 Change Run 可以事后描述已经发生的工作，却不能保证 Agent 在首次写入前领取正确 Work、加载固定 Skill 并按验证结果推进，这是 Repoctopus 核心工作流的产品完整性缺口。

## What Changes

- 增加受管 Work 执行能力：Runtime 在 claim 后向宿主交付不可变的完整执行包，由唯一宿主端口调用 Agent，并把真实 Outcome 交回现有 Validator；持久状态只保存执行包身份，不保存可能敏感或体积不受控的正文。
- 把内置 lifecycle 的每种声明 Work 接到生产创建、领取、执行和验证路径，删除仅存在于 definition 或测试中的不可达 Work；Open、Design、Build、Verify、Archive 都必须有明确当前 Work 或可信 Human Decision，不允许无 Work 自动跨过业务阶段。
- 提供 Repoctopus-owned、Provider-neutral 的阶段 action Skills。当前 OpenSpec Provider 继续提供官方 instructions/template 和四类工件权威；Matt `tdd`、`codebase-design`、`diagnosing-bugs`、`code-review` 与 `pr` 只作为 definition 固定的 augmentation 或独立发布 action，不建立第二套规格权威。
- 将公共 claim 协议升级为完整、短生命周期的 `WorkExecutionPacket`，包含 Runtime contract、action Skill 正文、Specification Provider 指令、augmentations、Method Profile 和当前输入；ActionIntent、Run、日志和遥测只保留各层 identity 与整体 digest。
- 增加版本化 `WorkExecutionHost` Cordis Contributor 契约和受管执行服务。Host 必须声明能力、执行 preflight、接收冻结执行包并调用 Agent；不能通过调用参数替换 Skill、扩大范围或绕过当前 claim。
- 将 `run next` 收敛为 Agent/Runner 发起的 pull-based continuation/dispatch 入口：Runtime 只解析或调度 definition 已选定的当前 Action，调用方不能指定目标 phase、Work 或 Skill；合法 Outcome/Validator 写入在同一响应返回下一 continuation，`auto_transition` 只决定客户端是否继续消费 `execute`，不参与 phase 合法性。
- 把现有 Run checkpoint 从“恢复 phase 与投影”扩展为 Work 级断点续跑协议：由同一个 Change Run aggregate 权威持久化当前 Action attempt、claim/Host/packet identity、Outcome/Validator/transition 边界和 continuation；ActionStore 只保存由 Run identity 绑定的不可变明细，不拥有 claim、attempt 或下一步。新进程或新 Runner 必须从原断点等待、核对、继续验证或重放幂等转换，不得从 phase 名称猜测进度、协调两套推进状态或重复外部副作用。
- 明确 `fresh` 与 `adopt-existing` 两种 Change 启动模式。新开发默认 `fresh`，已完成 checkbox 不得静默变成 `imported-claim`；只有显式采用既有实现时才允许导入 completion claim，并仍要求完整 Verify。
- 增加从空目录开始的进程外黑盒自举测试：创建 Change Run、捕获完整 Skill 正文、完成 OpenSpec 四类工件、等待真实 Design 决定、逐 Task Build、Verify、Archive；测试必须证明首次受保护写入发生在 claim 和上下文交付之后。
- 增加 definition 可达性与消费端契约检查：每个内置 Work kind 都必须具有生产创建路径、合法 Host/Contributor、完整上下文交付测试和 Validator，不能用只检查 layer 名称/digest 的测试替代宿主消费测试。
- 保持 Repoctopus 是工作流与授权边界而不是操作系统沙箱。任意外部进程仍可能直接改文件，但这种写入不得形成受管 Receipt、Task 完成或阶段推进；正式集成的 Agent Host 只能使用当前 Work 授权的应用能力。

## Capabilities

### New Capabilities

- `managed-work-execution`: 定义完整执行包、Agent Host 端口、preflight、上下文保密边界、宿主调用、Outcome 回报和真实消费验收。

### Modified Capabilities

- `change-lifecycle`: 让五阶段中的声明 Work 全部可达且必须由受管执行或 Human Decision 推进，并区分 fresh 与 adopt-existing 启动语义。
- `skill-integration`: 要求 action/augmentation Skill 的实际正文在执行前交付给唯一 Host，并增加 Repoctopus 阶段 Skill Provider。
- `plugin-composition`: 增加可替换的 Work Execution Host Contributor 与受管执行 Service，保持 Cordis 为唯一组合容器。
- `specification-authority`: 让 Specification Provider 为阶段 Work 提供官方指令和工件协议，同时保持 OpenSpec 四类工件与 Tasks 的唯一权威。

## Impact

- 影响 Change lifecycle definition、transition、WorkflowRuns、WorkDispatcher、ActionIntent/claim 公共协议、Runtime checkpoint/transition journal、Command Router、CLI、Skill Provider、Specification Provider、Cordis builtin catalog、composition snapshot、Run 兼容性和自举文档。
- `run work-claim` 的结果从仅含 ActionIntent 的身份投影升级为版本化执行包；旧调用方必须迁移，不保留旧 claim fallback。身份信息仍可通过明确的只读 inspection projection 查看，但该投影不能领取、执行或提交 Outcome。
- 不新增模型厂商依赖，也不把 DSH LLM 或某个 IDE 写死为执行器；真实 IDE/Runner 通过 Host Contributor 接入。首个内置 Host 是可进程外消费的 CLI/Application Host 协议，测试使用行为等价的捕获 Host，不以 mock 绕过 Runtime。
- Comet 0.5.0 固定提交继续作为行为参考，采用 `applicationSkillWork`、`SkillExecutionHost` 与 preflight/execute 分离的架构思想，不复制其产品 shell、CLI、状态目录或 Skill 文案，因此不新增第三方源码派生文件或许可证义务。
- 本 Change 阻断新的 Dashboard 功能实现；只有黑盒五阶段自举和完整上下文消费测试通过后，才恢复后续产品切片。
