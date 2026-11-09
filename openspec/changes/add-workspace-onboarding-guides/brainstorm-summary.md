# 初始化引导需求摘要

## 目标

让安装发布包后完成接入的 Workspace 自带人和 Agent 均可使用的入口，团队无需取得 Repoctopus 源码即可开始和恢复受管开发。

## 已确认事实

- 用户已选择独立 Comet Classic change，调查、设计并修复此缺口。
- 用户已批准 Open 当前四类产物，Comet Guard 已将原 Run 推进到 Design；Design 方案与执行配置尚待本阶段确认。
- 当前获批 apply 负责 Root / Store / pointer、`repoctopus.yaml` 和 `.gitignore`，没有安装 Workspace 指南。
- 共享 README 和 Agent 指令必须保留团队自有内容；Workspace 既可独立于多仓业务仓，也可嵌入单仓。
- Runtime 是 Work、Skill 内容、阶段推进和审批的权威；引导文件不能代替其验证。
- 既有公开 CLI 没有 `run list` 或 Repoctopus ambient resume probe，不得在模板中虚构这些命令。

## 候选与建议

1. 直接复制产品 README / AGENTS：混入源码开发与 Comet 自举规则，且会覆盖宿主项目内容，不采用。
2. 把完整教程写入根 README 和 AGENTS：已有业务 README 容易膨胀，Agent 上下文重复，不推荐。
3. 根 README 短入口 + AGENTS 短执行规则 + Workspace 内一份教程：建议采用，受管区块可更新，人工和 Agent 的职责分开；最终以 Open 与 Design 审批为准。

## 非目标与范围

不增加新阶段、自动 Run 路由、IDE 专属文件、文档服务、Release 发布或第二套 spec/task。仅在现有可信接入批准边界写入本 Workspace 的引导；不改业务仓说明文件。沿用独立 worktree 隔离新 Change 与三个无关提案。

## 关键未知项与待设计核对

- 文档写入须与现有配置最后发布、同一 request 中断恢复顺序相容；confirmed 请求的原有幂等语义不扩大为隐式升级入口。
- 受管区块冲突、目录/符号链接及并发文件变化的诊断须在写入前规划，并使用现有受限原子写入能力。
- 新成员 Store 登记、实际公共 CLI 参数和本地相对链接须以当前代码与候选安装包核对。

## 验收场景草案

空白多仓 Workspace、已有 README/AGENTS 的单仓、拒绝/请求修改审批、相同请求重试与部分引导写入后重启、受管区块损坏、非普通文件或路径冲突、实际 tarball 独立安装后的初始化与启动/恢复说明。

## Design 复核结果

- 原 apply 的 confirmed 分支在写入之前返回；保持这个语义，已有项目补齐文档使用新的获批接入请求，不把包升级等同于旧授权扩大。
- 现有文件适配器提供 containedRoot、exclusive 与 beforeCommit，可以复用父目录身份校验及原子写入，不需要新的 journal、文件锁服务或状态迁移。
- 根 README 与 AGENTS 只留短入口，完整教程按需读取；包内模板、相对链接和公共 CLI 示例纳入实际消费验收。
- Windows 真实 PTY 探针成功，stdin/stdout 均为 TTY；交互式安装包 review 验收可执行，无需新增依赖或生产测试绕过。
- 无需 Spec Patch；任务仍为已批准的 5 项。候选执行配置为 autonomous + TDD + thorough，沿用已建立的 worktree，待 Design 决策时与方案一并确认。
