---
change: add-workspace-onboarding-guides
design-doc: openspec/changes/add-workspace-onboarding-guides/design.md
base-ref: b95ae3eb459c4cd4de838116fe68679caaea1996
---

# Workspace 初始化引导实施计划

<!-- comet-task-authority: openspec/changes/add-workspace-onboarding-guides/tasks.md -->

**Goal:** 获批接入安装可共享的人机入口与本地教程，保留团队内容并证明安装包路径可用。

**Architecture:** 纯文档渲染位于项目配置领域，文件观察、区块合并与受限原子写入位于接入平台层，既有 Cordis Service 和 CLI review 负责调用与可信批准。任务完成状态只来自 OpenSpec Tasks。

**Execution:** 用户已批准 autonomous + TDD + thorough，沿用当前 worktree；本计划不改变执行方式，也不新增完成复选框。

## 约束与审查重点

- 保留 Runtime、OpenSpec、审批与已有 journal 权威，无新依赖、配置 Schema 或状态迁移。
- 首次创建、已有团队文件、CRLF/混合换行、无结尾换行、损坏区块、符号链接/父目录和写入期间变化都需明确结果。
- 原 confirmed 请求不扩大效果；失败保留现场，配置和完成状态最后发布。
- 单仓和多仓使用同一机制，模板只采用共享逻辑配置，不泄漏本机路径或凭据。
- 公共 CLI 交互验收使用真实 PTY，生产安装不能借源码 apply、isTTY 伪造或注入开发文件通过。

## 1.1 首个可用切片

<!-- comet-task-ref:579fe2e4-b9fa-4798-88f1-4e7a1552f20b -->

先在 `test/project-onboarding.test.ts` 的真实批准路径断言三份引导存在且链接有效，运行单项得到缺失引导的 RED。新增 `domains/project-configuration/workspace-guides.ts` 渲染逻辑与 `platform/project-configuration/workspace-guides.ts` 安装器，在 `onboarding.ts` 的批准路径接入。运行相关回归得到 GREEN，再提交并立即 push。

## 1.2 文件所有权与边界

<!-- comet-task-ref:60f2e194-a82d-4b54-b769-27d5b87600e4 -->

新增 `test/workspace-guides.test.ts`，在正常切片基础上先为内容保持、换行、标记异常、不安全目标、并发修改写 RED。采用小型区块解析和现有 `atomicWriteText` 原语修复，拒绝完整区块之外的标记残片，不格式化团队文本；新文件 exclusive 创建，已有文件提交前复核。针对性测试、类型和 lint 通过后提交并 push；不复制 Comet 源码，不改变来源清单。

## 1.3 接入事务与恢复

<!-- comet-task-ref:ffd162e4-1c89-4fde-a076-f43c38b3d97e -->

扩展 `test/project-onboarding.test.ts`，验证未批准、拒绝、路径冲突无共享产物、部分安装后的原请求恢复、并发变化、confirmed 幂等。统一预检位于 Store 副作用之前，引导和 gitignore 位于配置发布之前，回归真实 RED→GREEN。确认原 Store/指针 Receipt 未重复生成，提交并 push。

## 2.1 团队内容与审批说明

<!-- comet-task-ref:56a8c9c8-4b37-4b58-a6cd-e5ffddd1c3ff -->

在 `app/cli/project-configuration-decision.ts` 的现有摘要说明固定引导文件与区块策略。更新 `README.md` 和 `docs/project-onboarding.md` 的共享产物和旧团队补齐步骤；教程覆盖安装、新成员、首次任务、状态恢复、配置和 SigNoz。对齐真实命令参数与相对链接，审查短 AGENTS 的执行性与无影子权威；相关测试后提交并 push。

## 2.2 安装包与真实终端集成

<!-- comet-task-ref:74562c66-1331-4a9f-b04f-0e8e84857fdc -->

扩展 CLI/包集成的必要断言，从精确提交构建指定候选 tgz，隔离生产安装。建立新的临时多仓和单仓现场，真实 PTY 运行 detect/prepare/review（含拒绝），比较共享文件原文，按生成教程执行启动、状态与新进程恢复，并解析全部本地链接。记录候选摘要与退出码；不触及旧五仓实验。使用独立 reviewer 做 Build 分段与最终集成审查，解决重要问题后保存正式报告。

## 正式检查与交付

所有实现、报告、任务完成事实先提交并 push。Build Guard 使用 check policy 中的完整构建入口 `npm.cmd run build`；Verify Guard 使用标准完整验收入口 `npm.cmd run verify`（`VITEST_MAX_WORKERS=2`），各自提交真实收据。后续仅按同一 Run 的 continuation 执行；归档与交付遵循实际用户授权，不在此计划暗示已经发布新 Release。
