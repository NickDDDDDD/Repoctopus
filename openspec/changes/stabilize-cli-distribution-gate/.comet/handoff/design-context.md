# Comet Design Handoff

- Change: stabilize-cli-distribution-gate
- Phase: design
- Mode: compact
- Context hash: cde43f2135a2d1e607eea6cf6da8586f6a26554e9c88d805070d741f852691fc

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/stabilize-cli-distribution-gate/proposal.md

- Source: openspec/changes/stabilize-cli-distribution-gate/proposal.md
- Lines: 1-31
- SHA256: 44a3a470f152dfa473bcb80851805dc909d9aabc98ded2c5639752d3fd89d8b4

```md
# Proposal

## Why

Repoctopus 的源码 checkout 会把 `dist/` 作为本地构建产物忽略，但当前仓库没有在 pull request 与 `main` push 上执行完整验证；开发者也可能在更新源码后误用历史 `dist`，让验收实际运行旧 Runtime。现在需要把“干净环境验证当前源码”和“源码运行前显式构建”变成可审计的产品分发契约，而不是依赖操作者记忆。

## What Changes

- 建立 `product-distribution` 能力，明确源码 checkout、生成产物和安装包之间的权威边界。
- 增加面向 pull request、`main` push 和人工触发的 GitHub CI，在干净 checkout 中使用受支持的 Node 版本安装固定依赖并运行仓库完整验证。
- 让 CI 直接复用仓库已有的 `npm run verify`，保持本地与托管验证只有一套命令权威，并通过失败状态阻止把未验证源码描述为可交付。
- 固化源码自举与多仓验收的执行来源：多仓验收默认从当前源码构建 tarball 并在隔离消费者环境安装后运行；只有明确需要源码入口时，才先从当前 checkout 重新构建并通过 freshness preflight，再启动源码 CLI。历史或缺失的本地 `dist` 不构成当前源码的验证证据。
- 增加对 CI 工作流、package-first 验收和源码构建边界的自动化回归检查，并更新自举文档中的验收顺序。
- 不提交 `dist/`，不让 launcher 隐式重编译源码，不改变 npm 安装包的公共 CLI 参数或 Runtime 协议。

## Capabilities

### New Capabilities

- `product-distribution`: 定义干净 checkout 的持续验证、源码构建产物的权威边界以及安装包/源码验收的可复现要求。

### Modified Capabilities

无。

## Impact

- 影响 `.github/workflows/`、构建/仓库契约测试、自举与开发验证文档。
- 复用现有 npm lockfile、构建脚本、测试和 OpenSpec 校验，不增加生产依赖，不改变 Runtime 架构。
- 参考 Comet 0.5.1 的“忽略 `dist`、源码显式构建、PR/main CI 强制验证”做法；不复制 Comet 源码，因此不新增第三方许可证义务。
- 本次垂直切片只建立 GitHub 上的仓库验证门禁与源码验收契约；服务端 required-check 配置、其他代码托管平台流水线和自动发布版本留给后续独立 change。

```

## openspec/changes/stabilize-cli-distribution-gate/design.md

- Source: openspec/changes/stabilize-cli-distribution-gate/design.md
- Lines: 1-90
- SHA256: 8545a3ca529e0433121f39a9cb380b453e1f5d53abc004f85119b0e083505eec

[TRUNCATED]

