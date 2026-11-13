# Skills 接入与投影

Repoctopus 使用 DSH Skill Registry 解析 Skill，并通过 Cordis Provider 接入具体 Skill 来源。工作流只依赖唯一的 `ctx.skills` Service；团队生命周期组合另由共享配置显式声明，并在创建 Run 时冻结，不能由个人目录或调用参数改变。

## 在宿主中调用 Repoctopus

第一次接入时，先安装当前宿主的个人级 `repoctopus-init`。在已接入的 Workspace，使用审批过的 `repoctopus` 启动或续跑 Change，使用 `repoctopus-configure-verify` 单独配置验证。

| 宿主              | `--entry-hosts` | Workspace 目录         | 个人 Init 默认目录          |
| ----------------- | --------------- | ---------------------- | --------------------------- |
| Codex             | `codex`         | `.agents/skills`       | `~/.codex/skills`           |
| OpenCode          | `opencode`      | `.opencode/skills`     | `~/.config/opencode/skills` |
| CodeBuddy Code    | `codebuddy`     | `.codebuddy/skills`    | `~/.codebuddy/skills`       |
| CodeArts 码道 IDE | `codearts`      | `.codeartsdoer/skills` | `~/.codeartsdoer/skills`    |
| TRAE 国际版       | `trae`          | `.trae/skills`         | `~/.trae/skills`            |
| TRAE 中国版       | `trae-cn`       | `.trae/skills`         | `~/.trae-cn/skills`         |

个人安装支持预览。CodeBuddy Code 使用 `CODEBUDDY_CONFIG_DIR` 时，个人目录跟随该设置，仍须位于用户目录内。首次接入默认预览 Codex 和 OpenCode 的 Workspace 入口。用 `--entry-hosts` 选择实际需要的宿主。

获批的 Workspace 初始化与补装还会安装八个阶段 Action、Matt 的 `grilling`、`codebase-design`、`tdd`、`code-review`、`diagnosing-bugs`、`pr`，以及使用 OpenSpec 时的只读 `openspec-explore`。每个 Skill 的正文和资源位于所选宿主的 `skills/<name>/`。把接入或补装产生的 Skill 目录与同级的 `.repoctopus-workflow-skills/` 管理记录一起提交并推送，再开始 Change。其他成员拉取后即可使用同一套 Skill，也可通过补装增加团队尚未提交的宿主。升级走同一个补装命令，预览会报告被修改或占用的文件。

```powershell
repoctopus.cmd skill install-init --entry-hosts codebuddy --preview
repoctopus.cmd skill install-init --entry-hosts codebuddy
```

已有 Workspace 可以单独补装入口。下面以 CodeArts 码道为例，在 Workspace 根目录运行：

```powershell
$prepared = repoctopus.cmd project install-entry-skills --entry-hosts codearts --json | ConvertFrom-Json
repoctopus.cmd project review --request $prepared.result.file
```

审批只写入所选宿主的 Workspace Skill。按团队流程提交生成的入口，并在宿主里打开 Workspace 的新会话。CodeArts 码道使用智能体模式，在「技能与规则」核对目标 Skill 的启用状态。TRAE 可在「技能与命令」检查项目与全局技能。CodeBuddy Code 可用 `/skills` 核对发现情况。遇到同名 Skill 时，在宿主确认实际来源。

