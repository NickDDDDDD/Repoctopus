# Spec Delta

## ADDED Requirements

### Requirement: Release 候选绑定已验证的产品提交

Repoctopus MUST 提供由维护者显式启动的 GitHub Release 流程。候选必须绑定远端 `main` 历史中完整 CI 已成功的精确提交，Release Tag 必须与该提交的包版本对应。

#### Scenario: 从通过 CI 的提交构建候选

- **WHEN** 维护者为 `main` 上已有完整 CI 成功结果的提交请求匹配版本的 Release
- **THEN** 流程从该提交的干净 checkout 构建候选并在发布记录中保留提交、版本和验证结果

#### Scenario: 提交、CI 或 Tag 不满足发布要求

- **WHEN** 请求提交不在远端 `main` 历史、该提交的完整 CI 未成功、版本不匹配，或同名 Tag 已指向其他提交
- **THEN** 流程停止并给出可核对的原因，保留已有 Tag 和 Release

### Requirement: Release 资产先验收再公开

Repoctopus MUST 用最终上传的同一份 CLI tarball 和 Windows x64 Desktop 安装器完成验收。Release MUST 提供这两份资产和对应的 `SHA256SUMS`，在草稿中核对完整性后才能公开。

#### Scenario: 验证并上传同一组产物

- **WHEN** 候选包通过独立 CLI 消费验收和 Windows 安装到卸载验收
- **THEN** 草稿附上已验证的 CLI 包、可选桌面安装器与校验文件，下载资产的文件名和 SHA-256 与候选记录一致

#### Scenario: 构建、验收或上传中断

- **WHEN** 任何必需检查失败、发布资产缺失或实际摘要不同
- **THEN** Release 保持未公开，诊断说明失败步骤和实际状态

#### Scenario: 发布操作被重试

- **WHEN** 同版本已有草稿或已公开 Release
- **THEN** 流程核对 Tag、提交和资产身份，匹配时复用已有结果，冲突时停止并保留现有资产

### Requirement: 团队用固定版本的 Release URL 运行 CLI

Repoctopus MUST 在用户文档给出固定版本的 GitHub Releases CLI 下载入口和 `npx` 调用。用户能够在源码仓以外从公开资产执行 CLI。Windows 桌面安装器仅用于本地 Dashboard。

#### Scenario: 从已公开的版本运行 CLI

- **WHEN** 用户在具备受支持 Node.js 和 Git 的环境中通过 `npx` 引用固定 Tag 的公开 `.tgz` 下载 URL
- **THEN** npm 从该资产解析并运行 `repoctopus`，可验证帮助输出和公共 CLI JSON 协议

#### Scenario: 首个版本仍在准备

- **WHEN** 对应版本的公开 Release 资产尚不可用
- **THEN** 文档说明发布状态并保留通过已取得 tarball 安装或运行的方式

#### Scenario: 仅需要 CLI 工作流

- **WHEN** Windows 用户没有安装 Desktop
- **THEN** 使用发布包运行 CLI 和 Change 工作流仍可用
