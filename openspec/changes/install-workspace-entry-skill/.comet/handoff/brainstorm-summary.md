# Design 恢复检查点

- Change: install-workspace-entry-skill
- 状态: 候选，等待正式 Design 决定

## 已确认范围

入口随获批 Workspace 接入安装，宿主直接调用；Runtime 为同一 Run 选择当前 Action，宿主装填对应 Skill。

## 候选技术方案与验收

以 [design.md](../../design.md) 为准。批准绑定入口安装目标与内容，入口只装 Workspace；宿主加载公开 claim 返回的当前 Skill 正文与匹配资源。通过实际安装包、真实宿主、多仓项目和冷恢复验证。

## Spec Patch

无。方案沿用 Open 已批准范围。
