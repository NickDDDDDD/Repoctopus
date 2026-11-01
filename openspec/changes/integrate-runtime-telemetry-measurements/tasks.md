# Tasks

## 0. 冻结当前主线整合边界

- [ ] 0.1 盘点当前主线 canonical observation envelope/outbox、Desktop receiver、`observationDestinationsFromEnvironment`、Runtime stability facts 与各 exporter 的所有权，形成代码到规格的 gap map；运行现有 observation、Desktop 和 Runtime telemetry 测试，证明本 Change 只补缺口而不建立第二套管线。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移, development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:7d3dc414-526e-42c2-b3ac-1a95c2820f69 -->
- [ ] 0.2 将旧分支的候选测试逐项改写为当前主线接口上的失败测试，记录不能直接应用的核心冲突，并禁止恢复已删除文件或增加旧补丁兼容层；运行选定测试先证明真实缺口可复现。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态） <!-- comet-task:b4c73533-d0df-4aac-b11c-08619ad80cb3 -->
- [ ] 0.3 增加架构回归断言，保证新增度量仍经 canonical envelope/outbox 投递，Desktop 与远端保持同一公开协议，现有 Runtime stability 事实不被复制为同义事件；确认旧直连 OpenTelemetry exporter 没有生产调用者。（Requirements: development-telemetry#工作流健康和效率度量必须可复算, development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:465afb6a-5847-4c4a-a310-538d446c5459 -->

## 1. 冻结现有公开遥测契约

- [ ] 1.1 盘点 canonical observation delivery、Runtime stability、Runtime、Evidence、Lifecycle、Delivery exporter 当前公开的 Resource、Span、Event/Log、Metric 和 Attribute，建立 `domains/telemetry/observation-contract.ts` 的 schema v1 类型与目录；运行 `npx vitest run test/telemetry-observation-contract.test.ts` 验证现有名称均被收录且无重复定义。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:f666367f-612c-42d8-bfa9-8180821a0faf -->
- [ ] 1.2 将公开名称、类型、单位、枚举、必填性、来源、基数和隐私级别编码为可校验元数据，并让现有 mapping 测试从目录断言输出；运行 `npx vitest run test/telemetry-mapping.test.ts test/telemetry-observation-contract.test.ts` 验证未发生删除、改名或类型漂移。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:5b517b87-6ee6-4804-b96b-e3b70e03c9a1 -->
- [ ] 1.3 增加目录快照与公开协议变更检查脚本，并接入 `check:generated`；运行 `npm run check:generated` 验证代码与快照一致，故意改变公开名称时检查会失败。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:21022ad4-61a8-449c-83a0-2f2104ee904a -->
- [ ] 1.4 在 `docs/telemetry.md` 记录 schema v1、兼容性边界和“字段名不是部署配置”，运行 `npx prettier --check docs/telemetry.md` 验证文档格式。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:fd7e8e46-19e5-4080-92db-1e12f9221917 -->

## 2. 交付标准 OTLP 配置垂直切片

- [ ] 2.1 为标准 `OTEL_EXPORTER_OTLP_ENDPOINT`、按信号 endpoint、headers、timeout、`OTEL_SERVICE_NAME`、`OTEL_RESOURCE_ATTRIBUTES` 和兼容环境回退建立表驱动测试，运行 `npx vitest run test/opentelemetry-config.test.ts` 先证明当前缺口可复现。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:8fdcbc38-a1c2-4ea6-aa94-11947b8b4a15 -->
- [ ] 2.2 保留 `observationDestinationsFromEnvironment` 对总 endpoint、按信号 endpoint、header 和 Desktop token 的所有权，补齐标准按信号 header/timeout，并实现共享 OTel Resource/service 配置；运行 `npx vitest run test/opentelemetry-config.test.ts test/observation-telemetry.test.ts` 验证所有优先级组合及既有目的地行为不变。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:c5c8f07b-7855-430c-836e-bdd316460d9f -->
- [ ] 2.3 扩展 canonical OTLP encoder，使 Workflow、Evidence、Lifecycle 和 Delivery envelope 共用同一 Resource、允许列表 attributes、Span/Event 与有界 Metric 投影，同时保留 Desktop 可逆 envelope；迁移有效测试后删除无生产调用者的旧直连 OpenTelemetry exporter，运行 observation pipeline、dual-destination 和 managed execution OTLP 测试验证没有平行传输路径。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效, development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:9e0dc859-8fe5-48ce-8c06-26a9a6d88815 -->
- [ ] 2.4 增加协议级 mock OTLP receiver 测试，验证统一 endpoint、按信号覆盖、认证 header、无 endpoint 时禁用和后端不可用时业务继续；运行 `npx vitest run test/e2e/otlp-configuration.e2e.test.ts` 验证 Trace、Log、Metric 三类信号。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:7f6059f6-1019-4b82-9c1a-efa0e6d01a70 -->
- [ ] 2.5 在 `docs/telemetry.md` 写明面向兼容 Collector/SigNoz 的环境变量、优先级、密钥边界和可运行示例；运行文档中的 mock receiver 示例并执行 `npx prettier --check docs/telemetry.md`。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:4e57cfee-1b8a-45a6-85e2-cd1aa9d7133a -->