```md
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

安装包则由当前源码生成 tarball，并在隔离消费者目录中通过包内 `bin` 验证。多仓生命周期验收默认采用这条 package-first 路径，避免长期产品 checkout 中的忽略产物泄漏到验收结果；只有诊断未打包源码改动时才使用上述直接源码例外。`npm run verify` 中的完整 Vitest 已包含 `test/e2e/package.e2e.test.ts`，所以 CI 不再重复调用第二份 package 命令；该测试仍保持独立的消费环境和断言。

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
- 顶层权限保持 `contents: read`；
- `verify` job 使用 Ubuntu、Node 24、npm cache 和 `npm ci`；
- job 只通过 `npm run verify` 消费完整检查权威，不复制内部检查清单；
- workflow/job 名称保持稳定，供管理员后续选择 required check。

同一测试读取 `docs/self-hosting.md`，保护“多仓验收默认 package-first”和“源码例外在更新后重新构建、通过 freshness preflight 再启动”的顺序，并明确旧 `dist` 不构成证据。结构化测试只验证仓库可以控制的 workflow 与文档契约，不声称已观察到操作者实际执行或 GitHub branch protection。

没有引入 Action 专用 Linter 依赖：本次 workflow 很小，YAML 结构测试、完整 `npm run verify` 与 GitHub 首次执行已覆盖当前风险；未来 workflow 复杂化时可独立评估 actionlint。

### 4. CI 检查与服务端合入保护分开取证

仓库只保证产生稳定的 `Continuous integration / verify` 检查状态。GitHub required status check/branch protection 是仓库外的平台配置，是否启用必须从 GitHub 规则获得独立证据。

因此文档会把管理员将该检查设为 required 写成可选的后续运维步骤，不把新增 YAML 描述成已经阻止合入。这也避免在没有管理员权限、套餐能力或 API 凭据时制造虚假保证。

### 5. 不改变 Runtime 与 Composition 边界

本 change 只修改仓库自动化、契约测试和源码自举文档。Engine、Cordis Service/Contributor、Run Store、Specification Provider、OTLP 以及业务仓都不参与 CI 身份判断。CI 失败只是提交级验证事实，不创建或推进 Repoctopus Run。

## Risks / Trade-offs

- `npm run verify` 包含 Desktop 构建和完整测试，CI 时长高于拆分的快速检查。当前优先保证单一、完整、不可漂移的门禁；并行矩阵和缓存优化应在有实际时长数据后另行设计。
- GitHub Actions 首次运行前，仓库测试只能证明 YAML 契约，不能证明托管 Runner 环境无差异。首次 PR/main 结果是必要的外部证据。
- `main` push 复验不会自行阻止已经发生的直接 push。真正的预合入阻断依赖管理员配置 branch protection/required check，必须保持这一限制可见。
- 每次源码更新后显式构建增加少量本地耗时，但换来实际执行版本的确定性；不通过 launcher 隐式缓存来交换正确性。
- 测试固定稳定 workflow/job 名称会让重命名成为显式变更。这是有意的，因为平台 required check 可能引用该名称。

```

Full source: openspec/changes/stabilize-cli-distribution-gate/design.md

## openspec/changes/stabilize-cli-distribution-gate/tasks.md

- Source: openspec/changes/stabilize-cli-distribution-gate/tasks.md
- Lines: 1-25
- SHA256: cf805e66aca54d81b96dc9617ba6929c419c104b10bbf3a1724aea1e7edb426d

