---
change: integrate-runtime-telemetry-measurements
design-doc: openspec/changes/integrate-runtime-telemetry-measurements/design.md
base-ref: a819b3754cedd0d18c7e7be584d82f17a3c8aa88
---

# Integrate Runtime Telemetry Measurements Build Plan

<!-- comet-task-authority: openspec/changes/integrate-runtime-telemetry-measurements/tasks.md -->

## Execution contract

本计划是已批准 Design 的执行投影。任务文本、完成状态与稳定 ID 只以 `openspec/changes/integrate-runtime-telemetry-measurements/tasks.md` 为权威；本文件不建立第二套任务清单。实施固定为 `autonomous + tdd + thorough`，产品实现只保留 canonical envelope → outbox → OTLP projection 一条生产路径，不为旧分支或无生产调用者的直连 exporter 建兼容层。

行为任务执行真实 RED/GREEN：先用当前主线接口证明缺口，再做最小实现并记录转绿命令。盘点、文档、生成物、删除和最终验证任务不伪造 RED。每个结果段完成后做一次分段审查；任何字段无法由持久领域事实证明时保持 `unknown`，不得由 exporter、时间邻近或最终成功推断。

## 0. 冻结当前主线与迁移边界

<!-- comet-task-ref:7d3dc414-526e-42c2-b3ac-1a95c2820f69 -->

**0.1 当前主线所有权图。** 盘点 Trajectory → canonical envelope → outbox → OTLP encoder → Desktop/remote，以及 Runtime stability 和四类 adapter 的生产接线。用现有 observation、Desktop 和 Runtime telemetry 测试建立全绿基线，并把缺口落实为后续测试文件与 owner，不新增另一份架构文档权威。

<!-- comet-task-ref:b4c73533-d0df-4aac-b11c-08619ad80cb3 -->

**0.2 旧分支测试意图迁移。** 对照旧提交逐项分类为仍有效需求、已由主线实现、接口已替换或应删除；只把仍有效的失败案例改写到当前主线接口。接受标准是目标测试因真实缺失行为失败，而不是因旧路径或旧类型不存在而失败。

<!-- comet-task-ref:465afb6a-5847-4c4a-a310-538d446c5459 -->

**0.3 单一生产路径守卫。** 用架构测试固定 production composition 只能使用 canonical adapters，确认旧直连 exporter 没有生产调用者，并断言 Runtime stability 不会被重新定义为同义事实。该守卫先于删除旧入口落地。

## 1. 建立公开观测目录

<!-- comet-task-ref:f666367f-612c-42d8-bfa9-8180821a0faf -->

**1.1 Schema v1 目录。** 从当前 envelope、encoder、mapping 和 stability facts 提取 Resource、Span、Event/Log、Metric 与 Attribute，建立 typed observation contract。目录必须能发现重名、缺失引用和不合法单位。

<!-- comet-task-ref:5b517b87-6ee6-4804-b96b-e3b70e03c9a1 -->

**1.2 元数据与 mapping 绑定。** 为每个公开字段记录类型、单位、枚举、必填性、来源、基数与隐私级别；mapping 测试从目录断言实际输出。高基数 identity 只允许进入 Event/Span，下钻字段不得进入 Metric labels。

<!-- comet-task-ref:21022ad4-61a8-449c-83a0-2f2104ee904a -->

**1.3 目录快照和生成检查。** 生成稳定快照并接入 `check:generated`，证明增量增加可审查而删除、改名、类型或单位漂移会失败。生成命令必须幂等且不依赖网络或本机绝对路径。

<!-- comet-task-ref:fd7e8e46-19e5-4080-92db-1e12f9221917 -->

**1.4 Schema 使用说明。** 在遥测文档解释 schema v1、兼容边界和字段名为何不是部署配置；示例只引用目录中的真实名称。

## 2. 标准 OTLP 配置与唯一协议投影

<!-- comet-task-ref:8fdcbc38-a1c2-4ea6-aa94-11947b8b4a15 -->

