---
change: fix-windows-default-archive-paths
design-doc: openspec/changes/fix-windows-default-archive-paths/design.md
base-ref: 04d37b5494fa1cf3bc2837312096f0c2401fa5a4
---

# Windows 归档路径与跨实现恢复实施计划

<!-- comet-task-authority: openspec/changes/fix-windows-default-archive-paths/tasks.md -->

任务及完成状态只在上述 tasks.md；本计划引用任务身份，不复制复选框。执行采用已记录的 autonomous + TDD + thorough，沿用已绑定 worktree。用户已委托处理中间决定及合入 main 后持续验证。

## 文件与职责

- domains/runtime/workflow-runs.ts：既有组合依赖、兼容采纳及受保护 Archive 入口，不添加第二个权威。
- services/workflow-runs.ts、services/delivery.ts、plugins/delivery/file-delivery-provider.ts：内部执行上下文与原冻结来源分离；Planning、Verify、Journal 保持原职责。
- platform/git/archive-git.ts：局部受管 Git 执行；specification-checkout 与 specification-publication 的全部归档 Git 调用接入。
- plugins/builtin-catalog.ts：登记实际代码依赖及经核实的唯一直接前驱。
- test/archive-composition-execution.test.ts、test/archive-git-longpaths.test.ts 及现有 Runtime、publication、compatibility 测试：分别验证真实执行边界、路径与恢复负例。
- docs/runtime-state.md、docs/plugins.md：公开恢复与身份解释。正式结果写入 verification/fix-windows-default-archive-paths/verification-report.md。

## 1. 恢复权威垂直切片

<!-- comet-task-ref:eaf35d6b-14b6-499e-825d-cedcf8df9b4a -->
<!-- comet-task-ref:dadbb228-3ace-4f5f-a456-e1770063eb63 -->
<!-- comet-task-ref:a709c446-2677-4d2a-8117-5a528b58bae3 -->

先在 Archive 的真实生产校验中建立冻结组合 A、兼容执行 B 的失败回归，记录失败消息和原状态。不能 spy 掉 validateArchiveIntent、Planning approval、compareCompositions 或核心 publishArchive。真实旧包到新包的公开验收在第 4 组单独证明，不把合成 catalog 当成真实升级。

实现最小内部 ArchiveExecutionContext，由可信最新 Run 取得 runId、changeId 和 compositionDigest。Coordinator 受保护入口复核最新 composition 与执行组合、Work/epoch/input，再由 callback 传递该上下文。Delivery 核对当前实现与上下文及原审批、实时分支；不拿历史 archive.planningCompositionDigest 要求当前实现相同，也不修改该冻结值。

在现有组合依赖函数补齐 Archive 的 specification-authority 与 delivery-state-write。覆盖 close/publish 两个 checkpoint、缺失/错误/多前驱、配置/authority/schema 漂移、跨 Run 与入口前并发组合漂移；受保护 callback 和外部副作用次数在拒绝时保持零。

诊断测试使用 node node_modules/vitest/vitest.mjs run test/archive-composition-execution.test.ts test/composition-compatibility.test.ts test/runtime.test.ts；RED 来自待修复行为，GREEN 后运行相关规划和 Archive 回归，不伪造失败或回退代码重演。

## 2. Windows 路径垂直切片

<!-- comet-task-ref:21d48cd8-e38d-4dc6-9d80-d1174d52889b -->
<!-- comet-task-ref:a6ec55d6-082b-4b4d-80c7-d4daaf04d5ff -->
<!-- comet-task-ref:1dc12635-41cc-46b3-9fbe-12b272a62fbd -->

真实 Git 夹具先证明 checkout 边界失败，再增加局部 archive-git 执行适配；Windows 前缀 -c core.longpaths=true，非 Windows 原 argv，保留 ProcessResult 原始 stdout/stderr。不能修改父环境、仓库/全局/系统配置或目录布局。

第二个 RED 令归档文件完整路径超过 260 字符，再接入 publication 中直接 execute 的 NUL diff、ls-files、add/commit/push 与恢复路径。断言真实索引、commit 内容、远端 OID 和清理。长度用实际夹具路径计算，不能凭测试名认定边界覆盖。

诊断命令：node node_modules/vitest/vitest.mjs run test/archive-git-longpaths.test.ts test/isolated-specification-closure.test.ts test/specification-publication.test.ts。已有 commit/push/MR 故障注入和 completed 重放继续执行，调用者 HEAD/branch/index、根目录及允许路径约束保持。

## 3. 实现身份和文档收口

<!-- comet-task-ref:c3d049cc-18b6-4291-9e24-e89fffbe965e -->
<!-- comet-task-ref:c69cbbf0-19fe-4c16-9a88-c7ae21f47d9d -->

以生产算法、原失败 Run 和已验证旧包核实实际变更的前驱 codeDigest 与 descriptorDigest；只更新受影响实现，新增 Git 模块进入 sourceFiles。运行 composition 正负回归，源码全部完成后再次核对，不固定伪造当前代码摘要。

更新现有文档解释冻结来源与当前执行上下文、公开恢复及不可兼容时的只读阻断。记录 Git commit/OID 不等于插件代码/配置摘要；每次 commit 仍立即 push。

## 4. 原 Run 的真实包验收

<!-- comet-task-ref:62e65c6f-2762-4a91-bf7b-feda48bc36c0 -->
<!-- comet-task-ref:8dd9ab1c-ebc2-4294-98c3-6bcfb80257ac -->
<!-- comet-task-ref:84ba5edb-a748-4af4-8e10-d40850f724ed -->

标准构建、freshness 和独立 tarball 安装形成候选；保留旧包与原失败记录。通过公开 CLI 先观察并合法采纳，再接续同一失败 Run。工具切换不得更改 registry、workspace、业务代码/OID、原审批、Verify Input/Gate/Bundle 或 Archive input。

记录默认 Git 各作用域及系统设置、实际失败/归档路径长度，完成真实关闭与完整 MR 集合。新进程交替 resume/next，核对原 Journal、精确远端结果和次数，未知外部结果仍只观察不盲重试。原 Run 通过后，合入 main 再以 main 生成的新包执行授权的直接验证循环。

## 5. 完整检查、审查与交付

<!-- comet-task-ref:7594fa72-e6c3-4ec2-b7ec-abd6e0d629f2 -->

VITEST_MAX_WORKERS=2。Build/Verify 通过 Comet guard 派发 check policy 中精确 argv：npm.cmd run verify，不手写等价 shell 串。完整检查、独立 thorough 审查、真实旧包到新包证据和未执行项分别写入正式报告；输入变化按 Runtime 规则重验，不用旧成功记录替代。

经本次委托执行 Archive、push、PR、CI 和合入 main；每次提交立即 push。main 验证失败时保留现场并通过 Comet 继续修复和复验。只有实际通过才报告完成。清理只限新测试夹具和无用临时日志，原失败 Run、旧包和有效证据保留。
