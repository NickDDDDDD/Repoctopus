# Design

## Context

Release Prepare 已将构建出的 CLI tarball 传给安装和 npx 验收。现有多仓实验已验证过工作包恢复和发布响应丢失，实验依赖预先准备的仓库和本机路径。见 [Proposal](proposal.md)。

## Goals / Non-Goals

用指定的 `.tgz` 完成一条可重复的 Windows 多仓验收。单独执行和 Release Prepare 共用入口。验收范围聚焦消费后的 CLI、一个小 Change 和两个已知恢复边界。

## Decisions

- 以候选文件为输入。验收在临时消费目录安装 CLI，通过公开命令驱动流程。Release Prepare 将已产出的文件传给该入口，并以文件摘要核对验收与封存的对象。
- 使用独立 Git 仓与可控的托管服务。Workspace 保存规格与 Run，业务仓提供两个小工作包。首包完成后换进程，以公共 CLI 的观察结果核对计划、完成事实和 Run 身份。
- 在托管服务提交规格 PR 后中断第一次创建响应，并暂时隐藏该 PR 的查询结果。恢复可见性后继续原 Run。通过 Git 和 HTTP 请求记录核对真实远端效果及后续读取。
- 验收编排、Git 与 HTTP 观测位于测试侧。Engine 和 Cordis Service 通过已安装 CLI 的正常装配执行。当前设计以 CLI 状态、候选摘要与远端记录作为验收证据。

## Risks / Trade-offs

- Windows 路径和用户级 Git 配置可能使环境相关失败难以复现。临时路径与 Git 配置需独立于机器上已有的 Workspace。
- 丢弃响应前若没有真实创建 PR，实验只覆盖请求失败。验收需要确认托管服务先持久化创建，再校验查询和副作用次数。
- Release Prepare 的执行时长取决于安装和实际生命周期。Design 阶段核对现有预算、诊断产物和故障退出行为。