```md
# Tasks

## 1. 干净 checkout 的 CI 门禁

- [ ] 1.1 新增仓库 CI 契约测试，先证明缺失或削弱 `.github/workflows/ci.yml` 时会失败；覆盖稳定 workflow/job 名、PR/`main`/人工触发、`contents: read`、并发取消、Ubuntu、Node 24、npm cache、`npm ci` 与唯一 `npm run verify` 调用，并以 `npx vitest run test/repository-ci.test.ts` 验证红灯来自预期缺口 <!-- comet-task:ab81c324-0c3e-475d-be3d-5374a7e0d3fd -->
- [ ] 1.2 新增最小 `.github/workflows/ci.yml`，只负责干净 checkout、锁定依赖安装和调用标准完整验证命令，并以 `npx vitest run test/repository-ci.test.ts` 验证全部 CI 契约转绿 <!-- comet-task:666bc6b6-774f-4e58-9eb4-b57d8fb55cf0 -->
- [ ] 1.3 对 workflow 契约测试补充反例，证明写权限、非 `main` 默认分支或复制内部检查清单会被拒绝，并以 `npx vitest run test/repository-ci.test.ts` 验证测试不会只接受当前文本快照 <!-- comet-task:7b1d9b66-0e90-4039-a549-e0ec5424bf12 -->

## 2. 源码与安装包身份边界

- [ ] 2.1 扩展 `test/self-hosting-docs.test.ts`，先证明文档必须把隔离安装的 package-first 路径作为多仓验收默认值，并要求源码例外在每次更新后从当前 checkout 构建、通过 freshness preflight 再启动 CLI，且不得把历史 `dist` 当作验证证据；以 `npx vitest run test/self-hosting-docs.test.ts` 验证新增断言在文档修改前按预期失败 <!-- comet-task:c219a0b9-93e8-45d3-b29d-dd26588c4e28 -->
- [ ] 2.2 更新 `docs/self-hosting.md` 的源码准备与验收顺序，明确 package-first 默认值、直接源码例外、`npm ci` 的适用时机、每次 checkout 更新后的 `npm run build` 与 `node scripts/build.mjs --check`、旧/缺失 `dist` 的含义以及 CI 检查与 GitHub required check 的管理边界，并以 `npx vitest run test/self-hosting-docs.test.ts test/repository-ci.test.ts` 验证文档和 workflow 契约一致 <!-- comet-task:bf72fbec-0e6f-45f8-9408-daf5305215ef -->
- [ ] 2.3 复验安装包独立消费边界，确认测试从当前源码生成 tarball 并通过隔离安装后的公共 `bin` 验证必要资源；如发现缺口就在 `test/e2e/package.e2e.test.ts` 补齐，并以 `npm run test:package-e2e` 验证 package-first 默认路径，不用长期源码 checkout 的本地 `dist` 代替包验收 <!-- comet-task:0a8cc5f2-46ca-40a7-a41a-6246cee81bd1 -->

## 3. 集成验证与交付证据

- [ ] 3.1 对本 change 的 workflow、测试与文档执行 `npm run format:check`、`npm run lint` 和 `npm run typecheck`，修复所有失败并以三个命令均退出 0 验证静态质量 <!-- comet-task:1abe637a-4d0b-481e-8d84-91b9febf9891 -->
- [ ] 3.2 在当前源码 worktree 执行 `npm run verify` 和 `node scripts/build.mjs --check`，验证 CLI/Desktop 构建、完整 Vitest、生成物、品牌、架构、来源、Dashboard、OpenSpec、managed execution report 与源码 freshness preflight 全部通过 <!-- comet-task:e7a6d83e-55fe-472d-93c2-767238d7220b -->
- [ ] 3.3 执行 `comet classic openspec -- validate stabilize-cli-distribution-gate --strict`、`git diff --check` 与工作区状态检查，确认四份 OpenSpec 产物严格有效、只包含预期改动，并把最终命令和结果记录到正式 Verification Evidence <!-- comet-task:345389b1-84af-4148-9a0c-1a3e8c9149a2 -->

## Workflow follow-up

- 分支推送并创建 pull request 后，观察 `Continuous integration / verify` 的首次 GitHub 托管执行结果；本地 YAML 测试不能替代该外部证据。
- 如团队要求失败检查强制阻止合入，由仓库管理员把稳定检查配置为 required，并独立验证 branch protection；这不是仓库内 YAML 自动完成的能力。
- 完成 Verify 与评审要求后归档 change。

```

## openspec/changes/stabilize-cli-distribution-gate/.openspec.yaml

- Source: openspec/changes/stabilize-cli-distribution-gate/.openspec.yaml
- Lines: 1-2
- SHA256: 3e16994612e657a7bbaefe38b70ef46f3e8e9f382f092dcaceb60ebabe7a5da0

```md
schema: spec-driven
created: 2026-11-05

```

## openspec/changes/stabilize-cli-distribution-gate/specs/product-distribution/spec.md

- Source: openspec/changes/stabilize-cli-distribution-gate/specs/product-distribution/spec.md
- Lines: 1-97
- SHA256: 61b22492f1ef86287ae98eb1f6347e91d3f6978fee56a8ab9f8c4897f26bd79b

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义 Repoctopus 源码 checkout、持续验证、生成产物与安装包之间的权威边界，使维护者和自动化能够证明实际执行的是当前源码，而不是历史本地产物。

## ADDED Requirements

### Requirement: 干净 checkout 持续验证

