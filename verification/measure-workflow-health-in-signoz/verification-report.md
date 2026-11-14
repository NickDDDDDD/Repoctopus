
# 工作流健康遥测与 SigNoz 验证

Tested implementation commit: `89b7765fb09a661ed10b33f1cab3168a65cf1f77`

Package content SHA-256: `8032cab653d00434759bcd4699c293b905ba9f7924a8e056da2103503f1bea37`

Package files: `486`

Package content bytes: `6458882`

## 对账

- Windows Node.js 24，实际 `.tgz` 通过 npm 安装。五个独立 Git 仓与独立 OpenSpec Store 通过公开 CLI 创建 Run、批准 Open 和 Design、完成四个工作包以及独立 Build Check。首次 Verify 在检查 A 读到 `unit-only` 后转回 Build，保留 B/C/D 的 Completion。修复后第二次 Verify 接受，进入 Archive。
- SigNoz 0.150.0 和 MCP 0.19 在本机 Docker 运行。通过 MCP 查询、更新及回读同一份 v6 看板，九个面板可运行。真实日志查到配置 `autonomous / tdd / branch`、审批等待、Build 短暂阻塞、Verify → Build 及进入 Archive。
- 独立 OTLP 查询夹具覆盖内置生命周期当前没有产生的 `failed` 终态、窗口前启动与回退、重复投递、零回退和空分母。夹具中窗口内启动 3 个、终态 3 个，其中 1 个失败，1 个同期启动的 Run 未结束。两个完成 Run 的实际回退汇总分别为 3 和 0，均值为 1.5，其中 Verify → Build 为 1，Verify → Design 为 0.5。夹具 scope 独立于团队面板。
- 真实五仓 Open 到 Design 的两个同构场景使用同一个候选运行实现，默认与完整诊断的 HTTP 请求分别为 4 和 42。Collector 接受的记录分别为 4 和 4,885（1,206 Log、1,206 Span、2,473 Metric 点）。按 Workspace 查询的可关联 Run 日志分别为 4 和 67，两个模式均无重复 event ID。完整诊断是同实现的对照配置，包含启动收尾和不在看板范围内的细粒度记录。
- 回归覆盖独立进程重开 outbox、部分拒绝、Metric 重试保留 Log 成功、按 Collector 413 自动拆批以及桌面实时投递。独立审查核对了受保护 Runtime 身份、旧终态、关闭时错误隔离和 Scope SQL。受保护 Workflow Run 源码与基线一致。


## 完成终态复核

候选包 `89b7765` 在 `signoz-health-complete` 完成五仓生命周期。OpenSpec 在受管 checkout 实际关闭规格，四个业务分支及一个规格归档分支使用真实 Git HTTP 推送并核对提交。GitHub MR API 在本机模拟，四个业务 MR 与一个规格 MR 由 Runtime 接受进同一 Publication Receipt，Run 到达 `completed`。首次 API 结果未知的调用保留在原 journal，沿同一 Work 恢复后完成。

Trajectory 的唯一回退由 `verify.failed` 记录为 Verify → Build。SigNoz MCP 以 Workspace 隔离查询，同一 Run 窗口内启动 1、结束 1、未完成 0、失败 0，配置为 `autonomous / tdd / branch`。将窗口起点放到该回退后一毫秒，启动数为 0，完成数仍为 1，平均回退仍为 1，Verify → Build 为 1，其余路径为 0。

