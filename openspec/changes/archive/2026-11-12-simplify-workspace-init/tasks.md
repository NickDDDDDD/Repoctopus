# Tasks

## 1. 单仓入口与最小接入

- [x] 1.1 交付个人级 Init Skill、公开的接入调用和选择入口。验收：从仅安装发布候选包的 Codex 和 OpenCode 新项目原生调用，单仓各显示一个真实接入计划。 <!-- comet-task:221ece0e-1c4e-46fd-b406-ee6a61837f96 -->
- [x] 1.2 分离仓库与 Store 接入和 Verify 配置。验收：没有构建文件、测试命令或 Profile 的 Git 根可以获批接入，生成可启动 Run 的配置、OpenSpec Store 与受管入口。 <!-- comet-task:e3f222c2-b3f5-4982-8656-2173ee2bc362 -->
- [x] 1.3 保护接入审批与可恢复写入。验收：拒绝或输入变化时不改正式配置，中断从原请求恢复，已有团队内容和 Profile 保留。 <!-- comet-task:3d692f8f-c039-4200-91d0-3a2305f4c2bc -->

## 2. 多仓与错误诊断

- [x] 2.1 实现同级多仓选择与 Git 根核对。验收：仅选中仓进入实际接入计划，业务仓普通子目录和未包含 Workspace 根的扫描在审批前得到可操作诊断。 <!-- comet-task:0a7c2aea-90c2-4794-ac35-a39465562523 -->
- [x] 2.2 区分草稿、候选、缺失 Store binding 和不同 checkout。验收：复现 #85、#86 的路径、错传文件和绑定错误，检查输出指向正确恢复操作，验证 PowerShell 带空格路径。 <!-- comet-task:832f3936-d3e2-4661-b490-d57f755dae98 -->

## 3. 按需配置与同一 Run 验证

- [x] 3.1 交付独立 Verify 配置 Skill。验收：用户看到从真实仓库确认的命令、范围和覆盖，拒绝保持配置不变，批准仅更新目标 Profile，optional-only 覆盖被拒。 <!-- comet-task:16258cfc-0213-4eb5-a612-0d697cf1288b -->
- [x] 3.2 接入没有 Profile 的开发与验证等待。验收：同一 Run 经过 Open、Design、Build，保留 Acceptance Set 和 Build Check，缺少 Profile 时得到可恢复入口且 Archive 被拦截。已有无效 Profile 仍按原规则在 Design 报错。 <!-- comet-task:6a8b8234-a771-4429-bca1-26e4075ce0e5 -->
- [x] 3.3 实现并验证配置后恢复。验收：从新进程恢复同一 Run，补配及正常提交共享配置后保留仍有效的工作包和审批，通过真实 Verify 与 Archive；实际代码、仓库或规划变化按现有分类生效。 <!-- comet-task:a119dec8-ae7c-4372-bf7c-5bd012660419 -->

## 4. Windows 安装包验收

- [x] 4.1 更新安装说明和生成的本地引导。验收：新人从发布候选包和独立单仓或多仓项目能完成对应流程，验收记录包含宿主实际装填、Run 状态和证据身份。 <!-- comet-task:4f06016a-649f-472b-8adf-3c356f795088 -->
