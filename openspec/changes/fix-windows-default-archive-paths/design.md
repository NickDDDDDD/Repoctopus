# Windows 受管规格归档长路径设计

状态：Design 候选。Open 已批准；独立设计复核发现原 Run 跨实现恢复存在另一层阻断，下述验收调整与 Spec Patch 尚待用户决定，尚未修改 delta spec 或进入 Build。

## Context

动机及范围见 `proposal.md`，行为约束见 `specs/delivery-governance/spec.md`。真实失败位于 `GitSpecificationCheckoutManager.create` 的 `git worktree add --detach`，早于规格关闭和任何 MR 发布；此前另有长路径在规格索引阶段失败的记录。因此只处理首次 checkout 错误不能构成完整修复。

现有平台 checkout 和 publication 各自封装 Git，publication 内还有直接执行 Git 的 NUL 分隔路径读取。它们都经过通用进程执行器，但没有局部平台路径策略。规格提交依赖原冻结 OID、Closure changedFiles 及 Publication Journal，路径修复不需要改变这些身份。

固定 Comet 基线 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 `platform/process/git.ts` 展示了统一 Git 执行边界，但没有自动长路径支持；`test/domains/comet-native/native-portable-archive.test.ts` 的长路径测试显式设置 `core.longpaths=true`。本次借鉴边界，不宣称照搬一个不存在的默认配置修复。

独立设计复核发现，唯一精确前驱声明虽能让 Coordinator 采纳修复后的组合，`FileDeliveryProvider.assertPlanningApproval` 仍直接比较当前组合与冻结的 `archive.planningCompositionDigest`，导致后续发布阻断。该字段实际捕获 Archive prepare 时的 Run 组合，并不是人工 Design 审批的内容身份；PlanningSnapshot 不含此字段。公开 `archive-prepare` 的 replacement 比较也保留它，不能用重新 preflight、重复人工审批或手改状态替换。

## Goals / Non-Goals

**Goals:**

- 在受管 Archive Git 调用的局部平台边界统一 Windows 路径支持，覆盖创建、恢复读取、索引、提交、发布观察和清理。
- 不增加持久配置、状态格式或第二套恢复权威；冻结输入和 Journal 完成条件继续由现有层负责。
- 用真实 Git 证明失败边界被覆盖，再以公开 CLI 验证真实多仓恢复与发布；验收使用原 Run 还是新 Run，按下方候选范围调整取得决定后落实。

**Non-Goals:**

- 不改写通用进程执行器中所有 Git 命令，不接管用户检查命令、Git hooks 或任意第三方工具。
- 不移动受管 checkout 根，不引入短路径临时存储、目录重命名、系统设置要求或历史 Run 迁移机制。
- 不扩大到无失败证据的其他 Git 工作流，不新增生命周期、遥测 schema 或桌面功能。

## Decisions

### 1. 在平台 Git 边界采用命令级配置

新增局部共享的受管 Archive Git 执行适配，Windows 时以 argv 前缀 `-c core.longpaths=true` 调用 Git；其他平台保持原始 argv。使用现有 `execute` 的 `execFile` 调用，不拼接 shell，不修改 `process.env`。保留原始 stdout/stderr，调用者按需要 trim；NUL 分隔输出不得经过统一 trim 或重新拆分成空格路径。平台差异判断只在这个适配内完成；测试可替换平台观察和进程边界，生产端口不增加平台选择配置。

Git 的命令级配置只影响本次 Git 进程及其派生调用，不写入 local/global/system 配置。显式覆盖用户的持久 `false` 仅限产品拥有的归档动作；产品自身增加的路径层级不应要求用户改变整个仓库行为。

备选方案：写 `git config` 会污染宿主配置；全局修改通用 `execute` 会改变检查契约；缩短或移动 checkout 需要额外位置登记和清理策略，也不能覆盖归档后的文件路径。三者均不采用。

