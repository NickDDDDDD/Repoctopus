# Design 探索记录

本文件只记录 Comet Design 的候选取舍；行为权威为当前 delta specs，唯一技术设计为 design.md，不建立额外规划或实现事实。

## 已确认

- 用户已批准独立 worktree 和 Open 范围；当前同一 Run 处于 Design。
- 保留 Plan → Execute → Check → Verify，取消无依据的全包失效，不重开全部 OpenSpec Task，不创建特殊 Repair Work/lifecycle。
- 原失败公司 Run 无法从本环境读取；其 checkbox 根因说法未验证。本次针对已定位的全量失效生产路径建立独立回归。
- 新分支已发布；Open 产物 a899007 已 push，严格校验通过，初始 34 项领域基线通过，尚未实施新代码或建立缺陷 RED/GREEN。

## 本轮候选决策（待 Design 审批）

- 用失败 Bundle 的 Acceptance Trace、现有 Plan 和声明依赖确定范围；选定 passed 机器 Receipt 的实际输入证明支持保留。
- 范围不能证明时稳定阻断；现有检查若实际覆盖全局，则允许有证据地全量重验。不新增策略开关或 finding 关联表。
- 采用 Work 权威的内部 `revise-implementation`，保留 `continue-build` 同 Work/epoch retry 的原约束；不以 `build-plan` 漂移代表普通实现缺陷。
- 同内容 Plan 复用原身份，真实内容变化才新 revision；当前候选保留包在 Plan、修复 Execute 和 Check 接受边界重读输入。
- 新的修复依据放入现有 Build Protocol schema 3，Package Completion 与 Host result 结构不改；旧开发 checkpoint 明确拒绝，不做迁移。

## 排除的方案

- 只把全部 package IDs 改成一个 Host 自报 ID：缺乏机器依据，跨仓输入和依赖会被错误复用。
- 只保留旧 completion 不重读真实输入：会让修复改坏的独立包错误通过。
- 直接复用现有 `continue-build` 做跨 Verify 的新 epoch 迁移：与其严格的同 Work retry 契约冲突。
- 每次强制重写 Plan、增加 revision：制造没有语义变化的漂移，保留记录也可能随后再次失效。
- 新增 Repair Work、finding→Task 配置或迁移旧事实：超出已批准范围并重复既有权威。

## 上游核对

固定 Comet 0.5.1 和只读核对 0.5.2 Classic full 都在 Verify 失败后回 Plan；固定 Native 已分开 revise-implementation 与 retry-verifier。本产品只采用恢复分类和保留有效工作的思路，跨仓 completion 证明是自身架构适配，不宣称 Comet 已提供相同算法。

## 验证约束

保留凭证 ID、Plan 语义身份、真实输入、Execute/检查调用次数与新进程恢复都必须验证，不能只看最终 phase 或任务勾选。完整门禁、独立审查及实际安装包多仓验收必须有真实回执；当前尚未发生。

## Builder check

独立审查者已只读核对候选设计、已批准需求和相关生产代码，返回 `nothing important left`，没有需要补充才能制定实施计划的重大问题。原始回执保存在本机仓外验收材料中。本轮结果只说明设计可供实施规划；实际 RED/GREEN、生产组合、安装包多仓验收以及 Build/Verify 的实现审查仍待执行。
