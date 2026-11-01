# Tasks

## 1. 冻结现有公开遥测契约

- [x] 1.1 盘点 Runtime、Evidence、Lifecycle、Delivery exporter 当前公开的 Resource、Span、Event/Log、Metric 和 Attribute，建立 `domains/telemetry/observation-contract.ts` 的 schema v1 类型与目录；运行 `npx vitest run test/telemetry-observation-contract.test.ts` 验证现有名称均被收录且无重复定义。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:4ad2fe37-5c59-4aef-b61f-35b266138db9 -->
- [x] 1.2 将公开名称、类型、单位、枚举、必填性、来源、基数和隐私级别编码为可校验元数据，并让现有 mapping 测试从目录断言输出；运行 `npx vitest run test/telemetry-mapping.test.ts test/telemetry-observation-contract.test.ts` 验证未发生删除、改名或类型漂移。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:c85832b7-06d4-4858-a143-aa5ea892d11b -->
- [x] 1.3 增加目录快照与公开协议变更检查脚本，并接入 `check:generated`；运行 `npm run check:generated` 验证代码与快照一致，故意改变公开名称时检查会失败。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:9b58df3b-e7d7-4d35-a789-bc8f2701faa7 -->
- [x] 1.4 在 `docs/telemetry.md` 记录 schema v1、兼容性边界和“字段名不是部署配置”，运行 `npx prettier --check docs/telemetry.md` 验证文档格式。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:49676afc-4ef1-4a8c-9e0d-8671007a43ef -->

## 2. 交付标准 OTLP 配置垂直切片

- [x] 2.1 为标准 `OTEL_EXPORTER_OTLP_ENDPOINT`、按信号 endpoint、headers、timeout、`OTEL_SERVICE_NAME`、`OTEL_RESOURCE_ATTRIBUTES` 和兼容环境回退建立表驱动测试，运行 `npx vitest run test/opentelemetry-config.test.ts` 先证明当前缺口可复现。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:89e0f987-237c-43ac-9ec4-b2ccc499582f -->
- [x] 2.2 实现共享 OTel 环境解析器与 Resource 工厂，按 Design 的优先级合并固定 schema/product、exporter 默认值、标准属性、标准 service name 和兼容环境；运行 `npx vitest run test/opentelemetry-config.test.ts` 验证所有优先级组合。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:e7b05677-0d7c-44f1-a575-824ebfc9c23c -->
- [x] 2.3 让 Runtime、Evidence、Lifecycle 和 Delivery exporter 复用共享配置而不改变领域结果，运行 `npx vitest run test/telemetry-mapping.test.ts test/evidence-telemetry.test.ts test/delivery-telemetry.test.ts` 验证跨 exporter 资源一致。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:3c07c221-8810-44f2-8c6d-fdd29120dc73 -->
- [x] 2.4 增加协议级 mock OTLP receiver 测试，验证统一 endpoint、按信号覆盖、认证 header、无 endpoint 时禁用和后端不可用时业务继续；运行 `npx vitest run test/e2e/otlp-configuration.e2e.test.ts` 验证 Trace、Log、Metric 三类信号。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:1cea9909-0da2-4a0a-9f47-ead8677da9ff -->
- [x] 2.5 在 `docs/telemetry.md` 写明面向兼容 Collector/SigNoz 的环境变量、优先级、密钥边界和可运行示例；运行文档中的 mock receiver 示例并执行 `npx prettier --check docs/telemetry.md`。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:ebc9ad7b-c12c-4a75-a9de-32f41c19df1d -->

## 3. 补齐 Skill 执行效果事实

