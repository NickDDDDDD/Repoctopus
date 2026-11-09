---
comet_change: add-workspace-onboarding-guides
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-09-add-workspace-onboarding-guides
status: final
---

# Design

## Context

动机和边界见 `proposal.md`。当前接入经 `ProjectOnboarding` Cordis Service 调用平台层 `prepareProjectConfigurationDecision` / `applyProjectConfigurationDecision`。获批 apply 先完成 OpenSpec Root、Store、业务仓 pointer，再写共享配置与完成状态；重试通过原 request 及 Intent/Receipt 恢复，confirmed 请求直接返回原结果。

根 README 与 AGENTS 是宿主团队文件，不能复制产品仓的 README 或 Comet 自举规则。当前产品没有 `run list` 或 ambient resume probe；`run status`、`run resume`、`run next` 等都需要真实 Run 身份。共享 AGENTS 一旦被 Git 跟踪，仍按既有产品输入规则处理，不能借本次引导修改 Evidence 的排除策略。

## Goals / Non-Goals

**Goals:**

- 在既有可信接入边界提供最小的人机入口和完整本地教程。
- 支持多仓与单仓，保留已有说明、Agent 规则和用户编辑。
- 对受管区块、文件类型、受限路径和中断重试有明确行为，不引入新的状态机。
- 安装后的实际 CLI 能生成并使用这些文件，示例与当前公开命令一致。

**Non-Goals:**

- 不生成 IDE 专属 Skill 目录、CLAUDE/GEMINI 等平台文件或独立 Runner。
- 不新增文档更新命令、自动 Run 选择、后台恢复探针或文件驱动的权限。
- 不新增配置字段、遥测协议或 Registry；不迁移旧 Run/Store，不在此 Change 发版。

## Decisions

### 1. 两个短入口与一份本地教程

README 安装简短的 Workspace 说明、已批准仓库的相对关系及本地教程链接；AGENTS 安装可执行的工作流入口；`docs/repoctopus/workspace-guide.md` 保存人可阅读的完整教程。三者都有明确的 Repoctopus 受管区块，区块外可由团队维护。

相较将整份教程复制到两个根文件，这样不会膨胀已有业务 README 或 Agent 的默认上下文。相较只链接 GitHub，基础用法可以离线阅读。教程按安装、首次任务、新成员与恢复等用例组织，包含共享 `repoctopus.yaml`、本机 `.repoctopus/local.yaml`、Store 登记、可选 SigNoz `telemetry.endpoint`、凭据仅从环境提供及共享产物的 Git 提交范围。

渲染使用已批准的共享配置和包内维护的模板，动态内容限于可移植仓库 ID/相对路径及 Store 逻辑身份。禁止嵌入安装机器绝对路径、真实 Header/凭据和开发者身份。不把 v0.1.0 或本地 Release 地址固化到团队教程；要求使用团队指定版本，并给出公开发布入口和 CLI 可用性检查。

### 2. Agent 文件只引导到真实 Runtime

AGENTS 先指向本地教程及共享配置，区分用户给出的新建或恢复目标。已有 runId 时使用原 Run；身份不明时先核对，不通过解析 Store 私有文件猜阶段。领取 Work、消费 Skill 正文、提交 Outcome、处理 Human Decision、失败和未知副作用，均遵循公共 CLI 返回的 packet 与 continuation。

不在模板里复制五阶段合法转换表、硬编码 Skill 名单或替用户批准。用户显式选择其他工作流时保留其选择，不用新指令块压过既有明确授权。基础说明不依赖外部 IDE 会自动识别任意特定目录或斜杠命令。

### 3. 借鉴 Comet 的受管内容所有权，复用本地文件适配器

