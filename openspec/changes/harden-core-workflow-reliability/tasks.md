# Tasks

## 1. 固定失败基线与领域合同

- [ ] 1.1 为“Host 修改 OpenSpec 后恢复旧 claim”建立 characterization test，并确认当前实现因重新组装 context digest 而失败。
      **Blocked by:** 无
      **Acceptance:** 测试精确停在 `resumeClaim` 的 packet/context identity 边界，并证明失败不是 Host 重复调用或 Provider 校验造成
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份, change-lifecycle#change-run-continuation-必须来自同一权威-checkpoint
- [ ] 1.2 为 OpenSpec `skip_specs: true` 建立真实 status/validate fixture，并确认当前 Provider 投影 `delta-specs: missing`、Open Gate 被错误阻断。
      **Blocked by:** 无
      **Acceptance:** fixture 使用官方 CLI 真实 JSON 形状，测试分别断言官方 skipped、当前 missing 投影和 Gate blocker
      **Requirements:** specification-authority#规格操作使用稳定领域契约, change-lifecycle#open-与-design-必须分别形成受审查边界
- [ ] 1.3 为 INFO、WARNING、ERROR、未知 severity 与 `valid=true + error` 建立 Provider contract tests，并确认 INFO 在旧实现中被误映射为 ERROR。
      **Blocked by:** 无
      **Acceptance:** 五类输入各有独立断言，能够区分映射错误、外部契约冲突和普通 strict validation 失败
      **Requirements:** specification-authority#规格操作使用稳定领域契约, specification-authority#规格校验是推进前置事实
- [ ] 1.4 定义新版本 WorkExecutionCheckpoint、packet content identity、SpecificationArtifact 三态和 SpecificationDiagnostic severity 纯领域类型，并通过序列化、非法枚举和 digest 稳定性测试。
      **Blocked by:** 1.1, 1.2, 1.3
      **Acceptance:** 领域模块不导入 Cordis、文件系统或 OpenSpec 类型；等价输入 digest 一致，旧 checkpoint schema 和非法状态 fail closed
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份, specification-authority#规格操作使用稳定领域契约
- [ ] 1.5 实现工件满足、规划工件规范化和 validation consistency 纯函数，并通过四类恰好一次、ready/skipped/missing、valid/error 矩阵测试。
      **Blocked by:** 1.4
      **Acceptance:** 任何 Service、Gate 或 approval 都可复用同一 helper；missing/重复/无 digest/valid+error 稳定拒绝
      **Requirements:** specification-authority#规格校验是推进前置事实, specification-authority#provider-校验-open-与-design-work-的完成事实

## 2. 不可变 Packet 内容存储

- [ ] 2.1 定义 `WorkExecutionPacketStorePort` 和 Cordis Service，只公开按 runId/packet identity 的 put/get 操作，并通过端口 contract tests。
      **Blocked by:** 1.4
      **Acceptance:** 端口不公开 latest/list 作为恢复权威，不拥有 attempt、continuation 或完成状态；类型检查和 contract tests 通过
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份
- [ ] 2.2 实现按 Run 隔离的文件 packet store，使用安全路径、原子 create-or-verify 和 canonical identity 校验，并通过 Windows 路径、重复写、冲突、截断与越界测试。
      **Blocked by:** 2.1
      **Acceptance:** 文件只出现在 `.repoctopus/runs/<runId>/packets/`；同内容幂等、同 digest 异内容拒绝、无临时残留
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份
- [ ] 2.3 把 packet store 注册到应用组合和测试 harness，验证 Cordis 生命周期、唯一 Provider 与缺失 Provider boot failure。
      **Blocked by:** 2.2
      **Acceptance:** 生产和测试 composition 都解析唯一实现；重复/缺失实现启动失败且错误可定位
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复
- [ ] 2.4 将 claim 改为 assemble → save intent → save packet → Run CAS bind → deliver，并用故障注入验证每个崩溃窗口。
      **Blocked by:** 2.3
      **Acceptance:** packet 保存前不绑定 claim，CAS 前孤儿无执行权，CAS 后响应丢失可读取同一 packet，Host 只在 bind 后收到正文
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复
- [ ] 2.5 让重复 claim 返回同一 packet identity/content，拒绝同一权威 claim 的第二个 packet 或 attempt，并通过并发 CAS 测试。
      **Blocked by:** 2.4
      **Acceptance:** 两个 Runner 竞争时只有一个权威 claim；失败方不会覆盖 packet、调用 Host或推进 Run
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复
- [ ] 2.6 更新 Runtime state 与 packet 安全边界文档，并用 secret/path fixture 验证 Run、checkpoint、trajectory、日志和 OTLP 不含正文或绝对路径。
      **Blocked by:** 2.4
      **Acceptance:** 文档命令与实际目录一致；自动扫描只在私有 packet 文件找到 canary，其他共享事实均无泄漏
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份

