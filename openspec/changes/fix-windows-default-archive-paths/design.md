---
comet_change: fix-windows-default-archive-paths
role: technical-design
canonical_spec: openspec
---

# Windows 归档路径与跨实现恢复设计

状态：用户选择 B 并授权代理处理中间确认；本方案已依据该委托经正式 Comet Design Wait 记录 approved。执行采用 autonomous + TDD + thorough，产品实现与验收证据另行记录。

## Context

路径失败和范围见 proposal.md。真实多仓 Run 已完成 Build、Verify，在创建隔离 checkout 时因 Git for Windows 默认路径处理失败；没有规格关闭或发布结果。另一历史案例在归档后索引阶段失败，因此要覆盖 checkout 到发布的完整链路。

跨实现恢复暴露了已有契约的遗漏：组合权威可以采纳兼容实现，但 FileDeliveryProvider.assertPlanningApproval 仍把当前组合与冻结的 archive.planningCompositionDigest 作严格等值比较。PlanningSnapshot 没有这个字段；它记录的是 Archive prepare 当时的执行组合来源，不能替代人工审批语义。公开 preflight replacement 也不能改这个冻结字段。

历史定位：stabilize-runtime-continuation 的提交 2fb0da8 已尝试分离规划和组合，却留下上述比较。此前 CLI adoption 测试在 Open 后改变无状态遥测插件；部分 Archive 纵切又 mock 掉 validateArchiveIntent，没有证明受保护 Delivery 实现在 Archive 中途更新后仍能发布。

## Goals / Non-Goals

**Goals:**

- 原失败 Run 使用修复包，经公开入口完成真实长路径归档与多仓发布。
- 由既有组合权威证明当前执行实现可接续，受保护副作用入口消费这一结论；冻结来源、审批、证据、Journal 和发布身份保持可核验。
- 用真实生产校验及冷恢复、漂移、故障注入矩阵证明闭环，避免只测试单个分类函数或投影。

**Non-Goals:**

- 不修改五阶段生命周期，不新增 adoption 状态机、持久 Receipt、迁移工具或通用历史版本兼容。
- 不修改用户 Git/系统持久配置，不移动或缩短 checkout，不改写 check policy 精确 argv，不接管 hooks 或外部工具。
- 不削弱规划、仓库、OID、证据、允许路径及结果未知的检查，不用新 Run 替代原 Run 的恢复验收。

## Decisions

### 1. 按 Comet 的真实边界借鉴，明确本项目适配责任

固定基线为 35c9860b77b42bafa0c2d80d8d695889f888a924。

- platform/process/git.ts：集中 Git 执行，未自动开启长路径；native-portable-archive 测试显式启用 core.longpaths。只借鉴执行边界，Windows 默认支持由本次真实验证负责。
- domains/engine/runtime-action.ts：保持 Action 原输入、attempt、claim 与 Outcome 绑定。
- domains/comet-classic/classic-sdk-archive-preflight.ts：发布前核对 Run、原审批、绑定分支、检查 argv、环境及实际输入证据，而非以执行器完全未变化代替这些事实。

Comet Classic 没有本项目的 Cordis 组合等值门槛。我们复用其身份分离和副作用前复核思路，使用已有 compareCompositions 与 Coordinator 采纳协议适配 Cordis，不宣称移植了上游现成的 Cordis 升级方案。

### 2. 冻结来源与当前执行上下文分开

| 身份                                             | 职责                                    | 修复包接续时的处理                                        |
| ------------------------------------------------ | --------------------------------------- | --------------------------------------------------------- |
| Planning semantic 与可信 approval                | 证明范围和设计获批                      | 语义不变则保留原决定                                      |
| Verify Input、Gate、Bundle                       | 证明原业务输入已验证                    | 实际依赖不变则保留，继续核对原 evidenceCompositionDigest  |
| Archive input、publication checkpoint 与 Journal | 证明精确发布集合、OID、策略和已发生事实 | 保留原摘要与稳定身份                                      |
| 当前 Run composition                             | 证明当前实现能解释并执行既有事实        | 既有权威精确判断 same、compatible 或 migration_required   |
| 副作用调用的执行上下文                           | 绑定此次调用与受保护的最新 Run          | 在入口内从最新已采纳状态取得，不接受 Host 或 CLI 提供摘要 |

保留 archive.planningCompositionDigest 的持久字段及其原值，作为冻结时的执行来源记录；不改名迁移、不抹平旧来源、不将其替换为 current。它不再被用来要求当前执行实现与历史完全相同。

内部 Delivery Archive 端口使用明确的执行上下文命名，包含当前获准执行的组合身份；不复用 planningCompositionDigest 参数表达两个不同含义。这个上下文只在进程内传递，不增加 CLI 参数、Host Outcome 字段、持久协议或第二份权威状态。