固定上游 Comet `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 `domains/skill/project-instructions.ts`、`managed-markdown.ts` 及对应测试，提供缺失时创建、存在时追加、仅替换自身区块、重复/残缺标记拒绝和换行保持的成熟思路。

本次在现有项目接入平台边界实现小型、可测试的受管 Markdown 渲染/合并与安装能力，文件提交继续使用 `platform/filesystem/atomic-write.ts` 的 containedRoot、exclusive 与提交前检查。保留区块外原始字节，不通过重排/格式化整份文件实现更新。三份目标及父目录在产生接入副作用前统一预检，写入前再次核对观察到的内容/身份，出现变化时停止而不覆盖；拒绝非普通文件与符号链接，不为此引入复杂 alias 兼容。

安装器分为纯渲染/区块合并与文件观察/提交两个部分：前者只接收批准后的逻辑配置和旧文本，后者保留每个目标的原始字节与文件身份。现有文件只替换区块所在的字节区间，缺少区块时追加，区块外混合换行或无结尾换行不能因整体规范化而变化；新文件使用一致的 UTF-8 文本格式。相同渲染结果不重新写文件。不存在的文件使用 exclusive 创建；现有文件在原子替换的提交前重新核对当前内容与身份。父目录预检只观察，实际创建目录交给 containedRoot 原子写入，不在 detect/prepare 或冲突预检时创建共享目录。

只借鉴实现思路时不增加来源登记；若实际复制或改编上游实现，采用现有 `third-party` 来源和许可证审计，不能把复制的文件伪装为原创。不导入 Comet SDK，不改变 Cordis 生命周期或 Service 依赖。

### 4. 插入既有接入事务，不建立第二本 journal

prepare 不生成共享引导。可信 review 的现有摘要说明三份文件的受管写入范围，不新增一轮人工审批。apply 在原批准与 candidate digest 验证后规划/预检引导，沿用原 Store binding Intent/Receipt 完成前置事实，再安装引导与 `.gitignore`，最后发布新 `repoctopus.yaml` 并确认请求。

具体边界仍在既有 `ProjectOnboarding` Service 后的项目接入平台层，不增加 Engine、Plugin 或配置入口。保持当前请求/响应 Schema：review 通过现有候选和固定输出约定说明受管文件范围，安装器不向项目共享配置塞入模板、绝对路径或 Loader 字段。固定输出和故障处理作为本版本接入行为的一部分，由同一可信批准控制。

部分引导成功后失败不删除任何已有文件；原 applying 请求重试时重新观察，已符合的区块不重复写，区块外新内容保留。写入完成且产物复核成功才能记录 confirmed。confirmed 重放仍返回已有结果，不利用升级包静默扩大旧批准的效果。

已接入团队更新后，以现有共享配置为候选重新走 detect → prepare → review；复用既有健康 Root/登记与 pointer，只补齐或刷新引导。无状态迁移，也不要求删配置或旧 Run。文档同其他共享产物一样由团队走 Git，不在初始化时自动 commit/push/MR。

### 5. 验收分层且保持真实交互边界

- 受管文件回归先给出真实 RED，再覆盖创建、追加、区块替换、幂等、CRLF/无结尾换行、重复/残缺区块、路径冲突与并发变化。
- 接入回归覆盖 detect/prepare/reject/request_changes 无共享文件写入、多仓与单仓、引导失败不确认/不提前发布新配置、同一请求中断恢复及 confirmed 幂等。
- 文档内容按 docs-writing 与 agents-md 的可执行命令、短入口、按需展开原则审查。相对链接实际解析；仅检查字面字符串不足以证明命令可运行。
- 公共 CLI 与候选 tarball 独立安装验收覆盖实际 detect/prepare/review、生成引导及后续启动/状态/新进程恢复；`project review` 目前要求真实交互终端，因此交互批准部分使用真实 PTY，并保留命令、退出码和结果证据。不得通过伪造 `isTTY`、新生产测试后门或导入源码 apply 来冒充安装包审批验收。
- 已用当前宿主的 Windows PTY 执行无副作用的 Node 探针，实际 `stdin.isTTY` 和 `stdout.isTTY` 均为 true。实施验收将使用同一终端能力运行已安装 CLI；该能力探针只证明真实交互路径可用，不代表接入或模板已通过验收。
- 覆盖新建多仓和已有说明的单仓；对原 README/AGENTS 的区块外内容做字节比较。测试使用隔离 Registry，清理临时消费者，不触及之前五仓实验的 Run。
- 无新增 OTel 埋点需求；保证现有接入与 Run 观测契约不变，文档说明现有 OTLP URL 配置，不修改字段名。

## Risks / Trade-offs

- 团队可能编辑受管区块 → 文件内说明更新范围，团队规则置于区块外；标记不完整时明确阻断。
- 三份引导不是跨文件原子事务 → 逐文件原子写入并沿原 request 恢复，完成状态最后保存；不承诺失败时回滚或删除团队文件。
- 教程随产品演进过期 → 模板属于发布包维护面，实际包验收执行示例；新获批接入更新受管内容，不靠开发者手工同步团队仓。
- 新 Agent 仅有文件仍可能不遵循 → 文件负责入口发现，安全和状态合法性继续由 Runtime 强制验证，不将提示词当成已执行 Skill 或成功证据。
- 现有 README/AGENTS/教程路径冲突 → 预检报具体文件和原因，不另选隐蔽路径或自动覆盖。
- 文件被不遵循本进程约定的外部工具持续写入 → 使用提交前文件身份与内容复核检测已观察到的变化，发生冲突时保留原请求并重试；不把现有原子替换原语描述为跨进程文件锁或跨文件事务。

## Migration Plan

无 schema 或状态迁移。新安装在获批接入中生成引导；已接入团队在新版本 CLI 上按前述现有审批入口补齐。回退包不会改写已提交文档，团队如需移除引导可通过正常 Git 评审移除 Repoctopus 受管区块；不提供破坏性清理脚本。
