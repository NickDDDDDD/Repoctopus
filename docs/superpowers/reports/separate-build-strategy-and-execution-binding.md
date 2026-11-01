# Build Strategy 与 Execution Binding 验证交接

## 结论

`separate-build-strategy-and-execution-binding` 的实现、真实多仓生命周期、Binding 漂移恢复和完整 Build 门禁均已通过。独立复核没有发现未解决的阻断项。

## 权威证据

- Repoctopus 正式验证报告：`verification/separate-build-strategy-and-execution-binding/verification-report.md`
- 核心产品实现边界：`7e69f378ed9f74ccbe16db4d0fe2f685a2cea2ca`
- 控制器：`@rpamis/comet@0.5.1`
- 独立复核：Strategy/Binding 身份分离、Design approval 绑定、Plan Evidence 完整性、外部 Runner Host fencing、Binding 漂移重验、决定复用、遥测基数和 Desktop 投影均通过，阻断项为 0。

本文件是 Comet Classic Verify 所需的报告入口，只负责把生命周期证据绑定到上述正式报告；它不建立第二套规格、任务或产品验证权威。npm 包摘要只记录在包外的正式报告中，避免本文件对自身所在包产生摘要自引用。

## 当前 Build Checkpoint 证据

- Build Check 命令：`npm run verify`
- 结果：退出码 0，执行期间工作区无变化，输入前后摘要一致
- 输入摘要：`2ca45abdc9f5d9c4e167b778becc331ffc8d61b9636e2dafd4bf4579f3563e35`
- 内容摘要：`52a24cd972f7b9c7e7bfd71ac1670b0284159e9b797353e858b2cc032e17248d`
- 收据：`.comet/runtime/classic-sdk-checks/d9fa9a59c64a3c1071e7a7f17bd3907ddbd432a0ff5eaffb278f8fc47d8cc4dd/3f873433-5c6e-4e3b-813f-556e0b19fd3d.log`

完整验证覆盖 TypeScript、Desktop TypeScript、Lint、CLI/Desktop 生产构建、158 个测试文件、708 个通过测试与 2 个跳过测试、generated/brand/architecture/provenance/Dashboard salvage、18 项严格 OpenSpec 校验，以及正式验证包复现。

## 审查范围与结论

- 稳定人工语义只存在 `BuildStrategy`；Host、capability、checkout、worktree 和 HEAD 只存在 `ExecutionBinding`。
- Design approval 绑定 Strategy 摘要；Configure 自动验证 Binding，不创建常规人工决定。
- Plan 同时绑定 Strategy 与 Binding，Plan Evidence 在 Execute 前完成 Task、acceptance、repository/write scope、DAG、report owner、Host、composition 和 risk 检查。
- Binding 漂移只失效依赖机器事实的后继身份；同语义高风险决定被复用，真实风险语义变化才产生新决定。
- 外部 Runner claim 与当前 Binding Host 不一致时 fail closed；只有 Configure 能建立新 Binding。
- Trajectory、OTLP 和 Desktop 将人工 Strategy 变化与自动 Binding 重验分开投影；指标维度保持有界且不泄露路径、正文或摘要片段。

## 已知边界

- 本文件属于产品包，因此提交后必须由包外正式报告重新绑定最终包摘要；旧摘要不能继续使用。
- Archive 前仍须由 Comet Verify Guard 生成 Verify 作用域的真实检查收据；Build 收据不能替代 Verify 收据。
- OpenSpec 的四份 Change 文档和 `tasks.md` 仍是规格与计划权威；本文件只是一份生命周期验收入口。
