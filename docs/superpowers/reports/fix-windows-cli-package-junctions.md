# Windows CLI 发布包修复验证

[候选包验收报告](../../../verification/fix-windows-cli-package-junctions/verification-report.md)记录包身份、旧包失败回归、CodeBuddy CN IDE 原生回执、npx、安装测试及独立审查。正式全量验证由 Comet Guard 执行并记录收据。

首轮完整验证有一项并发 Run 启动用例收到 Windows `EPERM`，发生在打开 `transition.lock` 时。其余 1230 项通过、4 项跳过。对同一实现单独重跑该用例通过。首轮失败收据为 `449ffb45-9aa4-4e2a-bd78-bc0ce7b90041.log`。