- [x] 3.1 为 Skill consumed receipt 与同一 Run、Work attempt、Host invocation、digest 和 Outcome 的绑定增加领域失败测试，运行 `npx vitest run test/skill-run-binding.test.ts` 验证 resolved/delivered 不会被误计为 consumed。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:a2464d49-1089-4349-b07f-099e158d8006 -->
- [x] 3.2 增加 accepted、rejected、failed 与 repair 结果的 additive 关联事实及稳定事件身份，运行 `npx vitest run test/skill-run-binding.test.ts test/change-lifecycle-domain.test.ts` 验证重放和进程恢复不会重复计数。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:317260e1-67fc-47db-8700-375b585efbfa -->
- [x] 3.3 将 changes-requested、Outcome rejection、Task reopen 和 Repair Work 映射为有界人工修正类别，运行 `npx vitest run test/telemetry-mapping.test.ts test/skill-run-binding.test.ts` 验证不导出审批正文、差异或自由文本原因。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:d297535a-876a-45b6-8034-713905c03966 -->
- [x] 3.4 导出 Skill 调用、完成、错误、人工修正和复用所需的计数事实，Metric 仅使用角色、类别和结果等低基数标签；运行 `npx vitest run test/telemetry-mapping.test.ts` 验证精确 Skill identity 只在允许的 Event/Span 中出现。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:1ac1f4be-1e06-4144-9a64-d141938f7f19 -->
- [x] 3.5 在遥测参考生成源中记录四项 Skill 指标的分子、分母、窗口、未知语义和“相关性而非因果性”，运行 `node scripts/generate-telemetry-reference.mjs --check` 验证公式与机器目录一致。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态, development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:0da49002-c350-475b-8160-69d50d64adf2 -->

## 4. 增加机器可验证 Rule 评估

- [x] 4.1 定义稳定 Rule identity/digest、Evaluator identity/version、applicability、expected、triggered 和 result receipt 的领域契约，运行 `npx vitest run test/rule-evaluation.test.ts` 验证缺少结构化 Evaluator 时结果为 unknown。（Requirements: development-telemetry#Rule度量只接受机器可验证评估） <!-- comet-task:786af5f3-cf1a-47b6-8aa1-e5f634d4d8c2 -->
- [x] 4.2 将现有结构化 Validator/Evaluator 结果接入 Rule receipt 持久化边界，运行 `npx vitest run test/rule-evaluation.test.ts test/change-lifecycle-domain.test.ts` 验证文本规则、Skill 加载和最终成功不会被当作规则命中证据。（Requirements: development-telemetry#Rule度量只接受机器可验证评估） <!-- comet-task:ee716928-b3d9-4d5b-82bb-9af760fac105 -->
- [x] 4.3 导出 expected、triggered、passed、violated 和 unknown 的有界事件/计数，运行 `npx vitest run test/telemetry-mapping.test.ts test/rule-evaluation.test.ts` 验证精确 Rule identity 不进入 Metric label。（Requirements: development-telemetry#Rule度量只接受机器可验证评估, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:54130692-8e24-4d6c-bc84-22b018e46076 -->
- [x] 4.4 在遥测参考生成源中记录规则命中率与违规率的适用性、公式和未知处理，运行 `node scripts/generate-telemetry-reference.mjs --check` 验证无 Evaluator 的规则不会生成虚假零值。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态, development-telemetry#Rule度量只接受机器可验证评估） <!-- comet-task:1c37a97e-e2c4-418f-a7c9-5bc3828df822 -->

## 5. 冻结工作流健康与效率口径

- [x] 5.1 为权威 Run 开始、唯一终态、workflow identity/version、阶段边界和有效周期建立重放/恢复测试，运行 `npx vitest run test/runtime-telemetry.test.ts` 验证一次逻辑 Run 只贡献一次执行和终态。（Requirements: development-telemetry#工作流健康和效率度量必须可复算） <!-- comet-task:7053c8b3-e67f-4031-b7c3-13d3bfe8eafd -->
- [x] 5.2 补齐工作流执行、失败、复用和周期事件的稳定关联及低基数 Metric，运行 `npx vitest run test/runtime-telemetry.test.ts test/telemetry-mapping.test.ts` 验证临时导出失败和进程重启不会增加逻辑次数。（Requirements: development-telemetry#工作流健康和效率度量必须可复算, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:170f61e3-447e-4725-a4c5-68dd5c16d2ff -->
- [x] 5.3 在遥测参考生成源中记录失败率、复用次数和效率提升率的查询公式，明确同 workflow/version、完成周期、基线窗口与缺失基线为 unknown；运行 `node scripts/generate-telemetry-reference.mjs --check` 验证公式字段均存在于目录。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态, development-telemetry#工作流健康和效率度量必须可复算） <!-- comet-task:4a382790-8cb8-4816-8229-83d22634b00f -->