## 3. 精确恢复与未知结果处理

- [ ] 3.1 实现统一 `loadAuthoritativePacket` 领域/Service 边界，核对 checkpoint、内容、ActionIntent、current Work、attempt、epoch 与 input digest。
      **Blocked by:** 2.5
      **Acceptance:** 任一 identity 篡改、缺失或跨 Run/Work 引用均 fail closed；正常读取返回深度不可变的原 packet
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复
- [ ] 3.2 将 `resumeClaim` 切换为读取 frozen packet，并用 spy 证明恢复路径不调用 WorkContextAssembler。
      **Blocked by:** 3.1
      **Acceptance:** claim 后修改 Skill、Provider instruction 和规划文件仍恢复相同 packet；assembler 调用次数在恢复阶段为零
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份, change-lifecycle#change-run-continuation-必须来自同一权威-checkpoint
- [ ] 3.3 将 managed executor 的 Host reconcile、外部 Outcome submission 和 Validator retry 统一改为 frozen packet，并验证原 invocation/packet binding。
      **Blocked by:** 3.2
      **Acceptance:** invoking/unknown/outcome/validated 四个断点均不重新组装或重复 invoke；伪造 packet digest/Host/invocation 被拒绝
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复
- [ ] 3.4 对缺失/损坏 packet 与旧 checkpoint 返回精确 `content-missing-or-corrupt` 或 `migration_required` continuation，并删除任何旧重组兼容分支。
      **Blocked by:** 3.3
      **Acceptance:** 负向测试证明 Runtime 保留原 claim、没有新 attempt/Host/Outcome/Store 修改，代码搜索不存在 legacy packet reconstruction
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份, managed-work-execution#受管-work-必须从原执行断点恢复
- [ ] 3.5 完成真实进程重启纵切：Open Host 写四类工件后中断，重建应用并从原 packet、invocation/Outcome 和 Validator 继续到 Open approval。
      **Blocked by:** 3.4
      **Acceptance:** 相同 runId/workId/attempt/checkEpoch/packetDigest 贯穿前后进程，Host invoke 计数为一，最终停在可信 Open Human Decision
      **Requirements:** change-lifecycle#change-run-continuation-必须来自同一权威-checkpoint, change-lifecycle#open-与-design-必须分别形成受审查边界
- [ ] 3.6 更新恢复架构文档，记录 Comet reserve/execute/commit 与 Repoctopus 对应边界，并执行本组单元、并发和重启测试。
      **Blocked by:** 3.5
      **Acceptance:** 文档不宣称采用 Comet SDK；本组测试可独立运行且全部通过
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复

## 4. Specification Provider 归一化

- [ ] 4.1 扩展 OpenSpec status parser，窄解析官方 artifact `skipped`，继续用实际输出路径证明 ready，并拒绝重复、未知或矛盾状态。
      **Blocked by:** 1.5
      **Acceptance:** 官方 skip fixture 投影 skipped；空但可开始写的 ready 状态不被误当完成；未知状态 fail closed
      **Requirements:** specification-authority#规格操作使用稳定领域契约
- [ ] 4.2 为 skipped 工件生成绑定 Provider/change/artifact/metadata 的稳定 digest，并验证 metadata 或 skip 状态变化会改变 planning semantic identity。
      **Blocked by:** 4.1
      **Acceptance:** 等价官方输出 digest 稳定，metadata 变化使旧 approval 失效，missing 不获得满足 digest
      **Requirements:** specification-authority#规格操作使用稳定领域契约, specification-authority#规格校验是推进前置事实
- [ ] 4.3 修正诊断映射，大小写无关地保留 info/warning/error，未知 severity 形成 contract error，并通过 fixture 矩阵。
      **Blocked by:** 1.5
      **Acceptance:** INFO 不阻断、WARNING 可见、ERROR 阻断、未知值 fail closed且原 code/message/path 在安全边界内保留
      **Requirements:** specification-authority#规格操作使用稳定领域契约
- [ ] 4.4 强制 validation 一致性不变量，把 `valid=true + error` 归一化为无效并追加 contract-conflict 诊断。
      **Blocked by:** 4.3
      **Acceptance:** validationDigest 绑定归一化后结果；任何有效结果 error 计数为零，严格校验 fallback 仍可定位
      **Requirements:** specification-authority#规格校验是推进前置事实
- [ ] 4.5 让 planning manifest/approval、Open/Design validator 与 Archive preflight 复用领域 satisfaction helper，删除 Workflow 的四个 ready 硬编码。
      **Blocked by:** 4.2, 4.4
      **Acceptance:** 普通 delta Change 与 skip_specs Change 都形成四类稳定快照；missing/重复/无 digest 在同一 helper 阻断
      **Requirements:** specification-authority#provider-校验-open-与-design-work-的完成事实, change-lifecycle#open-与-design-必须分别形成受审查边界
