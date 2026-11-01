---
comet_change: stabilize-host-owned-input-boundary
role: technical-design
canonical_spec: openspec
status: draft
---

# Design

## Context

`platform/git/evidence-fingerprint.ts` 目前用 `git diff --name-only HEAD` 与 `git ls-files --others --exclude-standard` 合并 dirty path，并对每个文件进行竞态安全的内容哈希。这一机制对产品源码是正确的，但无法表达“文件影响执行，却不属于待验证产品”的控制面输入。

与此同时，`scripts/check-architecture.mjs` 对 `architecture-governance.json` 中 `legacyWorkflow.forbiddenPaths` 直接执行 `lstat`。因此外部 Host 合法生成 `.codex/hooks.json` 或 `.codex/rules/**` 后，即使路径未被 Git 跟踪、未进入 npm 包且生产代码没有依赖，架构检查仍会失败。上一轮自举在 Verify 前移走 `.codex`、完成后恢复，又因为 Evidence 对全部未跟踪文件取指纹而触发输入漂移。

这不是“是否忽略 `.codex`”的单点问题，而是三种身份被混在一起：

1. 产品输入：业务源码、规格、配置和所有未知 dirty 内容；
2. 执行控制面输入：Host Hook、Agent 指令、Skill 安装和锁定身份；
3. Runtime 状态：已经由 `.gitignore` 和 Store 边界管理的短期状态。

控制面输入会改变 Agent 行为，所以必须被内容寻址；但它不应作为产品源码污染 dirty tree，也不应因为物理存在而被误判成产品复制了旧工作流。

## Goals / Non-Goals

**Goals:**

- 建立一个确定、版本化、跨平台的输入所有权分类和摘要模型。
- 允许已登记 Host 文件在完整 Verify→Archive 窗口内保持原位。
- 保持未知输入、external-exclusive 冲突、路径逃逸和策略变化的 fail-closed 行为。
- 让 Evidence、Verification Input、复用和 Archive 重验使用同一份输入身份。
- 让架构检查证明产品没有依赖旧工作流，而不是要求开发机上不存在任何 Host 安装文件。

**Non-Goals:**

- 不允许任意自定义排除 glob，也不把 `.gitignore` 当作安全策略。
- 不隐藏会影响执行但没有内容身份的 Agent 指令、Skill 或 Hook。
- 不修改 Comet、Codex 或其他 Host 的安装实现。
- 不改变 Open→Design→Build→Verify→Archive 状态机或 Evidence Gate 语义。
- 不为预发布旧指纹 schema 保留双读、双写或迁移兼容层。

## Approaches

### 采用：产品输入与控制面输入分区、共同绑定

Repository Input Policy 先依据 Git 身份、版本化路径规则和发布边界分类候选路径。产品输入继续形成现有 repository fingerprint；已登记且未跟踪的控制面输入形成独立 manifest，其中包含规范路径、文件类型、内容摘要、大小、owner/provider identity 和 policy version。最终 Evidence fingerprint 同时绑定两者。

这使 `.codex` 等 Host 文件不再制造“产品 dirty”噪声，但其内容变化仍会使旧 Evidence 失效。该方案也能解释未来团队 Skill：Skill 不是产品源码，却是可重现执行的一部分。

### 放弃：仅扩充 `.gitignore`

Git ignore 可以让当前指纹看不到文件，但同时让影响执行的规则、Hook 和 Skill 完全脱离 Evidence 身份；不同机器可能在相同产品 fingerprint 下使用不同方法。因此 `.gitignore` 只能管理纯 Runtime 状态，不能定义控制面可信边界。

### 放弃：对 `.codex` 或所有点目录硬编码跳过

宽泛跳过会隐藏真实产品文件、未知攻击面和所有权冲突，也无法覆盖其他 Host。领域层不应认识某个外部产品品牌；具体路径必须来自版本化 Provider/Host policy，并经过同一分类器。

