---
change: preview-team-skill-bindings
design-doc: openspec/changes/preview-team-skill-bindings/design.md
base-ref: eebf1ce
---

# 团队 Skill 预览实施计划

<!-- comet-task-authority: openspec/changes/preview-team-skill-bindings/tasks.md -->

## 组合、诊断与命令

<!-- comet-task-ref:ce847853-95f1-4c27-8281-6db978b5b9e5 -->
<!-- comet-task-ref:23672af6-62de-4836-a639-355b27e4f73c -->
<!-- comet-task-ref:675b22bf-ed28-40d6-aafa-571f19515c71 -->

先用真实 CLI 复现缺少预览命令。查询装配与项目运行共用 Provider 选择，查询只加载需要的内置服务。复用组合编译和 Build 方法层计算，按定义顺序提供 Work 元数据。使用现有错误协议，检查无效输入和读写边界。

## 教程

<!-- comet-task-ref:e8f2b4c5-f0cf-4676-8291-9708c8778679 -->

为生成的 Workspace 教程和公开 Skill 文档补上可按步骤执行的示例。核对示例与实际命令、目录和共享文件一致。

## 安装包验收

<!-- comet-task-ref:581be1ee-cb39-4071-a57d-081f426e1ac8 -->

安装同一候选包，验证新 Workspace 预览、配置失败及实际 Work 派发。对比预览前后的项目和 Run 状态，执行独立审查与完整项目门禁并记录候选包身份。
