# Implementation Notes

## Deviations

实施期间如代码事实要求偏离 `design.md` 或 `tasks.md`，在此记录原计划、实际约束、采用方案和验证结果。未记录的偏离不得在评审时被视为已批准设计。

## Stop Conditions

- OpenSpec、固定 DSH 源码、Matt Skill 行为、代码平台契约、设计图或现有公共协议存在实质冲突。
- DSH Skill 行为闭包无法在不引入第二个 Runtime 或 DSH Agent Loop 的情况下接入，且没有保持原语义的最小适配方案。
- 合入后机器动作无法限制在配置的 workspace 路径，或需要 merge、force push、rebase、删除分支或修改业务代码才能完成。
- 真实平台事实无法唯一映射 change、workspace MR 和业务 MR 集合。
- 实现需要把凭据、webhook 原始秘密、Skill 正文或个人学习内容写入日志、Git 或 OpenTelemetry。
