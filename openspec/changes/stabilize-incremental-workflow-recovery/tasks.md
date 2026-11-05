# Tasks

## 1. 恢复语义基线

- [x] 1.1 固定Comet 0.5.1的revision、plan与evidence invalidation行为参考及MIT采用边界，并用来源审计测试确认Repoctopus没有引入Comet Runtime依赖 <!-- comet-task:a4fd5783-13b7-434f-b0f9-0d71249ec402 -->
  **Acceptance:** 来源登记精确绑定固定commit和参考文件；依赖图与生产包不包含Comet SDK或Runtime
  **Requirements:** 恢复分类只选择最高受影响权威

- [x] 1.2 为四种核心恢复处置建立失败优先的领域合同测试，并验证相同observation得到稳定decision identity <!-- comet-task:855f7952-223f-4eb0-8295-4618114fe550 -->
  **Blocked by:** 1.1
  **Acceptance:** 测试分别覆盖revise-design、revise-plan、continue-build和invalidate-evidence；重复输入得到相同decision identity
  **Requirements:** 失败分类必须决定真实返工路径, 恢复重放必须收敛到同一 checkpoint

## 2. Runtime 恢复 Inspector

- [x] 2.1 定义规范化Recovery Observation、Authority Diff、Recovery Decision与失效集合，并用schema测试拒绝Host选择phase或恢复动作 <!-- comet-task:e7054d0d-52d7-4dd5-a646-ed0efaa177fe -->
  **Blocked by:** 1.2
  **Acceptance:** 领域类型只能表达有界事实和Runtime decision；含targetPhase或recovery action的Host payload被拒绝
  **Requirements:** Host 只能报告发现而不能选择阶段, Finding 必须先验证再形成恢复处置

- [x] 2.2 实现权威专属Inspector与薄Recovery Coordinator，并用表驱动测试验证planning、plan、work、evidence的固定优先级 <!-- comet-task:ffe993f0-b318-40c2-b970-97dca399e9b7 -->
  **Blocked by:** 2.1
  **Acceptance:** 同时发生多层漂移时只返回最高层处置；仅Plan变化保持Build；仅Evidence变化不失效Plan
  **Requirements:** 恢复分类只选择最高受影响权威, 失败分类必须决定真实返工路径

- [x] 2.3 扩展Runtime identity graph计算保留与失效闭包，并用性质测试验证失效只向下游传播且结果顺序稳定 <!-- comet-task:749e689c-ea08-4d4b-b171-ce48277a7e38 -->
  **Blocked by:** 2.2
  **Acceptance:** 任意identity输入顺序得到相同闭包；publication provenance和Task checkbox不会单独失效planning semantic
  **Requirements:** 恢复分类只选择最高受影响权威, Evidence 失效必须按声明输入面传播

- [x] 2.4 为decision应用增加expected revision、checkEpoch和observation identity CAS保护，并用并发测试验证重复提交只建立一个checkpoint <!-- comet-task:8101fce2-f5f2-445a-a904-475fdd912bf1 -->
  **Blocked by:** 2.3
  **Acceptance:** 两个并发Runner中只有一个提交新checkpoint；另一个返回相同checkpoint或明确revision conflict
  **Requirements:** 恢复重放必须收敛到同一 checkpoint

## 3. Host Finding 与 Continue Build

- [x] 3.1 以事实分类替换design_assumption_invalid和planning_semantics_changed，并用合同测试验证Requirement、Task、Package和Evidence引用边界 <!-- comet-task:0af000c7-725e-4af6-a42b-64d006f51c59 -->
  **Blocked by:** 2.2
  **Acceptance:** 旧finding不再被schema接受或映射生命周期；未知与越界引用使当前submission可纠正地失败
  **Requirements:** Host 只能报告发现而不能选择阶段, Finding 必须先验证再形成恢复处置

