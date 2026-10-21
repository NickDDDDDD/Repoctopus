# Cordis 上游快照

Repoctopus 内嵌以下未修改的官方 npm 发布源码：

- `@deepseek-ai/cordis` 4.0.5，对应 DeepSeek Harness `vendor/cordis`。
- `@deepseek-ai/cordis-plugin-loader` 1.0.6，对应 DeepSeek Harness `vendor/loader`。
- 固定上游标签：`dsh-v0.2.1-rc.2`；提交：`687f282e8625c6b8d11ff58211a90524be2e4317`。
- 上游仓库：`https://github.com/deepseek-ai/deepseek-harness`。
- 许可证：MIT；两个包各自目录中保留原始 `LICENSE`。

`cordis-upstream.json` 记录官方 npm 完整性值和每个已纳入文件的 SHA-256。Loader 1.0.6 会保留成功导入的原始 module namespace，供 HMR 在 manifest 变化后更新同一 Entry 身份；Repoctopus 未在快照内修改该实现。产品扩展位于 `app`、`domains`、`platform` 或 `plugins`，不得直接修改这里的上游快照。同步上游版本需要 OpenSpec 记录、差异审查和完整验证。
