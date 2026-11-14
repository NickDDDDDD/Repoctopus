# 对齐 Workspace 初始化引导

## Why

已发布的 v0.1.2 可以通过轻量 Init 接入项目、安装宿主 Skill、单独配置 Verify，并向 SigNoz 提供工作流健康数据。用该安装包完成多仓初始化后，生成的 Workspace 文档仍混有旧入口，遗漏 Skill 管理记录和看板导入说明。只看 Workspace 文档的成员容易走回底层命令，或将必须一起提交的文件留在本机。

## What Changes

- 对齐仓库 README、安装和接入指南、Skill 与遥测文档，以及初始化生成的 Workspace README、AGENTS 和本地教程。
- 让首次接入走 `repoctopus-init`，成员加入时复用团队配置并登记本机 Store，已有 Workspace 可单独补装宿主。说明如何通过新的获批请求刷新旧引导。
- 为所选宿主说明入口、阶段和方法 Skill 的实际安装范围与 Git 提交清单。Change 默认从 Workspace 的 `repoctopus` Skill 启动或恢复，说明审批、当前 Action 的 Skill 装填、Verify 补配及 Git 交付。
- 补齐团队 SigNoz 默认工作流日志、按需诊断和四项健康指标看板的导入路径，并说明 Windows Dashboard 的用途。
- 使用实际候选安装包验证新建单仓、多仓及旧 Workspace 引导升级。

## Capabilities

### Modified Capabilities

- `project-configuration` 的本地引导契约补充当前接入和工作流入口、受管文件提交清单，以及 SigNoz 看板获取方式。

## Impact

涉及初始化模板、相关公开文档及消费者验收。沿用现有接入审批、成员 Store 登记、Skill 安装、Runtime、Verify 和遥测协议。现有团队内容由受管区块更新机制保护。当前发布资产与版本号由单独的 Release 流程管理。