### 3. 单一组合权威，完整覆盖 Archive 的真实执行依赖

继续由 WorkflowRunCoordinator 的 compareCompositions 和 prepareWritableComposition 做兼容判定及既有原子采纳，保留 composition.changed 审计事实。领域层不读取 Git、文件或 Cordis Context。

Archive 的依赖范围包含 Run/Lifecycle 权威以及实际规格关闭和发布端口拥有者，包括 specification-authority 与 delivery-state-write。不能把 Work capability 名称直接当成插件 authority 的完整映射：specification.close 的 specification.write 与 delivery.publish 的 git.publish，并不等于相应 Provider 的受保护 authority。关闭阶段已经使用受管 Git checkout，并会在同一冻结 Archive 接续发布，因此采纳前就要覆盖这些真实依赖。

只为本次直接基线中确实变化且受影响的实现登记唯一精确前驱；新 Git 适配纳入实际代码摘要。预计涉及 workflow-runs 与 delivery-file，以生产 catalog 和原包观察确认，不无差别更新其他插件。缺失/错误/多个前驱，配置、authority、schema 或当前 Work 契约不兼容时仍阻断；不增加通配版本或旧版执行分支。

未进入本次 Archive 真实依赖闭包的无关组件变化继续按既有规则处理；不为解决局部遗漏改为整包变化一律禁止。

### 4. 受保护入口把已采纳实现绑定到副作用

保留并加强现有 withArchiveEffectAuthority，不另建执行授权 Service 或持久 token：

1. 公开 Archive 入口先通过既有 Coordinator 恢复/采纳，再读取权威 Run。
2. 在现有 commitGuarded 边界核对 Run、phase、Work、epoch、冻结 Archive input 以及最新 Run composition 与当前执行组合一致。
3. 继续核对规划审批、仓库/OID、实际证据依赖和已有副作用状态。
4. 只有通过上述检查后，callback 才从最新状态构造本次执行上下文并调用关闭、业务发布或规格发布端口。
5. Delivery 继续核对实际 Provider 组合与收到的执行上下文一致，并核对原 Planning approval 和实时分支；不自行发明另一套兼容判定。

只读 validateArchiveIntent 也区分冻结来源和当前执行上下文，但不因只读检查通过就缓存写权限。每次真正副作用仍走受保护入口。非 Archive 的 checkpoint/prepare/publish 行为保留原契约，不借此次改动放宽通用 Delivery。

这不是简单删除等值检查：当前执行器与可信 Run 的一致性仍检查，只是不再把历史来源当成当前执行身份。缺少真实上下文、跨 Run、旧 Work、期间再次组合漂移或未获准采纳，都在副作用之前被拒绝。

不依赖扫描历史 trajectory 重新决定当前状态；现有已提交 Run 与采纳事实是恢复依据。并发执行者改变 composition 后，旧执行者不能凭手中旧视图写入。原 Journal 对结果未知的观察、采用、拒绝盲重试规则继续生效。

### 5. 局部 Git 进程级长路径支持

在平台新增受管 Archive Git 执行适配，Windows 使用命令级 -c core.longpaths=true 前缀，非 Windows 保持原 argv。复用 execute 的 execFile 调用，不拼 shell、不修改 process.env 或持久 Git 配置。保留 stdout/stderr 原文；NUL 路径由原调用者解析，不统一 trim。

完整接入 platform/git/specification-checkout.ts 与 platform/delivery/specification-publication.ts，包括直接 execute 的 diff、cached diff、ls-files、恢复检查、提交、push、观察和清理。保留 publication Git port 的故障注入和观察职责。

OpenSpec Provider 的关闭前 status 和 HEAD 观察保持原校验，隔离关闭继续使用官方 OpenSpec 与 Node 文件系统；真实全链路若发现归档范围内其他路径敏感调用，按同一适配补齐，不批量改写其规划或用户检查命令。

替代方案：持久 git config 污染宿主；全局修改 execute 改变检查契约；移动 checkout 增加位置与清理协议且不解决归档后的文件路径。均不采用。