## 3. 补齐 Skill 执行效果事实

- [ ] 3.1 为 Skill consumed receipt 与同一 Run、Work attempt、Host invocation、digest 和 Outcome 的绑定增加领域失败测试，运行 `npx vitest run test/skill-run-binding.test.ts` 验证 resolved/delivered 不会被误计为 consumed。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:60fcdc58-943a-4f2c-8a0f-eee8828fa81c -->
- [ ] 3.2 增加 accepted、rejected、failed 与 repair 结果的 additive 关联事实及稳定事件身份，运行 `npx vitest run test/skill-run-binding.test.ts test/change-lifecycle-domain.test.ts` 验证重放和进程恢复不会重复计数。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:fc50df0b-37cf-44b4-9300-0787c5cca62e -->
- [ ] 3.3 将 changes-requested、Outcome rejection、Task reopen 和 Repair Work 映射为有界人工修正类别，运行 `npx vitest run test/telemetry-mapping.test.ts test/skill-run-binding.test.ts` 验证不导出审批正文、差异或自由文本原因。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:1bc32eb4-1d68-47ce-8250-0acdf2c86ba3 -->
- [ ] 3.4 导出 Skill 调用、完成、错误、人工修正和复用所需的计数事实，Metric 仅使用角色、类别和结果等低基数标签；运行 `npx vitest run test/telemetry-mapping.test.ts` 验证精确 Skill identity 只在允许的 Event/Span 中出现。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:f8d24722-d97d-4a6e-a2f5-0936b1058ec4 -->
- [ ] 3.5 在遥测参考生成源中记录四项 Skill 指标的分子、分母、窗口、未知语义和“相关性而非因果性”，运行 `node scripts/generate-telemetry-reference.mjs --check` 验证公式与机器目录一致。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态, development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:aff094bb-0ff0-4a31-96a1-5feaa7d65c5a -->

## 4. 增加机器可验证 Rule 评估

- [ ] 4.1 定义稳定 Rule identity/digest、Evaluator identity/version、applicability、expected、triggered 和 result receipt 的领域契约，运行 `npx vitest run test/rule-evaluation.test.ts` 验证缺少结构化 Evaluator 时结果为 unknown。（Requirements: development-telemetry#Rule度量只接受机器可验证评估） <!-- comet-task:3cae53bf-bc62-476d-bef0-9447ca5b6d6e -->
- [ ] 4.2 将现有结构化 Validator/Evaluator 结果接入 Rule receipt 持久化边界，运行 `npx vitest run test/rule-evaluation.test.ts test/change-lifecycle-domain.test.ts` 验证文本规则、Skill 加载和最终成功不会被当作规则命中证据。（Requirements: development-telemetry#Rule度量只接受机器可验证评估） <!-- comet-task:d3a3dfa2-820a-42d6-81a9-f7bd85112c6d -->
- [ ] 4.3 导出 expected、triggered、passed、violated 和 unknown 的有界事件/计数，运行 `npx vitest run test/telemetry-mapping.test.ts test/rule-evaluation.test.ts` 验证精确 Rule identity 不进入 Metric label。（Requirements: development-telemetry#Rule度量只接受机器可验证评估, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:a8f5e431-f0dc-49e0-9d75-2f8eaabf13f9 -->
- [ ] 4.4 在遥测参考生成源中记录规则命中率与违规率的适用性、公式和未知处理，运行 `node scripts/generate-telemetry-reference.mjs --check` 验证无 Evaluator 的规则不会生成虚假零值。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态, development-telemetry#Rule度量只接受机器可验证评估） <!-- comet-task:1239ebee-187d-486a-a64e-ac50bdacae56 -->

## 5. 冻结工作流健康与效率口径

