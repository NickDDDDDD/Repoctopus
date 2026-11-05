---
change: stabilize-cli-distribution-gate
design-doc: openspec/changes/stabilize-cli-distribution-gate/design.md
base-ref: 04f71da2d204c7dd24106a5b9e0ae027b30ee652
---

# CLI 分发门禁实施计划

<!-- comet-task-authority: openspec/changes/stabilize-cli-distribution-gate/tasks.md -->

## 目标与边界

本计划把仓库已有的构建、package E2E 与 `npm run verify` 组织成一条可审计的分发契约：GitHub 在干净 checkout 验证当前提交；多仓验收默认消费隔离安装包；直接源码只在构建和 freshness preflight 后运行。实现不修改 Runtime、Cordis、CLI launcher、公开协议或依赖版本。

Build 使用 `autonomous + tdd + thorough`。每个行为先由聚焦测试暴露缺口，再实现最小改动；最终集成审查在 Verify 统一完成，Build 只做任务级自检。

## 1. 建立 CI 契约的 RED 基线

<!-- comet-task-ref:ab81c324-0c3e-475d-be3d-5374a7e0d3fd -->

新增 `test/repository-ci.test.ts`，把 workflow 解析和契约判定封装为测试内纯函数，覆盖稳定名称、触发器、权限、并发、Runner、Node/npm cache、`npm ci` 与单一 `npm run verify`。先在 `.github/workflows/ci.yml` 尚不存在时运行聚焦测试，保存因缺失目标文件而失败的真实 RED 证据。

依赖：无。接受：失败原因只指向本任务声明的缺失 CI，而不是类型、环境或测试夹具错误。

## 2. 交付最小 CI 垂直切片

<!-- comet-task-ref:666bc6b6-774f-4e58-9eb4-b57d8fb55cf0 -->

新增 `.github/workflows/ci.yml`：`Continuous integration / verify` 在 pull request、`main` push 与 `workflow_dispatch` 上运行；权限为 `contents: read`，同一 ref 的旧运行可取消；Node 24 启用 npm cache；执行 `npm ci` 后只调用 `npm run verify`。运行聚焦测试确认 GREEN。

依赖：任务 1。回退：删除 workflow 即可，不涉及数据或 Runtime 状态迁移。

## 3. 证明 CI 测试是语义契约而非文本快照

<!-- comet-task-ref:7b1d9b66-0e90-4039-a549-e0ec5424bf12 -->

用内存复制并变异解析后的 workflow：分别扩大顶层权限、用 job 级权限覆盖、移除 `main` push 或加入重复的内部检查命令，确认契约函数给出定向问题；原 workflow 仍通过。避免依赖键顺序、缩进或无关显示文本。

依赖：任务 1-2。接受：聚焦测试同时覆盖正例和三个负例。

## 4. 建立验收来源文档的 RED 基线

<!-- comet-task-ref:c219a0b9-93e8-45d3-b29d-dd26588c4e28 -->

扩展 `test/self-hosting-docs.test.ts`，要求文档明确：多仓验收默认 package-first；直接源码是显式例外；源码更新后按 `npm run build`、`node scripts/build.mjs --check`、源码 CLI 的顺序执行；旧 `dist` 不构成验证证据。先对现有文档运行测试并保存预期 RED。

依赖：无，可与任务 1 的 RED 独立完成。接受：新增断言因缺失语义失败，现有链接与 reconcile 行为断言仍通过。

## 5. 固化 package-first 与源码 preflight

<!-- comet-task-ref:bf72fbec-0e6f-45f8-9408-daf5305215ef -->

更新 `docs/self-hosting.md`：区分安装包验收和源码诊断；给出可执行顺序；说明 `npm ci` 只在依赖需要恢复时运行；说明 CI 状态与平台 required check 是不同证据；拒绝同一文档后文再次把源码路径简化为 build-only。联合运行 self-hosting 与 CI 聚焦测试，确认文档、workflow 与测试使用同一术语和命令。

依赖：任务 2、4。接受：两个聚焦测试文件共同通过，文档不声称仓库 YAML 已启用 branch protection。

## 6. 复验安装包独立消费

<!-- comet-task-ref:0a8cc5f2-46ca-40a7-a41a-6246cee81bd1 -->

核对现有 package E2E 是否确实执行 `npm pack`、隔离 `npm install --omit=dev`，并从安装目录调用公共 CLI 验证必要资源和 JSON 协议。standalone `npm run test:package-e2e` 必须通过 npm lifecycle 先运行标准 build，并由脚本契约测试保护该前置；随后执行真实 package E2E。不创建第二套打包脚本，也不把源码目录的历史 `dist` 当成当前源码消费者环境。

依赖：任务 5 的术语稳定。接受：package E2E 通过，测试证据指向安装后的包路径。

## 7. 静态质量与格式

<!-- comet-task-ref:1abe637a-4d0b-481e-8d84-91b9febf9891 -->

运行 `npm run format:check` 暴露并记录全仓既有格式基线，再对最终 workflow、测试、文档和规格执行精确 Prettier 检查，并运行 `npm run lint` 和 `npm run typecheck`。格式工具不得改写 Comet 机器生成的 handoff/state 语义；若仓库全量格式检查暴露既有生成文件差异，先区分既有事实与本 change 引入问题。

依赖：任务 1-6。接受：精确格式检查、`npm run lint` 和 `npm run typecheck` 均退出 0；全量格式基线若仍失败，必须提供可复现证据并在 Verify 明示，不得静默忽略或把它描述为绿色。

## 8. 完整构建与 freshness 验证

<!-- comet-task-ref:e7a6d83e-55fe-472d-93c2-767238d7220b -->

运行 `npm run verify`，随后运行 `node scripts/build.mjs --check`。前者覆盖 CLI/Desktop 构建、完整 Vitest、生成物、品牌、架构、来源、Dashboard、OpenSpec 与 managed execution report；后者证明刚生成的源码 CLI 与当前输入一致。

依赖：任务 1-7。失败处理：定位到最小责任面后修复并重跑受影响聚焦检查，再重跑完整命令；不通过削弱断言或删除门禁获得绿色结果。

## 9. 规格、差异与正式 Evidence

<!-- comet-task-ref:345389b1-84af-4148-9a0c-1a3e8c9149a2 -->

运行 `comet classic openspec -- validate stabilize-cli-distribution-gate --strict`、`git diff --check` 和工作区卫生检查。把最终 HEAD、命令、退出结果、未执行的 GitHub 外部检查及 required-check 管理边界写入正式 Verification Evidence；清理临时配置、日志、tarball 与诊断输出，只保留规范产物和可复用证据。

依赖：全部任务。接受：9/9 Task 可由同一 tasks.md 勾选、正式 Evidence 与最终 tree 一致，外部 GitHub 运行没有被本地测试冒充。
