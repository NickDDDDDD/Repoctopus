---
change: close-runtime-telemetry-measurement-gaps
design-doc: openspec/changes/close-runtime-telemetry-measurement-gaps/design.md
base-ref: 42e7c669be2ceed99b83ca5d2bd2028ec39d4779
archived-with: 2026-11-02-close-runtime-telemetry-measurement-gaps
---

# 补齐 Runtime 遥测度量缺口实施计划

<!-- comet-task-authority: openspec/changes/close-runtime-telemetry-measurement-gaps/tasks.md -->

## 实施原则

- `tasks.md` 是唯一任务完成权威；本计划只映射稳定任务 ID，不复制完成状态。
- 按 TDD 执行每个垂直切片：先用目标测试复现缺口，再实现最小行为并运行相关回归。
- 领域层只产生并持久化事实；OTLP、环境变量和 SigNoz 接入只存在于平台与文档层。
- 公开字段采用 additive 演进；发现同名字段的类型、单位或语义冲突时停止并回到 Design。
- 每组完成后运行本组命令并检查 diff；最终由 Build Guard 和 Verify 执行完整检查。

## 1. 冻结现有公开遥测契约

<!-- comet-task-ref:4ad2fe37-5c59-4aef-b61f-35b266138db9 -->
1.1 从 Runtime、Evidence、Lifecycle、Delivery mapping 与 exporter 提取当前公开信号，建立 schema v1 目录和重复名称验证。先新增失败的目录完整性测试，再实现类型化目录。

<!-- comet-task-ref:c85832b7-06d4-4858-a143-aa5ea892d11b -->
1.2 把类型、单位、枚举、必填性、来源、基数与隐私级别纳入目录，并让 mapping 测试依据目录核对实际输出，不改变现有公开名称。

<!-- comet-task-ref:9b58df3b-e7d7-4d35-a789-bc8f2701faa7 -->
1.3 增加稳定快照与生成检查入口；生成检查只读核对，不在 `--check` 模式写文件。

<!-- comet-task-ref:49676afc-4ef1-4a8c-9e0d-8671007a43ef -->
1.4 在现有遥测文档解释 schema、兼容性和字段名协议边界。验收：`npx vitest run test/telemetry-observation-contract.test.ts test/telemetry-mapping.test.ts && npm run check:generated`。

## 2. 标准 OTLP 配置垂直切片

<!-- comet-task-ref:89e0f987-237c-43ac-9ec4-b2ccc499582f -->
2.1 用表驱动测试覆盖总 endpoint、按信号 endpoint、headers、timeout、service name、resource attributes、兼容环境和无 endpoint 行为，并先确认当前 Resource 合并用例失败。

<!-- comet-task-ref:e7b05677-0d7c-44f1-a575-824ebfc9c23c -->
2.2 实现纯解析函数和共享 Resource 工厂；严格解析 OTel resource attributes，固定产品/schema 身份不允许被部署配置抹除，标准 service name 保留覆盖能力。

<!-- comet-task-ref:3c07c221-8810-44f2-8c6d-fdd29120dc73 -->
2.3 将 Runtime、Evidence、Lifecycle、Delivery exporter 迁移到共享工厂，保持领域 Port 与无 endpoint 空实现不变。

<!-- comet-task-ref:1cea9909-0da2-4a0a-9f47-ead8677da9ff -->
2.4 用本地 HTTP mock receiver 捕获 OTLP HTTP 请求，验证三类信号 URL/headers、禁用和失败隔离；测试不得依赖真实 SigNoz。

<!-- comet-task-ref:ebc9ad7b-c12c-4a75-a9de-32f41c19df1d -->
2.5 补充 Collector/SigNoz 环境配置和密钥边界。验收：`npx vitest run test/opentelemetry-config.test.ts test/e2e/otlp-configuration.e2e.test.ts test/evidence-telemetry.test.ts test/delivery-telemetry.test.ts`。

## 3. Skill 执行效果事实

<!-- comet-task-ref:a2464d49-1089-4349-b07f-099e158d8006 -->
3.1 扩展现有 Skill 绑定测试，证明只有 consumed digest 能进入测量分母，并核对 Run、Work attempt、Host invocation 与 packet identity。

<!-- comet-task-ref:317260e1-67fc-47db-8700-375b585efbfa -->
3.2 以稳定事件 ID 记录 consumed Skill 与 accepted/rejected/failed/repair 结果的关联，重放相同事实保持幂等。

<!-- comet-task-ref:d297535a-876a-45b6-8034-713905c03966 -->
3.3 把正式返工入口映射为有界 correction category，不导出审批正文、差异或自由原因。

<!-- comet-task-ref:1ac1f4be-1e06-4144-9a64-d141938f7f19 -->
3.4 输出 Skill 调用、完成、错误、人工修正和复用所需计数事实；精确 identity 仅用于安全 Event/Span，Metric 使用角色、来源类别和结果。

<!-- comet-task-ref:0da49002-c350-475b-8160-69d50d64adf2 -->
3.5 将四项 Skill 指标公式和相关性限制写入生成源。验收：`npx vitest run test/skill-run-binding.test.ts test/change-lifecycle-domain.test.ts test/telemetry-mapping.test.ts`。

## 4. 机器可验证 Rule 评估

<!-- comet-task-ref:786af5f3-cf1a-47b6-8aa1-e5f634d4d8c2 -->
4.1 定义版本化 Rule evaluation receipt 与严格解析，覆盖 identity、digest、evaluator、applicability、expected、triggered 和 result；缺证据为 unknown。