参考：[Git 命令级配置](https://git-scm.com/docs/git)、[Git for Windows 长路径说明](https://gitforwindows.org/git-cannot-create-a-file-or-directory-with-a-long-path.html)。官方说明并不承诺任意脚本工具支持长路径，因此产品承诺限于受管 Git/文件系统操作。

### 2. 完整收拢两处适配器的 Git 调用

`platform/git/specification-checkout.ts` 和 `platform/delivery/specification-publication.ts` 的 Git 调用统一使用局部适配，包括直接 `execute` 的 diff、cached diff、ls-files 和恢复检查。保留 publication Git port 的故障注入与远端观察职责，测试不得为了验证路径而绕过真实索引或提交。

Engine 和 Cordis Service 继续决定合法 Action、证据和阶段；领域模块继续验证冻结身份与 Journal 状态；平台适配器负责进程差异。通用检查执行路径不调用这个专用适配。无需把 Windows 条件提升到领域层。

OpenSpec Provider 关闭路径中的 Git 调用也经过只读审计：`prepareClosureAt` 与关闭后的 HEAD 观察使用 `rev-parse`，关闭前源 Workspace 使用定向 status；隔离 checkout 的规格同步和归档使用官方 OpenSpec 命令及 Node 文件系统。不把 Provider 所有规划操作改成 Archive 模式；真实关闭链路测试若证明还有路径敏感 Git 调用遗漏，则在当前受管归档范围内补齐，并保留原校验。

### 3. 保持现有恢复约束并显式处理验收边界

调用顺序仍为冻结输入核对、隔离 checkout、规格关闭、提交与现有 Journal 驱动的远端发布。路径失败后不生成成功 Receipt，不重建 Run 或重新规划；仍有效的工作包、Verify Gate 和 Bundle 保持有效。恢复沿公开入口继续，已有副作用仍先观察再采用。

本轮失败现场没有生成成功 checkout、关闭结果或远端 MR。修复包与旧包的执行代码身份不同；不能仅凭平台状态格式不变，就承诺原 Run 可跨实现完成。测试仍覆盖已有 commit、push 和 MR 的同一实现下中断恢复，防止后续阶段成为新的路径阻塞点。

#### 已核实的跨实现恢复阻断

受影响的 `delivery-file` 是受保护插件，其 `codeDigest` 会随两个适配器变化。源基线按生产算法计算的代码摘要与原失败 Run 一致；既有 `compareCompositions` 只有在状态、authority、配置契约不变且声明唯一精确前驱时才允许采纳。但采纳不等于所有执行栅栏已经兼容。

- `services/workflow-runs.ts` 在 Archive prepare 冻结 `planningCompositionDigest`，发布时继续传递旧值。
- `plugins/delivery/file-delivery-provider.ts` 要求当前组合严格等于该值；路径修复后这一条件不再成立。
- `domains/change-lifecycle/transition.ts` 的 preflight replacement 将此字段纳入稳定输入，不能用公开 preflight 静默改为当前值。
- Evidence 路径已区分原验证组合与当前执行组合：发布继续核对原 Bundle 归属，暂未发现同类硬阻断，不能顺手刷新或削弱这些检查。
- `openspec/specs/plugin-composition/spec.md` 已要求兼容组合采纳与规划审批正交；重复批准相同 Design 不能修复该缺口。

#### 候选范围调整，待用户决定

**A：本次只修路径，独立验收，推荐。** 保留旧包、原 Run、失败证据和远端事实；修复包新建隔离验收 Change，以相同长路径边界完成全链路、同一版本下的冷恢复和 Journal 中断恢复。跨实现 Archive 缺口单独记录并后续独立修复，不声称原 Run 已恢复。新适配登记真实代码身份，不为了当前验收更新前驱声明或增加兼容层。代价是本次不交付原 Run 的跨实现续跑。

**B：本次扩大为路径修复加跨实现 Archive 恢复。** 需要先补全冻结发布来源与当前获准执行实现之间的可核验证明，保持审批、Bundle、Archive input 与 Journal 原身份，再验证原 Run 全链路。这个方案涉及现有 Cordis Service、平台执行栅栏及组合采纳协议，不能在 Build 临时实现，也不能只删掉等值检查或把冻结值替换成 current。

若选择 A，拟申请的 Spec Patch 是：第三条新增 Requirement 的恢复承诺明确限制为同一执行实现；增加“补丁改变受保护实现身份而原 Run 无法合法恢复时，保留现场、返回真实阻断，允许用独立新 Run 验证路径修复，但不得声称旧 Run 已恢复”的场景。前两条长路径与配置隔离要求保持原文。任务 3.1 去除跨实现采纳承诺，3.2 改为独立 Change 的完整默认配置验收与同版本恢复，仍为 8 项任务。用户同意之前不改 delta spec 或任务权威。

### 4. 验证跨越两个不同的路径边界

- 先用真实 Windows Git 夹具复现默认配置下 checkout 目录创建失败；记录绝对目录与文件长度，不把不同 Win32 边界混为固定的单一阈值。
- 测试受管操作可读取原规格树，再将 Change 移到 archive，令归档文件完整路径超过 260 字符；执行真实 diff、add、commit、push 和清理。断言实际索引、提交内容和远端 OID，而非只断言命令参数。
- 对成功、故障注入及恢复检查持久配置/父进程环境/调用者 HEAD 和 index 不变；保留越权路径与 OID 漂移阻断，验证 NUL 分隔及带空格路径。
- 默认配置的真实验收保留各作用域长路径配置未设置以及系统原值；自动化夹具可在该夹具专用配置中显式设置 `false` 来抵消 CI 的全局 `true`，但记录该区别并断言前后不变，不能把夹具设置当作真实默认环境证据。
- 非 Windows 测试覆盖不附加 Windows 参数及原有归档回归；CI Windows 环境即使已开启全局长路径，也不能被误称为默认配置证明。真实默认环境验收需单独记录系统及 Git 各作用域的实际值。
- 新包安装到实验工具目录；根据用户对上方候选的决定，使用公开 CLI 验证对应 Run 的完整规格关闭、Publication Receipt、MR 集合与终态冷恢复，报告明确区分原失败 Run 和独立验收 Run。
- `test/composition-compatibility.test.ts` 保持既有身份约束；不得固定伪造当前代码摘要、扩大前驱集合或改写原 Bundle 以通过验收。若选 A，不追加针对旧 Run 的兼容声明；若选 B，先完成正式恢复协议设计再进入实施。

## Risks / Trade-offs

- Git hooks、外部脚本或文件系统仍可能拒绝路径 → 不承诺支持任意外部工具；保留原失败和 Journal，报告实际边界，不能静默回退到修改系统配置。
- 只在创建 checkout 时加参数会遗漏索引和恢复 → 两个适配器所有 Git 调用统一覆盖，真实索引和中断恢复均纳入回归。
- 测试根目录过短或 CI 预先开启长路径会产生假阳性 → 构造并断言实际长度，默认设置验收记录各作用域配置，必要时将不满足前提的测试标为未验证而非通过。
- 工作树清理或长路径删除误伤现场 → 保留现有受管根约束；测试只清理新夹具，原失败验收 Run 与证据始终保留。
- 长路径是平台修复而非生命周期修复 → 验证现有 OTel Run/Work、阶段及结果关联没有变化，不新增高基数路径属性；测试结果进入正式验证报告。

## Migration Plan

路径适配自身无需持久数据迁移或兼容分支。构建候选包并保留旧包，在独立实验工具目录安装；待候选方案确定后按对应公开 CLI 验收。提交、发布和升级均不手改 Store、Journal、审批或证据。原失败现场始终保留；已发生的远端事实继续由原 Journal 观察，不回滚或重复创建远端结果。

## 停止条件

规格、冻结输入、实际 Git 行为或公开恢复接口与本设计冲突时，停止依赖步骤并回到正式设计修订；不得以目录搬迁、全局配置、手写替代命令或直接改 Store 绕过。
