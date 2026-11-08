---
change: fix-packaged-doctor-provenance
design-doc: openspec/changes/fix-packaged-doctor-provenance/design.md
base-ref: fec442b1c1b8cf1af94929fb9304de6e1a9dc575
---

# 安装包 doctor 修复计划

<!-- comet-task-authority: openspec/changes/fix-packaged-doctor-provenance/tasks.md -->

正式设计与批准范围见 design-doc，任务正文及 checkbox 只由 tasks.md 维护。用户授权代理执行中间审批、合入后复验。实施采用 autonomous + TDD，审查 thorough，沿用独立 worktree。

## 1.1 运行诊断垂直切片

<!-- comet-task-ref:3f6f2525-3fe5-465d-8673-2767d46439cf -->

范围：platform/provenance/check.ts、test/provenance.test.ts。先让无开发文件健康 fixture 失败并保留日志；再按设计从产品根解析实际生产依赖，保持已分发来源摘要检查。新增缺失、格式/身份/版本漂移负例并证明健康恢复。测试 `node node_modules/vitest/vitest.mjs run test/provenance.test.ts`；所有预期必须来自现有来源清单和独立反例，不自造成功。

## 1.2 源码审计边界

<!-- comet-task-ref:f07fc2be-5f62-4874-a3a6-6ea2715c208f -->

范围：来源测试 fixture 与 scripts/check-provenance.mjs 的消费回归。沿用原源码审计脚本，对健康 fixture 及锁版本、integrity、准备脚本缺失三个反例执行真实脚本；健康成功、反例失败。先于整体验收核对 `npm run check:provenance`。

## 2.1 真实 npm 消费切片

<!-- comet-task-ref:f9926e98-5bc4-4bba-bbcd-37a178955b3c -->

范围：现有 test/e2e/package.e2e.test.ts。扩展真实 tarball + omit=dev 安装用例，对已创建 Run 执行公共 doctor；验证无源码开发资源也健康，篡改必需资源后失败，恢复后健康。读取原始 Run、Checkpoint、Trajectory 字节作为只读断言。禁止往安装包补开发文件。使用标准 `npm run test:package-e2e`，失败保留完整输出；临时消费者由既有 cleanup 管理。

## 2.2 文档与集成检查

<!-- comet-task-ref:1a971bb8-f8bd-499b-81ee-6a7b698c9dbf -->

补 docs/runtime-state.md 的源码/安装诊断边界，正式报告记录根因、Comet 固定参考、真实 RED/GREEN、包消费和未执行项。独立审查重点检查没有跳过必需资源、误用宿主 cwd 或降低 CI 校验。运行相关来源/CLI/包测试和标准 verify；Comet Guard 使用 check policy 的精确 `npm.cmd run verify`，VITEST_MAX_WORKERS=2。已存在的完整有效检查由 Runtime 决定复用，不为阶段名重跑。

## 交付

按正式 Comet Archive 守卫归档，提交后立即 push，创建唯一产品 PR，CI 成功再合入 main。重新构建 main 包，以相同公共包测试复验，保护既有多仓 Run 和验收报告。不修改全局 Node/Git 设置，不重置 Store。
