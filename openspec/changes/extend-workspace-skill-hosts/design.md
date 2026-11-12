# Design

## Context

`simplify-workspace-init` 已合入 `main`（`3d756be`）。现有资产包含个人级 `repoctopus-init`，以及 Workspace 级 `repoctopus` 和 `repoctopus-configure-verify`。安装服务对 Codex 和 OpenCode 共用正文、所有权摘要、目标校验与原子写入。

已有 Workspace 当前通过项目接入流程补齐入口。该流程同时处理 Store、业务仓 pointer 和 Workspace 引导文件。新增宿主需要支持单独补装，因此安装审批应能只授权这批入口文件。

## Goals / Non-Goals

- 用户能在 CodeBuddy、CodeArts 码道和 TRAE 里用原生机制调用这三个 Repoctopus 入口。Windows 优先。
- 未接入项目先安装个人 Init，已有 Workspace 可以获批补装所选宿主。
- 保持公共 Runtime 续行和真人审批协议。范围限于入口 Skill、安装和验证，宿主的阶段 Action 继续由 Runtime 派发。

## Approaches

现有安装器可以扩展目录映射后继续用完整接入流程补装，代码改动少，但会进入 Store 和引导文档处理。候选方案将目录映射收拢到同一个安装服务，为已接入 Workspace 增加仅安装入口的请求。它复用已有的审批、重验和写入逻辑，同时让补装的副作用可以从请求中直接核对。

## Decisions

### 1. 宿主与作用域

沿用 Comet 0.5.1 分开定义项目、个人路径的方式。Repoctopus 保留当前 Codex 和 OpenCode 的默认 Workspace 安装。新增宿主均由 `--entry-hosts` 显式选择，重复选择归并到唯一目标文件。安装预览按真实目标展示，使用共享的三份 Skill 正文。个人级继续使用现有 `skill install-init --entry-hosts <host>`，支持预览。所有目标通过现有的作用域边界和文件所有权检查。

| 宿主 | Workspace 路径依据 | 个人 Init 路径依据 | 原生验收入口 |
| --- | --- | --- | --- |
| CodeBuddy | `.codebuddy/skills` | 官方 CodeBuddy Code 使用 `~/.codebuddy/skills`，IDE 用户级目录在实测后记录 | 从官方 npm 包在实验目录安装 CodeBuddy Code，核对 `/skills`、显式调用与实际 CLI 输出。验证 IDE 支持时记录 IDE 版本与行为 |
| CodeArts 码道 | `.codeartsdoer/skills` | `~/.codeartsdoer/skills` | 本机 CodeArts Agent 26.9.901 的 IDE 智能体模式，核对技能列表、启用状态和显式调用 |
| TRAE 国际版 | 候选 `.trae/skills`，参考 Comet 0.5.1 | 候选 `~/.trae/skills`，参考 Comet 0.5.1 | 本机 TRAE 3.5.55，验证实际扫描目录及原生调用 |
| TRAE 中国版 | 官方文档为 `.trae/skills` | 官方文档为 `~/.trae-cn/skills` | 本机 TRAE CN 3.3.72，验证与 Comet 中国版项目目录映射不同的情况 |

暂用 `codebuddy`、`codearts`、`trae`、`trae-cn` 作为选择值。两个 TRAE 发行版分别选择个人目录。在实测共用项目目录时，同一 Workspace 只写一套项目入口。若宿主版本与文档不一致，先取得实际发现证据，再确定对应发行版的映射。CodeArts 如需启用项目 Skill，由宿主的技能设置操作并记录，Repoctopus 的安装请求只授权受管 Skill 文件。遇到更高优先级同名 Skill 时，记录实际加载来源与可用的宿主处理方式。

[Comet 0.5.1 安装映射](https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/platform/install/platforms.ts) · [CodeBuddy IDE](https://www.codebuddy.ai/docs/ide/Features/Skills) · [CodeBuddy Code](https://www.codebuddy.cn/docs/cli/skills) · [CodeArts 码道](https://support.huaweicloud.com/usermanual-codeartsagent/codeartsagent_ug_0024.html) · [TRAE 中国版](https://docs.trae.cn/ide_skills?lang=zh)

### 2. 已接入 Workspace 补装

拟使用 `repoctopus project install-entry-skills --entry-hosts <host> --json`。运行时确认当前目录是已接入的 Workspace Git 根，从已有配置读取基线，生成选定项目级入口的审批请求。请求沿用 `project decision` 与 `project review`，并以现有 HumanDecisionRequest 摘要绑定补装作用域、Workspace 根、当前配置摘要、目标路径及 before/content 摘要。申请的配置基线和候选一致。审批回传由宿主收集，终端可处理同一请求。

复用现有请求状态与原子写入。在批准前显示路径和冲突，拒绝不写入入口。批准后重新核对根、配置基线、写入目标与当前文件，并先持久化 `applying`。继续同一请求时允许已落盘的获批文件，拒绝被替换、被移动或出现未获批内容的目标。完成所有文件校验后记录 `confirmed`。请求生成与回传校验使用同一补装摘要，补装、Verify Profile 更新和完整 Store 接入的作用域互斥。该分支的写入范围为本机请求记录与所选 Workspace Skill，保留配置、Store、业务仓 pointer、引导文件、其他 Skill 和现有 Run。首次接入继续使用原事务。

补装本身不改写 Run、工作包或证据。新 Skill 文件参与正常 Git 输入观察，冻结的 Evidence 和续行按现有漂移规则核对。验证中覆盖活动 Run 补装后的同一 Run ID，以及有受保护输入变化时 Runtime 返回的实际恢复指令。

### 3. 公开入口与审批

三份 Skill 共用现有 Init、工作流续行和 Verify 配置协议。宿主负责调用它能发现的 Skill、收集真实用户决定和执行当前 Runtime Action。初始化说明与生成的 Workspace 引导列出选择值、补装命令及宿主需要的重载或启用步骤。Runtime 返回当前 Action Skill 的流程沿用已交付接口。

## 验证

- 先用回归测试覆盖新宿主项目、个人目标，默认 Codex/OpenCode 的原目标，以及同一目标只落盘一次。用批准、拒绝、同名、修改、越界和中断恢复用例覆盖选择性补装。比对已有配置、Store、业务仓和 Run 的实际文件。
- 安装固定候选包，在未接入的实验 Git 根调用个人 Init，记录原生 Skill 装填及 CLI 创建的实际接入请求。接入后分别调用 Workspace 入口和 Verify 配置，记录实际 Run ID、当前续行指令和配置审批请求。使用隔离的本地 Git 仓和无敏感信息的任务。
- Windows 最低原生验收覆盖 CodeBuddy Code CLI、CodeArts 码道 IDE、TRAE 国际版与中国版，分别记录版本、实际 Skill 来源、启用状态、显式装填及相应 CLI 结果。CodeBuddy IDE 按官方路径设计，发布说明只把有真实证据的客户端标为已验收。账号、同名覆盖或权限导致的阻塞记录为缺口，取得可用宿主后继续验证。单独回归 Codex 和 OpenCode。
- 固定实际安装包和产品提交，保存包内容身份与原生调用证据，完成完整 Verify。
