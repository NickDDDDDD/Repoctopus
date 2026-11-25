# 并行 Run 桌面工作台候选包验证

Tested implementation commit: `7b6c27420e6920e7d2b6a9e83968cef9a7abdb62`

Package content SHA-256: `b4872a772159d8720c507c336b0a2806621989a3183e287af13a6a6a4d55fdc8`

Package files: `493`

Package content bytes: `6749309`

在上述提交上运行 `npm run build` 并使用 `npm pack --ignore-scripts` 构建候选。摘要由项目的 `package-content-digest.mjs` 对实际归档计算。测试范围及 Comet 生命周期证据见[桌面工作台验证](../../docs/superpowers/reports/show-parallel-runs-in-desktop.md)。

在 Windows 上使用实际候选 `repoctopus-0.1.4.tgz` 执行 `npm run test:windows-multirepo-package-e2e`。同一 Run `change-workspace-verify-package-workflow-1084f1a8861b28e9` 完成 Init 至 Archive、首包后的冷恢复、PR 响应丢失后的去重，以及终态恢复，耗时 264.75 秒。
