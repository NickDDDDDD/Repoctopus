---
comet_change: simplify-workspace-init
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-12-simplify-workspace-init
status: final
---

# Design

## Context

接入逻辑当前把 Git/Store 探测、构建命令推断和共享配置审批放在一起。共享配置拒绝空 Profile，Design preflight 又默认编译 `verify`。Build Check 的当前接受路径在持久化通过事实前会先编译 Verify、冻结输入和准备下一份 Work。除此之外，完整有效配置摘要被放进 `delivery-file` 的组合配置，而 FileDeliveryProvider 实际没有消费这个字段。补加 Profile 因而还可能造成受保护组合被误判为变化。Git Build checkpoint 绑定精确仓库 HEAD，提交 Verify 配置也需要独立验证。

## Goals / Non-Goals

- 用户在尚未接入的项目显式调用一次 Init，通过宿主看见并决定同一份接入计划。单仓、同级多仓均可用。
- 首次接入只需 Git 仓库与 Store，已有团队配置可继续使用。Verify 配置按需执行。
- 在最小 Workspace 上完整开发并保留 Build 结果，缺 Profile 时从原 Run 恢复。正式交付仍以当前 Evidence Gate 为准。
- 本 Change 的宿主验收覆盖 Codex 和 OpenCode。CodeBuddy、CodeArts 和 TRAE 由另一个 Change 实现。保留 OpenSpec 规格权威和五阶段。手工证据交付留给独立需求。

## Decisions

### 1. 入口安装与一次宿主交互

将个人级 `repoctopus-init` 与项目级 `repoctopus`、`repoctopus-configure-verify` 作为安装包内的受管资产。安装指引提供一次显式的宿主选择和个人级 Init 安装。范围限定所选宿主的入口文件，安装目标预览及冲突处理复用受管资产规则。Workspace 接入仅计划项目级入口，由原接入请求批准后应用。Comet 0.5.1 的项目级与个人级安装分工解决同样的首次发现问题。

CLI 增加一个把最小探测和准备串联的 Init 入口，返回结构化计划与待决定请求。已有 `project detect/prepare/review` 仍供终端和调试使用，同一服务负责候选和请求；命令参数以实际 argv 传递。宿主显示仓库、Store、拟写入文件和影响，并通过与 `run decision` 类似的公开请求读取和 response-file 协议回传真实选择。共享请求解码方式，审批绑定具体请求、候选摘要、作用范围和本机调用身份。终端入口可处理同一请求，无法收集选择时保持待确认。配置变更、请求或 Workspace 身份不符时拒绝。批准后复用现有 Intent/Receipt；同一请求中断后可重试。

### 2. 最小候选由 Runtime 构造

单仓直接核对指定目录的真实 Git 根，多仓复用同级探测并限制到用户确认的仓库。布局可确定时只展示一个计划；不明确时列出真实可选仓库。普通业务仓子目录、未选中的 Workspace Git 根、重复仓库身份或不同 checkout，分别给出可操作诊断。探测草稿与共享候选继续用不同的 `kind`；误传完整探测草稿时输出候选位置和用法。

最小共享配置包括 Workspace、仓库、OpenSpec Store 和合法的空 `profiles`。项目探测读取 Git 与 Store 状态。已有 Profile 和其他团队字段从当前配置保留，初次接入无需推断构建命令。准备请求时验证探测所得 Store binding 必须存在且匹配；批准前再观察根和候选基线。Store Bootstrap、业务仓 pointer 和入口写入继续走原有事务。单纯补齐入口时复用已有健康 Store。

### 3. Verify Profile 有独立的作用域

已接入 Workspace 显式调用 Verify 配置 Skill，读取选定仓的构建和测试证据，核对实际执行命令和覆盖范围。编译检查依赖、必需节点和 coverage 结构，显示目标 Profile 前后差异。配置服务以当前共享配置为基线，只批准并写入目标 Profile，复用候选摘要、可信选择和原子写入。具有现有 Run 时，先提供该 Run 的 Acceptance 预检反馈。未命中的选择器、只有 optional 覆盖、请求漂移和候选越权都需明确诊断。用户完成批准并按团队 Git 流程提交后，通过原 Run 继续；此配置过程复用已接入 Store。

### 4. Build Check 完成和 Verify 准备使用两个 Runtime 观察