**2.1 配置矩阵 RED。** 用表驱动测试覆盖总/按信号 endpoint、共享/按信号 headers、共享/按信号 timeout、service name、resource attributes、兼容环境和无 endpoint；先固定当前缺口与标准优先级。

<!-- comet-task-ref:c5c8f07b-7855-430c-836e-bdd316460d9f -->

**2.2 配置解析 GREEN。** 在 transport/platform 边界补齐按信号 header/timeout 与共享 Resource/service 配置，保留 Desktop token 的本地认证职责。秘密、endpoint 和本机信息不得进入 Resource 或普通属性。

<!-- comet-task-ref:9e0dc859-8fe5-48ce-8c06-26a9a6d88815 -->

**2.3 Canonical encoder 收敛。** 让同一 envelope 确定性生成标准 Resource、允许列表 attributes、Span/Event 和有界 Metric，同时保留 Desktop 可逆 envelope。先迁移旧 exporter 的有效协议测试，再删除无生产调用者的直连实现与平行 mapping。

<!-- comet-task-ref:7f6059f6-1019-4b82-9c1a-efa0e6d01a70 -->

**2.4 协议级 receiver 验收。** 使用真实 HTTP mock receiver 验证三类信号的路由、认证、timeout、禁用和后端失败隔离；每个目的地独立确认 cursor，任一失败不得回滚领域事实或阻断另一目的地。

<!-- comet-task-ref:4e57cfee-1b8a-45a6-85e2-cd1aa9d7133a -->

**2.5 部署文档。** 给出兼容 Collector/SigNoz 的环境变量、优先级、密钥边界和可运行示例，明确字段目录与部署值分离。

## 3. Skill 执行效果事实

<!-- comet-task-ref:60fcdc58-943a-4f2c-8a0f-eee8828fa81c -->

**3.1 Consumed 绑定 RED。** 固定只有匹配 Run、Work attempt、Host invocation 与 digest 的 consumed receipt 才进入调用分母；resolved/delivered 和缺失 consumed 保持不同语义。

<!-- comet-task-ref:fc50df0b-37cf-44b4-9300-0787c5cca62e -->

**3.2 Outcome additive facts。** 为 accepted、rejected、failed 和 repair 建立稳定、可重放的 Skill outcome 关联事实；事件身份从权威输入确定，恢复和重放不得重复计数。

<!-- comet-task-ref:1bc32eb4-1d68-47ce-8250-0acdf2c86ba3 -->

**3.3 人工修正分类。** 将 changes-requested、Outcome rejection、Task reopen 与 Repair Work 映射为固定类别，不导出审批正文、diff 或自由文本原因。

<!-- comet-task-ref:f8d24722-d97d-4a6e-a2f5-0936b1058ec4 -->

**3.4 Skill 观测投影。** 从 additive facts 输出 consumed/completed/error/corrected 事件和低基数计数；精确 Skill identity 只用于 Event/Span 下钻，并明确统计相关性而非因果贡献。

<!-- comet-task-ref:aff094bb-0ff0-4a31-96a1-5feaa7d65c5a -->

**3.5 Skill 指标公式。** 在机器目录与参考手册记录四项指标的分子、分母、窗口、去重和 unknown 语义，样本数必须可同时查询。

## 4. Rule 机器评估事实

<!-- comet-task-ref:3cae53bf-bc62-476d-bef0-9447ca5b6d6e -->

**4.1 Receipt 契约 RED。** 定义稳定 Rule digest、Evaluator identity/version、applicability、expected、triggered 与 result；缺少结构化 evaluator 必须产生 unknown，而非零或未命中。

<!-- comet-task-ref:d3a3dfa2-820a-42d6-81a9-f7bd85112c6d -->

**4.2 Validator/Evaluator 接线。** 只把现有结构化评估结果持久化为 receipt；Skill 加载、文本规则和最终成功不得被解释为规则执行证据。

<!-- comet-task-ref:a8f5e431-f0dc-49e0-9d75-2f8eaabf13f9 -->

**4.3 Rule 观测投影。** 输出 expected、triggered、passed、violated、unknown 的允许列表事件与低基数计数；精确 Rule identity 保留在 Event/Span。

