# Tasks

## 1. 查询与诊断

- [x] 1.1 从现有生命周期与 Skill 组合服务生成只读预览。验收：每个 Work 的实际层、来源、角色、绑定和顺序可核对，Build Execute 明确区分 TDD 与 direct 的实际层。 <!-- comet-task:ce847853-95f1-4c27-8281-6db978b5b9e5 -->
- [x] 1.2 将现有配置和组合错误呈现在 CLI。验收：无效 YAML、未知 Work 或 slot、缺少或不允许使用的 Skill 返回非零退出，并指出待修复的配置字段、绑定或 Skill。 <!-- comet-task:23672af6-62de-4836-a639-355b27e4f73c -->
- [x] 1.3 提供终端与 JSON 命令。验收：在没有 Run 的 Workspace 成功查询，且不新增 Run、投影或 Skill 文件。结果仅包含预览元数据。 <!-- comet-task:675b22bf-ed28-40d6-aafa-571f19515c71 -->

## 2. Workspace 教程与验收

- [x] 2.1 在生成的 Workspace 教程及公开 Skill 文档中加入完整示例。验收：依次提供 Skill 正文、现有 YAML 绑定、预览命令和提交文件清单。现有受管引导刷新可交付新示例。 <!-- comet-task:e8f2b4c5-f0cf-4676-8291-9708c8778679 -->
- [x] 2.2 用候选安装包验证示例、失败诊断和与实际 Work 的一致性。验收：在隔离 Workspace 从无 Run 开始验证预览及其读写边界，比较真实领取的 Skill 层，并记录严格校验与项目验证结果。 <!-- comet-task:581be1ee-cb39-4071-a57d-081f426e1ac8 -->