Comet 0.5.1 在 Build Check Evidence 后派发独立 Verify Action。借鉴这个顺序，复用 Repoctopus 已有的 Build checkpoint、Build Check Evidence 与 continuation。Build Check 在当前 invocation 和精确 checkout 上验证，先持久化接受、已完成工作包和原 checkpoint。随后通过 Runtime 观察准备当前 Verify 输入，现有 `build.verification-blocked`/准备验证入口可承载待配置状态，`build.validated` 仍在输入具备后进入 Verify。持久化通过事实、接受回执与可恢复状态时使用现有事务边界。Verify 计划具备的路径同一次 `next` 可继续派发。配置、重试、失败诊断的投影均由 Runtime 生成。

Design 冻结 Acceptance Set。已配置的选定 Profile 使用原有精确 coverage preflight；只在默认 Profile 尚未配置且用户未指定其他 Profile 时延期。Build 完成后，缺少 Profile 或当前 coverage 无法满足时保持可恢复，返回配置 Skill 指引。用户完成配置后，对当前 Profile 重新使用同一 coverage resolver，再创建 Verification Input、派发原有 Verify Work。已冻结的 Verify 与 Archive 仍走现有证据有效性规则。

### 5. 在原 Run 中核对哪些输入确实变化

- 当前 `loadChangePlanningBase` 读启动时的配置摘要，`EvidenceCoordinator` 则读取当前配置。原启动基线保留在 Run；冻结 Verify 时绑定实际编译的 Profile、Acceptance、仓库、当前相关配置及 Evidence fingerprint。在 Verify repair、归档和发布入口继续核对这一当前身份。
- `delivery-file` 当前将整个配置摘要计入保护组合身份，但实现从配置只消费工作区和 GitHub 凭据设置，并从操作参数读取实际交付策略。移除未被该适配器使用的全配置注入，实际消费的配置和归档输入仍参与相应身份。用 Profile、交付策略、凭据、插件配置分别变化的用例验证作用域。
- 对 Build Check 之后的正常配置提交，复用 Workspace binding 和恢复分类。继续前核对同一分支、worktree、仓库、Plan、Store、已接受 Check 与配置审批回执。只有能证明从已接受 HEAD 延续且变更限定于获批的 Verify Profile 时，接受新 HEAD 作为当前观察，保留历史 Check 与工作包。混有产品、规格、Store、隔离策略或不明变更时走原恢复分类。实际 checkout 授权和 Verify 声明的显式 Git 输入继续参与校验。
- 记录缺 Profile、配置获批、重观察和 Verify 派发的已有 trajectory/OTLP 事实。重复调用、并发和中断从存储事实恢复，避免重提 Build Check、重复发放审批或派发两个 Verify Work。

### 6. 验证路径

| 入口 | 必测事实 |
| --- | --- |
| 已打包 Windows CLI 与真实 Codex/OpenCode | 未接入时发现个人级 Skill。含空格路径的单仓和同级多仓在一次宿主交互完成。真实拒绝保持原状，认可后写入最小配置和项目入口。 |
| 接入负例 | 重放 #85/#86。错误 argv、错传草稿、普通子目录、缺 binding、已被登记的其他 checkout 有不同诊断。审批之前没有 Store 写入。 |
| 最小配置的真实多仓 Run | 公开 CLI 走到 Build Check，通过后退出进程。换进程读到同一待配置状态。批准真实 Profile、正常 commit/push，再换进程继续，仍有效的工作包和审批保持原身份。Verify 生成当前有效 Gate，真实 Archive 完成。 |
| 恢复与已有团队 | 覆盖并发或中断、无关配置与真实代码/branch/Store 漂移、已有有效 Profile 直通、已有 coverage 不足在 Design 阻断、无有效证据时拒绝 Archive。 |

## Risks / Trade-offs

- 采用延后验证配置，使用者可以开始开发，覆盖缺口必须在交付前解决。备选是强制开工前配置，接入会重新暴露当前阻塞。引入新的手工证据来源会扩大正式门禁范围。
- Profile 更新同时影响 Git 和配置身份。兼容性比较、Build workspace recovery 和 Evidence fingerprint 要各自复验，单纯用文件名、HEAD 相等或修改后的配置摘要都不足以判定。
- 老版配置已有 Profile 时沿用现有使用路径。当前产品版与候选版本间状态采纳沿用已有兼容性合同，只按真实先前状态和边界证明。实现方案与正式规格或公开宿主约束冲突时先回到 Design 核对。