<!-- comet-task-ref:1239ebee-187d-486a-a64e-ac50bdacae56 -->

**4.4 Rule 指标公式。** 记录适用性、命中率、违规率和 unknown 处理，并通过生成检查证明没有 evaluator 时不会输出虚假零值。

## 5. 工作流健康与效率口径

<!-- comet-task-ref:b1a0437e-d019-4a2d-9093-373bf8eaca7e -->

**5.1 权威 Run 周期。** 用重放和恢复测试固定唯一 Run start、唯一终态、workflow identity/version、phase 边界和有效周期；临时进程与重试不产生第二个逻辑 Run。

<!-- comet-task-ref:c9384cb4-0199-4c20-954e-61efe98686c1 -->

**5.2 健康度观测。** 补齐执行、失败、复用和周期的稳定关联与低基数 Metric，复用现有 Runtime stability facts，不建立内存聚合 Store。

<!-- comet-task-ref:70a5e4ed-2e7c-4c63-837d-bb3c912c7fbe -->

**5.3 查询公式。** 冻结失败率、复用次数与效率提升率的窗口、基线和去重规则；缺少可比较基线时返回 unknown。

## 6. 覆盖矩阵、数据字典与发布边界

<!-- comet-task-ref:b937519d-d4e0-4705-89d5-4182195f6ae2 -->

**6.1 22 项覆盖矩阵。** 机器可校验地逐项记录 direct、derived、optional-evaluator 或 out-of-scope、权威来源、公式和缺失语义；数量必须恰好为 9 项纳入、13 项范围外。

<!-- comet-task-ref:dd646e5b-6ae5-48e9-ab22-d9f4441151bd -->

**6.2 参考手册生成器。** 从机器目录生成 Resource、Span、Event/Log、Metric、Attribute 与公式规范区块，支持写入和 `--check` 幂等模式。

<!-- comet-task-ref:c4d951ba-45a1-4934-a4fd-3cbb8ae279a7 -->

**6.3 范围外边界。** 对 13 项外部指标说明需要的 RAG/评测、IDE/代码归因、身份或培训系统，并限定未来只能经评审 Provider 接入。

<!-- comet-task-ref:0d646363-f31d-4f90-b24f-9f65c956e0d6 -->

**6.4 SigNoz 查询说明。** 提供基于规范字段的查询示例、逻辑事件去重、低基数和敏感数据边界；不提供字段别名、改名或 Collector transform。

<!-- comet-task-ref:1eaad028-74ec-4758-a946-41483ef39100 -->

**6.5 防漂移接线。** 将目录与参考手册检查加入 `check:generated` 和 `verify`，保证代码、文档、规格共同演进。

<!-- comet-task-ref:c8aad2f2-7b2d-41b2-a358-9f729599a5d7 -->

**6.6 发布包边界。** 包含产品遥测参考，排除 `docs/superpowers/**` 和 Comet 临时产物；以 package E2E 与 managed execution report 检查固定边界。

## 7. 跨切片验收与交付证据

<!-- comet-task-ref:69183074-877e-4f40-9b05-44e2c81752f1 -->

**7.1 完整度量纵切。** 跑一个包含 Skill consumed、Rule receipt、人工返工与最终成功的真实 Run，通过 mock OTLP receiver 关联 Trace、Log、Metric，并从收到的事实复算 9 项指标。

<!-- comet-task-ref:a1f61bfd-9af6-4b78-8bda-3914ce5fbb2c -->

**7.2 隐私与基数回归。** 扫描 payload 和 Metric labels，拒绝 header、credential、路径、自由文本及未登记高基数 identity；同时验证 payload 体积仍在 receiver 上限内。

<!-- comet-task-ref:6561d5a6-1e5f-4ae4-97cd-e02f1fa218ab -->

**7.3 最终 Build 检查。** 执行 `npm run verify`、package E2E 和 tracer E2E，保存命令、结果和关键收据；只有任务 33/33、计划映射、生成物、发布包、架构和 OpenSpec 均通过，才向 Runtime 提交 Build completion 并进入 Verify。
