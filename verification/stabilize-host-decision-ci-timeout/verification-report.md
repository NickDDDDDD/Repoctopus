# 宿主审批测试超时修复验证

Tested implementation commit: `c049517c99cf334d47ae774729938b75a987bbe7`

Package content SHA-256: `68b4af2602a05868721211c5ea69c0b83b705b7ff68d74203159bbad7eb52ff3`

Package files: `489`

Package content bytes: `6625016`

main CI 运行 44876140948 的两次尝试均在同一条宿主审批端到端测试耗尽 180 秒。此次仅将这一场景的预算设为 300 秒，覆盖顺序执行的真实 CLI 调用。保留各项断言和套件门禁。

在 Windows 上通过 `npm exec -- vitest run test/e2e/host-human-decision-cli.e2e.test.ts --maxWorkers 1` 执行真实 CLI 场景，1 项通过，用例耗时 119.67 秒。Prettier 与 Git diff 检查通过。现有发布证据校验已通过并接受本报告绑定的实现提交与包内容摘要。

用当前工作区的构建执行 `npm pack --ignore-scripts`。重打包的文件 SHA-256 为 `96694dfc4e4be478e5992d08841a84f20c5b1ba57f55d11bab63a1d2020bce22`，与[之前验收的候选包](../prepare-v0-1-4/verification-report.md)逐字节一致。发布草稿须使用最终通过 main CI 的提交产生的工件。