## 6. 发布完整度量覆盖矩阵与数据字典

- [x] 6.1 将 22 项候选指标逐项写入机器可校验覆盖矩阵，标明 `direct`、`derived`、`optional-evaluator` 或 `out-of-scope`、权威来源、公式和缺失语义；运行 `npx vitest run test/telemetry-metric-coverage.test.ts` 验证恰好覆盖输入清单且 9 项纳入、13 项范围外。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态） <!-- comet-task:09160294-69a4-4bec-92d9-72619e4cdb25 -->
- [x] 6.2 实现 `scripts/generate-telemetry-reference.mjs`，从机器目录生成 `docs/telemetry-reference.md` 的 Resource、Span、Event/Log、Metric、Attribute 和指标公式规范区块；运行 `node scripts/generate-telemetry-reference.mjs && node scripts/generate-telemetry-reference.mjs --check` 验证生成幂等。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:6f13c77a-8110-43ad-8a93-c404c8228884 -->
- [x] 6.3 在参考手册中解释 13 项范围外指标所需的 RAG/评测、IDE/代码归因、身份、规则编辑审计或培训系统，并明确未来只能通过评审后的 Provider 接入；运行 `npx prettier --check docs/telemetry-reference.md` 验证文档格式。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态） <!-- comet-task:d984ec31-a8c4-4796-9c26-2b9c4c8de75e -->
- [x] 6.4 为 SigNoz 提供使用规范字段的查询示例、去重口径、低基数约束和敏感数据边界，不提供字段别名、改名或 Collector Transform；运行文档契约测试 `npx vitest run test/telemetry-documentation.test.ts` 验证示例字段全部存在于机器目录。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:5002dc70-bc43-44f6-97b3-55a915cb0401 -->
- [x] 6.5 将目录与参考手册漂移检查接入 `npm run verify`，运行 `npm run check:generated && npm run spec:validate` 验证公开协议、文档和规格同步。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:3b037bf1-9ceb-40bf-a38f-2cf8169dd643 -->

## 7. 跨切片集成验证

- [x] 7.1 用 mock OTLP receiver 跑一个包含 Skill consumed、机器 Rule receipt、人工返工和最终成功的完整 Run，运行 `npx vitest run test/e2e/telemetry-measurement.e2e.test.ts` 验证三类信号可关联、去重且能复算 9 项指标。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实, development-telemetry#Rule度量只接受机器可验证评估, development-telemetry#工作流健康和效率度量必须可复算） <!-- comet-task:1a13d186-5ef0-4232-8675-8f69f8f1a8fe -->
- [x] 7.2 运行隐私与基数回归 `npx vitest run test/telemetry-mapping.test.ts test/e2e/telemetry-measurement.e2e.test.ts`，验证 header、凭据、路径、自由文本和未登记 identity 不进入公开属性或 Metric labels。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:63fabcf2-0fd5-4f80-84c6-1df2519dba08 -->
- [x] 7.3 执行 `npm run verify`，确认类型检查、Lint、构建、全量测试、生成物、架构、来源和 OpenSpec 严格校验全部通过，并把命令和结果记录到正式验证 Evidence。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:869583d0-7204-4192-bfe4-fea7bd27be78 -->

## Workflow follow-up

- 在项目评审要求满足后归档该 Change。
- 归档后验证主规格已合并且公开遥测参考仍通过生成检查。
