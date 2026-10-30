# Tasks

## 1. 冻结并审计上游事实

- [ ] 1.1 在可清理的临时 checkout 中取得 Comet `0.5.0`、`0.5.1`、`4901cac9330f5ffe289abfa6daf8412bfa190dc0` 与 DSH `dsh-v0.2.1-rc.3`、`dsh-v0.2.1-rc.5`、`ce7073d51254c26cd63b22a60835b8f948deb447`，用 `git rev-parse`、`git merge-base` 和许可证摘要验证标签、分支与提交关系。
  **Acceptance:** 固定 checkout 中的提交、标签、祖先关系与许可证摘要均被命令输出唯一证明，且路径位于可清理临时目录。
- [ ] 1.2 核对八个直接 DSH 包的 `0.2.1-rc.5` npm 发布物、依赖闭包和 tarball integrity，并用 `npm view` 与解包后的 `package.json` 证明版本身份一致。
  **Acceptance:** 八个包都返回精确版本，tarball 解包身份与 registry 元数据一致，完整性与依赖闭包有可复现记录。
- [ ] 1.3 对两个上游分别完成“旧发布→新发布”和“新发布→已审计分支头”的完整相关文件 diff，形成逐项采用、拒绝或延后表并确认没有越过 Design 的 Stop Conditions。
  **Acceptance:** 正式审计覆盖四段 diff，每个相关变化都有采用决定和理由，且没有未解决的停止条件。

## 2. 消除基线身份歧义

- [ ] 2.1 先为 branch/tag 分叉、branch 漂移、tag 移动、旧 schema 和缺失身份补失败测试，并证明旧检查器不能正确表达至少一个分叉案例。
  **Acceptance:** 新测试独立覆盖五类坏案例，并在生产修复前至少有一个分叉案例按预期失败。
- [ ] 2.2 将 `third_party/upstream-baselines.json` 原子迁移到 schema v2 的 `auditedBranchCommit` / `pinnedTagCommit` 模型，更新 `scripts/check-upstream-drift.mjs` 及仓内消费者，并用新坏案例测试验证 branch 与 release 各自独立比较。
  **Acceptance:** 仓内不再读取含糊的 `pinnedCommit`，正常和分叉 fixture 均通过生产漂移检查入口。
- [ ] 2.3 更新 `scripts/check-provenance.mjs`，令 DSH、Cordis 与 Comet 来源只绑定发布标签提交，增加不一致失败测试并运行 `npm run check:provenance`。
  **Acceptance:** 任一来源提交偏离 `pinnedTagCommit` 都会失败，正确发布来源通过 `npm run check:provenance`。

## 3. 升级 DSH 发布来源

- [ ] 3.1 将八个直接 DSH 依赖与 overrides 精确升级到 `0.2.1-rc.5`，刷新 lockfile，并用 `npm ls`、锁文件检查和生产/完整依赖审计证明不存在范围漂移或新增禁止运行时包。
  **Acceptance:** package 与 lockfile 只解析精确 rc.5，`npm ls` 和两类依赖审计通过且闭包无禁止包。
- [ ] 3.2 从固定 rc.5 标签复核 Skill、Cordis、Loader 与桌面参考面，更新 `third_party/dsh-adoption.json`、必要的不可变 Cordis 快照及逐文件摘要，并用 `npm run check:provenance` 验证每个来源和目标。
  **Acceptance:** 所有受影响来源、快照和摘要都绑定 rc.5 标签提交，逐文件 provenance 检查通过。
- [ ] 3.3 更新 DSH 采用报告和跨上游审计，明确 rc.5 已发布变化、`master` 未发布尾部及每项采用决定，并用文档搜索证明不再把 rc.3 写成当前基线。
  **Acceptance:** 当前文档清楚区分 release 与 branch，旧 rc.3 只出现在历史 diff 上下文。

## 4. 升级 Comet 发布来源

- [ ] 4.1 将 `third_party/comet/source-manifest.json` 固定到 `0.5.1` 标签，重算全部登记来源与目标摘要，并在 `COMET_UPSTREAM_ROOT` 指向固定 checkout 时运行 provenance 检查。
  **Acceptance:** manifest 的每个来源摘要等于 0.5.1 checkout，目标摘要等于当前文件，带固定上游根的 provenance 检查通过。
- [ ] 4.2 新增 Comet `0.5.1` 完整增量审计，更新采用报告和跨上游能力矩阵，明确 release 与 `master` 尾部的采用、拒绝或延后决定，并证明没有在本 Change 修改产品运行时行为。
  **Acceptance:** 审计覆盖发布与分支尾部，采用表无遗漏，Git diff 证明没有由审计决定之外的产品运行时修改。
- [ ] 4.3 更新当前架构和上游说明中的 Comet/DSH 版本引用，用定向文档检查证明旧版本只保留在历史审计或迁移上下文中。
  **Acceptance:** 当前态文档引用新基线，定向搜索仅在明确标记的历史上下文发现旧版本。

## 5. 集成验证与清理

- [ ] 5.1 运行 `npm exec -- openspec validate refresh-upstream-baselines-2026-10-30 --strict`、`npm run check:upstream`、`npm run check:provenance`、依赖审计和架构检查，并把每项命令结果收集为正式 Evidence。
  **Acceptance:** 所列生产命令全部返回成功，正式 Evidence 记录命令、退出码、输入身份和摘要。
- [ ] 5.2 运行格式、类型、构建和全量测试入口，确认 Windows 路径、CLI 与现有五阶段工作流没有回归，并将结果写入正式验证报告。
  **Acceptance:** 格式、类型、构建和全量测试全绿，验证报告可从固定提交复现结果。
- [ ] 5.3 再次查询两个远端头以区分“执行期间的新漂移”和本次冻结边界，清除临时 checkout、下载物与调试日志，并以干净的 `git status` 和 Evidence 清单验证只保留正式产出。
  **Acceptance:** 结束时远端事实被记录，临时产物已删除，提交后的工作树干净且只保留正式 OpenSpec、审计和 Evidence。

## Workflow follow-up

- 通过 Verify 后按 Runtime 的正式 Archive Work 归档本 Change。
- 在归档完成且 MR 合入后，以新的独立 Change 开始核心工作流可靠性加固，不把本次审计中延后的行为静默带入当前实现。
