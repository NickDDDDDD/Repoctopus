# 独立设计可实施性复核

阶段：Design。方式：独立审查者只读检查设计、规格、任务与真实实现；没有执行产品修复或修改验收现场。

结论：Git 路径适配、NUL 输出及两类真实 Windows 边界的设计足够实施；仍有一项影响验收范围的未决问题，正式设计尚不能进入 Build。

## 阻断问题

唯一精确前驱采纳并不足以证明原失败 Run 可以由修复包完成 Archive。`domains/runtime/workflow-runs.ts` 的组合采纳保持 Run 与证据，但 `plugins/delivery/file-delivery-provider.ts` 随后要求当前组合等于冻结的 `archive.planningCompositionDigest`。该摘要来自 Archive prepare，并不属于人工 Design PlanningSnapshot 的内容身份。`domains/change-lifecycle/transition.ts` 又禁止 replacement 改变这一字段，公开 preflight 不能绕过。

Evidence 已保持原 Verify Input 和 Bundle 归属，未发现同类硬阻断；不应借机重建证据。主规格也已要求兼容采纳与规划审批正交，重复人工批准不是根因修复。

## 建议

路径修复与跨实现 Archive 恢复应明确区分。推荐保留原失败 Run 与旧包，用修复包独立验收完整路径链路及同一版本恢复，并取得对应验收与 Spec Patch 的明确同意。若用户要求本次完成原 Run 跨实现恢复，需要先正式扩大设计并证明冻结来源与获准执行实现的衔接，不能在实施时临时删校验、改冻结摘要或扩大兼容范围。

范围选项与精确拟修改内容保存在唯一 `design.md`，待用户决定。