### 放弃：Verify 前移动、Archive 后恢复

临时搬移依赖调用顺序，破坏崩溃恢复，并让验证环境与实际开发环境不同。它是手工 workaround，不是稳定输入模型。

## Decisions

### 1. Repository Input Policy 是唯一分类权威

新增不可变、可规范化的 `RepositoryInputPolicy`，至少包含 schema/version、owner/provider identity 和精确 path rules。分类结果只允许：

- `product`：Git tree 中的文件、tracked modification/deletion，以及所有未被更具体可信规则接纳的输入；Git 跟踪身份优先，因此团队有意版本化的 Agent 指令或 Skill 仍属于产品输入；
- `control-plane`：与已登记规则匹配、当前未被 Git 跟踪且不属于发布包的执行输入；
- `runtime-state`：由既有 Runtime Store/ignore 边界管理，本 Change 不把它重新纳入 Evidence；
- `conflict`：外部独占路径进入产品面、类型不符、路径逃逸、重叠规则或无法稳定读取。

分类器默认拒绝，未知未跟踪路径仍是产品 dirty 输入。规则只接受仓库相对、正斜杠规范化、无 `..` 的精确文件或受限根路径；不提供任意否定规则和用户自定义通配绕过。

策略由 composition/Host integration Contributor 提供，Git Adapter 只执行已编译策略。领域模型只认识 owner 和类别，不认识 Comet、Codex 等品牌。

### 2. 控制面不是被忽略，而是单独内容寻址

对每个 `control-plane` 文件使用与 dirty product file 相同的 race-safe 读取、symlink 检查和 root containment。manifest 记录：

- 规范相对路径与 `file | symlink` 类型；
- SHA-256、字节大小；
- 有界 owner/provider identity；
- policy schema/version 和规则 identity。

manifest 规范排序后计算 digest。Evidence fingerprint 和 Verification Input 同时记录 `repositoryInputPolicyDigest` 与 `controlPlaneInputDigest`。任何内容、文件集合、类型、owner 或策略变化都会使复用、Gate 接受和 Archive 重验失效。

控制面内容本身不进入状态、日志或遥测；诊断只报告有界类别、路径和摘要前缀，不上传正文。Metric 不以路径或 owner 自由值作为 label。

### 3. Git 跟踪身份优先于路径标签

与 Host 规则匹配并不足以排除文件。分类前必须取得稳定 Git selection：

- 已在 HEAD/tree 或 index 中跟踪的普通双用途路径属于 `product`，照常进入 tree/dirty fingerprint，不因也可被 Host 使用而排除；
- 只有 policy 明确声明为 external-exclusive、且架构治理禁止进入产品面的旧 Host 路径被跟踪时才形成 `conflict`；
- 未跟踪且匹配已登记 Host 规则的路径进入 control-plane manifest；
- 未跟踪但未知的路径继续进入产品 dirty fingerprint；
- ignored Runtime 状态维持既有边界，不被本 Change 重新枚举。

首次选择、文件哈希和最终选择必须同时核对 product set、control-plane set、HEAD、tree 和 policy digest；任一集合变化都抛出 `RepositoryFingerprintChangedError`。

### 4. 架构治理检查产品面，不检查开发机物理存在性

`legacyWorkflow.forbiddenPaths` 从单一字符串列表演进为带 scope 的治理规则。旧工作流路径在以下任一条件下仍失败：

- 被 Git 跟踪或出现在 staged/modified 产品面；
- 被生产 source manifest、能力账本或 package files 覆盖；
- 生产扫描目标引用旧标记或旧路径；
- 本地路径与登记的 control-plane 规则不一致或类型不安全。

只有未跟踪、未打包、由当前 Host policy 接纳并能形成稳定控制面摘要的本地安装路径可以存在。架构检查和 Evidence 分类共享同一策略编译器，避免两套路径语义漂移。

### 5. composition 绑定策略提供者，Verification Input 绑定实际内容

