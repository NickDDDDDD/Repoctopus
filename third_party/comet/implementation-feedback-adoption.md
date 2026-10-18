# 实施反馈机制采用分析

## 分析基线

- 上游：`https://github.com/AbanteAI/comet`
- 版本：`0.4.5`
- Commit：`575ab0d172e8105257b3c9172b8c8a9b628960ca`
- 分析范围：命令执行、进程身份、Evidence、Receipt、Snapshot/Fence、Retention、Checkpoint/Journal 与 Lock。

本分析以运行不变量闭包和 Repoctopus 领域边界为判断依据。采用机制不等于复制同名文件；耦合深度和文件数量本身不是拒绝理由。若相互耦合的模块共同维护 Repoctopus 也需要的不变量，应整体采用或在一个明确聚合中完成等价改造；只有职责确认属于 Comet 产品外壳时才排除。

## Classic 受保护转换复审

从 `classic-guard` 的实际 `--apply` 路径反向追踪后，受保护转换依赖以下完整语义：Runtime 产生执行记录；记录绑定 Run、状态代次、argv、cwd、环境、输入 manifest 和日志；转换在 state lock 内重新读取当前 Run 并重新评价；状态、Run 投影、Trajectory 与 Checkpoint 可恢复提交；冷恢复保守失效无法重新证明的 Evidence；Retention 对引用图做闭包并在待恢复事务期间停止清理。

Repoctopus 采用这个不变量闭包，但不复制 Classic 的固定阶段和 OpenSpec 产品外壳。映射如下：

- Skill snapshot 映射为不可变 Workflow Package 快照。
- `checkEpoch` 映射为 Run `stateVersion`，并额外绑定 Action、Step 和 Profile。
- Command Check 映射为可包含命令、服务、浏览器和视觉节点的 Evidence Attempt/Receipt/Bundle。
- 单仓 Check Snapshot 映射为多仓 Repository Fingerprint 与开始/结束 Fence。
- Classic state lock/transaction 映射为 Runtime transition lock 和恢复 Journal。
- Native Evidence Retention 的 dependency closure 映射为 Runtime、Delivery 和 Evidence 共同提供 root 的 Artifact 引用闭包。

因此，“Native Evidence 与 Change/Checkpoint/Transaction 耦合较深”不再作为拒绝成熟实现的结论。后续选择复制还是改造，只取决于数据模型是否会迫使 Repoctopus 放弃多仓、通用工作流、浏览器反馈或独立 Delivery 聚合等明确需求。

## 依赖闭包结论

| 候选机制                                            | 直接或关键内部依赖                                                            | 结论                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `spawn-command`                                     | Node child process、文件存在检查                                              | 改造采用；独立且解决 Windows npm shim 与 argv 边界                                     |
| `terminate-process-tree`                            | Node child process                                                            | 改造采用；增加崩溃恢复时基于创建身份的保守终止                                         |
| `process-identity`                                  | `external-command`、`windows-process-identity`                                | 连同最小闭包采用；用于识别 PID 复用                                                    |
| `external-command`                                  | `spawn-command`、Comet runtime metrics                                        | 移除指标依赖后采用；Repoctopus 由 OTel Adapter 负责指标                                |
| `native-evidence-storage`                           | Native paths、文件 identity、verification scope/evidence/receipt              | 不复制；保留内容寻址、边界读取和写前后核对机制                                         |
| `native-verification-evidence/receipt`              | canonical hash、redaction、sensitive paths、check policy                      | 不复制；按通用 Attempt/Receipt/Artifact/Bundle 模型重建                                |
| `native-build-evidence`、`native-portable-checks`   | Change、Git provenance、runner protocol、portable requirements、mutation lock | 不复制；它们绑定 Comet Native change 生命周期                                          |
| `native-snapshot`                                   | Git runtime metrics、protected file、sensitive paths、Native types            | 不整块复制；抽取选择 Fence、两次内容复核和安全哈希到通用仓库 Fingerprint               |
| `native-evidence-retention`                         | Change、Checkpoint、Config、Migration、Transaction、Lock、Receipt             | 不复制；按 Repoctopus Evidence 引用闭包重建                                            |
| `native-progress-checkpoint`、`native-checkpoint-*` | Change revision、Continuation、Transition、Mutation Lock                      | 不复制；复用 Repoctopus 已有 Journal/Checkpoint 原语并扩展 Evidence 投影               |
| `native-lock`、`native-mutation-lock`               | race-safe read、file identity、Native paths、Transaction、Config              | 不整块复制；采用通用 file identity/race-safe read，并把所有权算法改造到 Resource Lease |

## 已采用的行为边界

Repoctopus 的进程层保留这些上游行为：

- 正式命令使用可执行文件与 argv，默认不经过 shell。
- Windows `.cmd`、`.bat` 和 `.ps1` 使用受控 shim；危险 batch 参数被拒绝。
- Linux 子进程使用独立进程组，Windows 使用 `taskkill /t /f`；同进程会话使用已持有的 ChildProcess 句柄，崩溃恢复必须同时核对 PID、创建 identity 与资源 lease。
- 进程所有权由 PID 与创建 identity 共同判断；无法读取 identity 时返回 `unknown`，不把不确定状态当作死亡。
- 外部探测具有超时、取消和缓冲区上限。

行为测试位于 `test/process-runtime.test.ts` 与 `test/service-recovery.test.ts`，覆盖含空格与 shell 字符的单一 argv、危险 batch 参数、当前进程 identity、错误 identity、受控进程树终止、命令超时、崩溃接管和 PID identity 不匹配时拒绝终止。

## 后续采用约束

Evidence、Fence、Retention、Journal 和 Lock 的后续实现需要逐项建立与上述候选机制相同的行为特征测试。若未来决定复制新的 Comet 文件，需先更新本分析、`source-manifest.json`、MIT 许可证覆盖和目标摘要；不得为了减少代码量而把 Comet Native Change、Skill 或产品命名引入 Repoctopus 领域。

全量能力归属和旧工作流隔离规则位于 `scripts/architecture-governance.json`。`npm run check:architecture` 要求每个生产源文件具有唯一能力 owner，并阻止旧 `agents-workspace` Hook、Skill、阶段常量、批准口令及项目专有路径进入产品面。
