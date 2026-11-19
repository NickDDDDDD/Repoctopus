# Tasks

## 1. 旧提案处置

- [ ] 1.1 新增 `docs/workflow-follow-ups.md`，记录三个旧提案的取消或暂缓结论、原因、原路径及源提交，只保留 TDD 真实命令 Evidence 核验目标；验收：逐项与 design.md 的处置表核对，原文可通过 `git show 37c04f4:<原路径>` 读取，索引没有执行任务或新规格。 <!-- comet-task:1d7297e6-ccd1-498a-99b8-4ed83520bdba -->
- [ ] 1.2 撤出三个旧活动目录并清理当前文档的活动引用；验收：`comet classic openspec -- list --json` 不再列出这三项，`git diff --name-status` 仅包含本次规划、处置文档及三个旧目录，不产生旧提案 Archive 或主规格修改。 <!-- comet-task:c851389a-95dc-415f-ac37-4ac51191344d -->

## 2. 整理结果验证

- [ ] 2.1 验证严格校验、链接和历史追溯，形成正式验证报告；验收：`comet classic openspec -- validate retire-obsolete-workflow-proposals --strict --no-interactive`、`git diff --check` 通过，逐一检查处置索引及历史坐标，确认未修改 Runtime、既有验证报告或旧任务完成事实。 <!-- comet-task:13bff3a4-d43b-49d2-a381-4a6e65f1d797 -->

## Workflow follow-up

- 经当前归档与交付目标确认后归档本次整理 Change；不将旧提案的 delta specs 同步到主规格。
