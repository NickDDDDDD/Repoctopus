# Proposal

## Why

通过 Release 安装 CLI 并完成项目接入后，Workspace 只有配置和规格根，没有面向团队成员的使用入口，也没有新 Agent 可直接读取的工作流指令。用户需要返回 Repoctopus 产品仓查教程，Agent 则可能绕过已建立的 Runtime 工作流。

## What Changes

- 在获批项目接入中生成 Workspace 级 `README.md` 使用入口、`AGENTS.md` 执行入口和本地教程 `docs/repoctopus/workspace-guide.md`，以多仓场景为主，同时覆盖业务仓兼任 Workspace 的单仓场景。
- 引导团队成员从已安装 CLI 启动、查看和恢复 Change，了解共享配置、本机覆盖、Store 登记、SigNoz OTLP 地址及共享文件提交范围；基本用法不依赖回产品仓阅读文档。
- Agent 入口使用现有公共 CLI 和 Runtime 返回的 continuation、Work 及真实 Skill 内容，不新增文件驱动的阶段推进规则或第二套任务权威。
- 借鉴固定 Comet 的受管 Markdown 区块方式，保护已有项目说明与 Agent 规则；只维护明确标记的 Repoctopus 内容，重复执行与中断恢复不能产生重复区块或虚假接入完成状态。
- 从实际候选 tarball 安装后验证引导产物、相对链接和公共命令，覆盖多仓、单仓、已有文件及拒绝审批场景。

本次不增加 IDE 专用安装器、后台守护进程、自动选择活动 Run、独立文档管理命令或遥测字段改名；不更换 OpenSpec Store 布局，不改五阶段状态机，不在接入时 commit、push、创建 MR 或发布新 Release。已接入团队可通过现有 detect → prepare → review 流程，以原共享配置为候选获批补齐引导。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-configuration`: 扩展获批接入的共享产物、现有内容保护、可恢复写入和本地人机使用入口契约。
- `product-distribution`: 实际发布候选必须能在独立消费者环境完成初始化并生成可用引导，不依赖源码 checkout 或开发文件。

## Impact

- 主要边界：`ProjectOnboarding` 既有 Cordis Service 与项目接入平台适配器；新增文档模板、受管内容规划及受限文件写入，不建立平行 Runtime。
- 文档：产品首次接入说明与生成后的 Workspace 文档；不把产品开发用 Comet 配置、开发者 AGENTS 或内部绝对路径复制到团队项目。
- 测试：项目接入回归、公共 CLI 接入验收和真实 tarball 生产安装验收。
- 参考固定 Comet `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 `domains/skill/project-instructions.ts` 与 `managed-markdown.ts` 的所有权、幂等及区块校验思路；保留 Repoctopus 现有 Cordis / Service / filesystem 边界。若实施中实际采用上游代码，须同步现有来源清单及许可证审计；本提案不引入 Comet SDK 或新依赖。
