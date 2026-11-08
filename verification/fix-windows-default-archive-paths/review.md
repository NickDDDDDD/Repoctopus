# Archive 路径与执行身份审查

## 独立审查与处理

审查者 archive_recovery_code_review 只读检查基线 04d37b5 至 d4b69ed 的实现，未发现已确认的 Critical 产品缺陷。首轮 Important 是缺少“合法组合采纳 → 生产 Runtime → 真实 Delivery Provider → 核心 publishArchive → 持久 Journal”的自动化链路。原有分层测试不能独自覆盖这个接口边界。

补充 archive-composition-execution.test.ts 后，同一审查者复核该增量，确认 Important 已解决，未发现新增 Critical、Important 或明显跨平台问题。审查不代替测试执行；实现者实际运行该文件 4 项均通过，相关六文件 95 项通过，类型检查与目标 lint 通过。

## 证据边界

- 自动化 A/B 是明确标注的合约元数据夹具，不冒充旧二进制。通过正式 Coordinator 初始化与转换构造已接受 Verify/Archive 事实，没有编辑 Run、审批或 Journal 文件。
- 真实生产 WorkflowRuns.resume 采纳 B；生产 Managed Host claim/outcome、受保护执行、实际 Planning Store 与原组合 Evidence 校验、Git 索引/commit/push 和两个 Journal 均执行。仅替代外部 GitHub MR 的 findAll/status/create 端口。
- 自动化 Closure Receipt 来自构造夹具，不宣称执行了真实 OpenSpec 关闭；真实旧包 Run 到修复包的公开 CLI 验收实际执行了关闭。
- 自动化 packet 在 B 采纳后生成；发布故障和冷恢复也在 B。它验证原 Journal operation、invocation、冻结输入和证据保留，不单独证明 A 已部分发布的 Journal 经升级恢复。
- 原失败 Run 的旧 close Work/accepted Host Outcome、原规划与验证身份，经实际安装包恢复并完成三个真实 MR。现场与远端核对由实现者执行，独立审查者未重复执行现场验收。

最终交付仍受完整 Comet 检查和 CI 约束。

## 最终增量复核

同一审查者核对至 0935ab2 后完成唯一最终集成审查：Critical 0、Important 0。随后仅补看 0935ab2..a39be14 的两项元数据修正，独立计算确认本地 Runtime raw SHA256 与 provenance 新值一致；固定上游提交、sourceSha256、检查脚本均未变化。组合测试仅刷新实际生产编译结果的严格预期摘要，插件集合和结构断言保留；没有放宽检查。最终结论保持无未解决审查阻断，仍以最终输入完整检查与 CI 为交付条件。

包证据准确绑定 d4b69ed；不能把该包摘要当作后续提交或合入 main 后新包的摘要。
