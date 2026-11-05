---
comet_change: stabilize-cli-distribution-gate
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-05-stabilize-cli-distribution-gate
status: final
---

# Design

## Context

Repoctopus 的源码入口 `bin/repoctopus.js` 加载本地 `dist/repoctopus.mjs`，而 `dist/` 是有意忽略、可由源码重建的产物。当前仓库已经通过 `npm run verify` 集中声明类型检查、Lint、CLI/Desktop 构建、完整 Vitest、生成物、架构、来源和 OpenSpec 校验，但 GitHub 只配置了定时上游漂移检查，没有在 pull request 与 `main` push 上运行这份完整契约。

因此，源码更新后残留的旧 `dist` 可能仍可启动，却执行上一提交的 Runtime。本轮多仓验收正是跳过 `npm run build` 后观察到旧 continuation；这不是 PR #65 应提交 `dist` 的证据，而是源码 checkout、构建产物和安装包三种身份没有被仓库门禁清晰隔离。

Comet 0.5.1 采用相同的基本边界：忽略 `dist`，源码消费前显式构建，并在 PR/主分支 CI 中检查生成物、构建和测试。Repoctopus 复用这一成熟原则，但继续使用自身单一 `npm run verify`、npm lockfile、Desktop 构建和 OpenSpec 校验，不复制 Comet 的脚本或源码。

## Goals / Non-Goals

**Goals:**

- 让每个 pull request、`main` push 和人工触发都在干净 checkout 中执行同一份完整仓库验证。
- 让本地和 CI 共同以 `npm run verify` 为唯一完整验证命令权威，避免 workflow 复制检查清单后漂移。
- 明确源码 checkout 的 `dist` 是临时派生产物；切换或更新源码后必须从当前 checkout 重新构建并通过 freshness preflight，不能把目录存在当成新源码已验证。
- 把隔离安装的 package-first 路径恢复为多仓验收默认值，同时保留直接源码诊断的显式例外。
- 保留并证明安装包 E2E 与源码构建是两个不同消费边界。
- 用仓库测试保护 CI 触发器、只读权限、Node 版本、锁定安装和标准验证命令，避免门禁被静默削弱。

**Non-Goals:**

- 不提交或版本化 `dist/`，不在 CLI launcher 中隐式构建，也不通过时间戳猜测产物新旧。
- 不改变 CLI 参数、Runtime 状态机、Cordis composition、Desktop 激活、遥测或多仓协议。
- 不在仓库代码中配置 GitHub branch protection；required check 是否真正阻止合入仍是托管平台管理员边界。
- 不建立发布流水线、不增加其他托管平台配置，也不升级 Node、npm 或第三方依赖。

## Decisions

### 1. 将源码、生成物和安装包视为三个独立身份边界

源码 checkout 的权威输入是 Git 跟踪源码和 `package-lock.json`；`dist/` 只是由该输入生成的本地产物。直接源码自举或验收在每次切换、拉取或合入源码后先执行 `npm ci`（依赖尚未安装时）、`npm run build` 和 `node scripts/build.mjs --check`，再调用 `node bin/repoctopus.js`。即使 `dist/` 已存在，也不能跳过当前 checkout 的构建和 freshness preflight。

安装包则由当前源码生成 tarball，并在隔离消费者目录中通过包内 `bin` 验证。多仓生命周期验收默认采用这条 package-first 路径，避免长期产品 checkout 中的忽略产物泄漏到验收结果；只有诊断未打包源码改动时才使用上述直接源码例外。standalone `npm run test:package-e2e` 通过 npm 的 `pretest:package-e2e` 生命周期先执行标准 `npm run build`，使这个公共验证入口自身保证 tarball 使用当前源码生成的 `dist`。`npm run verify` 中的完整 Vitest 已包含 `test/e2e/package.e2e.test.ts`，所以 CI 不再重复调用第二份 package 命令；该测试仍保持独立的消费环境和断言。

没有采用“提交 `dist`”，因为这会建立源码和生成物两份评审权威并制造合并噪声；也没有采用 launcher 自动重编译，因为公共 CLI 启动不应隐式修改工作树、延长启动或在生产安装包中要求开发工具链。

### 2. 新增一份最小 GitHub CI，直接调用标准验证命令

新增 `.github/workflows/ci.yml`，稳定 workflow 名称为 `Continuous integration`，稳定 job id 为 `verify`。它响应 `pull_request`、`main` push 和 `workflow_dispatch`，使用 `contents: read`、并发取消、`ubuntu-latest`、Node 24 与 npm cache，在干净 checkout 中执行：

1. `npm ci`
2. `npm run verify`

Node 24 同时满足 `package.json` 的 Engine 声明和现有上游检查做法。`npm ci` 以 lockfile 为依赖权威；不使用 `--ignore-scripts`，因为当前依赖安装和构建契约应按真实消费者环境运行，脚本准入由已提交的 `allowScripts` 与锁文件评审承担。

没有把 `typecheck`、`lint`、`build`、`test` 等逐条复制到 workflow。未来维护者只修改 `npm run verify` 即可同时更新本地和 CI；workflow 只负责建立干净运行环境。

### 3. 用结构化仓库测试保护 CI 契约

新增仓库级 Vitest，使用现有 `yaml` 依赖读取 `.github/workflows/ci.yml`，断言：

- 存在 PR、`main` push 和人工触发；
- 顶层权限保持 `contents: read`，且 `verify` job 不得通过 job 级 `permissions` 覆盖这份单一权限权威；
- `verify` job 使用 Ubuntu、Node 24、npm cache 和 `npm ci`；
- job 只通过 `npm run verify` 消费完整检查权威，不复制内部检查清单；
- workflow/job 名称保持稳定，供管理员后续选择 required check。

