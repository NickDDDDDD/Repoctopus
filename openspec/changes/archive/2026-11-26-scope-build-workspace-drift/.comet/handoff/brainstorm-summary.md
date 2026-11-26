# 设计探索摘要

## 已确认

- 同一个 Change 修复 #114 和 #115，沿用原多仓 Runtime、OpenSpec 和 Comet Classic Run。#105 没有可辨识的现场日志，独立定位。
- 保留 checkout、包写权限和交付边界，覆盖真实安装包及中断恢复。Open 阶段四类产物已批准。

## 候选

- 扩展现有 Git 观察和受管进度提交，统一 Build 各入口。只按经过验证的包输入及依赖做局部失效。保留已绑定的历史完成与受管 OID。
- 工作包读取范围默认按现有 repo 声明和依赖，可信路径证明可进一步缩小。遇到未知范围、身份冲突或未结算效果时阻断，并保留原记录。
- 采用 Comet 的有前提恢复及检查范围与交付范围独立核对。Archive 依据远端 base/head、Git ancestry 和 Change 的受管实现核验新增历史及实际 PR 差异。外部提交未在目标分支且进入 PR 的情况阻断。
- 沿用当前 worktree。建议当前 Agent 实施、真实 RED/GREEN、独立 thorough 审查。具体 Git 边界与验收见同一 Change 的 `design.md`。现有 delta spec 延用 Open 批准版。
