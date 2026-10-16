# establish-runtime-foundation 验证报告

## 报告状态

- 结论：实现与本 change 的 Proposal、Design 和 Delta Specs 一致，建议批准。
- 状态：待用户批准。
- 验证日期：2026-10-17。
- 代码状态：所有文件仍在本地未提交工作树；尚未 commit、push 或创建 MR。

## 交付结果

本变更完成 Repoctopus 第一条可运行纵切：

1. 只读探测同级多 Git 仓，生成稳定 Project Snapshot 和差异诊断。
2. 使用版本化 Workflow Package、确定性 Engine 和 Guardrail 推进 Run。
3. 使用跨进程锁、Journal、Trajectory、Run State 和 Checkpoint 保证转换可恢复且并发写入不丢失。
4. 通过独立 CLI 进程执行 `start`、`status`、`next`、`record`、`resume` 和 `doctor`。
5. 恢复时重新探测业务仓，发现 HEAD、分支、路径或工作树变化后硬阻断旧决策。
6. 工作流源文件变化时保留 Run 内冻结快照并报告摘要漂移。
7. 通过官方 OpenTelemetry SDK 输出 Run Trace、步骤 Span、领域 Log/Event、事件 Counter 和步骤耗时 Histogram。
8. 使用持久化 Delivery Cursor 实现遥测故障后的 at-least-once 补发；遥测失败不回滚业务事实。
9. 生成可实际安装的 npm 包，并保留第三方许可证、固定上游 commit、源文件与目标文件摘要。

## 需求映射

| 规格能力                | 实现证据                                | 验证证据                                                                                    |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| 确定性、平台无关 Engine | `domains/engine` 只依赖领域契约         | 相同输入、Guardrail、错误 Outcome 和 Resolver 测试                                          |
| Runtime 唯一组合入口    | `domains/runtime/runtime.ts`            | Run 隔离、幂等记录、遥测补发和恢复测试                                                      |
| 不可变工作流快照        | Run 保存摘要与来源，Engine 只加载冻结包 | 来源变更后 expected/current digest 漂移测试                                                 |
| 独立 Run 身份           | 每个 Run 独立目录、状态版本和事件       | 双 Run 隔离、同 ID 并发初始化竞争测试                                                       |
| 追加式 Trajectory       | 稳定事件 ID、序号、版本和尾部校验       | 重复请求、陈旧版本、跨 Run、截断文件测试                                                    |
| Checkpoint 与中断恢复   | 原子写、转换锁和 Journal 重放           | 四个写入边界崩溃注入、陈旧锁回收测试                                                        |
| 多仓只读探测            | `platform/git/probe.ts`                 | clean、staged、unstaged、untracked、detached、无远端、空格路径、越界 Junction、重复远端测试 |
| 恢复核对                | Project Snapshot reconciliation         | 路径、分支、HEAD、工作树和无变化测试                                                        |
| 稳定 CLI 协议           | 版本 1 JSON envelope 和文本渲染         | 成功、失败退出码、实际打包安装和独立进程 E2E                                                |
| OpenTelemetry 输出      | `platform/telemetry/opentelemetry`      | Trace、Log、Metric 三端点 mock receiver 测试                                                |
| 遥测最小化              | 属性允许列表与敏感值过滤                | Token、Cookie、Authorization、环境值、路径、截图和长日志测试                                |
| 第三方可追溯            | `third_party/comet`                     | 5 个目标摘要和固定上游源摘要检查                                                            |
| 公共命名                | Repoctopus CLI、状态目录和文档          | `npm run check:brand`                                                                       |

## 验证结果

| 命令                                      | 结果                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run typecheck`                       | 通过                                                                               |
| `npm run lint`                            | 通过                                                                               |
| `npm test`                                | 9 个测试文件、27 项测试全部通过                                                    |
| `npm run build`                           | 通过                                                                               |
| `npm run check:generated`                 | 通过，构建结果可重复                                                               |
| `npm run check:brand`                     | 通过                                                                               |
| `npm run check:provenance`                | 通过，5 个采用文件目标摘要一致                                                     |
| 设置 `COMET_UPSTREAM_ROOT` 后运行来源检查 | 通过，5 个固定上游源摘要一致                                                       |
| `npm run test:package-e2e`                | 通过，tarball 安装生产依赖后可探测、启动和 Doctor                                  |
| `npm run test:tracer-e2e`                 | 通过，两个临时 Git 仓跨进程恢复且接收三类 OTLP 信号                                |
| `npm run spec:validate`                   | 严格模式通过，1 个 change、0 失败                                                  |
| `npm run format:check`                    | 通过                                                                               |
| `git diff --check`                        | 通过；当前为未出生分支且文件均未跟踪，另由 Prettier、ESLint 和构建检查覆盖内容格式 |
| `npm audit --omit=dev`                    | 通过，0 个生产依赖漏洞                                                             |

采用前还在固定 Comet 基线上运行 6 个相关上游测试文件，共 66 项测试通过。

## 来源与许可证

- 上游版本：`0.4.5`。
- 固定 commit：`575ab0d172e8105257b3c9172b8c8a9b628960ca`。
- 许可证：MIT，原文保存在 `third_party/comet/LICENSE`。
- 采用范围：Engine Loop、Resolver、Guardrail、Eval 和 Workflow Hash，共 5 个文件，均标记为 `modified`。
- 未采用范围：上游文件存储、Skill 依赖、产品 CLI、TUI 和模板。

## 遥测与数据最小化

遥测只导出允许列表中的项目、Run、Workflow、阶段、动作、结果、重试和耗时维度。源码、Prompt、完整回复、Summary、绝对路径、Git remote、环境变量值、Token、Cookie、Authorization、截图和完整日志不进入普通属性。

OTLP 失败只返回 warning，本地 Trajectory 和 Checkpoint 保持成功。Cursor 只在整批发送成功后推进；重试保留原 `event.id`，语义为 at-least-once，不宣称 exactly-once。

## 未执行项与已知限制

- 未连接真实 Ubuntu 24.04 和 SigNoz Community 环境；当前使用本地 OTLP/HTTP mock receiver 验证 Trace、Log、Metric，并提供无凭据 Collector 示例。
- 本 change 不包含 TDD/Superpowers、浏览器与后端反馈采集、IDE Adapter、OpenSpec/OpenWiki 编排、人工决策门禁和升级机制，这些能力属于后续纵切。
- 完整 `npm audit` 报告 4 个 high，全部位于开发依赖 `@fission-ai/openspec -> fast-glob -> micromatch -> braces`。npm 只提供把 OpenSpec 强制降级到 `0.17.2` 的破坏性修复；未执行。该依赖不进入生产安装包或 Runtime 路径。
- 当前尚无 Git 基线提交，因此无法从 Git 的干净 checkout 执行；`npm pack` 后在全新临时目录安装和运行，覆盖了可分发产物的干净环境验证。

## 回退方式

当前没有提交、推送或远端交付副作用。批准前可直接丢弃本地未跟踪实现；批准并形成提交后，可通过回退该初始提交撤销整个 Runtime 纵切。运行数据始终位于被忽略的 `.repoctopus/`，删除代码不会修改同级业务仓。

## 批准含义

批准本报告只表示接受当前实现与验证结论，并解锁后续 Git 交付动作。commit、push 和创建 MR 仍按具体动作分别执行，不由报告批准自动触发。
