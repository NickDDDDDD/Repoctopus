---
change: stabilize-incremental-workflow-recovery
status: verified
---

# 增量工作流恢复稳定性验证交接

## 结论

`stabilize-incremental-workflow-recovery` 的 29 项 OpenSpec 任务已全部完成，完整门禁、真实多仓验收和恢复轨迹重放均通过。Runtime 现在按权威层级选择最小恢复动作，不再把普通实现、计划或 Evidence 问题粗暴折叠为 Build 到 Design 的回退。

## 权威证据

- Repoctopus 正式验证报告：`verification/stabilize-incremental-workflow-recovery/verification-report.md`
- 核心产品实现边界：`a94af4b8b49332a5b858a7e41a1e5c299fec5d2a`
- 包内容 SHA-256：`28ea217e7d987d46da10e346f1a9c411719da3080841f2e6b8abdfb07c7e0b77`
- 控制器：`@rpamis/comet@0.5.1`
- 自审结果：Runtime transition owner、恢复优先级、Evidence 依赖闭包、Specification 前置校验、外部 Host 身份和遥测低基数边界均通过，阻断项为 0。

本文件是 Comet Classic Verify 的阶段报告入口，只把生命周期证据绑定到上述正式报告；它不建立第二套产品验证权威。可复现的 npm 包摘要只保存在正式报告中，避免阶段报告对包摘要形成自引用。

## Build Check 证据

- 命令：`npm.cmd run verify`
- 结果：退出码 0，输入前后摘要一致
- 输入项：2,261
- 输入摘要：`89568e373c98cde3365df2befb38039924058e22534ba39958f86099cbe1f087`
- 收据：`.comet/runtime/classic-sdk-checks/5ca2803a4b834203a4086115801f5cec571445b874c5c0186b29858160c03416/368f383f-78dd-44d3-88cf-331519c7420a.log`

完整验证覆盖类型检查、Desktop 类型检查、Lint、CLI/Desktop 构建、189 个测试文件、938 个通过测试与 2 个按设计跳过的测试、generated/brand/architecture/provenance/Dashboard salvage、18 项严格 OpenSpec 校验，以及正式验证报告的新鲜度复现。六个真实受管场景覆盖 autonomous/subagent、单仓/多仓、保护分支修正、冷恢复、Evidence retry 和 Archive。

## 恢复演练

第一次 Build Check 使用了未匹配 policy 的 `npm` argv。Comet 在创建子进程前因保守输入扫描遇到 Windows `node_modules` junction 而拒绝执行，并把已领取 Action 标为 unknown。检查记录、命令、receipt 与 manifest 均不存在。通过原 Action 的 `not-executed` reconciliation 建立第二次 attempt 后，Runtime 派发 policy 声明的精确 `npm.cmd run verify` argv，检查正常完成。原 claim 和失败历史均被保留，没有编辑 Store 或伪造成功收据。

## 已知边界

- 后续提交只允许包含 OpenSpec、Comet 与验证证据；产品包变化会被正式报告新鲜度门拒绝。
- 主规格只在 OpenSpec Archive 中由 delta 同步，不在 Build 或 Verify 中手工改写。
- Verify Guard 仍须生成 Verify 作用域的真实检查收据；Build receipt 不能替代 Verify receipt。
