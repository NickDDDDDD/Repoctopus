# 设计

## Context

OpenSpec 在返回健康 Store 根前解析实际目录。Repoctopus 的规格读取使用 `path.resolve` 比较字符串，接入登记使用另一套字符串比较，项目探测则将真实 Git 路径与输入的 Workspace 路径匹配。Windows 短路径可使同一个 checkout 在这些边界得到不同结论。

首轮发布在 `spec inspect` 处误报 `registered to a different checkout`。本地用真实 Store 证明，实际路径访问成功，指向同一目录的 Windows junction 重现相同诊断。

## Goals / Non-Goals

**目标**

- 在项目接入与规格读取中使用一致的实际目录身份。
- 证明 Windows 包能通过现有发布验收，同时保留另一个 checkout 和失效登记的拒绝行为。

**非目标**

- 不修改配置、注册表或持久 Run 的格式，不扩大 Store 权限。
- 不调整工作流阶段、交付策略、遥测契约或 Release 的验证门禁。

## Decisions

在平台适配层复用 Node.js 的真实路径解析。OpenSpec 自身在根解析与登记冲突检查中区分路径字符串和实际目录。Comet Classic 用真实路径检查命令调用边界，Workspace 身份在 Windows 上使用原生真实路径解析。本次采用该行为原则，保持 Repoctopus 的多仓和显式 Store 契约。

项目探测的 Workspace 匹配、Store 登记的身份核验、Specification Provider 的 Store 根检查使用同一种实际目录判断。Engine、Cordis Service 和领域规则仍通过现有接口工作。保留 Store ID、健康根、metadata 和已批准接入流程的核对。对失效登记保留诊断所需原路径，不能把无法解析的路径当作同一 checkout 的证明。

备选做法是只修改 CI 临时路径。它能规避该测试目录的路径差异，但用户通过 Windows 短路径或目录别名访问时仍会遇到同样的问题。单纯折叠 Windows 大小写也无法处理这两种别名。

## Risks / Trade-offs

- 仅在已有 checkout 的身份判断使用实际路径。不同目录仍是冲突。涉及权限的路径无法核验时停止，沿用现有错误和恢复流程。
- 核对项目接入的批准快照和已有登记在 alias 与实际路径交替调用时的表现。遇到规格、接口契约或其他权威资料冲突时先停止并报告。
- 测试以真实 CLI 和真实 OpenSpec registry 覆盖别名、另一份 checkout、无法解析路径及正常接入路径。以新的精确 `main` 提交执行 Windows Prepare，公开后验证固定 URL 和 `npx`。记录在正式验证报告和 Actions Evidence 中。
