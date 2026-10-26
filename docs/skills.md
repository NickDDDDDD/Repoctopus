# Skills 接入与投影

Repoctopus 使用 DSH Skill Registry 解析 Skill，并通过 Cordis Provider 接入具体 Skill 来源。工作流只依赖唯一的 `ctx.skills` Service，因此你可以替换 TDD、诊断或评审方法，而不需要修改 Runtime 或 Workflow。

## 查看有效 Skill

在项目 workspace 中运行：

```powershell
node bin/repoctopus.js skill list --workspace . --audience user --json
node bin/repoctopus.js skill get --workspace . --audience user --name tdd --json
```

`skill list` 返回当前目录下完成优先级裁决后的目录。`skill get` 返回正文和内容摘要；传入 `--run <run-id>` 时，Repoctopus 会把首次使用的 Skill 快照绑定到该 Run。

模型调用使用 `--audience model`。Provider 可以通过 `modelInvocable` 与 `userInvocable` 分别控制模型和用户是否能调用 Skill。内置 `teach` 只允许用户主动调用。

## Provider 优先级

同名 Skill 只保留优先级最高的定义。

| 优先级 | 来源                         | 用途                         |
| -----: | ---------------------------- | ---------------------------- |
|    100 | `<workspace>/.agents/skills` | 项目为团队替换或新增 Skill   |
|    500 | `~/.agents/skills`           | 成员在本机替换 Skill         |
|    600 | Repoctopus 内置 Matt Skills  | 项目没有覆盖时使用的默认实现 |

数值越小，优先级越高。项目定义因此会覆盖个人定义和内置定义。Provider 负责发现与加载，Skill 消费方不识别 Provider 名称。

内置入口为 `grill-with-docs`、`codebase-design`、`tdd`、`diagnosing-bugs`、`code-review`、`pr` 和 `teach`。`grill-with-docs` 使用的 `grilling` 与 `domain-modeling` 也随固定上游快照提供。`to-spec` 与 `to-tickets` 仅作为方法采用的固定参考保存在 Provider roots 之外，不会出现在 Skill 目录或 IDE 投影中；Repoctopus 只通过版本化 Method Profile 使用其中已审核的规则，OpenSpec 仍是规格和任务的唯一结构权威。

Change lifecycle definition 为每个 Work kind 固定至多一个 action Skill、有序 augmentation Skills、独立 Method Profile、能力、side-effect class、写入范围、输出契约、Validator 和 checkpoint。Runtime 解析并冻结真实正文，把它们装入不可变执行包而不只记录名称；Method Profile 不经过 Skill Registry，也不能由调用方参数替换或伪装成 Skill。Open 使用 `repoctopus-open-change + grilling`，Design 使用 `repoctopus-design-change + codebase-design`，Build 只使用 `repoctopus-build-task + tdd`；Verify 使用 `repoctopus-verify-change + code-review`，Archive close/publish 分别使用 `repoctopus-archive-change` 与 `pr`。

Skill 在 Runtime 接受当前 Work 时装配，而不是在 change 开始时把所有 Skill 一次性塞进上下文。固定顺序为 Runtime contract → action Skill → Provider protocol → augmentations → Method Profile → change inputs。Host 必须明确回报真正读取的 action/augmentation layer digest；Runtime 只据此记录 `skill.consumed`，不会从 Work 成功反推所有 Skill 已被使用。

内置 Method Profile Registry 以 `id + version + digest` 固定已审核规则；每条规则同时绑定上游 source digest、适用 phase、官方 artifact kind，以及 `context`、`deterministic-validator`、`review-rubric` 或 `human-decision` enforcement。上下文装配只输出这些 Repoctopus-owned 规则，不读取或注入原始 `to-spec`/`to-tickets` 正文。即使项目或用户目录定义同名 Skill，lifecycle definition validation 也会在 Work 创建前拒绝它。

## 替换 Skill

在项目中创建 `.agents/skills/tdd/SKILL.md`：

```markdown
---
name: tdd
description: 团队的测试驱动开发方法
---

# TDD

先写一个能证明需求的失败测试，再写最少实现使其通过。
```

再次执行 `skill get`，返回的 Provider 应为 `project-user-files`。正在运行的 Run 已经绑定旧版本时，Repoctopus 在同一 runId 上判断兼容性：可兼容则重新领取当前 Work，不可证明兼容则返回只读 `migration_required`；未被该 Run 使用的 Skill 变化不会阻塞推进。

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

项目初始化和 Skill 投影都会把 `.repoctopus/` 加入 workspace 的 `.gitignore`。Git Evidence 使用 Git 的忽略规则选择输入，因此不会把个人学习文件放入待提交集合或 Evidence 指纹。Run 只保存 Skill 名称、Provider 和摘要；OpenTelemetry 的允许列表不会导出 Skill 正文或学习文件路径。

如果团队希望把学习结论转为共享知识，请评审结论，再通过项目正常的文档路径提交。不要直接提交个人学习目录。
