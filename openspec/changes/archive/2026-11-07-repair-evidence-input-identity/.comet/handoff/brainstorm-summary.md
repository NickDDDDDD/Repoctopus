# Design 澄清摘要

## 已确认

- 用户已批准当前八项任务的 Open 范围，继续外部 Comet Classic；未批准 Design 或 Build。
- 目标是等价 Task 收尾保留有效 Verify Evidence，真实依赖变化准确失效；保持多仓、Cordis、Specification Provider 和唯一 Run。
- 采用 Comet 的逐文件内容、Task 语义投影与显式 Git 依赖思路，不增加生命周期或旧证据兼容。

## 当前设计候选

- 共享 Profile 的 command 节点通过 `inputs` 声明逐仓 files/outputs、Git、Task checkbox 和环境依赖，省略范围时使用保守内容集合。
- Provider 提供有来源证明的官方规划工件投影；Git Adapter 收集实际有效内容及独立审计来源。
- Receipt 与 Bundle/Gate 使用不同粒度的输入身份，候选 Receipt 从实际 Store 查询并通过统一依赖校验后交给现有执行器；不新增证据数据库。
- Verify、Archive 和相应恢复入口共用同一输入观察，Run CAS 与 Journal 继续保护接受和副作用边界。

## Builder Check 处理

独立复核指出 DAG 前驱生成文件与初始快照之间的时序缺口。设计已明确源输入与同 Attempt 派生输入分离：固定源输入及 producer/DAG 规则，Runtime 在 producer Receipt 提交前采集输出 manifest，consumer 开始前核对并冻结实际派生内容；结束、Gate 与 Archive 按该证明链重验。输出缺失时不复用缓存 producer；未知执行不重发。复核补充覆盖实际产物与三处中断，未增加阶段或另一份证据 Store。

补充后独立 Builder Check 再次只读核对，结论为 `nothing important left`。这表示设计已可制定计划，不是实现或运行验收已经完成；Design 仍等待当前提案的用户批准。

## 用户要求参考 Comet 完成的规格措辞修正

当前 delta 把等价收尾的结果写成保留同一 Archive Work 且不递增 epoch，超出了“不要重复 Verify”的目标。实际 `ArchiveDeliveryInput` 还冻结发布 OID；提交若改变这个发布坐标，旧 Work 就不能继续使用，而首次准备 Archive Work 本来也会合法递增 epoch。

用户回复“comet 是怎么做的，参考 coemt 修正”。核对固定 Comet 的 check policy、Archive preflight 与 delivery validator 后完成 `change-lifecycle` delta 修正：有效 Gate、Bundle 和完成事实保持；独立发布 preflight 仍核对当前分支与坐标，已冻结坐标变化时先阻断并重新核对授权、范围和证据，成功后建立匹配的发布 checkpoint。首次准备或合法发布转换允许递增 epoch，不能因此误回 Verify。副作用已经开始时继续原 Journal/reconciliation。本次指示覆盖这处 Spec Patch，完整 Design 仍等待独立批准。
