---
change: fix-openspec-checkout-path-identity
design-doc: openspec/changes/fix-openspec-checkout-path-identity/design.md
base-ref: d0ab8d9fdff3cf25fbda71984be49af157a8d0d0
archived-with: 2026-11-06-fix-openspec-checkout-path-identity
---

# OpenSpec Store checkout 路径身份实施计划

<!-- comet-task-authority: openspec/changes/fix-openspec-checkout-path-identity/tasks.md -->

目标是让首版安装包能从 Windows checkout 别名使用真实 OpenSpec Store。设计与行为以 [Design](../../../openspec/changes/fix-openspec-checkout-path-identity/design.md) 和 [Delta Spec](../../../openspec/changes/fix-openspec-checkout-path-identity/specs/specification-authority/spec.md) 为准。现有 worktree 采用 autonomous、TDD 和 thorough。只在平台边界增加实际目录身份解析，保留持久格式、审批约束和归档隔离。

## 1.1 复现错误

<!-- comet-task-ref:211c6a9e-feca-48fc-976f-1b9ee1905cf0 -->

在 `test/e2e/package.e2e.test.ts` 的真实安装包夹具中增加目录别名。记录真实目录访问成功、别名访问因 Store checkout 冲突失败的 RED。使用 Windows junction 或 Unix 目录符号链接，测试夹具退出时清理。

## 1.2 规格读取

<!-- comet-task-ref:7a3864a1-f325-456d-8e2f-e0eef46967c1 -->

实现平台实际路径解析，规格 Provider 使用该解析绑定主 checkout 并核对 OpenSpec context。保留隔离归档工作树的路径。真实安装包的 `spec inspect` 与 `spec validate` 从别名执行成功。通过实际不同目录与缺失路径证明拒绝边界。

## 2.1 项目接入

<!-- comet-task-ref:d6ac1532-bd6f-4a8f-9ef4-b447d542cb45 -->

在 `test/e2e/project-onboarding-flow.e2e.test.ts` 扩展真实接入夹具，先运行从别名探测或批准的回归。探测与登记复用实际路径解析，扫描内重复别名只计一次。审批绑定实际 checkout，保持对草稿、决定文件与 Store 路径的原有检查。复验已登记复用、混合路径、改指或外部路径被拒以及现有接入。

## 2.2 打包与复验

<!-- comet-task-ref:c0fc5d42-4da7-4145-98d2-c14c0547a515 -->

从推送的修复提交构建预制 tarball，用 `REPOCTOPUS_PACKAGE_CANDIDATE` 运行 `test:package-e2e`，以同一 tarball 运行 `test:release-npx`。记录包内容摘要和测试结果，清理临时包。运行政策固定的 `npm.cmd run verify`。

## 2.3 审查与交接

<!-- comet-task-ref:e71e0bf8-0229-4905-8fae-6d39efbdc777 -->

独立审查实际改动并核对规格、批准边界和 CI 证据。说明合入后按同一发布流程重跑，公开 URL 验证属于外部交付。回退可撤销本 change 的实现，无注册表迁移。