Repoctopus MUST 在 pull request、默认分支 push 和人工触发时，从干净 checkout 使用受支持的 Node 版本与锁定依赖执行完整仓库验证，并以稳定的检查结果公开成功或失败。

#### Scenario: Pull request 更新源码

- **WHEN** pull request 被创建、重新打开或同步新的提交
- **THEN** CI 从该提交的干净 checkout 安装锁定依赖并执行完整验证，任一必要步骤失败时检查结果为失败

#### Scenario: 默认分支接收提交

- **WHEN** 提交到达默认分支
- **THEN** CI 对默认分支上的精确提交重新执行同一完整验证并保留检查结果

#### Scenario: 维护者人工复验

- **WHEN** 维护者从代码托管平台人工触发验证 workflow
- **THEN** workflow 对所选提交执行与 pull request 相同的验证契约

### Requirement: 本地与 CI 共享验证命令权威

Repoctopus MUST 让 CI 调用仓库声明的标准完整验证命令，而不是在 workflow 中复制一套逐渐漂移的构建、测试和规格校验步骤。

#### Scenario: 仓库验证清单发生变化

- **WHEN** 维护者在标准完整验证命令中增加或调整必要检查
- **THEN** 后续本地完整验证和 CI 自动采用同一更新，无需同步修改重复的命令清单

#### Scenario: 标准验证中的任一检查失败

- **WHEN** 类型检查、Lint、构建、测试、生成物检查、架构检查、来源检查或规格校验返回失败
- **THEN** 标准完整验证和消费它的 CI 都返回失败，不把部分成功描述为可交付

### Requirement: 源码运行绑定当前构建产物

Repoctopus MUST 把 `dist` 视为源码 checkout 的可重建本地产物；直接从源码自举或验收时，在启动 CLI 前必须用当前 checkout 的标准构建命令生成所需 artifact，并立即通过生成物 freshness preflight。历史、缺失或来自另一提交的本地 `dist` 不得作为当前源码通过验证的证据。

#### Scenario: 更新源码后开始自举

- **WHEN** 维护者切换、拉取或合入新的源码提交并准备从源码入口启动 Repoctopus
- **THEN** 自举顺序先从当前 checkout 生成 CLI 与所需桌面 artifact、通过 freshness preflight，再启动源码入口

#### Scenario: 工作目录残留历史 dist

- **WHEN** 当前 checkout 中存在 Git 未跟踪且由较早源码生成的 `dist`
- **THEN** 验收不得仅凭该目录存在就认定当前源码已构建，必须重新执行标准构建与 freshness preflight，或使用由当前提交生成并验证的安装包

#### Scenario: 干净 clone 没有 dist

- **WHEN** 维护者或 CI 得到不包含忽略产物的干净 clone
- **THEN** 标准构建能够从已提交源码与锁定依赖生成完整运行 artifact，而不要求从 Git 恢复 `dist`

### Requirement: 安装包经过独立消费验证

Repoctopus MUST 从当前源码构建发布候选包，在临时消费者环境安装其生产依赖并通过打包后的公共 CLI 执行协议级验收；多仓工作流验收默认使用这条 package-first 路径，源码目录中的本地 `dist` 成功不能替代安装包验收。

#### Scenario: 构建 npm 发布候选

- **WHEN** 仓库执行安装包端到端验证
- **THEN** 验收从当前源码生成 tarball、安装到隔离消费者目录，并通过安装后的 `bin` 验证公共 JSON 协议和必要资源

#### Scenario: 包缺少运行资源

- **WHEN** 发布候选未包含 CLI artifact、Schema、工作流、许可证或运行所需资源
- **THEN** 安装包端到端验证失败，即使源码目录中的测试或本地 CLI 已通过

#### Scenario: 开始新一轮多仓工作流验收

- **WHEN** 维护者准备在隔离的多仓测试项目中验证 Repoctopus 生命周期
- **THEN** 验收默认从目标产品提交构建 tarball、安装到独立消费者环境并通过安装后的公共 CLI 启动，不复用长期源码 checkout 的本地 `dist`

#### Scenario: 验收必须观察未打包的源码改动

```

Full source: openspec/changes/stabilize-cli-distribution-gate/specs/product-distribution/spec.md
