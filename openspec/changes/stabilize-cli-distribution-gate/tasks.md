# Tasks

## 1. 干净 checkout 的 CI 门禁

- [x] 1.1 新增仓库 CI 契约测试，先证明缺失或削弱 `.github/workflows/ci.yml` 时会失败；覆盖稳定 workflow/job 名、PR/`main`/人工触发、`contents: read`、并发取消、Ubuntu、Node 24、npm cache、`npm ci` 与唯一 `npm run verify` 调用，并以 `npx vitest run test/repository-ci.test.ts` 验证红灯来自预期缺口 <!-- comet-task:ab81c324-0c3e-475d-be3d-5374a7e0d3fd -->
- [x] 1.2 新增最小 `.github/workflows/ci.yml`，只负责干净 checkout、锁定依赖安装和调用标准完整验证命令，并以 `npx vitest run test/repository-ci.test.ts` 验证全部 CI 契约转绿 <!-- comet-task:666bc6b6-774f-4e58-9eb4-b57d8fb55cf0 -->
- [ ] 1.3 对 workflow 契约测试补充反例，证明顶层或 job 级写权限、非 `main` 默认分支或复制内部检查清单会被拒绝，并以 `npx vitest run test/repository-ci.test.ts` 验证测试不会只接受当前文本快照 <!-- comet-task:7b1d9b66-0e90-4039-a549-e0ec5424bf12 -->

## 2. 源码与安装包身份边界

- [x] 2.1 扩展 `test/self-hosting-docs.test.ts`，先证明文档必须把隔离安装的 package-first 路径作为多仓验收默认值，并要求源码例外在每次更新后从当前 checkout 构建、通过 freshness preflight 再启动 CLI，且不得把历史 `dist` 当作验证证据；以 `npx vitest run test/self-hosting-docs.test.ts` 验证新增断言在文档修改前按预期失败 <!-- comet-task:c219a0b9-93e8-45d3-b29d-dd26588c4e28 -->
- [ ] 2.2 更新 `docs/self-hosting.md` 的源码准备与验收顺序，明确 package-first 默认值、直接源码例外、`npm ci` 的适用时机、每次 checkout 更新后的 `npm run build` 与 `node scripts/build.mjs --check`、旧/缺失 `dist` 的含义以及 CI 检查与 GitHub required check 的管理边界；移除后文与 freshness preflight 冲突的 build-only 表述，并以 `npx vitest run test/self-hosting-docs.test.ts test/repository-ci.test.ts` 验证文档和 workflow 契约一致 <!-- comet-task:bf72fbec-0e6f-45f8-9408-daf5305215ef -->
- [ ] 2.3 复验安装包独立消费边界，确认 standalone `npm run test:package-e2e` 会先从当前源码构建，再生成 tarball 并通过隔离安装后的公共 `bin` 验证必要资源；补充脚本契约回归，并以 `npm run test:package-e2e` 验证 package-first 默认路径不依赖长期源码 checkout 的历史 `dist` <!-- comet-task:0a8cc5f2-46ca-40a7-a41a-6246cee81bd1 -->

## 3. 集成验证与交付证据

- [ ] 3.1 执行 `npm run format:check` 暴露并记录全仓既有格式基线，不改写归档规格或 Comet 机器产物；对本 change 控制的 workflow、测试、文档和规格执行精确 Prettier 检查，并以该检查、`npm run lint` 和 `npm run typecheck` 均退出 0 验证本次静态质量 <!-- comet-task:1abe637a-4d0b-481e-8d84-91b9febf9891 -->
- [x] 3.2 在当前源码 worktree 执行 `npm run verify` 和 `node scripts/build.mjs --check`，验证 CLI/Desktop 构建、完整 Vitest、生成物、品牌、架构、来源、Dashboard、OpenSpec、managed execution report 与源码 freshness preflight 全部通过 <!-- comet-task:e7a6d83e-55fe-472d-93c2-767238d7220b -->
- [x] 3.3 执行 `comet classic openspec -- validate stabilize-cli-distribution-gate --strict`、`git diff --check` 与工作区状态检查，确认四份 OpenSpec 产物严格有效、只包含预期改动，并把最终命令和结果记录到正式 Verification Evidence <!-- comet-task:345389b1-84af-4148-9a0c-1a3e8c9149a2 -->

## Workflow follow-up

- 分支推送并创建 pull request 后，观察 `Continuous integration / verify` 的首次 GitHub 托管执行结果；本地 YAML 测试不能替代该外部证据。
- 如团队要求失败检查强制阻止合入，由仓库管理员把稳定检查配置为 required，并独立验证 branch protection；这不是仓库内 YAML 自动完成的能力。
- 完成 Verify 与评审要求后归档 change。