composition identity 保存 Host input policy Contributor 的稳定 id、version、code/config digest；Repository fingerprint 保存该次运行实际观察到的 policy digest 与 control-plane manifest digest。这样：

- Provider 实现或规则改变时，Run composition 漂移；
- 文件内容改变时，Verification Input 漂移；
- 仅产品源码改变时，产品 repository fingerprint 漂移；
- 同一内容、同一策略、不同枚举顺序得到相同摘要。

不建立第二份生命周期状态；这些摘要沿用现有 Evidence fingerprint、Verification Input 和 Gate 比较链路。

### 6. 首版内置规则保持最小且显式

首版只登记 Repoctopus 自举已经真实遇到、且能够证明由外部 Host 安装的输入类别，例如 Host hooks/rules、Agent skill installation、Agent instruction entry 和 Skill lock。每条规则必须声明是否影响执行、预期文件类型、owner，以及该路径是仅限外部安装还是允许团队版本化。

不能证明所有权的根文件、任意 `.codex/**` 内容或团队自定义目录不得自动排除。若 `AGENTS.md`、Skill lock、规则或 Hook 被接纳，它们必须出现在 control-plane manifest，而不是消失。新增 Host 规则以后必须通过独立 Specification change 或版本化 Provider 配置评审。

### 7. 多仓逐仓分类，Workspace 汇总身份

每个已登记 Repository 使用相同策略编译规则但生成独立 product/control-plane fingerprint；Workspace Evidence 按 repository id 规范排序聚合。一个仓库发生 control-plane 漂移只失效引用该仓库的输入，但 Verify Profile 的完整仓库集合仍保持 fail-closed。

Repository override、worktree 和 sibling repository 不得通过绝对路径或 symlink 共享同一控制面文件对象；检测到 root 外解析或重复不安全映射时拒绝采集。

## Risks / Trade-offs

- [控制面文件数量较多导致哈希成本上升] → 使用明确根、规范排序和现有 race-safe hash；首版不递归扫描未知目录，并在测试中设置数量/大小边界。
- [Host 在采集期间更新 Skill] → 这是实际执行输入变化，Attempt 应 superseded，而不是为了通过门禁隐藏漂移。
- [架构治理与 Evidence 规则产生双重实现] → 提取共享 policy compiler 和分类结果；脚本只消费机器可读策略，不复制 glob 逻辑。
- [把真实产品文件误标为 Host] → Git tracked 和 package ownership优先；双用途 tracked 文件保持 product，只有 external-exclusive 路径冲突才 fail-closed，未知默认仍为 product。
- [外部 Host 生成不可预测文件] → 不追求自动兼容全部文件；未登记路径保持 dirty，需通过版本化规则明确引入。

## Test Strategy

- 单元测试策略规范化、路径重叠、Git 身份优先级、稳定摘要、symlink/root containment 和竞态。
- Git 集成测试覆盖 clean、tracked modification、unknown untracked、registered Host untracked、tracked dual-use、external-exclusive conflict、Host 内容漂移和策略漂移。
- Evidence/Verification Input 测试证明产品与控制面摘要都参与 Gate、复用和 Archive 重验。
- 架构检查测试证明未跟踪登记 Host 目录可存在、双用途 tracked 文件仍作为产品输入，而 external-exclusive tracked、意外 packaged 或生产非法引用仍失败。
- 多仓测试证明各仓摘要隔离且 Workspace 聚合确定。
- 自举 E2E 在 `.codex`/`.agents`/Agent instructions 保持原位的情况下执行 Verify 和 Archive 输入重验；再修改一个 Host 文件，确认旧 Evidence 被拒绝。

## Rollout

本项目尚未正式发布，直接升级 fingerprint、Verification Input 和治理策略 schema，不保留旧 schema 兼容路径。已有开发 Evidence 可丢弃并重新采集。完成后删除自举脚本或人工说明中的“移动 Host 目录” workaround，并更新自举验收文档。
