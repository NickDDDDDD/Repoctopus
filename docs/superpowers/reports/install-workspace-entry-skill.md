# Workspace 入口 Skill 验证报告

## 安装与真实宿主

在 Windows 用 `npm pack` 构建并独立安装 CLI。真实交互终端先展示 Codex 与 OpenCode 入口安装目标。批准前目标不存在，批准后两个入口只在 Workspace 中生成。三个 Git 仓通过独立 OpenSpec Store 与本地远端连接。

真实 Codex 新会话显式调用 Workspace 的 `repoctopus` Skill，经公开 CLI 启动和领取 Open。宿主从保存的完整 JSON 响应读取 `repoctopus-open-change`、`grilling` 及其资源。提交 Open 后 Runtime 等待独立审批。批准测试提案后，从另一个 Codex 进程恢复同一 Run，领取 Design 并实际读取 `repoctopus-design-change`、`codebase-design` 和 `DESIGN-IT-TWICE.md`。两次测试决定用实验 Workspace 的交互终端执行。

Build Configure 接受后，单独 CLI 进程恢复同一 Run，用相同的 Runner 和能力领取 Build Plan。重复领取返回原 invocation 且执行权为 false。Run 的五条 `skill.consumed` 事件分别与 Open、Design 和 Configure 的 invocation、packet 与回执匹配。本实验核对实际事件与回执，OTLP 映射由仓库测试覆盖。

OpenCode 1.19.5 的真实原生 `skill` 工具从仅含 `.opencode` 入口的项目返回完整已安装正文。用本地确定性模型驱动该工具调用。最终提交的 CLI 包重新验收了接入审批、宿主加载和缺输入时的行为。Codex 在缺少 Change ID、目标分支和 Run ID 时要求补充，未建立 Run。

## 规格与实现核对

OpenSpec 严格校验通过，8 项任务已完成。接入规格由 `project detect/prepare/review` 和 `workspace-entry-skills.ts` 实现，审批摘要绑定相对目标、候选内容与写入前态。宿主入口和装填规格由已安装的入口 Skill、公共 Run CLI、`WorkDispatcher` 与 `WorkContextAssembler` 实现。四类 OpenSpec 产物和 Runtime 的既有审批、执行包及 Outcome 权威贯穿两条路径。独立审查核对了两个 delta spec 中的接入、冲突、启动、冷恢复和停止场景。

## 失败回归和恢复

- 初次入口回归在旧实现上因缺少接入计划而失败。初次公开 Design claim 回归因缺少 `DESIGN-IT-TWICE.md` 资源而失败。实现后两项转绿。
- 接入回归覆盖批准前不写、同名和本地修改冲突、申请摘要变化、越界目录、写入后和提交前暂存中断、已接入补齐及已完成请求重放。父目录被联接替换时，暂存清理保留被移走的文件。
- 资源回归覆盖 Skill 目录链接、平铺 Skill 资源隔离、诊断层资源参与摘要、旧包的可核验资源补交，以及资源漂移时不得启动宿主。
- 用 `87dcd963` 实际创建并持久化未启动的旧 Open claim。新版通过精确前驱继续，保留同一 intent 和 packet digest，核验并补交 `agents/openai.yaml`，接受 Outcome 后进入原 Run 的 Open 决定。旧版平铺 Skill 若冻结了共享目录摘要，需要在原 Runtime 与原目录状态结算待处理工作。
- 独立分段审查和最终集成审查核对了恢复、路径、资源与兼容性。审查发现已修复，最终无阻断。

首轮正式 Verify 通过 1222 项测试，跳过 4 项，失败 1 项。唯一失败为组合兼容测试仍固定旧前驱摘要。测试现核对当前已实测的三个精确前驱，Runtime 代码和安装包无改动。

[验收回执](../../../verification/install-workspace-entry-skill/acceptance-receipt.json) 绑定包、Run 和执行身份。正式检查由 Comet Guard 保存实际命令与结果。