- [ ] 4.6 使用真实 OpenSpec CLI 临时 Store 完成普通/skip_specs/invalid 三条纵切，并更新 Specification 文档。
      **Blocked by:** 4.5
      **Acceptance:** 普通与 skip_specs 均 strict valid 并到 Open approval，invalid 保持 Open blocked；临时 Store 和进程日志测试后清理
      **Requirements:** specification-authority#规格校验是推进前置事实, change-lifecycle#open-与-design-必须分别形成受审查边界

## 5. 遥测与可观测一致性

- [ ] 5.1 为 packet create/reuse/recover/missing/corrupt/legacy 记录有界 Trajectory 事实并接入 OTLP 映射。
      **Blocked by:** 3.4
      **Acceptance:** 事件绑定 run/work/attempt/epoch/packet digest 和固定结果枚举，不含 packet 正文、路径、Prompt 或任意错误消息 label
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复
- [ ] 5.2 为 Provider artifact ready/skipped/missing 与 validation severity counts/contract-conflict 记录有界事实并接入相同 OTLP 管道。
      **Blocked by:** 4.5
      **Acceptance:** artifact kind/status 与 severity 是固定枚举，Metric labels 无 changeId/digest/path/诊断 code/message 高基数字段
      **Requirements:** specification-authority#规格操作使用稳定领域契约, specification-authority#规格校验是推进前置事实
- [ ] 5.3 更新 Desktop receiver/projection fixture，验证本地 Dashboard 与 SigNoz payload 对 phase、Work、packet recovery 和 Provider 状态使用同一事件源。
      **Blocked by:** 5.1, 5.2
      **Acceptance:** receiver 不查询 RunStore/packet store，乱序/重放幂等，skip_specs 不显示为缺失或 error
      **Requirements:** change-lifecycle#change-run-continuation-必须来自同一权威-checkpoint
- [ ] 5.4 更新 Telemetry 文档和安全 allowlist，并运行映射、redaction、OTLP round-trip 与 Desktop projection 测试。
      **Blocked by:** 5.3
      **Acceptance:** 文档列出固定字段与禁止字段；canary 正文/路径/诊断消息未出现在 span、log、metric 或 Desktop projection
      **Requirements:** managed-work-execution#持久事实只保存执行上下文身份

## 6. 集成验收与交付

- [ ] 6.1 建立故障矩阵，覆盖 packet save/CAS/response、Host invoke/response、Outcome/Validator/transition 与 Provider CLI 各中断点。
      **Blocked by:** 3.5, 4.6, 5.4
      **Acceptance:** 每个中断点都有唯一 continuation；未知结果不重放，已完成结果不重新 invoke，missing/corrupt 不推进
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复, change-lifecycle#change-run-continuation-必须来自同一权威-checkpoint
- [ ] 6.2 完成单仓与多仓公共 CLI 纵切，验证 Workspace Store、固定 Provider、同一 Run 和 packet 恢复不受仓库拓扑影响。
      **Blocked by:** 6.1
      **Acceptance:** 两条纵切均从 Open claim 到可信 approval；多仓 snapshot/binding 保持不变且没有第二 Run/attempt
      **Requirements:** change-lifecycle#open-与-design-必须分别形成受审查边界
- [ ] 6.3 执行 typecheck、lint、全量 test、package、OpenSpec strict、provenance 和架构禁用规则，并修复全部回归。
      **Blocked by:** 6.2
      **Acceptance:** 仓库正式验证命令全部退出 0；没有 only/skip、临时兼容分支、generation、第五规划文档或 Store 手改
      **Requirements:** managed-work-execution#受管-work-必须从原执行断点恢复, specification-authority#规格校验是推进前置事实
- [ ] 6.4 生成正式 Verification Report 与 Evidence，记录命令、输入摘要、失败注入、恢复 identity、Provider 三态和遥测一致性。
      **Blocked by:** 6.3
      **Acceptance:** 报告可从证据复算同一 run/work/attempt/epoch/packet 与四类工件满足事实，且不含敏感 packet 正文
      **Requirements:** change-lifecycle#change-run-continuation-必须来自同一权威-checkpoint
- [ ] 6.5 清理临时 Workspace、packet fixture、故障注入日志和调试输出，检查 Git diff 后提交并推送所有受管变更。
      **Blocked by:** 6.4
      **Acceptance:** Git 只包含预期源码、测试、四份 OpenSpec 规划产物、正式文档与 Evidence；分支远端与本地 HEAD 一致
      **Requirements:** specification-authority#provider-校验-open-与-design-work-的完成事实

## Workflow follow-up

- Open 规划批准后进入 Design 深化；本文件的 tracked tasks 只在独立 Design approval 后开始实施。
- Verify 通过并取得用户归档批准后，使用官方 OpenSpec archive 完成规格关闭，再通过正常 MR 合入。
