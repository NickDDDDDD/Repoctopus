# DSH 能力采用报告

本报告固定 DeepSeek Harness 发布 `dsh-v0.2.1-rc.3`、提交 `1f81c047fc48fa190a683e469daa699857e9afe8`，并已审计 2026-10-24 的 `master` 提交 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。发布依赖与默认分支审计身份分开记录，避免把未发布源码冒充 npm 版本。机器可检查数据见 `dsh-adoption.json`，跨能力审计见 `upstream-alignment-audit.md`。

## Skill Registry

固定提交中的 `packages/skill/skill/src/index.ts` 已发布为 `@deepseek-ai/dsh-skill@0.2.1-rc.3`。Repoctopus 直接使用该包，保留 `ctx.skills`、Provider 注册、作用域覆盖、rank 裁决、不完整发现、取消、缓存失效和 Cordis Effect 撤销语义。rc.2→rc.3 在已采用 Skill、Filesystem Skill、Webhook Handler、Cordis 和 Loader 源码面没有行为变化，发布差异只有包版本元数据。

使用精确版本和 npm overrides 后，闭包包含 13 个安装项：Repoctopus 已固定的 Cordis、Loader、Cosmokit、Schemastery，8 个 DSH 包和 Zod。闭包不含 Agent、Session、Workspace 或 Webhook Runtime。上游已经删除 `dsh-invariants`，Repoctopus 同步移除该包，而不是保留幽灵依赖。没有因为闭包较深而重写 Registry。

`dsh-llm` 在 Skill Registry 中只承载 TypeScript message-source 扩展，但它是已发布包声明的 peer。当前选择保留这个精确依赖，以直接使用上游包并避免复制、删改 Registry 源码。它不启动模型或 Agent Loop。

## Filesystem Provider

上游 `dsh-skill-filesystem` 同时支持 DSH Home、Agents Home、可选 `ctx.fs` 沙箱、工作区探测和 watcher。Repoctopus 需要其中的目录发现、frontmatter、稳定 rank、失效与取消语义，不需要 DSH 文件沙箱、Session 或 DSH Home 约定。

因此文件 Provider 在 `plugins/skill/file-skill-provider.ts` 中做来源登记的最小适配：使用 Node 文件系统和 Repoctopus 明确配置的项目、用户目录；Provider 仍注册到原生 `ctx.skills`，不会建立第二个 Registry。新基线修复了 Chokidar 在 Windows 关闭后仍可能发出迟到错误的问题，Repoctopus 已把同一生命周期约束移植到适配器。

## GitHub Webhook

固定提交中的 `packages/experimental/webhook-github/src/handler.ts` 提供 POST、严格 JSON Content-Type、请求体上限、唯一 Header、Credential 查找、HMAC 后解析和无损 JSON 快照语义。它与旧固定提交中的 Handler blob 相同，只是上游把 prototype 移到 `experimental`。Repoctopus 已在 `platform/events/github-webhook.ts` 中采用这些边界，并把输出规范化为 Provider、Source、Delivery ID、事件类型和无损载荷组成的 Delivery Envelope。Adapter 通过用途隔离的 Credential Provider 按请求读取秘密；HTTP Host 负责提供与 Node `headersDistinct` 等价的小写、多值不合并 Header 视图。Adapter 本身不持久化秘密或 Header。

Repoctopus 的 Event Inbox 使用稳定的 Provider、Source 与 Delivery ID 摘要去重，并以持久状态表达领取租约、租约过期恢复、重试等待、完成 Receipt 和死信。该状态机不依赖 DSH Session。

没有采用 DSH Webhook Runtime。新版本会在规则卸载时 abort 并 drain 活动回调，但它仍把事件 fire-and-forget 地映射为 Agent Session，不含 Repoctopus 要求的持久收件、去重、租约、重试、Receipt 与跨进程恢复。即使连同 Agent、Session 和 Workspace 全部引入，也不能替代这些产品能力。

Lifecycle Contributor 继续由 Cordis Service/Effect 组合，不从 DSH 未发布源码提取 Capability Resolver 或产品级 Agent/Session 容器。Work 方法仍通过已发布的 DSH Skill Registry 解析；Definition、Validator 与 Extension 是 Repoctopus 原生契约，并由架构检查禁止导入 `third_party/dsh` 或 DSH 应用源码。

## Desktop 基线

固定提交中的 `apps/desktop` 与 `apps/desktop-host` 采用薄 Electron Shell、Node-mode Host 子进程和私有 IPC。Repoctopus 采用这条进程边界作为桌面故障隔离与生命周期基线，但不会引入 DSH Web Host、账户、Agent/Session/Workspace、完整运行时打包或自动更新系统。

桌面直接依赖全部固定为精确版本并作为开发依赖安装，使普通 CLI 生产安装不携带 Electron。Electron `44.7.0`、React `18.2.0` 与 DSH 固定基线一致。Vite 从上游声明的 `^6.4.3` 选择修复 Windows `launch-editor` 公告的 `6.4.5`；`electron-builder` 使用当前稳定的 `26.15.3`，不采用固定 DSH 清单中的 `26.17.0` 预发布线。生产依赖审计保持零已知漏洞；构建链的剩余开发期公告必须在发布验证报告中重新审计。

Electron `44.7.0` 没有 lifecycle install script；它在首次解析包且本机二进制缺失时惰性下载固定平台产物。`npm run desktop:prepare` 把这一步显式化，便于干净机器、缓存和离线构建在启动窗口前失败。它不能登记为 `allowScripts`。真正的安装脚本仍按包和版本显式准入：允许 Vite 闭包中的 `esbuild@0.25.12` 校验平台二进制；拒绝未使用的 `electron-winstaller@5.4.0` Squirrel 辅助脚本。Repoctopus 首版只生成 NSIS Windows x64 安装包。

桌面采用面不仅登记被修改的四个生命周期文件，还固定 `main.ts`、应用 `package.json`、development launcher 及其相邻启动测试。上游的 `app.whenReady().then(main)`、`main: lib/main.js` 与开发态 `app.getAppPath()` 必须作为一个行为切片审计；Repoctopus 使用不同的 `dist/desktop` 入口，因此用独立产品根解析器和回归测试补偿这个布局差异。

## 漂移控制

- `package.json` 固定所有 DSH 包的精确 `0.2.1-rc.3` 版本，并用 overrides 阻止内部范围漂移。

## 2026-10-24 默认分支增量

`master` 在 rc.3 之后继续前进。Skill Registry、Filesystem Skill 和 GitHub Webhook Handler 的行为源码没有变化；Desktop 增加 Windows Runner 网络进程监督、打包缓存、安装器本地化与文件拖放等能力。Cordis `fiber.ts` 和 Loader resolver 也有未发布变化。Repoctopus 本轮不把这些未发布改动写入标记为官方 npm 快照的 `third_party/cordis*`，待对应发布版本出现后再升级；桌面变化作为后续打包与恢复审计输入，不混入 Change 生命周期设计。
- `package-lock.json` 固定 npm tarball integrity。
- `check:provenance` 校验固定 commit、包版本、锁文件完整性、禁止包和适配目标。
- `check:upstream` 每天比较默认分支、固定标签与当前审计提交；只报告漂移，不自动改变可复现基线。
- DSH 更新必须修改本报告、机器清单和对应契约测试，不能通过普通 `npm update` 静默进入。
