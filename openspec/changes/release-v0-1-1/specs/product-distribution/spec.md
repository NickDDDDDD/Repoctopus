# Spec Delta

## MODIFIED Requirements

### Requirement: Release 候选绑定已验证的产品提交

Repoctopus MUST 提供由维护者显式启动的 GitHub Release 流程。候选 MUST 绑定远端 `main` 历史中完整 CI 已成功的精确提交，Release Tag MUST 与该提交的包版本对应。候选的 CLI `--version`、默认产品遥测 `service.version` 与产品观测 Instrumentation Scope 版本 MUST 与包版本一致，并从同一包元数据派生。显式 OTEL 部署资源覆盖 MUST 保留既有优先级，候选验收 MUST 核对无显式覆盖时的默认版本；插件、协议及持久化 schema 的独立版本不得因此被批量改写。

#### Scenario: 从通过 CI 的提交构建候选

- **WHEN** 维护者为 `main` 上已有完整 CI 成功结果的提交请求匹配版本的 Release
- **THEN** 流程从该提交的干净 checkout 构建候选并在发布记录中保留提交、版本和验证结果

#### Scenario: 提交、CI 或 Tag 不满足发布要求

- **WHEN** 请求提交不在远端 `main` 历史、该提交的完整 CI 未成功、版本不匹配，或同名 Tag 已指向其他提交
- **THEN** 流程停止并给出可核对的原因，保留已有 Tag 和 Release

#### Scenario: 新版安装包报告产品版本

- **WHEN** 用户在源码仓之外运行新版本实际安装包的 `--version`，或该版本在未显式覆盖资源版本时向 Collector 输出产品观测
- **THEN** CLI 版本、资源的 `service.version` 和产品 Instrumentation Scope 版本均与安装包版本一致，不继续报告上一个发布版本
- **AND** 插件与协议的独立版本仍保持其自身契约

#### Scenario: 既有部署显式覆盖资源版本

- **WHEN** 部署通过现有 OTEL 资源配置显式设置 `service.version`
- **THEN** 产品 Resource 保留既有覆盖结果，Instrumentation Scope 与 CLI 仍报告实际产品包版本
- **AND** 默认版本一致性验收仍然执行，显式覆盖不替代或豁免候选默认版本检查

#### Scenario: 版本身份发生漂移

- **WHEN** 候选包的公开版本输出、产品观测版本或 Tag 与被验证的包版本不一致
- **THEN** 对应版本验收失败，候选不得被报告为可公开发布，也不覆盖旧版资产