- [x] 3.2 实现finding规范化与稳定identity，并用测试验证自由文本摘要不参与低基数分类或恢复动作选择 <!-- comet-task:8284985e-4ff2-47e1-bc0f-d54ec1f13df5 -->
  **Blocked by:** 3.1
  **Acceptance:** 相同结构化事实产生相同identity；只有摘要变化不会改变authority diff或直接选择Design
  **Requirements:** Finding 必须先验证再形成恢复处置

- [x] 3.3 实现continue-build的attempt恢复与结果未知分流，并用重启测试证明claim、packet、invocation、submission和rejection历史被保留 <!-- comet-task:320bf9ce-6559-41d2-9de5-3c77bcfdb786 -->
  **Blocked by:** 2.4, 3.2
  **Acceptance:** 可安全重试的Work继续同一执行链；未知外部副作用进入reconciliation且旧candidate不会被重放
  **Requirements:** Continue Build 保留当前执行身份, 恢复重放必须收敛到同一 checkpoint

## 4. Lifecycle 与 WorkflowRuns 接线

- [x] 4.1 删除build.design-revision-required/approved/rejected及其Wait、observation和旧遥测枚举，并用可达性测试确认没有遗留生产路径 <!-- comet-task:116ced0e-8601-437c-b7c4-6df4f00403ba -->
  **Blocked by:** 3.1
  **Acceptance:** 生产源码与状态定义不再包含旧transition或旧finding；所有核心恢复入口仍可从run next到达
  **Requirements:** 失败分类必须决定真实返工路径, Host 只能报告发现而不能选择阶段

- [x] 4.2 让Lifecycle原子物化revise-design与revise-plan，并用领域测试验证前者建立Design Work、后者保持Build和未受影响completion <!-- comet-task:e6a5e937-ba0f-4a43-a5b4-ea6fc65d7eac -->
  **Blocked by:** 2.4, 4.1
  **Acceptance:** revise-design一次提交phase、Work、epoch与失效闭包；revise-plan只递增Plan revision并保留合法completion
  **Requirements:** 失败分类必须决定真实返工路径, 恢复分类只选择最高受影响权威

- [ ] 4.3 让Lifecycle原子物化continue-build与invalidate-evidence，并用领域测试验证最小checkpoint恢复 <!-- comet-task:e35dd6de-5101-4dd6-968e-94c84621368c -->
  **Blocked by:** 3.3, 4.1
  **Acceptance:** continue-build保留Work与Plan；invalidate-evidence只退役依赖变化输入的检查事实并返回最近合法节点
  **Requirements:** Continue Build 保留当前执行身份, Evidence 失效必须按声明输入面传播

- [ ] 4.4 将WorkflowRuns中的分散条件分支替换为统一事实收集、有序Inspector和CAS应用管线，并用Service测试验证Host不能绕过Runtime决策 <!-- comet-task:e594e6ac-37d7-4f37-9fed-92b1e9e3440f -->
  **Blocked by:** 4.2, 4.3
  **Acceptance:** Build Plan、Execute、Check、Verify和关闭前置观察使用同一Recovery Coordinator；Service不再直接按finding名称选择phase
  **Requirements:** Finding 必须先验证再形成恢复处置, 恢复重放必须收敛到同一 checkpoint

## 5. Build Plan 前置可行性

- [ ] 5.1 扩展Plan Validator验证每个Package的Outcome与Validator闭包，并用失败测试覆盖遗漏Evidence与跨包伪完成 <!-- comet-task:fa22cb21-6026-47cf-b9a7-43e7a8068bef -->
  **Blocked by:** 2.2
  **Acceptance:** 无法在自身边界完成的Package在Execute前被拒绝为Plan finding；合法跨仓Package仍可通过
  **Requirements:** Plan Evidence 必须证明每个 Package 可独立完成

- [ ] 5.2 为tdd模式验证同一行为切片的RED、实现、GREEN和回归闭包，并用测试证明RED与GREEN拆包会触发revise-plan <!-- comet-task:6fedaa33-c7c1-4e36-8476-cd1b1244f771 -->
  **Blocked by:** 5.1
  **Acceptance:** tdd拆包候选在Plan Evidence失败；完整切片通过；direct模式不要求RED但仍要求实现与回归
  **Requirements:** Plan Evidence 必须证明每个 Package 可独立完成

