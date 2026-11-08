## ADDED Requirements

### Requirement: 安装后诊断独立于开发资源

安装后的 `doctor` MUST 使用产品随包分发的来源清单、受保护资源和已安装的生产依赖完成来源诊断，不要求开发 lockfile、开发依赖或源码准备脚本。诊断 MUST 保留现有只读状态检查及 CLI 输出契约；实际资源缺失、损坏或生产依赖身份不符时不得报告健康。

#### Scenario: 仅安装生产依赖的健康 CLI

- **WHEN** 当前候选 tarball 在独立消费者目录中仅安装生产依赖，且工具包内没有开发 lockfile 和准备脚本
- **THEN** 对有效 Run 执行 `doctor --json` 成功并返回健康结果，不改变 Run、Checkpoint 或 Trajectory

#### Scenario: 已分发资源被损坏

- **WHEN** 安装包的必需来源资源缺失、被修改或无法解析
- **THEN** `doctor` 返回非零退出码与明确的结构化错误，不回退到源码 checkout，不跳过失败，也不修改 Run 的持久事实

#### Scenario: 生产依赖与登记版本不一致

- **WHEN** 安装后的生产依赖身份与产品来源清单不符
- **THEN** 来源诊断失败并指出相关依赖，不以开发锁文件中的历史版本代替安装事实

### Requirement: 开发审计与发布包诊断分别验证

Repoctopus MUST 保留 CI 对源码 lockfile、依赖 integrity、禁止依赖和开发准备资源的审计，并在实际 tarball 隔离安装后执行公共 `doctor` 的健康与损坏反例。源码测试通过不能代替安装后诊断验收。

#### Scenario: 开发锁与固定来源不一致

- **WHEN** 源码 lockfile 中的固定依赖版本或 integrity 漂移，或开发准备资源缺失
- **THEN** 完整来源审计失败，即使安装后诊断不依赖这些开发文件

#### Scenario: 发布候选的诊断命令回归

- **WHEN** 实际安装包不能对健康 Run 完成诊断，或损坏必需资源后仍报告健康
- **THEN** 包 E2E 失败并阻止候选被认定为通过完整验证
