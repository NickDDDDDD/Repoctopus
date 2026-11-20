# 旧活动提案整理验证报告

日期：2026-11-20。范围：三个旧提案的文档整理，不改变产品行为。正式阶段结论以同一 Comet Run 的 Build/Verify Guard 收据为准；本报告不代替归档和交付授权。

## 任务与设计一致性

| 任务           | 已核验结果                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 处置索引   | `docs/workflow-follow-ups.md` 明确记录取消 Open 通用 Method Receipt、暂缓独立团队检查 Work，以及唯一保留的 TDD 真实命令 Evidence 核验目标。没有新任务清单或新增规格。 |
| 1.2 撤回旧提案 | 三个旧活动目录共 20 个文件已撤出；活动列表仅剩本次整理 Change。旧提案未进入普通 Archive，旧 delta specs 未合入主规格。                                                |
| 2.1 验证与追溯 | 严格校验、格式、链接、历史追溯及改动边界检查通过；独立审查无阻断项。                                                                                                  |

本次 `.openspec.yaml` 声明 `skip_specs: true`，规格级新增和修改不适用。完整性按本次三个任务判断，不将旧提案的 26 项未完成任务记为已交付。

## 实际执行的检查

- `comet.cmd classic openspec -- validate --all --strict --no-interactive`：16 项通过、0 失败；合法跳过本次 delta specs。
- `comet.cmd classic openspec -- list --json`：只列出 `retire-obsolete-workflow-proposals`，三个旧提案均未列为活动 Change。
- `git diff --check 4777902` 与暂存区差异检查：通过。
- Prettier 检查新增处置索引、本次 proposal/tasks/交接摘要、计划和两份报告：通过。已批准 design.md 保留接受时的原始表格空白，不再运行格式写入。
- 处置索引内 3 个相对链接全部指向存在的文件；3 条 `git show 37c04f4:openspec/changes/<name>/proposal.md` 示例均已实际读取成功。
- 对比 20 个删除文件在 `37c04f4` 与整理前 `4777902` 的 Git blob：全部一致，原始文档完整保留于历史。原任务均未勾选，分别为 10、8、8 项。
- 以 `47779021e06418b7edbdd57f44922e65f7933522` 为基线核对改动边界：只涉及本次规划/状态、处置索引、验证报告与三个旧目录删除。产品源码、主规格和既有验证报告均无变化。
- 盘点旧提案名称引用：当前说明使用处置索引；既有团队 Skill 组合验证报告中的两条历史叙述保留原样，并从索引说明其时间背景。

## 独立审查

独立审查者 `housekeeping_independent_review` 核对了当前实际差异、文档依据及原始历史，结论为无 CRITICAL/IMPORTANT 或其他阻断项。审查确认当前配置只接受 guidance/augmentation-replacement、consumed 不证明方法遵循、TDD Evidence ID 目前的结构校验边界，以及固定 Comet Classic 的真实执行要求。

Build 分段与 Verify 最终集成复用同一次有效审查；审查者已增量复核本报告、报告入口和任务完成记录，无阻断项，没有新的产品实现。

## 已处理的检查拦截

初次提交 Build 完成时，Runtime 拒绝了批准后由 Prettier 改动表格空白的 design.md。该次尚未执行 Build Check，没有有效检查被记为通过。已通过 Git 恢复至 `afe8f06` 中接受的 Design 原文，并提交 `16c8163`；未改变设计语义、修改 Runtime Store 或重建 Run。后续完整 Build/Verify 检查以修正后输入执行。

## 验证边界

原文档验证阶段没有执行 Runtime 全量测试、重打安装包、多仓发布实验或 Release。交付阶段发现分发门禁要求后，补充了下面的实包检查。变更仅整理文档，采用已批准的 direct 模式，不制造 RED/GREEN。本次不声称已实现 TDD 命令 Evidence 核验，也不承诺独立团队检查 Work 的交付时间。

Comet 固定参考为 `35c9860b77b42bafa0c2d80d8d695889f888a924`（0.5.1），本次未升级或引入其源码。

## 交付阶段的分发门禁补充

原文档验证遗漏了 `docs/` 会进入 CLI 包的影响。本地执行 `npm.cmd run check:managed-execution-report` 已复现：旧报告不能覆盖新增的 `docs/workflow-follow-ups.md`。本节补齐实际包证据，不修改已封存归档、旧报告或检查器，不重建已完成 Run。

Tested implementation commit: `25923738094b0e6e15b08e17764b3376b99416cd`

Package content SHA-256: `ce93b4e676a2331a9191599c531f6a94b27c8a0cec70372ee58d2af051ae3cfe`

Package files: `489`

Package content bytes: `6624985`

在该提交实际执行 `npm.cmd ci --ignore-scripts --no-audit --no-fund`、`npm.cmd run build` 和 `npm.cmd pack --json --ignore-scripts`，以项目 `packageContentDigest` 计算上述内容摘要。在独立临时目录安装该 `.tgz` 后，安装所得 `bin/repoctopus.js --help` 退出码为 0；包内处置索引与源码文件 SHA-256 一致。

通过 Git 对比，该提交相对于此前完成真实多仓验收的 `8163338d3916981c5982f8c37f1690ad541d205d`，产品代码、脚本、技能、依赖和锁文件均未变化。原报告的实包为 488 个文件、6621674 字节；本包仅增加 1 份 3311 字节的处置索引。原文档校验和独立审查覆盖该索引；本节不宣称重新执行了多仓工作流实验。后续只补证据文档，交付结论仍须实际 CI 检查通过。

补充上述证据后，实际运行 `npm.cmd run check:managed-execution-report` 退出码为 0，检查器选择本报告并重打包核对得到相同内容摘要。没有修改门禁规则。
