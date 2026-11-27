# Design

## Context

独立 Windows 五仓实验用 v0.1.5 运行真实机器检查。A 仓的检查第一次失败后只重做了 A，B、C、D 的有效完成保留。实验故意保持 A 的实际检查输入不变，第二次失败时 Runtime 又派发 Build Plan。两次 Verify fingerprint 相同，Plan 也相同，尽管 Work、Attempt 和 Bundle 各自合法更新。

## Goals / Non-Goals

**Goals**

- 在同一个已知失败经过一次自动修复仍无进展时，结束自动派工循环。
- 提供冷恢复后的稳定暂停，以及经明确决定或真实输入变化继续工作的路径。

**Non-Goals**

- 改变正常首次自动修复、现有的可信 Evidence 条件或产品交付流程。
- 将 GitHub 报告的所有细节归因于本实验，或重做 Verify/Build 状态机。

## Decisions

- 参考 Comet Native 持久化失败签名和无进展暂停的做法。Repoctopus 从现有机器 Bundle、已冻结的声明输入与上一轮 Verify 修复事实提取可比较的范围。在 Design 复核哪些实际输入属于签名，确保正常派发身份不会被误当成进展。
- 将暂停绑定当前 Verify 和真实失败证据。既有 Runtime 权威负责续行，宿主只负责展示问题和传递用户的真实决定。复用现有继续处理及审批合同，Design 需确认最小可行扩展。
- 保留实际变化和未知外部结果的既有分流。有真实变化时允许合法的局部修复，暂时不可观察时保留原执行，可信失败停滞才暂停自动派发。

## Risks / Trade-offs

- 过宽的签名会把无关变更计算为进展，过窄则会拦住真实修复。用无语义变化与有效输入变化的对照验收证明边界。
- 暂停若只存在于 CLI 投影，冷恢复仍可能重跑。必须验证持久化行为和至少两个进程的 `status`、`next` 与 `resume`。
- 报告者现场的首次失败仍缺原始 Machine Gate 与 Evidence，本次只对已复现的自动重复派工做可验证的承诺。
