# Spec Delta

## ADDED Requirements

### Requirement: Windows 候选包通过多仓生命周期验收

维护者 MUST 能在 Windows 上独立使用指定的 Repoctopus CLI 安装包运行多仓端到端验收。Release Prepare MUST 对当前发布候选使用同一验收入口，并在验收通过后才封存和上传资产。

#### Scenario: 独立验收指定安装包
- **WHEN** 维护者在 Windows 上提供一个候选 `.tgz` 并启动多仓验收
- **THEN** 验收 MUST 在隔离的消费目录中安装指定包，并通过安装后提供的公共 CLI 初始化 Workspace 和业务仓、完成一条 Change 的 Open、Design、Build、Verify 和 Archive
- **AND** 验收 MUST 记录实际消费的包摘要、各关键阶段结果及最终 Run 状态

#### Scenario: 工作包完成后在新进程继续同一 Run
- **WHEN** 第一个 Build 工作包的完成事实已持久化，且验收结束当前 CLI 进程
- **THEN** 新 CLI 进程 MUST 以原 Run 继续执行尚未完成的工作包，保留原计划与首包完成事实，最终完成 Verify 和 Archive

#### Scenario: PR 创建成功但响应丢失后采纳原发布结果
- **WHEN** Archive 已推送目标分支，托管服务已创建规格 PR 但创建响应丢失，且初次恢复暂时无法观察到该 PR
- **THEN** Runtime MUST 保留原 Run 并等待可核验的发布结果，恢复查询后采纳已创建的同一个 PR
- **AND** 验收 MUST 根据原始创建请求、Git 推送请求及远端事实确认等待、恢复和终态复读期间未重复发布

#### Scenario: 使用实际候选包作为准备门禁
- **WHEN** Release Prepare 生成待发布的 CLI 候选包
- **THEN** Windows 多仓验收 MUST 使用该候选的实际文件，且封存的 CLI 文件摘要 MUST 与通过验收的摘要一致
- **AND** 在验收失败或证据缺失时，Release Prepare MUST 停止准备并保留可定位的阶段与诊断