参考：[Git 命令级配置](https://git-scm.com/docs/git)、[Git for Windows 长路径说明](https://gitforwindows.org/git-cannot-create-a-file-or-directory-with-a-long-path.html)。

### 6. 验证必须贯穿真实权威与副作用

- 跨实现 RED：在生产 Cordis 组合中冻结 Archive 来源 A，经合法直接前驱采纳到执行实现 B，然后调用真实 FileDeliveryProvider 规划校验和发布端口。先证明当前版本会在目标等值检查失败，再修复；不能 mock validateArchiveIntent、组合兼容判定、原审批或核心 publishArchive。
- 不兼容矩阵：受保护 Delivery 更新在 specification.close 和 delivery.publish 两种 checkpoint 均需核验；错误/多个前驱、配置/authority/schema 漂移都在首次 checkout 写入、commit、push 或 MR 前拒绝。
- 并发矩阵：观察后、受保护入口前再次改变组合，旧 callback 不执行；采纳或副作用完成后进程中断，冷恢复使用已提交事实，不重复采纳或外部发布。
- 允许在自动化测试边界替代 GitHub HTTP、凭据和时钟；真实 Git 仓、Planning approval、Run、兼容判定、Provider 校验及 Journal 不绕过。合成的 A/B catalog 夹具如实标注为契约回归，不能声称是真实旧包升级验收。
- Windows 路径 RED/GREEN：实际 checkout 目录边界，以及归档后完整文件路径超过 260 字符的真实 diff、add、commit、push 与清理；断言长度、索引内容和远端 OID。
- 配置/隔离：成功、失败、中断后 local/global/system Git 配置、父进程环境、系统原设置和调用者 HEAD/branch/index 不变；NUL 与空格路径、冻结 OID 和越权拒绝仍覆盖。CI 夹具可仅在夹具配置设置 false 抵消全局 true，但不能冒充真实默认设置验收。
- 原现场验收：保留已验证旧包与失败日志，安装从本次提交构建的新包，经公开 CLI 恢复原失败 Run；保持原 registry、Workspace、分支/OID、审批、工作包、Verify Input/Gate/Bundle 和冻结 Archive input，不手改 Store。完成真实规格关闭和既定完整 MR 集合，冷进程交替 resume/next 后保持终态和副作用次数。
- 提交与 push 规则保持：Git OID 与插件源码/配置组合摘要是不同输入。测试区分只提交进度/报告引起的发布坐标变化和实际实现变化；不以延迟 push 规避合法漂移检查。
- 既有 OTel 记录关联原 Run/Work 与 composition.changed，核对未增加无原因的 phase 回退、审批或 Verify；不新增高基数路径字段或遥测 schema。过程与结果进入正式 Evidence/验证报告。

## Approaches

采用用户选择的 B：路径修复与 Archive 跨实现恢复在同一 Change 完成，原失败 Run 是最终验收对象。

不采用 A（仅修路径、另建 Run 验收）：它不能兑现本次已确认的原 Run 恢复目标。也不采用删除等值检查、重写冻结摘要、重复审批或扩大前驱集合的局部放行方案；它们无法证明当前执行授权。

不建立通用身份图、跨版本迁移框架或新的 adoption Receipt。已有权威和受保护入口足以表达本次边界，新增状态会形成第二套恢复职责。

## Risks / Trade-offs

- 同一实现下的重启测试无法证明跨实现恢复 → 同时覆盖真实生产契约回归与原旧包 Run 到新包的公开验证，报告分别列出证据。
- 当前 Work 的 capability 与 Provider authority 名称不同导致漏检 → 明确 Archive 实际端口依赖，在关闭和发布两个 checkpoint 做负例。
- 受保护入口之前通过的判断被并发变化破坏 → 在现有 Guard 内复核最新 composition；旧 callback 不能执行。
- 已有 mock 遮蔽真正校验 → 新验收不得替代核心校验，外部端口替代边界写入报告。
- Git hooks 或底层文件系统仍拒绝长路径 → 保留失败和原 Journal，不承诺支持任意外部工具，不静默修改系统设置。
- 修复中发现当前协议无法表达范围内事实 → 停止该步骤并更新正式设计，不临时添加旁路或直接编辑 Store。

## Migration Plan

不迁移持久格式，不增加双读或旧版运行分支。补丁通过既有唯一精确前驱协议接续指定直接基线；不兼容来源仍只读可检查并阻断写入。

保留旧包与原失败证据，在旁侧工具目录安装新包。旧 Run 的来源、已接受证据和发布 intent 不被覆盖；Runtime 只通过正常采纳协议更新当前执行组合。回退工具版本不意味着旧代码可解释新事实，使用前仍执行既有兼容判定；已发生远端事实不回滚。

## 本次授权与停止条件

用户已明确选择 B，并授权在当前 Change 处理两个问题。相应 Spec Patch 在本次 Design 内补充 Archive 执行组合与冻结来源分离的可观察契约，原路径与配置隔离要求保持，原 Run 验收不降级。正式技术方案与执行配置仍由当前 Design Wait 确认，不重建 Open 或追加其他设计文档。

规格、冻结输入、执行实现契约或实际结果与本设计冲突时停止依赖步骤；不得用新 Run、目录搬迁、全局配置、假定兼容或手改 Store 绕过。
