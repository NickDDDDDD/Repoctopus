# Proposal

## Why

Repoctopus 已能从多个 Provider 解析 Skill，并由 Runtime 为核心 Action 固定 Skill 组合，但团队目前无法在不改产品源码的情况下，把自己的工程方法可靠地接入指定 Work。现有生命周期扩展也只完成登记与快照，尚未形成可执行、可验证的团队检查。与此同时，`resolved → delivered → consumed` 只能证明正文被交付和 Host 声明消费，不能证明 Open 确实完成代码事实核对、TDD 确实经历有效 RED/GREEN，导致 Dashboard 看得到“加载了 Skill”，却无法回答“方法是否真的执行”。

当前 Build Configuration 还把 execution/TDD/review/isolation 等稳定策略与 Host、checkout、HEAD、worktree 等易变执行事实混在同一人工批准中。恢复、换 Host、修复 binding 或重新进入 Build 都可能重复请求确认；这与 Runtime 应自动验证机器事实、只把真实决策留给人的原则相悖。

本 Change 要把三件事做成同一个可交付纵切：团队可声明方法增强、Runtime 可证明关键方法执行、稳定 Build 策略只确认一次。它们共享同一条“配置编译 → Work 装填 → Outcome 验证 → Evidence/Telemetry 投影”链路，分开实现会再次产生两套身份和审计语义。

## What Changes

- 在 Git 跟踪的 `repoctopus.yaml` 中增加版本化团队 Skill binding 配置。第一版只支持：为声明的 Work 追加 guidance augmentation、显式替换一个允许替换的 augmentation slot、在 definition 声明的安全 checkpoint 增加 required check extension。
- **BREAKING** 核心 Action Skill 不允许被团队配置替换；个人/用户级 Skill 不得参与团队生命周期编译，也不得改变 phase、Human Decision、Validator 或门禁。
- Runtime 在 Run 启动时编译唯一的有效 Skill composition，解析 Provider、顺序、适用 Work、能力、validator 与 checkpoint，计算稳定摘要并冻结到 Run；恢复时漂移必须 fail closed 或进入显式迁移诊断。
- 把 required check extension 落为普通受管 Work、Validator 和 Evidence，而不是 Prompt 片段或第二套生命周期。扩展只能挂接 definition 已声明的安全点，不能推进 phase 或把失败门禁改为通过。
- 为 Open、TDD 和团队 required check 增加可机器核对的 Method Receipt。`consumed` 继续表示 Host 消费声明；只有 Receipt 与当前 packet、输入、命令/证据和 Validator 匹配时，才产生 `method_verified`。
- Open Receipt 记录已核对的仓库/规格/配置事实、未决 frontier 与零提问理由；TDD Receipt 解析真实 Evidence Store 中的 RED、GREEN 和回归 Receipt，不再接受占位 ID、摘要自述或仅凭最终测试成功反推 TDD。
- 把人工选择建模为稳定 `BuildStrategy`，把 Host、checkout、HEAD、branch/worktree ownership 等机器事实建模为可重建的 `ExecutionBinding`。Design approval 绑定 BuildStrategy 与团队 Skill composition；Build Configure 只验证 ExecutionBinding，正常恢复不再重复请求批准。
- 只在策略字段缺失、用户显式要求改变已批准语义、团队 binding 语义变化，或 definition 风险策略命中高风险计划时建立额外 Human Decision。兼容 Host 更换、正常 HEAD 推进、同模式 binding 修复、进程恢复和同摘要返工不得触发重复确认。
- 扩展 Plan Evidence，在 Execute 前验证 Work Package 的任务/验收覆盖、仓库与 write scope、终端报告归属、Host capability、Skill composition 和 ExecutionBinding，提前捕获运行中才暴露的越界计划。
- 扩展 Trajectory、OTLP 和桌面投影，分别展示 Skill resolved/delivered/consumed 与 method verified，并记录团队 binding、检查结果、策略/绑定变化和人工等待原因；不导出 Skill 正文、Prompt、本机路径或高基数 Metric label。
- 把固定 Matt Skills 快照纳入与 Comet、DSH 相同的上游对齐审计，避免团队方法合同与 vendored 内容长期漂移。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-configuration`: 增加团队 Skill binding 配置、规范化摘要和个人覆盖边界。
- `skill-integration`: 从硬编码固定组合收敛为“不可替换 Action + 编译后的团队 augmentation/check”，并冻结有效组合。
- `plugin-composition`: 让团队 required check 作为受约束 Lifecycle Extension/Validator/Work Contributor 进入生产组合。
- `change-lifecycle`: 精简 Human Decision，使用稳定 BuildStrategy 驱动 Design approval，ExecutionBinding 由 Runtime 验证。
- `managed-work-execution`: 分离 BuildStrategy 与 ExecutionBinding，并加强 Plan Evidence 的执行前边界验证。
- `implementation-evidence`: 增加 Open、TDD 与团队检查的 Method Receipt 和可验证方法门禁。
- `development-telemetry`: 增加 binding、方法验证、决策去重与检查扩展的规范观测事实。
- `desktop-observability-dashboard`: 展示团队 Skill composition、方法验证和真正需要用户处理的决定。

## Impact

- 主要影响项目配置 Schema/Loader、Skill Registry 与 Work Context Assembler、Lifecycle Definition/Extension 编译、WorkflowRuns、Work Outcome/Validator、Evidence Store resolver、Trajectory/OTLP 和 Desktop projection。
- `BuildConfiguration` 的预发布持久化模型将被 `BuildStrategy + ExecutionBinding` 替代；不保留旧 Run 的执行兼容层，旧状态只允许只读诊断。
- OpenSpec 的 Proposal、Delta Specs、Design 和 Tasks 仍是唯一规划权威；不新增 ticket、ADR、implementation notes、Build Plan 文件或团队 Skill 自有状态机。
- OpenSpec Store、多仓 repository identity、Tasks 与 Runtime BuildPlan 的既有权威边界保持不变。
- Comet 固定版本只作为 binding、adapter、validator、checkpoint 与冻结 composition 的行为参考；不引入 Comet SDK、Creator/Application 包、Child Workflow 或其第三方源码，因此不新增许可证义务。
- Matt Skills 继续以固定快照和现有许可证接入；本 Change 只增加上游对齐和运行时审计，不复制第二份 Skill 内容。

## 非目标

- 替换任一 Repoctopus-owned Action Skill。
- 自定义 lifecycle phase、任意 transition condition、GUI workflow editor 或完整 Comet Creator/Application package。
- Child Workflow、Skill 内嵌任意代码、任意本机路径加载或个人 Skill 改写团队门禁。
- 为每个 Build Configure、恢复、重试、Host 切换或 HEAD 变化增加人工审批。
- Hotfix profile、运行中 execution mode 升级、可选关闭 Review 或降低 Verify 强度。
