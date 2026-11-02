# Open Observation Continuation Recovery 验证交接

## 结论

`recover-open-observation-continuation` 的实现与生产边界验证已完成。Open Work 在严格校验后若 planning observation 暂时失败，会保留 `validated` checkpoint 并从 planning gate 重观察；普通 HEAD/worktree 变化不再触发全局 reconciliation，真正的 branch、remote、path、身份和拓扑变化仍 fail closed。

## 权威证据

- Repoctopus 正式验证报告：`verification/recover-open-observation-continuation/verification-report.md`
- 核心产品实现边界：`a9d70dddcad31a207662c4bdbfd947b9d508cd47`
- 控制器：`@rpamis/comet@0.5.1`

本文件只把 Comet Classic Verify 入口连接到正式验证报告，不建立第二套验证权威。npm 包摘要只记录在包外的正式报告中，避免包内容自引用。

## 已证明的关键行为

- 单一纯 classifier 被 recovery、managed dispatch、`run next`、状态投影和 next actions 共同使用。
- Provider validation 与 planning gate 的瞬时故障都保留同一 Work、attempt、epoch、packet、Outcome、Receipt、invocation 和 Skill consumption。
- `run resume` 不执行 Provider 或 Host；content drift 交给 phase authority 精确重验。
- branch、remote、path、Project/root identity、仓库增删和 diagnostics 继续触发全局 reconciliation。
- Open observation stage 与 reconciliation class 形成低基数 OTLP 维度，重复 pull 不重复计算逻辑执行量。
- 普通非 Change workflow Run 保持原恢复语义，没有被 Change classifier 错误接管。

## 已知边界

- Runtime 不自动切换或修复 branch、remote、path 与仓库拓扑；identity drift 需要操作方恢复环境或开始新的 Run。
- content drift 不等于自动接受变化；Open、Design、Build、Verify 与 Archive 仍按各自冻结输入精确重验。
- 本 Change 不迁移或篡改此前作为缺陷证据保留的旧 acceptance Run。
