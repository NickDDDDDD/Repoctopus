# Design

## Context

见 `proposal.md` 的 Why。当前 `third_party/upstream-baselines.json` 用 `pinnedCommit` 表示默认分支头；Comet provenance 又要求同一个值等于派生源码基线。当发布标签与默认分支位于同一提交时该模型碰巧成立，一旦分叉就无法同时表达“从哪个发布版本派生”和“审计到哪个分支头”。DSH 已通过 `pinnedTagCommit` 与 `pinnedCommit` 部分区分两者，但字段命名仍然含糊，Comet 检查则直接把两种身份绑在一起。

2026-10-30 的实时远端事实为：

| 上游 | 新发布基线 | 发布提交 | 已审计默认分支提交 |
| --- | --- | --- | --- |
| Comet | `0.5.1` | `35c9860b77b42bafa0c2d80d8d695889f888a924` | `4901cac9330f5ffe289abfa6daf8412bfa190dc0` |
| DSH | `dsh-v0.2.1-rc.5` | `b830ec950faba0a46dda564be3e2d854afed94f1` | `ce7073d51254c26cd63b22a60835b8f948deb447` |

八个直接使用的 `@deepseek-ai/dsh-*` 包均已在 npm 发布 `0.2.1-rc.5`。两个仓库仍使用 MIT 许可证；许可证内容与来源关系要在 Build 中从固定提交再次验证，而不是只信远端标签名。

## Goals / Non-Goals

**Goals:**

- 让发布来源、默认分支审计和依赖锁三类身份都可独立验证且语义唯一。
- 将 Comet 与 DSH 的发布基线升级到本次审计时的最新正式标签，并刷新所有受影响的逐文件 provenance。
- 对发布增量和默认分支尾部做完整能力审计，形成下一项核心可靠性 Change 可直接使用的证据。
- 保持 Windows 与普通本地开发环境可重复执行，不依赖常驻进程或某个开发者的临时目录。

**Non-Goals:**

- 不在本 Change 中采用 Comet/DSH 新增的产品行为，也不修改五阶段状态机、统一 Run 或 Specification Provider。
- 不把 DSH Agent、Session、Workspace、Webhook Runtime 或 Comet 产品外壳引入 Repoctopus。
- 不为旧版 `upstream-baselines.json` 保留兼容读取分支；产品尚未正式发布，账本与检查器原子迁移到新 schema，避免长期双语义。
- 不创建 delta specs；本 Change 没有规格级可观察行为变化。

## Decisions

### 1. 基线账本使用两个明确身份

`upstream-baselines.json` 升级为 schema v2。每个上游只保留以下互不重叠的身份：

- `version`、`pinnedTag`、`pinnedTagCommit`：可复现的发布来源；
- `branch`、`auditedBranchCommit`：本次完整审计覆盖到的默认分支头；
- `provenance`：具体来源清单。

删除含糊的 `pinnedCommit`。`check-upstream-drift` 将远端 branch 与 `auditedBranchCommit` 比较、tag 与 `pinnedTagCommit` 比较；`check-provenance` 则只要求发布来源清单等于 `pinnedTagCommit`。这样分支继续开发只会报告“出现未审计增量”，不会迫使发布来源伪装成 branch snapshot。

备选方案是保留 `pinnedCommit` 并新增一个字段。该方案仍需约定旧字段到底代表 release 还是 branch，增加长期歧义，因此不采用。

### 2. 发布升级与分支审计分两条 diff 闭合

每个上游分别检查：

1. 旧发布标签到新发布标签：决定来源、依赖和当前产品采用面是否需要更新；
2. 新发布标签到 `auditedBranchCommit`：记录尚未发布但值得后续采用或监测的变化；
3. 标签提交、分支提交、许可证、npm 包版本与 lockfile 均用机器命令独立验证。

审计报告对每个与 Repoctopus 能力域有关的变化给出 `采用`、`拒绝` 或 `延后`，并写明理由。发现适合核心可靠性修复的方案只登记为后续 Change 输入，本 Change 不越界实现。

备选方案是只看 release notes。release notes 不能覆盖分支尾部、逐文件派生关系或未公开修复，无法满足每日上游审计，因此不采用。

### 3. Comet 来源固定在发布标签，目标实现不自动覆盖

`third_party/comet/source-manifest.json` 的 `upstream.commit` 与 `version` 移到 `0.5.1` 标签。清单中每个 `sourceSha256` 都从该固定 checkout 重算；目标 `sha256` 由当前 Repoctopus 文件重算并继续验证。上游来源变化不意味着本地目标要被覆盖：只有审计明确决定采用的行为才能在独立产品 Change 中修改目标实现。

如果 0.5.1 删除或移动某个已登记来源文件，必须停止并明确更新来源映射与采用理由，不允许用空摘要或相似文件静默替代。

### 4. DSH 发布依赖、Cordis 快照与分支头分开处理

八个直接 DSH 依赖和 overrides 一起升级到精确 `0.2.1-rc.5`，由 npm lockfile 固定 tarball integrity。`dsh-adoption.json` 与 Cordis 不可变快照只引用 rc.5 发布提交；若 rc.5 中对应 Cordis/Loader 文件与 rc.3 不同，则从固定标签更新快照与逐文件摘要；若字节相同，也更新发布来源身份并在审计报告中记录无内容变化。