<!-- comet-task-ref:ee716928-b3d9-4d5b-82bb-9af760fac105 -->
4.2 仅从现有结构化 Validator/Evaluator 显式提交 receipt；不从文本规则、Skill 加载或 Work 成功推断。

<!-- comet-task-ref:54130692-8e24-4d6c-bc84-22b018e46076 -->
4.3 将持久 receipt 纯映射为 Event 和低基数 Metric，精确 Rule identity 只供下钻。

<!-- comet-task-ref:1c37a97e-e2c4-418f-a7c9-5bc3828df822 -->
4.4 记录规则命中率、违规率的 applicability 与 unknown 公式。验收：`npx vitest run test/rule-evaluation.test.ts test/telemetry-mapping.test.ts`。

## 5. 工作流健康与效率口径

<!-- comet-task-ref:7053c8b3-e67f-4031-b7c3-13d3bfe8eafd -->
5.1 以 Run/trajectory 测试冻结开始、唯一终态、workflow identity、阶段边界和完成周期，覆盖重放与进程恢复。

<!-- comet-task-ref:170f61e3-447e-4725-a4c5-68dd5c16d2ff -->
5.2 增加执行、失败、复用和周期的 additive 事件/Metric；导出失败与重启不得制造新逻辑执行。

<!-- comet-task-ref:4a382790-8cb8-4816-8229-83d22634b00f -->
5.3 把失败率、复用次数和效率提升率的查询口径写入生成源；效率提升要求相同 workflow/version 和显式基线。验收：`npx vitest run test/runtime-telemetry.test.ts test/telemetry-mapping.test.ts`。

## 6. 度量覆盖矩阵与公开数据字典

<!-- comet-task-ref:09160294-69a4-4bec-92d9-72619e4cdb25 -->
6.1 在机器目录中逐项编码 22 项指标，测试固定 9 项可信覆盖和 13 项范围外，并验证每项都有来源、公式或外部依赖说明。

<!-- comet-task-ref:6f13c77a-8110-43ad-8a93-c404c8228884 -->
6.2 实现参考手册生成器和幂等 `--check`，规范区块完全来自机器目录，人工说明保留在生成区块外。

<!-- comet-task-ref:d984ec31-a8c4-4796-9c26-2b9c4c8de75e -->
6.3 解释 13 项范围外指标所需的外部 Provider 和数据，不把 unknown 写成零。

<!-- comet-task-ref:5002dc70-bc43-44f6-97b3-55a915cb0401 -->
6.4 提供直接使用规范字段的 SigNoz 查询示例，并以文档契约测试验证所有字段存在。

<!-- comet-task-ref:3b037bf1-9ceb-40bf-a38f-2cf8169dd643 -->
6.5 将漂移检查接入现有生成与全量验证入口。验收：`npx vitest run test/telemetry-metric-coverage.test.ts test/telemetry-documentation.test.ts && node scripts/generate-telemetry-reference.mjs --check && npm run check:generated && npm run spec:validate`。

## 7. 跨切片集成与完成条件

<!-- comet-task-ref:1a13d186-5ef0-4232-8675-8f69f8f1a8fe -->
7.1 运行一条包含 Skill consumed、Rule receipt、正式返工和成功终态的完整 Run，通过 mock receiver 证明 Trace/Log/Metric 可关联并复算 9 项指标。

<!-- comet-task-ref:63fabcf2-0fd5-4f80-84c6-1df2519dba08 -->
7.2 对 headers、凭据、路径、自由文本和未登记 identity 执行隐私与基数回归。

<!-- comet-task-ref:869583d0-7204-4192-bfe4-fea7bd27be78 -->
7.3 运行 `npm run verify`，保存正式检查结果；只有全部任务、相关审查和检查通过后才向 Comet 提交 Build 完成。

## 失败处理与回退

- 若现有字段与目录定义冲突，保留现场并修正 Design/Spec，不通过别名掩盖。
- 若某项指标缺少权威事实，将其降为 unknown 或范围外，不用时间邻近推断。
- 若 OTel SDK 的环境变量行为与设计不同，以 SDK 实测为准更新共享工厂和文档。
- 所有新增协议均为 additive；回退时可停止新映射，旧消费者继续忽略未知字段。

## Verify repair：隔离 Comet 临时报告与发布包

第一次 Verify Guard 的产品测试、生成物、架构、来源和 OpenSpec 均通过，但 package Evidence 发现 Comet 要求的 `docs/superpowers/reports/*.md` 被仓库的宽泛 npm `files: ["docs"]` 纳入临时 pack，改变了已验证实现包的摘要。该报告是当前 Comet Run 的本地阶段产物，不是 Repoctopus 发布包内容，也不应形成 package hash 对自身的递归引用。

修复在 `package.json.files` 永久排除 `docs/superpowers/**`，并由 package Evidence 检查显式拒绝开发工作流产物进入发布包；不修改遥测实现或 OpenSpec 需求。Verify 与 Archive 完成后，将正式报告保存到现有 `verification/` Evidence 根，并清理本地 `docs/superpowers/` 与其他 Comet 临时工具文件。重新执行 `npm run verify`，要求 package checksum 为 `1ee2ba6935ec996f272de4f0be3ee99b5e8b932e05a051adb049fa8f6a606e98`。
