# 实施反馈机制采用分析

## 分析基线

- 上游：`https://github.com/AbanteAI/comet`
- 版本：`0.4.5`
- Commit：`575ab0d172e8105257b3c9172b8c8a9b628960ca`
- 分析范围：命令执行、进程身份、Evidence、Receipt、Snapshot/Fence、Retention、Checkpoint/Journal 与 Lock。

本分析以 import 闭包和 Repoctopus 领域边界为判断依据。采用机制不等于复制同名文件；只有依赖闭包可以从 Comet 产品域中安全分离时才复制源码。

## 依赖闭包结论

| 候选机制                                            | 直接或关键内部依赖                                                            | 结论                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `spawn-command`                                     | Node child process、文件存在检查                                              | 改造采用；独立且解决 Windows npm shim 与 argv 边界                              |
| `terminate-process-tree`                            | Node child process                                                            | 原样采用；独立且具有 Windows/Linux 明确语义                                     |
| `process-identity`                                  | `external-command`、`windows-process-identity`                                | 连同最小闭包采用；用于识别 PID 复用                                             |
| `external-command`                                  | `spawn-command`、Comet runtime metrics                                        | 移除指标依赖后采用；Repoctopus 由 OTel Adapter 负责指标                         |
| `native-evidence-storage`                           | Native paths、文件 identity、verification scope/evidence/receipt              | 不复制；保留内容寻址、边界读取和写前后核对机制                                  |
| `native-verification-evidence/receipt`              | canonical hash、redaction、sensitive paths、check policy                      | 不复制；按通用 Attempt/Receipt/Artifact/Bundle 模型重建                         |
| `native-build-evidence`、`native-portable-checks`   | Change、Git provenance、runner protocol、portable requirements、mutation lock | 不复制；它们绑定 Comet Native change 生命周期                                   |
| `native-snapshot`                                   | Git runtime metrics、protected file、sensitive paths、Native types            | 不复制；采用开始/结束 Fence 与内容 manifest 思路                                |
| `native-evidence-retention`                         | Change、Checkpoint、Config、Migration、Transaction、Lock、Receipt             | 不复制；按 Repoctopus Evidence 引用闭包重建                                     |
| `native-progress-checkpoint`、`native-checkpoint-*` | Change revision、Continuation、Transition、Mutation Lock                      | 不复制；复用 Repoctopus 已有 Journal/Checkpoint 原语并扩展 Evidence 投影        |
| `native-lock`、`native-mutation-lock`               | race-safe read、file identity、Native paths、Transaction、Config              | 不整块复制；采用 owner identity、原子取得、保守 takeover 和 mutation fence 规则 |

## 已采用的行为边界

Repoctopus 的进程层保留这些上游行为：

- 正式命令使用可执行文件与 argv，默认不经过 shell。
- Windows `.cmd`、`.bat` 和 `.ps1` 使用受控 shim；危险 batch 参数被拒绝。
- Linux 子进程使用独立进程组，Windows 使用 `taskkill /t /f`，只接受已持有的 ChildProcess 句柄作为终止目标。
- 进程所有权由 PID 与创建 identity 共同判断；无法读取 identity 时返回 `unknown`，不把不确定状态当作死亡。
- 外部探测具有超时、取消和缓冲区上限。

行为测试位于 `test/process-runtime.test.ts`，覆盖含空格与 shell 字符的单一 argv、危险 batch 参数、当前进程 identity、错误 identity、受控进程树终止和命令超时。

## 后续采用约束

Evidence、Fence、Retention、Journal 和 Lock 的后续实现需要逐项建立与上述候选机制相同的行为特征测试。若未来决定复制新的 Comet 文件，需先更新本分析、`source-manifest.json`、MIT 许可证覆盖和目标摘要；不得为了减少代码量而把 Comet Native Change、Skill 或产品命名引入 Repoctopus 领域。
