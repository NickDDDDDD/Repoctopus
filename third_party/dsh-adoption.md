# DSH 能力采用报告

本报告固定 DeepSeek Harness 发布 `dsh-v0.2.1-rc.5`、提交 `b830ec950faba0a46dda564be3e2d854afed94f1`，并已审计 2026-10-30 的 `master` 提交 `ce7073d51254c26cd63b22a60835b8f948deb447`。发布依赖与默认分支审计身份分开记录，避免把未发布源码冒充 npm 版本。机器可检查数据见 `dsh-adoption.json`，跨能力审计见 `upstream-alignment-audit.md`。

## Skill Registry

固定提交中的 `packages/skill/skill/src/index.ts` 已发布为 `@deepseek-ai/dsh-skill@0.2.1-rc.5`。Repoctopus 直接使用该包，保留 `ctx.skills`、Provider 注册、作用域覆盖、rank 裁决、不完整发现、取消、缓存失效和 Cordis Effect 撤销语义。rc.3→rc.5 在已采用 Skill、Filesystem Skill、Cordis 和 Loader 源码面没有行为变化；已登记桌面参考面只变更 `apps/desktop/package.json` 的发布版本元数据。

使用精确版本和 npm overrides 后，闭包包含 13 个安装项：Repoctopus 已固定的 Cordis、Loader、Cosmokit、Schemastery，8 个 DSH 包和 Zod。闭包不含 Agent、Session、Workspace 或 Webhook Runtime。上游已经删除 `dsh-invariants`，Repoctopus 同步移除该包，而不是保留幽灵依赖。没有因为闭包较深而重写 Registry。

`dsh-llm` 在 Skill Registry 中只承载 TypeScript message-source 扩展，但它是已发布包声明的 peer。当前选择保留这个精确依赖，以直接使用上游包并避免复制、删改 Registry 源码。它不启动模型或 Agent Loop。

## Filesystem Provider

上游 `dsh-skill-filesystem` 同时支持 DSH Home、Agents Home、可选 `ctx.fs` 沙箱、工作区探测和 watcher。Repoctopus 需要其中的目录发现、frontmatter、稳定 rank、失效与取消语义，不需要 DSH 文件沙箱、Session 或 DSH Home 约定。

因此文件 Provider 在 `plugins/skill/file-skill-provider.ts` 中做来源登记的最小适配：使用 Node 文件系统和 Repoctopus 明确配置的项目、用户目录；Provider 仍注册到原生 `ctx.skills`，不会建立第二个 Registry。新基线修复了 Chokidar 在 Windows 关闭后仍可能发出迟到错误的问题，Repoctopus 已把同一生命周期约束移植到适配器。

## GitHub Webhook

固定提交中的 webhook prototype 仍作为上游证据保留，但 Repoctopus 明确不采用：当前产品以短生命周期 `change reconcile` 拉取远端事实，不拥有监听端口、验签秘密、Inbox、Lease 或常驻 Runner。

没有采用 DSH Webhook Runtime。新版本会在规则卸载时 abort 并 drain 活动回调，但仍把事件 fire-and-forget 地映射为 Agent Session。Repoctopus 不需要这条常驻事件链：Archive 以 Publication Receipt 完成，后续远端变化由短生命周期 `change reconcile` 按需拉取。

Lifecycle Contributor 继续由 Cordis Service/Effect 组合，不从 DSH 未发布源码提取 Capability Resolver 或产品级 Agent/Session 容器。Work 方法仍通过已发布的 DSH Skill Registry 解析；Definition、Validator 与 Extension 是 Repoctopus 原生契约，并由架构检查禁止导入 `third_party/dsh` 或 DSH 应用源码。

## Desktop 基线

固定提交中的 `apps/desktop` 与 `apps/desktop-host` 采用薄 Electron Shell、Node-mode Host 子进程和私有 IPC。Repoctopus 采用这条进程边界作为桌面故障隔离与生命周期基线，但不会引入 DSH Web Host、账户、Agent/Session/Workspace、完整运行时打包或自动更新系统。

桌面直接依赖全部固定为精确版本并作为开发依赖安装，使普通 CLI 生产安装不携带 Electron。Electron 保持 DSH 的 44 主版本线，并升级到修复 eMudhra 证书公告的 `44.9.3`；React 保持 `18.2.0`。Vite 从上游声明的 `^6.4.3` 选择修复 Windows `launch-editor` 公告的 `6.4.5`；`electron-builder` 使用当前稳定的 `26.15.3`，不采用固定 DSH 清单中的 `26.17.0` 预发布线。生产与完整依赖审计均保持零已知漏洞。

Electron `44.9.3` 没有 lifecycle install script；它在首次解析包且本机二进制缺失时惰性下载固定平台产物。`npm run desktop:prepare` 把这一步显式化，便于干净机器、缓存和离线构建在启动窗口前失败。它不能登记为 `allowScripts`。真正的安装脚本仍按包和版本显式准入：允许 Vite 闭包中的 `esbuild@0.25.12` 校验平台二进制；拒绝未使用的 `electron-winstaller@5.4.0` Squirrel 辅助脚本。Repoctopus 首版只生成 NSIS Windows x64 安装包。

桌面采用面登记 backend controller、Host process、Node-mode 环境、单实例、关闭生命周期、Shell settings 与 Tray 七个修改目标，并固定 `main.ts`、应用 `package.json`、development launcher 及其相邻启动测试。关闭生命周期从 DSH `main.ts` 的原生资源 owner 行为中抽出纯状态机，settings 与 Tray 保留上游边界但使用 Repoctopus 的 `ask | quit | tray` 契约。上游的 `app.whenReady().then(main)`、`main: lib/main.js` 与开发态 `app.getAppPath()` 必须作为一个行为切片审计；Repoctopus 使用不同的 `dist/desktop` 入口，因此用独立产品根解析器和回归测试补偿这个布局差异。

## 漂移控制

- `package.json` 固定所有 DSH 包的精确 `0.2.1-rc.5` 版本，并用 overrides 阻止内部范围漂移。

## 2026-10-30 默认分支增量

`master` 在 rc.5 之后继续快速前进。已登记面中 Desktop 的 `main.ts`、`host-process.ts` 和启动测试已有未发布变化；Filesystem Skill 增加“单个根目录发现失败时保留其余根目录、同时标记观察不完整”的容错语义。Repoctopus 本轮不把这些未发布改动写入发布快照或产品实现：前者等待正式发布，后者作为后续 Skill Provider 可靠性候选，避免在版本刷新 Change 中夹带行为变更。
- `package-lock.json` 固定 npm tarball integrity。
- `check:provenance` 校验固定 commit、包版本、锁文件完整性、禁止包和适配目标。
- `check:upstream` 每天比较默认分支、固定标签与当前审计提交；只报告漂移，不自动改变可复现基线。
- DSH 更新必须修改本报告、机器清单和对应契约测试，不能通过普通 `npm update` 静默进入。
