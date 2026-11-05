# Brainstorm Summary

## 状态

原 Design proposal hash `e0a699f473ed6da443c3155cab970dc77dec126425175a9b7835d3b2be55f17a` 已获批准。首次 Verify 发现实现证据与 Tasks 表述不完全一致，Runtime 已正式返回 Design；下述修订候选已作为 proposal hash `abdeb49d1d6e32fb00fe46c570b06f4da9122f84023b21b3f7c039c3a4da988f` 提交，等待新的 Human Decision。本文只用于 Comet 中断恢复，不是第五份规格或正式 Design Doc。

## 已确认事实

- `bin/repoctopus.js` 直接加载忽略的 `dist/repoctopus.mjs`；源码入口不会自行判断该文件属于哪个 Git 提交。
- `scripts/build.mjs --check` 会从当前源码重新构建临时 bundle，并按字节比较检测缺失或陈旧的 CLI artifact。
- Round 5/6 从独立产品 checkout 构建 tarball，再安装到独立 CLI 消费目录；Round 7 改为直接使用长期 main checkout，main 已更新到 11 月 5 日而 `dist` 仍来自 11 月 2 日。
- `npm run verify` 是仓库现有的完整检查权威，包含构建、完整 Vitest、package E2E、生成物、架构、来源和 OpenSpec 校验。
- `test/e2e/package.e2e.test.ts` 已从当前仓库执行 `npm pack`，安装到临时消费者环境，并通过安装后的公共 `bin` 验证协议和运行资源。
- 用户已批准：多仓验收默认恢复 package-first；直接源码仅作为显式例外，并在每次源码更新后执行 build 与 freshness preflight。

## 已批准的方案比较

### A. 提交 `dist`

优点是源码 checkout 立即可运行。缺点是源码与生成物成为两份评审权威，产生大体积 bundle diff、合并噪声和“源码已改但产物未同步”的另一类漂移。与 Repoctopus、Comet 0.5.1 当前都忽略 `dist` 的模式冲突，不采用。

### B. Launcher 自动构建或隐式修复

优点是调用者难以忘记构建。缺点是公共 CLI 启动会修改工作树、依赖开发工具链并增加不透明延迟；安装包消费者也可能被错误带入源码开发逻辑。把 launcher 改成 fail-closed freshness guard 虽比自动构建安全，但需要在每次启动重新 bundle 或新增提交身份协议，超出本次仓库门禁切片，不采用。

### C. Package-first + 显式源码 preflight + 干净 CI（推荐）

多仓验收默认从目标提交构建 tarball，安装到隔离消费者目录并使用包内 CLI。只有需要观察未打包源码时才运行 `npm run build`、`node scripts/build.mjs --check` 和源码 CLI。GitHub PR、`main` push 与人工触发都在干净 checkout 中执行 `npm ci` 和唯一权威 `npm run verify`。

该方案复用现有构建、package E2E 和验证命令，不引入生产代码或依赖；它与 Comet 的“忽略 dist、显式构建、CI 校验”边界一致，并针对 Repoctopus 的多仓验收补上 package-first 默认路径。

## 已批准的技术设计

1. 新增 `.github/workflows/ci.yml`：workflow 名固定为 `Continuous integration`，job id 固定为 `verify`；触发 `pull_request`、`main` push、`workflow_dispatch`；只授予 `contents: read`；使用并发取消、Ubuntu、Node 24、npm cache；仅执行 `npm ci` 和 `npm run verify`。
2. 新增 `test/repository-ci.test.ts`：使用现有 `yaml` 包结构化解析 workflow；以小型契约校验函数检查触发器、权限、环境和命令，并用变异后的内存对象证明写权限、错误默认分支和复制检查清单会被拒绝，而不是只比较当前 YAML 文本快照。
3. 扩展 `test/self-hosting-docs.test.ts`：保护 package-first 默认路径、直接源码例外的 `build -> freshness check -> CLI` 顺序、旧 `dist` 非证据，以及 CI 状态与 GitHub required check 的不同权威边界。
4. 更新 `docs/self-hosting.md`：把 Round 5/6 的隔离安装方式定义为多仓验收默认值；源码路径明确为诊断例外，不让长期 checkout 的本地 `dist` 泄漏到验收结论。
5. 保留现有 package E2E 作为安装包独立消费证据；只有核对发现缺少必要资源或公共协议场景时才补测试，不另建第二套 package harness。
6. 不修改 Runtime、Cordis、CLI launcher、OTLP、OpenSpec Provider 或多仓状态协议。

## 风险与失败处理

- CI YAML 只能产生检查状态，不能证明 GitHub branch protection 已把它设为 required；文档必须保留管理员配置边界。
- package-first 增加一次打包和隔离安装成本，但避免长期 checkout 的不可见派生产物污染验收。
- 直接源码路径仍依赖调用者选择正确入口；结构化文档测试保护正式流程，验收执行者必须记录为何使用例外。若未来仍频繁绕过，再以独立 change 评估 fail-closed launcher，不在本次预先增加复杂度。
- `npm run verify` 较重，但当前优先单一完整门禁；只有取得 CI 时长和失败分布后才考虑拆分快速/完整 job。

## 测试策略

- RED：CI 文件缺失时 `test/repository-ci.test.ts` 失败；文档未声明 package-first/freshness 顺序时 `test/self-hosting-docs.test.ts` 失败。
- GREEN：最小 workflow 与文档修改使聚焦测试通过；负例证明契约校验不是快照测试。
- 安装边界：`npm run test:package-e2e`。
- 源码边界：`npm run build` 后执行 `node scripts/build.mjs --check`。
- 集成：`npm run verify`、严格 OpenSpec、`git diff --check`，再观察 GitHub 托管 workflow 的真实结果。

## Spec Patch

用户批准的 package-first 与源码 freshness 场景已经写入当前 `product-distribution` delta spec；本 Design 候选不再提出新的行为范围或额外 Spec Patch。

## Verify 修订候选

- standalone `npm run test:package-e2e` 通过 npm lifecycle 先执行标准 `npm run build`，再由现有测试打包和隔离安装；仓库测试结构化绑定这两个脚本，防止未来再次打包历史 `dist`。
- CI 契约除顶层 `contents: read` 外，拒绝 `verify` job 自行声明权限覆盖；内存负例证明 job 级写权限不能绕过测试。
- 自举文档保留唯一一致的源码例外：每次更新后执行 build、freshness preflight、源码 CLI；删除后文“只要求 build”的冲突表述，并增加负例保护。
- Tasks 3.1 与已批准 Build Plan 的既有基线例外对齐：全量 `npm run format:check` 继续暴露并记录历史差异，本 change 精确格式检查、全量 lint 和全量 typecheck 必须退出 0；不机械改写归档规格或 Comet 机器状态。
- 修订不改变 `product-distribution` delta spec，不引入 launcher 自动构建、跟踪 `dist`、依赖升级、Runtime/Cordis/OTLP 或协议改动。

取舍：为 package E2E 增加一次显式 build 会增加 standalone 命令耗时，但使该公共验证入口自身闭合；job 级权限禁止覆盖牺牲少量局部配置灵活性，换取单一最小权限权威；格式基线仍作为明确的非绿色历史事实保留，不用大范围机械 diff 掩盖本 change。

## 待确认项

是否批准上述同范围 Verify 修订候选。批准后更新同一 `design.md`，重新提交 Build Plan 并执行四项已重新打开的任务；拒绝则停止，不沿用旧 Design approval。