[CodeBuddy Code](https://www.codebuddy.cn/docs/cli/skills) · [CodeArts 码道](https://support.huaweicloud.com/usermanual-codeartsagent/codeartsagent_ug_0024.html) · [TRAE 中国版](https://docs.trae.cn/ide_skills?lang=zh)

通过宿主显式调用 `repoctopus`。启动时提供 Change ID 和目标分支，续跑时提供 Run ID。Runtime 为每个 Action 返回当前执行包，Host 领取执行权后读取正文和匹配的资源。人工批准和恢复沿同一 Run 处理。

## 查看有效 Skill

在项目 workspace 中运行：

```powershell
node bin/repoctopus.js skill list --workspace . --audience user --json
node bin/repoctopus.js skill get --workspace . --audience user --name tdd --json
```

`skill list` 返回当前目录下完成优先级裁决后的目录。`skill get` 返回正文和内容摘要；传入 `--run <run-id>` 时，Repoctopus 会把首次使用的 Skill 快照绑定到该 Run。

模型调用使用 `--audience model`。Provider 可以通过 `modelInvocable` 与 `userInvocable` 分别控制模型和用户是否能调用 Skill。内置 `teach` 只允许用户主动调用。

## Provider 优先级

同名 Skill 只保留优先级最高的定义。该规则用于目录发现，不等于同名 Skill 自动获得团队生命周期权限。

| 优先级 | 来源                         | 用途                         |
| -----: | ---------------------------- | ---------------------------- |
|    100 | `<workspace>/.agents/skills` | 项目为团队替换或新增 Skill   |
|    500 | `~/.agents/skills`           | 成员在本机替换 Skill         |
|    600 | Repoctopus 内置 Matt Skills  | 项目没有覆盖时使用的默认实现 |

数值越小，优先级越高。项目定义因此会覆盖个人定义和内置定义。Provider 负责发现与加载，Skill 消费方不识别 Provider 名称。

内置入口为 `grill-with-docs`、`codebase-design`、`tdd`、`diagnosing-bugs`、`code-review`、`pr` 和 `teach`。`grill-with-docs` 使用的 `grilling` 与 `domain-modeling` 也随固定上游快照提供。`to-spec` 与 `to-tickets` 仅作为方法采用的固定参考保存在 Provider roots 之外，不会出现在 Skill 目录或 IDE 投影中；Repoctopus 只通过版本化 Method Profile 使用其中已审核的规则，OpenSpec 仍是规格和任务的唯一结构权威。

Change lifecycle definition 为每个 Work kind 固定一个 action Skill、有序 augmentation Skills、独立 Method Profile、能力、side-effect class、写入范围、输出契约、Validator 和 checkpoint。Runtime 解析并冻结真实正文，把它们装入不可变执行包而不只记录名称；Method Profile 不经过 Skill Registry，也不能由调用方参数替换或伪装成 Skill。

## 团队生命周期组合

团队在受版本控制的 `repoctopus.yaml` 中声明 guidance 或显式 slot replacement：

```yaml
lifecycle:
  skillBindings:
    schemaVersion: 1
    bindings:
      - id: team-design-guidance
        target: specification.plan
        role: guidance
        skill: team-code-guidance
        order: 20
      - id: team-design-method
        target: specification.plan
        role: augmentation-replacement
        skill: team-codebase-design
        slot: design-method
        order: 10
```

`guidance` 在内置方法层之后追加只读团队方法；`augmentation-replacement` 只能替换 lifecycle definition 已公开的 slot。当前 slot 为 `open-method`、`design-method` 和 `verify-review`。Action 没有 slot，因此不能替换。未知 Work/slot、重复 binding、非模型可调用 Skill、个人来源、产物协议所有者或请求写入能力的团队 Skill 会在首个 claim 前 fail closed。

配置只保存逻辑 Skill 名，不保存 Provider 路径或模块。Skill 必须由团队批准的项目 Provider 解析；`.repoctopus/local.yaml` 与用户级 Skill 目录不能新增、删除或重排 binding。Runtime 将规范化层、Provider 内容/资源摘要和角色编译为 `EffectiveSkillComposition`，其摘要进入 Cordis composition、Run 和 Work input。恢复时内容漂移会阻止新 claim，不会静默切换方法。

| Work                         | 固定 Skill 组合                              |
| ---------------------------- | -------------------------------------------- |
| Open                         | `repoctopus-open-change + grilling`          |
| Design                       | `repoctopus-design-change + codebase-design` |
| Build Configure              | `repoctopus-build-configure`                 |
| Build Plan                   | `repoctopus-build-plan`                      |
| Build Execute，`tddMode=tdd` | `repoctopus-build-execute + tdd`             |
| Build Execute，`direct`      | `repoctopus-build-execute`                   |
| Build Check                  | `repoctopus-build-check + code-review`       |
| Verify                       | `repoctopus-verify-change + code-review`     |
| Archive close/publish        | `repoctopus-archive-change` / `pr`           |

Execution mode 是 Repoctopus action input，不是另一个 Skill。`subagent-driven-development` 要求 Host 具有 `subagent.dispatch.attested`，并为当前 package 返回结构化 delegation receipts；`autonomous` 禁止未声明的子调用。两种模式使用相同的 Runtime、Validator 和 Verify 边界，不依赖 Superpowers。

Runtime 在 change 开始时冻结并绑定有效组合身份，但只把当前 Work 的层装入上下文。资源随对应 Skill 层交付，在领取提交前完成校验并冻结。固定顺序为 Runtime contract → action Skill → Provider protocol → 内置 augmentation / replacement → team guidance → Method Profile → change inputs。Host 必须明确回报当前 packet 中真正读取的 Skill layer digest；Runtime 拒绝缺失、未知或旧层，只据此记录 `skill.consumed`。`consumed` 是有界回执，不证明 Agent 遵循了方法内容。

可验证本地装填的 CLI 宿主可在 `run work-claim` 加 `--skill-reference-host <host>`。成功领取时，符合条件的内置层只返回路径和摘要。用同一 Run、Runner、invocation、Host 和 packet 摘要调用 `run work-content --layer-index <index> --skill-reference-host <host>`，按顺序装填它返回的正文和资源。缺失、替换或修改的本地文件自动回退到冻结内容。没有使用该选项的宿主仍收到完整包。动态 OpenSpec Provider 指令和团队绑定按原组合交付。

内置 Method Profile Registry 以 `id + version + digest` 固定已审核规则；每条规则同时绑定上游 source digest、适用 phase、官方 artifact kind，以及 `context`、`deterministic-validator`、`review-rubric` 或 `human-decision` enforcement。上下文装配只输出这些 Repoctopus-owned 规则，不读取或注入原始 `to-spec`/`to-tickets` 正文。即使项目或用户目录定义同名 Skill，lifecycle definition validation 也会在 Work 创建前拒绝它。

## 提供项目 Skill

平铺的 `<name>.md` 只提供正文。若旧版 Run 已冻结平铺 Skill 的共享目录摘要，升级后可能提示组合变化。用该 Run 原绑定的 Runtime 和原 Workspace Skill 目录状态完成待处理工作后，再按 Runtime 提示接入新版本。需要随当前 Action 交付相对资源时，将正文放在 `<name>/SKILL.md`，资源放在同一 Skill 目录内。

在项目中创建 `.agents/skills/tdd/SKILL.md`：

```markdown
---
name: tdd
description: 团队的测试驱动开发方法
---

# TDD

先写一个能证明需求的失败测试，再写最少实现使其通过。
```

再次执行 `skill get`，返回的 Provider 应为 `project-user-files`。要让该 Skill 进入团队生命周期，还必须在 `lifecycle.skillBindings` 中显式引用；同名文件不能替换 Action。正在运行的 Run 已经绑定旧版本时，Repoctopus 在同一 runId 上判断兼容性：摘要相同才继续，不兼容内容漂移返回只读诊断。

## 投影到 IDE

Repoctopus 可以把相同的有效目录投影成 Codex 或 OpenCode 能发现的文件：

```powershell
node bin/repoctopus.js skill project --workspace . --target codex --json
node bin/repoctopus.js skill project --workspace . --target opencode --json
```

Codex 投影到 `.agents/skills`，OpenCode 投影到 `.opencode/skills`。Repoctopus 在 `.repoctopus/skill-projections/` 保存受管文件清单。重新投影前，它会验证原文件摘要；如果你直接修改受管文件，命令会停止并报告冲突，避免覆盖本地修改。

项目原生 `.agents/skills` 文件是团队维护的来源，Codex 直接读取它们，Repoctopus 不复制或接管这些文件。

## Teach 的本地状态

`teach` 产生的课程、笔记、任务和资源索引必须写入：

```text
.repoctopus/learning/<topic>/
```

项目初始化和 Skill 投影都会把 `.repoctopus/` 加入 workspace 的 `.gitignore`。该目录是 Runtime Store 边界，由 Run、Evidence 和 Skill Projection Store 自己管理，不进入产品源码 fingerprint。其他已登记 Host 输入即使被本机 Git ignore 隐藏，仍会进入独立 control-plane fingerprint；ignore 不是 Evidence 豁免机制。Run 只保存 Skill 名称、Provider 和摘要；OpenTelemetry 的允许列表不会导出 Skill 正文或学习文件路径。

如果团队希望把学习结论转为共享知识，请评审结论，再通过项目正常的文档路径提交。不要直接提交个人学习目录。
