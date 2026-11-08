# Windows 受管规格归档长路径设计

## Context

动机及范围见 `proposal.md`，行为约束见 `specs/delivery-governance/spec.md`。真实失败位于 `GitSpecificationCheckoutManager.create` 的 `git worktree add --detach`，早于规格关闭和任何 MR 发布；此前另有长路径在规格索引阶段失败的记录。因此只处理首次 checkout 错误不能构成完整修复。

现有平台 checkout 和 publication 各自封装 Git，publication 内还有直接执行 Git 的 NUL 分隔路径读取。它们都经过通用进程执行器，但没有局部平台路径策略。规格提交依赖原冻结 OID、Closure changedFiles 及 Publication Journal，路径修复不需要改变这些身份。

固定 Comet 基线 `35c9860b77b42bafa0c2d80d8d695889f888a924` 的 `platform/process/git.ts` 展示了统一 Git 执行边界，但没有自动长路径支持；`test/domains/comet-native/native-portable-archive.test.ts` 的长路径测试显式设置 `core.longpaths=true`。本次借鉴边界，不宣称照搬一个不存在的默认配置修复。

## Goals / Non-Goals

**Goals:**

- 在受管 Archive Git 调用的局部平台边界统一 Windows 路径支持，覆盖创建、恢复读取、索引、提交、发布观察和清理。
- 不增加持久配置、状态格式或第二套恢复权威；冻结输入和 Journal 完成条件继续由现有层负责。
- 用真实 Git 证明失败边界被覆盖，再以公开 CLI 验证真实多仓恢复与发布。

**Non-Goals:**

- 不改写通用进程执行器中所有 Git 命令，不接管用户检查命令、Git hooks 或任意第三方工具。
- 不移动受管 checkout 根，不引入短路径临时存储、目录重命名、系统设置要求或历史 Run 迁移机制。
- 不扩大到无失败证据的其他 Git 工作流，不新增生命周期、遥测 schema 或桌面功能。

## Decisions

### 1. 在平台 Git 边界采用命令级配置

新增局部共享的受管 Archive Git 执行适配，Windows 时以 argv 前缀 `-c core.longpaths=true` 调用 Git；其他平台保持原始 argv。使用现有 `execute` 的 `execFile` 调用，不拼接 shell，不修改 `process.env`。保留原始 stdout/stderr，调用者按需要 trim；NUL 分隔输出不得经过统一 trim 或重新拆分成空格路径。

Git 的命令级配置只影响本次 Git 进程及其派生调用，不写入 local/global/system 配置。显式覆盖用户的持久 `false` 仅限产品拥有的归档动作；产品自身增加的路径层级不应要求用户改变整个仓库行为。

备选方案：写 `git config` 会污染宿主配置；全局修改通用 `execute` 会改变检查契约；缩短或移动 checkout 需要额外位置登记和清理策略，也不能覆盖归档后的文件路径。三者均不采用。

参考：[Git 命令级配置](https://git-scm.com/docs/git)、[Git for Windows 长路径说明](https://gitforwindows.org/git-cannot-create-a-file-or-directory-with-a-long-path.html)。官方说明并不承诺任意脚本工具支持长路径，因此产品承诺限于受管 Git/文件系统操作。

### 2. 完整收拢两处适配器的 Git 调用

`platform/git/specification-checkout.ts` 和 `platform/delivery/specification-publication.ts` 的 Git 调用统一使用局部适配，包括直接 `execute` 的 diff、cached diff、ls-files 和恢复检查。保留 publication Git port 的故障注入与远端观察职责，测试不得为了验证路径而绕过真实索引或提交。

Engine 和 Cordis Service 继续决定合法 Action、证据和阶段；领域模块继续验证冻结身份与 Journal 状态；平台适配器负责进程差异。通用检查执行路径不调用这个专用适配。无需把 Windows 条件提升到领域层。

### 3. 保持原恢复协议

调用顺序仍为冻结输入核对、隔离 checkout、规格关闭、提交与现有 Journal 驱动的远端发布。路径失败后不生成成功 Receipt，不重建 Run 或重新规划；仍有效的工作包、Verify Gate 和 Bundle 保持有效。恢复沿公开入口继续，已有副作用仍先观察再采用。

本轮失败现场没有生成成功 checkout、关闭结果或远端 MR；修复包在不修改 Store 的前提下恢复同一 Run。若公开入口证明输入失效或存在无法归属的残留，则停止并报告具体事实，不自动删除现场、猜测成功或替换发布身份。测试同时覆盖已有 commit、push 和 MR 的中断恢复，防止后续阶段成为新的阻塞点。

### 4. 验证跨越两个不同的路径边界

- 先用真实 Windows Git 夹具复现默认配置下 checkout 目录创建失败；记录绝对目录与文件长度，不把不同 Win32 边界混为固定的单一阈值。
- 测试受管操作可读取原规格树，再将 Change 移到 archive，令归档文件完整路径超过 260 字符；执行真实 diff、add、commit、push 和清理。断言实际索引、提交内容和远端 OID，而非只断言命令参数。
- 对成功、故障注入及恢复检查持久配置/父进程环境/调用者 HEAD 和 index 不变；保留越权路径与 OID 漂移阻断，验证 NUL 分隔及带空格路径。
- 非 Windows 测试覆盖不附加 Windows 参数及原有归档回归；CI Windows 环境即使已开启全局长路径，也不能被误称为默认配置证明。真实默认环境验收需单独记录系统及 Git 各作用域的实际值。
- 新包安装到实验工具目录，使用同一公开 Archive 入口恢复失败多仓 Run，核对原证据身份、规格关闭、完整 Publication Receipt、MR 集合及完成后新进程恢复；旧包与原失败证据保留。

## Risks / Trade-offs

- Git hooks、外部脚本或文件系统仍可能拒绝路径 → 不承诺支持任意外部工具；保留原失败和 Journal，报告实际边界，不能静默回退到修改系统配置。
- 只在创建 checkout 时加参数会遗漏索引和恢复 → 两个适配器所有 Git 调用统一覆盖，真实索引和中断恢复均纳入回归。
- 测试根目录过短或 CI 预先开启长路径会产生假阳性 → 构造并断言实际长度，默认设置验收记录各作用域配置，必要时将不满足前提的测试标为未验证而非通过。
- 工作树清理或长路径删除误伤现场 → 保留现有受管根约束；测试只清理新夹具，原失败验收 Run 与证据始终保留。
- 长路径是平台修复而非生命周期修复 → 验证现有 OTel Run/Work、阶段及结果关联没有变化，不新增高基数路径属性；测试结果进入正式验证报告。

## Migration Plan

无需持久数据迁移或兼容分支。构建候选包并保留旧包，在原实验工具目录旁安装候选包，经公开 CLI 恢复原 Run。提交、发布和升级均不手改 Store、Journal、审批或证据。回退只切换调用的 CLI 包，已发生的远端事实继续由原 Journal 观察，不回滚或重复创建远端结果。

## 停止条件

规格、冻结输入、实际 Git 行为或公开恢复接口与本设计冲突时，停止依赖步骤并回到正式设计修订；不得以目录搬迁、全局配置、手写替代命令或直接改 Store 绕过。