仓库测试同时结构化读取 `package.json`，固定 `pretest:package-e2e` 先构建、`test:package-e2e` 再运行现有 package E2E 的脚本关系。这样测试不是只证明 E2E 文件会调用 `npm pack`，而是证明维护者直接执行文档公开命令时也不会打包历史 `dist`。

同一测试读取 `docs/self-hosting.md`，保护“多仓验收默认 package-first”和“源码例外在更新后重新构建、通过 freshness preflight 再启动”的顺序，并明确旧 `dist` 不构成证据。结构化测试只验证仓库可以控制的 workflow 与文档契约，不声称已观察到操作者实际执行或 GitHub branch protection。

没有引入 Action 专用 Linter 依赖：本次 workflow 很小，YAML 结构测试、完整 `npm run verify` 与 GitHub 首次执行已覆盖当前风险；未来 workflow 复杂化时可独立评估 actionlint。

### 4. CI 检查与服务端合入保护分开取证

仓库只保证产生稳定的 `Continuous integration / verify` 检查状态。GitHub required status check/branch protection 是仓库外的平台配置，是否启用必须从 GitHub 规则获得独立证据。

因此文档会把管理员将该检查设为 required 写成可选的后续运维步骤，不把新增 YAML 描述成已经阻止合入。这也避免在没有管理员权限、套餐能力或 API 凭据时制造虚假保证。

### 5. 不改变 Runtime 与 Composition 边界

本 change 只修改仓库自动化、契约测试和源码自举文档。Engine、Cordis Service/Contributor、Run Store、Specification Provider、OTLP 以及业务仓都不参与 CI 身份判断。CI 失败只是提交级验证事实，不创建或推进 Repoctopus Run。

### 6. 验证失败按证据类型修订，不扩大产品范围

首次 Verify 的独立审查发现三项实现证据缺口：standalone package E2E 未自行构建、job 级权限可覆盖顶层只读权限、文档后段仍有一处 build-only 表述；同时 Tasks 3.1 把全仓格式基线写成必须全绿，与已批准 Build Plan 的基线例外不一致。这些都是当前能力的闭合性或任务权威问题，不改变 `product-distribution` 的公开行为，因此复用同一 delta spec，不新增 capability。

修订采用以下边界：

- 用 npm lifecycle 闭合 standalone package E2E，而不是在测试实现内部隐式修改工作树；
- 拒绝 `verify` job 声明任何权限覆盖，而不是尝试维护第二份允许列表；
- 文档只保留一条源码例外顺序：build、freshness preflight、CLI，并用负例防止 build-only 文案回归；
- 全量 `npm run format:check` 继续作为可见的历史基线证据，本 change 控制的文件使用精确 Prettier 检查且必须退出 0；全量 lint 和 typecheck 仍必须退出 0。既有归档规格与 Comet 机器状态不为制造全仓格式绿灯而机械改写。

## Risks / Trade-offs

- `npm run verify` 包含 Desktop 构建和完整测试，CI 时长高于拆分的快速检查。当前优先保证单一、完整、不可漂移的门禁；并行矩阵和缓存优化应在有实际时长数据后另行设计。
- GitHub Actions 首次运行前，仓库测试只能证明 YAML 契约，不能证明托管 Runner 环境无差异。首次 PR/main 结果是必要的外部证据。
- `main` push 复验不会自行阻止已经发生的直接 push。真正的预合入阻断依赖管理员配置 branch protection/required check，必须保持这一限制可见。
- 每次源码更新后显式构建增加少量本地耗时，但换来实际执行版本的确定性；不通过 launcher 隐式缓存来交换正确性。
- 测试固定稳定 workflow/job 名称会让重命名成为显式变更。这是有意的，因为平台 required check 可能引用该名称。
- standalone package E2E 会多执行一次标准构建，耗时略增，但不再依赖调用者事先准备 `dist`；CI 中仍只调用 `npm run verify`，不会重复该 standalone 命令。
- 禁止 job 级权限覆盖牺牲少量局部配置灵活性，换取顶层最小权限成为唯一权威。未来确需额外权限时必须显式修改契约，而不能在 job 中静默放宽。
- 全仓 `format:check` 当前会暴露 116 个既有差异。该失败保持可见并记录为历史基线；本 change 不以大规模无关格式化掩盖其实际交付内容。

## Migration Plan

1. 先提交仓库契约测试，使缺失 CI、package-first 默认值或源码 freshness preflight 时失败。
2. 新增 `.github/workflows/ci.yml`，更新 `docs/self-hosting.md`，让聚焦测试通过。
3. 在当前 worktree 执行 standalone `npm run test:package-e2e`，证明它会先构建当前源码；再执行 `npm run verify`、源码 build/freshness preflight、严格 OpenSpec 校验和工作区卫生检查。
4. 执行全仓 `npm run format:check` 并记录既有基线；对本 change 控制的文件执行精确 Prettier 检查，同时要求全量 lint 与 typecheck 通过。
5. 推送分支后观察 pull request 的 `Continuous integration / verify` 实际结果；只有该外部结果存在时才宣称托管 CI 已运行。
6. 如团队需要强制预合入门禁，由仓库管理员在 GitHub 规则中把稳定检查设为 required，并单独保存平台配置证据。

回滚只需移除 workflow 与对应仓库契约；没有数据、Run Store、协议或配置迁移。即使回滚 CI，package-first 多仓验收以及源码运行前显式构建和 freshness preflight 仍是正确的使用方式。
