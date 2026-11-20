---
change: retire-obsolete-workflow-proposals
design-doc: openspec/changes/retire-obsolete-workflow-proposals/design.md
base-ref: 47779021e06418b7edbdd57f44922e65f7933522
archived-with: 2026-11-20-retire-obsolete-workflow-proposals
---

# 旧活动提案整理计划

<!-- comet-task-authority: openspec/changes/retire-obsolete-workflow-proposals/tasks.md -->

执行配置：autonomous、direct、thorough；沿用当前 worktree。需求与任务完成状态仍由 OpenSpec tasks.md 管理。

## 处置索引

<!-- comet-task-ref:1d7297e6-ccd1-498a-99b8-4ed83520bdba -->

新增 `docs/workflow-follow-ups.md`，为三个旧提案记录处置、现有能力边界与可读取原文的 Git 坐标。只保留一个 TDD 后续目标，不创建执行清单。逐一通过 `git show` 读取源提交中的原文，核对文档链接和生产代码依据。

## 移出活动清单

<!-- comet-task-ref:c851389a-95dc-415f-ac37-4ac51191344d -->

索引完成后，以显式 Git 路径删除三个旧目录中的受跟踪文件。盘点当前引用；保留历史验证报告，不改写旧事实。核对删除范围、活动清单和 Archive 目录，确认旧提案没有被当作已交付归档。

## 验证与审查

<!-- comet-task-ref:13bff3a4-d43b-49d2-a381-4a6e65f1d797 -->

运行 OpenSpec 全量严格校验、`git diff --check` 和改动边界/历史追溯检查。thorough 模式安排独立审查，重点核对三种处置、TDD 目标边界、历史事实和链接。正式验证报告保存实际命令及结论，Comet 报告入口引用该报告。

Build Check 与 Verify 均使用 `comet.cmd classic openspec -- validate --all --strict --no-interactive`；本次文档整理不执行无关 Runtime 测试或多仓发布实验。校验失败时修正文档，发现需要改动产品行为时停止并报告范围差异。回退通过 Git 还原本次文档改动，保留原 Run。