- [ ] 5.3 实现Plan授权包络比较，并用测试验证顺序、包边界和等价命令变化自动接受而仓库、write scope或风险扩大要求决定 <!-- comet-task:9b6f3284-ddc7-4e9d-8fdd-6300ec67c717 -->
  **Blocked by:** 5.1
  **Acceptance:** 同包络revision不创建Human Decision；越权revision fail closed并绑定增量授权请求
  **Requirements:** Plan revision 只在授权范围扩大时请求决定

## 6. Specification 前置校验

- [ ] 6.1 扩展Tasks Requirement metadata语法并用解析测试覆盖半角与全角逗号、分号、空token和歧义标记 <!-- comet-task:1e5dead0-2795-4512-9b9d-8302a7d97132 -->
  **Blocked by:** 1.2
  **Acceptance:** 受支持分隔形式规范化为相同有序引用；空或歧义token在规划校验中定位失败
  **Requirements:** Task Requirement 映射必须在规划批准前解析

- [ ] 6.2 由Specification Provider解析当前主规格与delta的稳定Requirement identities，并用集成测试拒绝未知映射且不让Build重新解析文本 <!-- comet-task:dd268ca7-883c-415c-9ea5-59d2d3b3203f -->
  **Blocked by:** 6.1
  **Acceptance:** 未知Requirement在Open或Design严格校验失败；合法映射以结构化identity交付Build Plan
  **Requirements:** Task Requirement 映射必须在规划批准前解析

- [ ] 6.3 抽取纯领域closure analyzer并用测试验证新增capability Purpose、delta操作和退役关系的静态可关闭性 <!-- comet-task:c524e3c7-c2a9-44f7-b5d9-467f31922879 -->
  **Blocked by:** 1.2
  **Acceptance:** 缺少或无效Purpose在规划边界失败；相同输入的preflight与关闭候选得到相同静态结论
  **Requirements:** 新 Capability 的关闭前置条件必须早期验证

- [ ] 6.4 将closure preflight接入Open与Design严格校验，并用Provider测试证明后续阶段只重新观察身份和checkout事实 <!-- comet-task:4c099978-2eba-4ab4-9cf2-976a0031c712 -->
  **Blocked by:** 6.2, 6.3
  **Acceptance:** 规划批准绑定closure preflight identity；规划未变时不会更晚首次发现同一Purpose错误
  **Requirements:** 新 Capability 的关闭前置条件必须早期验证, 规划语义与发布身份必须分别参与恢复分类

## 7. Evidence 输入与精确失效

- [ ] 7.1 定义实现内容、规划语义、执行控制面、可选Git identity与publication provenance分区，并用指纹测试验证各分区独立稳定 <!-- comet-task:7627945a-6e2a-49ee-8cea-2343e79c2635 -->
  **Blocked by:** 2.3, 6.2
  **Acceptance:** checkbox与非语义协调仓commit只改变完成或发布投影；实现内容和显式Git依赖仍能使对应identity变化
  **Requirements:** Evidence 输入必须区分产品与执行控制面, 规划语义与发布身份必须分别参与恢复分类

- [ ] 7.2 为Receipt、Bundle、Gate、Build Check和Verification Input保存规范化依赖清单，并用持久化往返测试验证恢复后不丢失依赖 <!-- comet-task:60de5dcb-261d-442a-b6f5-eb2bcd5a8696 -->
  **Blocked by:** 7.1
  **Acceptance:** 每种Evidence事实重启后仍能计算相同依赖与identity；未知依赖fail closed
  **Requirements:** Evidence 失效必须按声明输入面传播

