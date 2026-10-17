# Implementation Notes

## Deviations

实施期间每次出现规划与源码事实不一致时，记录：计划原文、对应 Comet 基线模块、上游原路径、目标路径、需求差异、实际约束、采用方案、保留的测试、验证证据和是否影响规格。

只有明确的需求缺口、产品边界冲突或维护风险可以支持增加、改写或重构。产品命名替换必须集中、机械并可检查，不得借机改变行为。

影响外部行为、验收标准、数据安全或范围的偏差属于 Stop Condition，必须暂停受影响实现并由用户决定；其他偏差采用保守方案、记录证据后继续。

### DEV-001：缩小 Comet Engine 采用边界

- 计划：优先采用 Comet Engine 的成熟完整边界。
- 源码事实：上游 `domains/engine` 同时包含纯状态算法、文件存储、手动运行封装和对 `domains/skill`、`platform/fs` 的依赖，整目录采用会让 Engine 直接承担平台职责。
- 处理：采用并改造 `loop.ts`、`resolver.ts`、`guardrails.ts` 和 `evals.ts` 的算法及适用测试；工作流类型迁入 `workflow-contract`，文件持久化进入 `platform/runtime`。
- 理由：产品边界冲突。该调整保持成熟算法，但落实已确认的纯 Engine 约束。
- 验证：上游对应 6 个测试文件共 66 项测试通过；本地来源清单和行为测试将在任务 1、2 中持续校验。

### DEV-002：分发包外置生产依赖

- 计划：生成只依赖 Node.js 的可分发产物，允许使用锁定的生产依赖或完整 bundle。
- 源码事实：esbuild 将 `yaml` 的 CommonJS 代码完整打入 ESM 时，Node.js 24 在动态 `require("process")` 处拒绝执行。
- 处理：CLI 仍构建为 ESM，但把 npm packages 保留为外部生产依赖；package E2E 必须从打包产物安装 production dependencies 后运行。
- 理由：维护风险。避免注入易碎的 CommonJS 兼容垫片，仍符合 Node.js 加锁定生产依赖的分发契约。

### DEV-003：Doctor 与恢复路径分离

- 计划：`doctor` 只读检查状态、Trajectory、Checkpoint、来源和遥测队列，恢复由 `run resume` 执行。
- 实现发现：最初的 Doctor 复用了 `loadRun`、`loadCheckpoint` 和 `loadTrajectory`；这些读取为了业务命令可用会先重放 Journal，导致诊断命令可能修改状态。
- 处理：增加 `FileRuntimeStore.inspect` 只读投影。Doctor 看到未完成 Journal 时报告并指向 `run resume`，不完成转换、不删除 Journal。
- 理由：外部行为纠正。保持诊断与修复职责清晰，避免检查动作改变待排查证据。
- 验证：四个写入边界的崩溃测试先断言 `pendingTransition=true`，再使用新的 Store 显式恢复；打包 E2E 验证正常 Doctor 同时检查来源清单。

### DEV-004：显式保存工作流来源以报告漂移

- 计划：Run 使用不可变 Workflow Package，磁盘定义变化不得静默改变进行中的 Run，并应报告漂移。
- 实现发现：只保存快照和摘要可以保证不可变，却无法知道应重新检查哪个磁盘来源。
- 处理：Run State 保存本地 `workflowSource`，Runtime 通过 `WorkflowSourcePort` 加载当前定义并只比较摘要。Engine 仍只使用冻结快照；来源不可读或摘要变化都作为 `workflowDrift` 返回。
- 理由：需求补全。来源读取留在平台端口，不让 Engine 访问文件系统。
- 验证：测试修改来源返回的 Workflow Package，确认状态继续引用原摘要，同时报告 expected/current digest。

## 最终采用范围

本变更从固定 Comet 基线采用并实质改造五个文件：Engine Loop、Resolver、Guardrail、Eval 和 Workflow Hash。完整来源路径、上游与目标 SHA-256、采用方式记录在 `third_party/comet/source-manifest.json`，MIT 许可证和人工采用报告保存在同目录。

没有采用上游 Engine 的文件存储、Skill 依赖、产品 CLI、TUI 和模板。Repoctopus 将持久化放在 `platform/runtime`，把工作流类型放在 `domains/workflow-contract`，并由 `domains/runtime` 统一组合。该偏差落实了已确认的纯 Engine、多仓恢复和后端中立遥测需求，不改变已批准规格。

## 已知限制

- 第一阶段只建立 Runtime、确定性 Engine、多仓 Git 快照、恢复和 OTLP 纵切。TDD、浏览器与后端反馈采集、IDE Adapter、OpenSpec/OpenWiki 编排、人工决策门禁和分发升级属于后续 change。
- `npm audit --omit=dev` 报告 0 个生产依赖漏洞。完整 `npm audit` 报告 4 个 high，均来自开发依赖 `@fission-ai/openspec -> fast-glob -> micromatch -> braces`。npm 当前只给出强制降级 OpenSpec 到 `0.17.2` 的破坏性修复，未采用；OpenSpec 不进入生产安装包或 Runtime 执行路径。
- 当前 Delivery Cursor 提供 at-least-once 补发语义。超时后的重复 OTLP 数据保留稳定 `event.id` 供后端关联或去重，不宣称 exactly-once。
