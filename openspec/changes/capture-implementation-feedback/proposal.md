# Proposal

## Why

Repoctopus 已能推进 Run、恢复状态并治理多仓交付，但 Verify 仍只能接收调用方提交的结果，无法直接证明代码确实完成构建、服务已经健康、页面能够打开或视觉检查已经执行。现在需要把命令、服务、浏览器和视觉反馈收敛为 Runtime 可验证、可失效且可审计的 Evidence，使 Agent 获得真实实施反馈，而不是依赖文字自述。

## What Changes

- 增加团队共享 `repoctopus.yaml` 与本机 `.repoctopus/local.yaml` 的项目配置模型；确定性探测只生成候选和 reconcile diff，正式配置仍由 Agent 补全并经用户确认。
- 增加版本化 Evidence Profile、依赖 DAG、Attempt、Receipt、Artifact、Bundle 和 Gate Outcome，区分 `verified`、`observed`、`fresh`、`reused`、`superseded` 及 `passed`、`failed`、`incomplete`、`passed_with_warnings`。
- 增加结构化命令、Managed/Attached 服务、HTTP/端口/日志就绪、浏览器 Journey、截图、console、失败请求和视觉检查请求 Adapter。
- 增加内容寻址 Artifact 存储、输入指纹、采集前后 fence、漂移失效、容量限制、脱敏、保留策略、资源 lease、进程身份和中断恢复。
- 增加浏览器运行时分级：系统 Chrome/Edge 产生开发反馈；显式安装的固定 Chromium 产生可用于正式门禁的浏览器证据。
- 当视觉结果、OpenSpec、设计图或接口契约存在实质冲突时，生成 `requirements-conflict` Human Decision 并阻断受影响验证，不自动选择任何依据。
- 增加 Evidence CLI、版本化 JSON envelope 和 OpenTelemetry 映射；遥测只记录低基数状态与 Artifact 引用，不包含截图、完整日志或敏感值。
- 在 `agent-lab-workspace` 提供真实项目配置，验证四仓构建、两个 Spring 服务、Vite、桌面与移动 Journey、结构化视觉反馈、漂移失效、恢复和清理；四个业务仓保持无非预期修改。
- 采用 Comet 固定基线中满足需求的命令执行、进程身份、内容寻址 Evidence、Receipt、Fingerprint、Retention、Lock 和 Journal 机制，并扩展多仓、服务、浏览器、视觉与 OTel 行为。
- 本次不实现完整 RED/GREEN/REFACTOR 状态机、OpenSpec 全生命周期编排、OpenWiki 回写、CodeHub、具体 IDE 插件和 SigNoz Dashboard。

## Capabilities

### New Capabilities

- `project-configuration`: 定义共享项目配置、本机覆盖、确定性探测候选、用户确认和配置 reconcile 行为。
- `implementation-evidence`: 定义可信 Evidence、Artifact、Receipt、Bundle、输入指纹、有效期、聚合门禁、保留与恢复契约。
- `feedback-collection`: 定义命令、服务、健康检查、浏览器 Journey、视觉检查、资源 lease 和反馈采集 Adapter 行为。

### Modified Capabilities

- `development-telemetry`: 增加 Evidence Attempt、Adapter 执行、Artifact 引用、Gate Outcome 和恢复事件的最小化遥测要求。

## Impact

- 新增 Evidence 领域与项目配置领域，并由 Runtime 组合命令、进程、健康、浏览器、视觉、Artifact、Store 和 Telemetry 端口。
- 扩展 CLI、`.repoctopus/` 状态布局、配置 Schema、doctor 和 npm 分发内容。
- 引入精确锁定的 `playwright-core`；固定 Chromium 由显式安装命令管理，不在普通运行中隐式下载。
- 从 Comet `0.4.5` 固定 commit `575ab0d172e8105257b3c9172b8c8a9b628960ca` 采用的每个文件都需要更新 MIT 许可证、来源清单、摘要、采用报告和行为测试。
- 增加 Repoctopus 合成 E2E，并在独立 `agent-lab-workspace` 仓增加真实项目配置与验收入口。