- [ ] 7.3 实现invalidate-evidence的图传播与Evidence不可用分流，并用测试证明只重采受影响节点且基础设施失败不回Build或Design <!-- comet-task:b4deb521-4982-4141-b7e3-c3cb74b670ce -->
  **Blocked by:** 4.3, 7.2
  **Acceptance:** 单节点输入变化保留无关Receipt；Provider不可用保持blocked/retry；失效清单与保留清单可审计
  **Requirements:** Evidence 失效必须按声明输入面传播, Evidence 无效与 Evidence 不可用必须分离

## 8. 遥测与轨迹

- [ ] 8.1 为recovery observed、classified、applied和evidence invalidated增加稳定trajectory事件，并用schema测试验证decision与失效闭包可重放 <!-- comet-task:9af6511c-75b0-4e0f-99aa-33ede8858c76 -->
  **Blocked by:** 4.4, 7.3
  **Acceptance:** 每个decision有稳定事件身份、source action、authority layer与结果；重复应用不会追加第二个逻辑decision
  **Requirements:** 恢复重放必须收敛到同一 checkpoint

- [ ] 8.2 更新OTLP映射与遥测字段说明，并用隐私测试验证仅发送低基数decision、layer、reason code和计数 <!-- comet-task:7b49f00d-ae7c-4beb-9ede-bc9ea2b18e7b -->
  **Blocked by:** 8.1
  **Acceptance:** metric属性不包含路径、摘要原文、Requirement文本、commit或digest；Dashboard可按既有run/change关联事件
  **Requirements:** 恢复分类只选择最高受影响权威, Evidence 失效必须按声明输入面传播

## 9. 集成与真实轨迹重放

- [ ] 9.1 建立脱敏多仓轨迹fixture并用确定性重放测试覆盖错误TDD拆包、测试切面、checkbox收尾、真实规划变化和Evidence漂移 <!-- comet-task:7fc72b11-661d-44d5-ac6b-e5ab9b9f9d4e -->
  **Blocked by:** 5.3, 6.4, 7.3, 8.1
  **Acceptance:** 错误拆包与测试切面只产生revise-plan；checkbox收尾不回退；真实规划变化只产生一次revise-design；Evidence漂移只失效相关节点
  **Requirements:** 恢复分类只选择最高受影响权威, 恢复重放必须收敛到同一 checkpoint

- [ ] 9.2 运行Runtime Service与CLI集成测试，并验证Runner只能执行Runtime返回的精确Action而不能手写等价transition <!-- comet-task:0dc08d73-6a68-487e-9b58-7985d04f1500 -->
  **Blocked by:** 4.4, 9.1
  **Acceptance:** 冷恢复、重复pull和进程中断收敛；伪造phase、action或旧candidate的请求被拒绝
  **Requirements:** Host 只能报告发现而不能选择阶段, Continue Build 保留当前执行身份

- [ ] 9.3 在模拟团队协调仓与多个业务仓中运行完整小change验收，并核对阶段往返、Work、Skill、Evidence与OTLP轨迹 <!-- comet-task:56292f05-a314-41e2-8893-466f6f368330 -->
  **Blocked by:** 8.2, 9.2
  **Acceptance:** 没有无依据的Build到Design或关闭前双回退；每次恢复与保留事实都能从trajectory和OTLP解释
  **Requirements:** 失败分类必须决定真实返工路径, Evidence 失效必须按声明输入面传播

- [ ] 9.4 执行OpenSpec严格校验、类型检查、lint和完整测试套件，并核对旧恢复信号在生产源码、规格与遥测中均已清退 <!-- comet-task:e45dcb55-677b-4280-b31a-8a9903a82ad2 -->
  **Blocked by:** 9.3
  **Acceptance:** 所有项目检查通过；旧finding与transition只允许出现在迁移拒绝fixture或历史归档中；当前change产物严格校验通过
  **Requirements:** 失败分类必须决定真实返工路径, Host 只能报告发现而不能选择阶段

## Workflow follow-up

- 在项目审查要求满足后归档该change，并确认主规格只由OpenSpec同步更新。
- 将最终实现与Comet 0.5.1固定参考重新对照，记录采用、改写与未采用边界。
