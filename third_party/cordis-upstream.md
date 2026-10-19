# Cordis 上游快照

Repoctopus 内嵌以下未修改的官方 npm 发布源码：

- `@deepseek-ai/cordis` 4.0.4，对应 DeepSeek Harness `vendor/cordis`。
- `@deepseek-ai/cordis-plugin-loader` 1.0.5，对应 DeepSeek Harness `vendor/loader`。
- 固定上游提交：`d0dca04e22f09fe04967090b2ee70587ecdad6cc`。
- 上游仓库：`https://github.com/deepseek-ai/deepseek-harness`。
- 许可证：MIT；两个包各自目录中保留原始 `LICENSE`。

`cordis-upstream.json` 记录官方 npm 完整性值和每个已纳入文件的 SHA-256。产品扩展位于 `app`、`domains`、`platform` 或 `plugins`，不得直接修改这里的上游快照。同步上游版本需要独立 OpenSpec Change、差异审查和完整验证。
