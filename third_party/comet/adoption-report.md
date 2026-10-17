# Comet 采用报告

## 固定基线

- 上游：`https://github.com/AbanteAI/comet`
- 版本：`0.4.5`
- Commit：`575ab0d172e8105257b3c9172b8c8a9b628960ca`
- 许可证：MIT，原文保存在同目录 `LICENSE`

采用前在固定基线上运行 Engine 与 Workflow Contract 相关的 6 个测试文件，共 66 项测试通过。

## 已采用并改造

| 能力           | 上游来源                                                              | Repoctopus 位置                              | 主要改造                                                                |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| Run 循环       | `domains/engine/loop.ts`                                              | `domains/engine/loop.ts`                     | 使用 Repoctopus Workflow Package；增加项目核对硬阻断；保持确定性动作 ID |
| Resolver       | `domains/engine/resolver.ts`                                          | `domains/engine/resolver.ts`                 | 通过深拷贝和冻结隔离 Resolver 输入                                      |
| Guardrail      | `domains/engine/guardrails.ts`                                        | `domains/engine/guardrails.ts`               | 对接版本化动作类型、引用允许列表和确认输入                              |
| Eval           | `domains/engine/evals.ts`                                             | `domains/engine/evals.ts`                    | 对接 Repoctopus Run State 与可审查证据文本                              |
| Workflow 摘要  | `domains/workflow-contract/hash.ts`                                   | `domains/workflow-contract/hash.ts`          | 对接独立 Workflow Contract 域与规范 JSON                                |
| 结构化进程启动 | `platform/process/spawn-command.ts`                                   | `platform/process/spawn-command.ts`          | 保留跨平台 argv 和 Windows shim 处理；替换产品环境变量命名              |
| 外部命令探测   | `platform/process/external-command.ts`                                | `platform/process/external-command.ts`       | 移除 Comet 运行指标耦合，保留超时、取消和缓冲区边界                     |
| 进程创建身份   | `platform/process/process-identity.ts`、`windows-process-identity.ts` | 同名平台文件                                 | 保留 PID 复用防护；替换 Windows 探测缓存与类型命名                      |
| 进程树终止     | `platform/process/terminate-process-tree.ts`                          | `platform/process/terminate-process-tree.ts` | 原样采用受控进程树终止机制                                              |

机器可检查的上游和目标 SHA-256 记录在 `source-manifest.json`。

## 未直接采用

- 上游 Engine 内的文件存储和手动运行封装没有复制。它们依赖 Skill 和平台文件系统，会破坏 Repoctopus 的纯 Engine 边界。
- 上游完整 CLI、TUI、Skill、模板和产品命名没有复制。当前纵切只需要 Runtime 协议和可分发 CLI。
- Superpowers/TDD 和更高层编排保留为后续纵切，待 Repoctopus 需求明确后再评估采用边界。
- Comet Native Evidence、Snapshot、Receipt、Retention、Checkpoint 与 Lock 文件没有整块复制。依赖闭包显示它们同时引用 Change、Transaction、Portable、Doctor 和 Comet Native 配置等产品域；Repoctopus 采用其内容寻址、Fence、引用闭包、Journal 与所有权校验机制，并按独立 Evidence 领域重新实现。详细分析见 `implementation-feedback-adoption.md`。

这些决定保留上游成熟算法，又避免把无关模块和耦合一并带入。后续采用新的上游文件时，必须先更新来源清单、许可证评估、采用报告和行为测试。
