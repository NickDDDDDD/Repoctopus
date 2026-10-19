# Proposal

## Why

Repoctopus 已有可恢复 Run、Evidence 和多仓 Delivery，但还不能独立完成一次日常开发闭环：Skill 与规格体系没有插件化入口，MR 合入后仍依赖开发者手动刷新、验证、同步规格和关闭 change。现在需要用 Repoctopus 自身交付 Repoctopus，证明插件内核能够承载真实团队工作流，并把开发者最容易遗漏的合入后收尾交给可靠的机器执行。

## What Changes

- 采用固定 DSH 基线的 `ctx.skills` Service Definition 与文件系统 Provider 语义，接入可替换 Skill Provider；首个内置集合使用 Matt Pocock Skills，工作流只依赖稳定 Skill 名称，不依赖具体来源。
- 增加 Skill 快照：Run 在实际使用 Skill 时记录名称、Provider、调用策略和正文摘要，恢复与审计可以判断方法指令是否发生漂移。
- 增加 `Specification` Cordis Service；OpenSpec 作为首个 Provider 提供 change 状态、产物引用、严格校验、主规格同步和归档，Workflow 与 Runtime 不读取 `openspec/` 路径或调用其 CLI。
- 保留 `teach` Skill 的团队共享定义，同时把每个成员的课程、笔记和学习记录放在 `.repoctopus/learning/` 本机目录；默认不提交 Git，也不导出正文到遥测。
- 采用固定 DSH 基线的 Webhook 验签、请求体上限、标准化 Delivery Envelope 和 Effect 生命周期；不采用其进程内 fire-and-forget Session 动作。
- 增加持久 Event Inbox 与 Post-merge Coordinator。代码平台发送 MR 合入事件后，Repoctopus 先持久化、去重并快速响应，再重新读取平台权威状态，待 change 的全部业务 MR 合入后启动可恢复 Post-merge Run。
- Post-merge Run 检出精确 merge commit，执行合入后 Evidence，调用当前 Specification Provider 同步主规格并关闭 change，然后只在允许的工作区路径中创建、提交并推送收尾变更，持续更新原 workspace MR。
- 合入事件只触发协调，不作为权威合入证据；重复、乱序、服务重启和部分失败不得重复归档或产生不同的逻辑收尾动作。
- 本次使用 GitHub Adapter 与可测试 Runner 完成 Repoctopus 自举；代码平台 Adapter 保持可替换，为后续 CodeHub 接入保留同一标准化事件协议。
- 本次只接入完成自举所需的 Matt Skills、OpenSpec Provider、GitHub 合入事件和收尾动作。Skill 管理 UI、远程 Skill 市场、多个同时生效的规格权威、CodeHub Adapter、生产级高可用部署和自动合入 workspace MR 留给后续切片。

## Capabilities

### New Capabilities

- `skill-integration`: 定义 DSH Skill Service、Provider 选择、Run 快照、Matt Skills 接入和个人学习状态隔离。
- `specification-authority`: 定义可替换的规格权威 Service，以及 OpenSpec Provider 的校验、同步和关闭契约。
- `platform-event-processing`: 定义代码平台事件的验签、标准化、持久收件、幂等处理和失败恢复。
- `post-merge-automation`: 定义多仓 MR 全部合入后自动执行验证、规格同步、change 关闭和 workspace 收尾发布的行为。

### Modified Capabilities

- `plugin-composition`: 增加 Skill、Specification、Event Inbox 与 Post-merge Coordinator 作为 Cordis Service、Provider 和 Contributor 的组合要求。
- `delivery-governance`: 增加交付与平台事件的绑定，以及合入后的机器收尾动作边界。
- `runtime-foundation`: 增加由外部事件启动并恢复 Post-merge Run，以及 Run 绑定 Skill 和规格 Provider 身份的要求。
- `development-telemetry`: 增加 Skill 选择、平台投递和合入后收尾的低基数审计事件，同时排除 Skill 正文与个人学习内容。

## Impact

- 新增 Skill、Specification、Platform Event 与 Post-merge 领域、Service、Provider、Contributor、持久 Store、Runner 和命令入口。
- 扩展 `repoctopus.yaml` 的 Skill、规格权威、代码平台事件和收尾路径允许列表配置；本机秘密仍通过 Credential Provider 读取。
- 从固定 DeepSeek Harness commit `d0dca04e22f09fe04967090b2ee70587ecdad6cc` 采用或适配 Skill 与 Webhook 源码时，更新 MIT 许可证、来源清单、逐文件摘要和架构能力账本；不会引入 DSH Agent Loop、Session 或 Workspace 子系统。
- Matt Pocock Skills 使用其 MIT 许可固定版本接入，Skill 正文保持来源可追溯；具体 Skill 可以通过 Provider 优先级替换。
- GitHub webhook secret、平台 Token 和机器 Git 身份由 Runner 环境提供，不写入项目配置、状态、日志或遥测。
- 增加持久状态 Schema 和打包内容；本变更不承诺兼容未发布的旧 Repoctopus 状态格式。
