## ADDED Requirements

### Requirement: 发布包安装 Cordis 到普通目录

Repoctopus 发布包 MUST 用固定的官方 npm 版本安装 Cordis Core 和 Loader。两个包的版本与完整性 MUST 与仓库的上游来源清单一致。

#### Scenario: 在 Windows 安装候选包并从受限宿主启动

- **WHEN** Windows 用户直接使用 npm 安装发布候选 `.tgz` 并在 CodeBuddy IDE 中调用 CLI
- **THEN** npm 把两个 Cordis 依赖安装为普通目录，CLI 能返回有效的公共 JSON 响应

#### Scenario: npx 在独立消费者目录运行候选包

- **WHEN** 发布检查用 npx 执行候选包的项目探测
- **THEN** 检查以包含实验 Git 仓的父目录作为扫描根，核对 CLI 成功响应
