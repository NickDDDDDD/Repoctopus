# 工作流旧提案处置与后续目标

这份索引供维护者查询三个旧提案的处理结论。它们已从活动 Change 清单撤出；本次整理没有实现其尚未交付的能力，也没有把旧 delta specs 合入主规格。

## 处置结论

| 旧提案                             | 结论                                  | 当前能力与保留边界                                                                                                                                |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add-managed-team-required-checks` | 暂缓独立团队检查 Work，撤回旧实施计划 | 普通自动化命令检查使用已有 Verify Profile 的 required 节点。该能力不等于在任意阶段派发独立 Agent 检查 Work；后者有明确团队需求时再重新提案。      |
| `verify-open-intake-method`        | 取消通用 Method Receipt 方案          | 继续通过当前 Action Skill、规格校验和人工审查约束 Open。Skill 的 `consumed` 记录仅表明 Host 回报已读取相应层，不证明 Agent 理解需求或遵循了方法。 |
| `verify-tdd-method`                | 撤回旧方案，只保留下面的后续目标      | 已有 TDD 策略、完整行为切片和 RED/GREEN/回归 Evidence ID 的结构校验；尚未核验这些引用对应的真实命令执行。                                         |

团队 Skill 当前配置见 [Skill 说明](skills.md)，普通命令检查与有效 Evidence 规则见 [验证配置](evidence.md)。主规格与当前代码仍是已有行为的依据；这份索引不建立另一套规格或执行任务。

## 唯一保留的后续目标：TDD 真实执行核验

未来单独立项，复用现有命令 Evidence，核验 RED、GREEN 和回归引用是否属于当前 Run、Work 与工作包，是否绑定正确输入，以及结果和执行顺序是否符合要求。预期失败是否验证了目标行为，仍需 Host 与审查判断。

这个目标尚未实施或排期。重新立项时重新设计和审批，不继承旧提案的通用 Method Receipt 框架，也不恢复旧的 8 项任务清单。真实命令 Evidence 的存在与有效性核验，和自动证明 Agent 理解方法，是不同职责。

## 历史追溯

三份旧提案均来自提交 `37c04f4`（2026-10-31，`docs(spec): split team skill composition delivery`）。原目录中的 proposal、design、tasks 和 delta specs 均由 Git 历史保留。它们未被标记完成，也未移入表示已交付的普通 Archive。

在此仓库运行以下命令可读取原提案；同一目录的其他文件也可用相同方式读取：

```powershell
git show 37c04f4:openspec/changes/add-managed-team-required-checks/proposal.md
git show 37c04f4:openspec/changes/verify-open-intake-method/proposal.md
git show 37c04f4:openspec/changes/verify-tdd-method/proposal.md
```

早期的[团队 Skill 组合验证报告](../verification/add-auditable-team-skill-composition/verification-report.md)保留了当时拆分提案的说明。该报告是历史记录；上述处置表记录本次整理后的结论。