DSH `master` 的 `ce7073d…` 只进入 `auditedBranchCommit` 和分支增量审计，不写入 npm 发布来源或 Cordis 快照。这样不会把未发布源码冒充发布包。

### 5. 验证采用生产入口和真实远端事实

实现测试至少覆盖以下坏案例：发布 tag 与 branch 分叉仍能通过 provenance；远端 branch 前进会被 drift 检查报告；tag 被移动会被报告；provenance 提交不等于 tag 提交会失败；旧 schema 或遗漏身份会失败。测试调用生产检查入口，不复制一份仅在测试内成立的解析逻辑。

集成验证依次执行 OpenSpec strict validate、上游漂移检查、provenance、依赖审计、架构检查、类型检查和全量测试。`check:upstream` 在本次固定到实时远端后必须为 clean；未来远端继续前进属于正常漂移信号，不是本次构建不稳定。

## Risks / Trade-offs

- [上游在 Change 执行期间继续前进] → Build 使用 Open 审查确认的提交作为冻结边界；结束时再次查询远端，如有新提交只报告下一次漂移，不悄悄扩大本 Change。
- [DSH rc.5 的依赖闭包或 Cordis 源码改变] → 从固定 tag 与 npm tarball 双向核对，更新快照和摘要后运行真实安装、provenance 与全量测试；若公共行为冲突则停止并另开产品 Change。
- [Comet 0.5.1 来源文件变化导致现有派生实现过时] → 先更新来源摘要和审计决定；除非只是 provenance 数据，不在本 Change 覆盖 Repoctopus 目标代码。
- [一次性 schema v2 迁移破坏外部私有脚本] → 该 JSON 是仓库内部治理文件且产品尚未正式发布；选择清晰失败而非长期兼容债，并同步所有仓内消费者与文档。
- [网络或 registry 短暂失败] → 保留冻结提交和已下载证据，失败时停止；不把无法验证当成“无变化”。

## Migration Plan

1. 在临时、可清理的上游 checkout 中固定四个提交边界，验证标签、许可证、npm 发布物和提交关系。
2. 原子升级账本到 schema v2，并先补齐检查器坏案例测试，再修改生产检查器。
3. 升级 DSH 精确依赖、lockfile、采用清单和必要的 Cordis 快照；升级 Comet manifest 的发布身份与逐文件来源摘要。
4. 写入完整增量审计和当前架构引用，运行分层及全量验证。
5. 删除临时 checkout、下载物和调试日志；保留正式审计、Evidence 与验证报告。

回滚方式是整体 revert 本 Change 的提交，使账本、依赖、快照、清单和文档一起回到旧基线；不得只回滚其中一部分而制造 provenance 分裂。

## Stop Conditions

- 固定标签解析到的提交与上述冻结提交不一致，或许可证不再是可接受的 MIT 来源。
- npm 发布包的版本、tarball 内容或来源提交无法与 DSH 固定标签建立可验证关系。
- 上游已登记来源路径消失或语义被替换，且无法从审计证据唯一决定新的映射。
- 规格、设计、架构边界或用户已确认的“本 Change 不采用产品行为”发生冲突。
- 发现升级会改变公共契约、持久数据、安全边界或团队工作流行为；该部分必须转入独立普通 Change 并经审查。

## Deferred Core Reliability Findings

本 Change 的 Open 自举在未修改 Runtime Store、未伪造 delta spec 的情况下稳定复现了以下缺陷。它们不属于上游基线更新范围，不在本 Change 临时修补；后续 `harden-core-workflow-reliability` Change 必须把这些案例加入坏案例账本、生产入口回归测试和真实外部 Host 验收。

1. **外部 Host Outcome 错误地重建可变上下文。** Open Work 在领取时已冻结 packet；Host 按该 packet 创建并提交规划文件后，`run work-outcome` 重新组装已经变化的 Specification Context，最终报出 `Work execution context digest does not match the persisted intent identity`。正确语义应验证领取时持久化的 packet、invocation 与 Outcome 绑定，不能要求执行副作用后的当前上下文仍等于执行前输入。
2. **Open Gate 未承认 Provider 的合法 skipped 工件。** OpenSpec `1.14.3` 的 strict validation 明确认可 `.openspec.yaml` 中的 `skip_specs: true`，并把 `specs` 标记为 `skipped`；Repoctopus `inspect` 却投影为 `delta-specs: missing`，Open Gate 又硬编码要求四类工件全部 `ready`。后续修复应由 Specification Provider 将官方“已跳过且满足”语义规范化为稳定领域状态和摘要，而不是创建伪 delta spec 或让 Workflow 识别 OpenSpec 专有字段。
3. **成功校验包含错误级诊断。** Provider 将 OpenSpec 的 `INFO` 项映射成 `error`，同时仍返回 `valid: true`。这会让遥测、Dashboard 和后续审计得到互相矛盾的健康信号；后续修复应保留上游 severity，并增加“成功结果不得含 error 诊断”的领域不变量。

当前 Open 规划提交 `a06f615` 已公开推送，OpenSpec 官方 strict validation 与 Repoctopus strict validation 均通过。该事实只证明规划内容有效，不把受阻的 Runtime Run 伪装成已经完成；后续可靠性 Change 修复并验证恢复语义后，再决定从原 checkpoint 恢复还是以相同已发布规划启动新 Run。
