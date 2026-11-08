# 扩展设计独立复核

范围：用户选择 B，在同一 Change 修复 Windows 长路径及跨实现 Archive 恢复；原失败 Run 由修复包公开接续。

结果：nothing important left。设计足以制定实施计划，未发现需要进一步决定的阻断。仅只读核对设计和源码，没有实现、运行产品验证或操作实验 Run。

- 现有 capability 与 Provider authority 名称不同，设计补齐 Archive 的真实规格关闭及发布依赖。
- 在原 withArchiveEffectAuthority 内核对最新组合，并由可信 Run 形成执行上下文；不用历史来源要求当前执行器完全相同，不新增持久授权协议。
- 原 Bundle 继续由 evidenceCompositionDigest 证明归属，真实输入依赖仍校验。
- Business Publication Journal 的稳定 operation identity 不含当前 composition，既有观察、采用和 unknown 拒绝盲重试规则保留。
- 新回归不 mock 核心校验，真实旧包到新包的公开验收与合成夹具分开记录。

该结论不代表实现或测试通过。正式技术设计及任务权威仍位于当前 Change 的 design.md、delta spec 和 tasks.md。