- [ ] 5.1 为权威 Run 开始、唯一终态、workflow identity/version、阶段边界和有效周期建立重放/恢复测试，运行 `npx vitest run test/runtime-telemetry.test.ts` 验证一次逻辑 Run 只贡献一次执行和终态。（Requirements: development-telemetry#工作流健康和效率度量必须可复算） <!-- comet-task:b1a0437e-d019-4a2d-9093-373bf8eaca7e -->
- [ ] 5.2 补齐工作流执行、失败、复用和周期事件的稳定关联及低基数 Metric，运行 `npx vitest run test/runtime-telemetry.test.ts test/telemetry-mapping.test.ts` 验证临时导出失败和进程重启不会增加逻辑次数。（Requirements: development-telemetry#工作流健康和效率度量必须可复算, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:c9384cb4-0199-4c20-954e-61efe98686c1 -->
- [ ] 5.3 在遥测参考生成源中记录失败率、复用次数和效率提升率的查询公式，明确同 workflow/version、完成周期、基线窗口与缺失基线为 unknown；运行 `node scripts/generate-telemetry-reference.mjs --check` 验证公式字段均存在于目录。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态, development-telemetry#工作流健康和效率度量必须可复算） <!-- comet-task:70a5e4ed-2e7c-4c63-837d-bb3c912c7fbe -->

## 6. 发布完整度量覆盖矩阵与数据字典

- [ ] 6.1 将 22 项候选指标逐项写入机器可校验覆盖矩阵，标明 `direct`、`derived`、`optional-evaluator` 或 `out-of-scope`、权威来源、公式和缺失语义；运行 `npx vitest run test/telemetry-metric-coverage.test.ts` 验证恰好覆盖输入清单且 9 项纳入、13 项范围外。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态） <!-- comet-task:b937519d-d4e0-4705-89d5-4182195f6ae2 -->
- [ ] 6.2 实现 `scripts/generate-telemetry-reference.mjs`，从机器目录生成 `docs/telemetry-reference.md` 的 Resource、Span、Event/Log、Metric、Attribute 和指标公式规范区块；运行 `node scripts/generate-telemetry-reference.mjs && node scripts/generate-telemetry-reference.mjs --check` 验证生成幂等。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:dd646e5b-6ae5-48e9-ab22-d9f4441151bd -->
- [ ] 6.3 在参考手册中解释 13 项范围外指标所需的 RAG/评测、IDE/代码归因、身份、规则编辑审计或培训系统，并明确未来只能通过评审后的 Provider 接入；运行 `npx prettier --check docs/telemetry-reference.md` 验证文档格式。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态） <!-- comet-task:c4d951ba-45a1-4934-a4fd-3cbb8ae279a7 -->
- [ ] 6.4 为 SigNoz 提供使用规范字段的查询示例、去重口径、低基数约束和敏感数据边界，不提供字段别名、改名或 Collector Transform；运行文档契约测试 `npx vitest run test/telemetry-documentation.test.ts` 验证示例字段全部存在于机器目录。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:0d646363-f31d-4f90-b24f-9f65c956e0d6 -->
- [ ] 6.5 将目录与参考手册漂移检查接入 `npm run verify`，运行 `npm run check:generated && npm run spec:validate` 验证公开协议、文档和规格同步。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:1eaad028-74ec-4758-a946-41483ef39100 -->
- [ ] 6.6 保持发布包边界只包含产品文档和运行产物，排除 Comet 的 `docs/superpowers/**` 等工作流计划；运行 `npm run test:package-e2e` 和 managed execution report 检查，验证包内包含遥测参考但不泄漏工作流临时产物。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:c8aad2f2-7b2d-41b2-a358-9f729599a5d7 -->

## 7. 跨切片集成验证

- [ ] 7.1 用 mock OTLP receiver 跑一个包含 Skill consumed、机器 Rule receipt、人工返工和最终成功的完整 Run，运行 `npx vitest run test/e2e/telemetry-measurement.e2e.test.ts` 验证三类信号可关联、去重且能复算 9 项指标。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实, development-telemetry#Rule度量只接受机器可验证评估, development-telemetry#工作流健康和效率度量必须可复算） <!-- comet-task:69183074-877e-4f40-9b05-44e2c81752f1 -->
- [ ] 7.2 运行隐私与基数回归 `npx vitest run test/telemetry-mapping.test.ts test/e2e/telemetry-measurement.e2e.test.ts`，验证 header、凭据、路径、自由文本和未登记 identity 不进入公开属性或 Metric labels。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:a1f61bfd-9af6-4b78-8bda-3914ce5fbb2c -->
- [ ] 7.3 执行 `npm run verify`、`npm run test:package-e2e` 和 `npm run test:tracer-e2e`，确认类型检查、Lint、构建、全量测试、生成物、架构、来源、发布包和 OpenSpec 严格校验全部通过，并把命令和结果记录到正式验证 Evidence。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:6561d5a6-1e5f-4ae4-97cd-e02f1fa218ab -->

## Workflow follow-up

- 在项目评审要求满足后归档该 Change。
- 归档后验证主规格已合并且公开遥测参考仍通过生成检查。
