# Tasks

## 1. 项目级入口

- [x] 1.1 复用现有受管计划和写入机制增加宿主选择。验收：分别选择三个新增宿主时输出准确路径，仅批准目标被安装。 <!-- comet-task:9c21fdc5-dff9-4a5e-966c-853e18d6ec75 -->
- [x] 1.2 支持已有 Workspace 选择性补装和恢复。验收：保留现有配置、Store、Run 与其他 Skill，同名冲突可定位，部分写入后原请求可重试。 <!-- comet-task:7165e11b-3aa6-42ce-ad61-bca8a540d0e6 -->
- [x] 1.3 验证基础项目级入口。验收：在 Windows CodeBuddy、CodeArts 码道和 TRAE 的新会话中观察发现、显式装填和至少一次真实 Runtime continuation。记录实际宿主版本、启用或重载条件。 <!-- comet-task:887897a4-70b2-4e21-915e-00111b7f94a5 -->

## 2. 首次 Init 和 Verify 配置

- [x] 2.1 基于已合入的轻量初始化扩展个人级 Init 和项目级 Verify 配置的安装映射。验收：三宿主安装预览正确，未接入项目可实际调用 Init，接入后可调用 Verify 配置。 <!-- comet-task:6e9bba1f-5a7c-4946-8b8e-c2767303b741 -->
- [x] 2.2 补齐宿主文档并执行发布候选包验收。验收：真实宿主记录涵盖三种新增宿主和 Codex/OpenCode 回归，区分已写入、已发现、已启用和实际执行。 <!-- comet-task:9c4a65ca-e29f-45bc-9b07-478dcee28cd8 -->
