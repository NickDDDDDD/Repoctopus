# Tasks

## 1. 终态权威贯穿恢复入口

- [x] 1.1 核对并记录 Comet 固定版和当前上游的终态规则，先增加完整 status 被历史 reconciliation 标志覆盖的失败回归，再修正共享投影；验收为同一 completed checkpoint 在 Runtime status、continuation 和 next actions 中一致返回完成，RED/GREEN 证据和上游来源可核对。 <!-- comet-task:b5c2b368-cbb9-4c8c-a0d7-bc9e4a94fb24 -->
- [x] 1.2 为 Service 与通用 coordinator 的 completed 恢复增加真实失败回归并实施终态优先分派；验收为合法开发产生分支与 HEAD 变化后，`resume → next` 和 `next → resume` 不新增 reconciliation、活动观察、Host 派发、Work 或阶段转换，并保留所有完成身份和执行计数。 <!-- comet-task:a0c16dfa-ff64-4525-957a-ce30ed37979d -->
- [x] 1.3 补齐完整性和活动恢复负向回归；验收为缺失/损坏的 Store 或 Checkpoint 明确失败、未结 Journal 仍按原机制恢复，且活动 Run 的未授权 checkout、未知外部结果和原 Build/Evidence 恢复测试保持 fail closed 或既有合法 continuation。 <!-- comet-task:02df3761-54be-436d-8039-74ba735841cc -->
- [x] 1.4 更新恢复使用说明与采用来源说明，解释完成 Run、历史诊断和独立后续一致性审查的边界；验收为文档与当前公开命令、两份 delta spec 一致，不出现新增状态 schema、影子规划文件或宿主项目路径。 <!-- comet-task:4e285ec2-43ac-4141-9f17-638e331b3219 -->

## 2. 多仓冷恢复验收与完整验证

- [x] 2.1 在生产 CLI 验收中加入真实多仓 Git 和 completed 发布事实的两个新进程恢复顺序；验收为每一步同时核对 status、continuation、execution、next actions、Closure、PublicationReceipt、Bundle、Package Completion、check epoch 及副作用次数，且重新引入原通用 reconciliation 路径会使回归失败。 <!-- comet-task:febd29aa-0a2a-42ec-8811-02bed759014b -->
- [x] 2.2 用本 change 构建的独立安装包复验小型真实多仓任务，从正式接入、审批、实施和 Evidence 到 Close、发布及终态冷恢复；验收为整个过程仅使用公开 CLI，分支与提交及时 push、远端 MR 唯一且 head/base/OID 正确，旧失败 Store 和报告保持原哈希，新报告明确区分本次结果与历史证据。 <!-- comet-task:9fdc85bf-d195-4f80-b38e-716ddde41be0 -->
- [x] 2.3 完成与本次改动匹配的 Runtime、生命周期、活动 Build/Evidence 恢复、CLI 和完整性回归，以及类型、格式、构建/生成物、架构/来源和严格规格检查；验收为实际命令及退出码被正式验证证据记录，未执行、失败或未知项不计为通过。 <!-- comet-task:6917c193-28ac-4b98-a9b0-2710ce46e4c9 -->
- [x] 2.4 对最终差异完成独立审查并形成正式验证报告，逐条映射本 change 验收要求、上游采用规则和真实失败/修复结果；验收为无未解决的重要缺陷，报告同时列明终态新进程结果、保留的历史诊断与未纳入范围的问题。 <!-- comet-task:8221a7e6-a84b-48c0-894f-093c56a3371d -->

## Workflow follow-up

- 由 Comet Classic 在正式 Verify 通过后按用户授权归档，并完成所选 commit、push 和 PR 交付。
- 合入后核对产品基线与实验 MR 的实际状态；已完成 Run 的后续交付影响继续由独立一致性审查处理。
