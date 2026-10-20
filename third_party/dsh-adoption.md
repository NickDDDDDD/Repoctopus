# DSH 能力采用报告

本报告固定 DeepSeek Harness 提交 `d0dca04e22f09fe04967090b2ee70587ecdad6cc`，把上游事实、依赖闭包和 Repoctopus 产品决定分开记录。机器可检查数据见 `dsh-adoption.json`。

## Skill Registry

固定提交中的 `packages/skill/skill/src/index.ts` 已发布为 `@deepseek-ai/dsh-skill@0.1.7-alpha.1`。Repoctopus 直接使用该包，保留 `ctx.skills`、Provider 注册、作用域覆盖、rank 裁决、不完整发现、取消、缓存失效和 Cordis Effect 撤销语义。

使用精确版本和 npm overrides 后，闭包包含 14 个安装项：Repoctopus 已固定的 Cordis、Cosmokit、Schemastery，9 个 DSH 包和 Zod。闭包不含 Agent、Session、Workspace 或 Webhook Runtime。没有因为闭包较深而重写 Registry。

`dsh-llm` 在 Skill Registry 中只承载 TypeScript message-source 扩展，但它是已发布包声明的 peer。当前选择保留这个精确依赖，以直接使用上游包并避免复制、删改 Registry 源码。它不启动模型或 Agent Loop。

## Filesystem Provider

上游 `dsh-skill-filesystem` 同时支持 DSH Home、Agents Home、可选 `ctx.fs` 沙箱、工作区探测和 watcher。Repoctopus 需要其中的目录发现、frontmatter、稳定 rank、失效与取消语义，不需要 DSH 文件沙箱、Session 或 DSH Home 约定。

因此文件 Provider 在 `plugins/skill/filesystem-skill-provider.ts` 中做来源登记的最小适配：使用 Node 文件系统和 Repoctopus 明确配置的项目、用户目录；Provider 仍注册到原生 `ctx.skills`，不会建立第二个 Registry。

## GitHub Webhook

固定提交中的 GitHub Handler 提供 POST、严格 JSON Content-Type、请求体上限、唯一 Header、Credential 查找、HMAC 后解析和无损 JSON 快照语义。Repoctopus 已在 `platform/events/github-webhook.ts` 中采用这些边界，并把输出规范化为 Provider、Source、Delivery ID、事件类型和无损载荷组成的 Delivery Envelope。HTTP Host 与 Credential Provider 在后续组合层接入；Adapter 本身不持久化秘密或 Header。

Repoctopus 的 Event Inbox 使用稳定的 Provider、Source 与 Delivery ID 摘要去重，并以持久状态表达领取租约、租约过期恢复、重试等待、完成 Receipt 和死信。该状态机不依赖 DSH Session。

没有采用 DSH Webhook Runtime。该 Runtime 把事件 fire-and-forget 地映射为 Agent Session，不含 Repoctopus 要求的持久收件、去重、租约、重试、Receipt 与跨进程恢复。即使连同 Agent、Session 和 Workspace 全部引入，也不能替代这些产品能力。

## 漂移控制

- `package.json` 固定所有 DSH 包的精确版本，并用 overrides 阻止内部 `^0.1.7-alpha.1` 范围漂移到 RC。
- `package-lock.json` 固定 npm tarball integrity。
- `check:provenance` 校验固定 commit、包版本、锁文件完整性、禁止包和适配目标。
- DSH 更新必须修改本报告、机器清单和对应契约测试，不能通过普通 `npm update` 静默进入。
