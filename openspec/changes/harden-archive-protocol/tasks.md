# Tasks

## 0. 固定问题基线与架构边界

- [ ] 0.1 为 `run start --help` 建立进程外回归测试，证明只读帮助当前会创建 Run，并将目标断言设为零 composition、零 reconcile、零持久写入。
  **Blocked by:** None
  **Acceptance:** 定向测试在修复前失败且能定位新增 Run；测试不依赖已有 `.repoctopus` 状态
  **Requirements:** post-merge-automation#readonly-cli
- [ ] 0.2 把已发现的旧 Run Receipt head 与最终实际合入 head 不一致构造成去身份化 integrity fixture，并用只读测试证明基线不会改写旧 Receipt。
  **Blocked by:** 0.1
  **Acceptance:** fixture 可重现差异且测试核对原文件摘要在审计前后不变
  **Requirements:** specification-authority#historical-integrity
- [ ] 0.3 更新 Comet 采用映射，记录 archive preflight、transaction Journal、resume probe、portable archive 的采用与排除边界，并运行来源、摘要和许可证检查。
  **Blocked by:** 0.2
  **Acceptance:** `npm run check:provenance` 通过，采用记录不新增未登记运行时依赖
  **Requirements:** change-lifecycle#archive-terminal, specification-authority#closure-journal
- [ ] 0.4 扩展架构检查，限定 lifecycle terminal、Archive Journal、attempt 分配、Specification close 和平台 merge proof 的唯一 owner。
  **Blocked by:** 0.3
  **Acceptance:** 正向生产组合通过，恶意 fixture 对直接写 Run、Adapter 完成 Change、CLI 自选 attempt 和 Provider 宣称 terminal 分别失败
  **Requirements:** change-lifecycle#runtime-attempt, post-merge-automation#archive-protocol

## 1. 交付最终 MR 合入才完成的最小纵切

- [ ] 1.1 定义 Archive Work、FinalPublicationReceipt、FinalMergeProof 和 ArchiveCompletionReceipt 的版本化领域契约，并用序列化 golden tests 固定规范摘要。
  **Blocked by:** 0.4
  **Acceptance:** 类型、Schema、canonical digest 与无路径/无凭据泄露 contract tests 通过
  **Requirements:** change-lifecycle#archive-terminal, post-merge-automation#final-head-drift
- [ ] 1.2 发布新版内置 lifecycle definition，加入 `publish-final → await-final-merge → finalize`，移除“final MR ready 即 completed”的当前版本触发。
  **Blocked by:** 1.1
  **Acceptance:** 纯领域测试覆盖 open、closed-unmerged、merged-matched、merged-mismatched 和非法越级，只有 matched 可 completed
  **Requirements:** change-lifecycle#archive-terminal, post-merge-automation#archive-protocol
- [ ] 1.3 扩展 Change Run observation/reducer，使最终 MR 创建只进入 `archive/waiting`，FinalMergeProof 才生成 finalize Work。
  **Blocked by:** 1.2
  **Acceptance:** reducer 重放与重复 observation 幂等，等待状态不依赖进程或 Fiber
  **Requirements:** change-lifecycle#archive-terminal
- [ ] 1.4 扩展公共 ChangeRunProjection/CLI JSON，显示 Archive subwork、最终 MR 等待、冻结 head 和 completion proof freshness。
  **Blocked by:** 1.3
  **Acceptance:** projection golden tests 与 CLI protocol tests 对相同 Run 给出同一 phase/status/next action
  **Requirements:** change-lifecycle#archive-terminal, post-merge-automation#archive-protocol
- [ ] 1.5 用内存平台 Adapter 建立最小生产 composition 纵切，模拟 Runner 创建或采用人工最终 MR、人工合入和 finalize。
  **Blocked by:** 1.4
  **Acceptance:** 集成测试证明 Runner 创建和人工创建均在合入前未完成、精确合入后完成、Runtime 从未调用 merge
  **Requirements:** change-lifecycle#archive-terminal, delivery-governance#stable-external-action

## 2. 建立 Archive Journal 与恢复核心

- [ ] 2.1 定义单一 `ArchiveJournal` schema、步骤状态、history event、version/CAS 和 input binding，并提供严格解码与迁移错误。
  **Blocked by:** 1.5
  **Acceptance:** schema tests 拒绝未知版本、缺失 input、倒退状态和跨 Run 数据
  **Requirements:** post-merge-automation#archive-protocol
- [ ] 2.2 实现原子 FileArchiveJournalStore、可恢复文件锁和 compare-and-swap 更新，复用现有受审计文件原语。
  **Blocked by:** 2.1
  **Acceptance:** 并发、撕裂写、锁过期、取消和重复提交测试通过，Journal 始终可解码
  **Requirements:** post-merge-automation#archive-protocol
- [ ] 2.3 实现纯 Journal reducer，强制 `preflight → business publication → business merge → evidence → close candidate → final publication → final merge → finalize` 单调顺序。
  **Blocked by:** 2.2
  **Acceptance:** 属性测试覆盖全部合法边、非法跳步、重复事件、supersede 和 blocked/reconcile 分支
  **Requirements:** post-merge-automation#archive-protocol
- [ ] 2.4 增加 Archive Coordinator Cordis Service，把 Journal Receipt 转换为 Change Run observation，禁止直接改写 RunStore。
  **Blocked by:** 2.3
  **Acceptance:** composition lifecycle 测试覆盖安装、卸载、缺失依赖、取消和有界排空
  **Requirements:** post-merge-automation#archive-protocol
- [ ] 2.5 将现有 PostMerge closure Journal 兼容读取映射到新 Journal view，并 fence 新流程对旧聚合状态的双写。
  **Blocked by:** 2.4
  **Acceptance:** 旧 fixture 可只读恢复，新 Archive 只写一个 authority，架构测试拒绝第二 owner
  **Requirements:** post-merge-automation#archive-protocol

## 3. 前置检查、Attempt 和 CLI 安全

- [ ] 3.1 定义 `ArchivePreflightRequest/Receipt` 及诊断分类，覆盖 credential presence、Git author、Store/Provider、平台能力、Evidence profile、远端 OID、临时根和发布策略。
  **Blocked by:** 2.5
  **Acceptance:** contract tests 证明 Receipt 不含凭据值、绝对临时路径或无限错误正文
  **Requirements:** delivery-governance#side-effect-preflight
- [ ] 3.2 实现只读 preflight Service 和各 Provider capability probe，并保证配置缺失时零 Action Intent、零 attempt、零外部 mutation。
  **Blocked by:** 3.1
  **Acceptance:** 缺 Token、缺作者、Store 错指、profile 缺失、平台不支持与暂时故障测试分别得到正确诊断
  **Requirements:** delivery-governance#side-effect-preflight
- [ ] 3.3 重构 CLI 命令解析，在 boot composition 前处理 help/version/未知参数/必需参数并提供每个子命令用法。
  **Blocked by:** 3.2
  **Acceptance:** 任务 0.1 回归转绿，并覆盖 `run start --help`、缺少 target、未知 flag 和正常 Change start
  **Requirements:** post-merge-automation#readonly-cli
- [ ] 3.4 在 Action Store/Dispatcher 实现 Runtime 原子 attempt 分配、已有 attempt 恢复和单调序列。
  **Blocked by:** 3.3
  **Acceptance:** 并发 claim、进程崩溃、Receipt 响应丢失、旧 Outcome 和伪造更大 attempt 测试通过
  **Requirements:** change-lifecycle#runtime-attempt
- [ ] 3.5 用配置或本机 registry 的稳定 Runner identity 替换 `cli:<PID>`，把 PID、启动时间和 lease deadline 降为 session 元数据。
  **Blocked by:** 3.4
  **Acceptance:** 不同 PID 的同一 Runner 可恢复，另一 Runner 可在合法 lease 边界接管，审计仍能区分执行主体
  **Requirements:** change-lifecycle#runtime-attempt
- [ ] 3.6 更新公共 `run work-claim`、`archive-publish` 和相关命令，使调用方不需要也不能创建任意 attempt。
  **Blocked by:** 3.5
  **Acceptance:** CLI process tests 证明默认自动分配、兼容参数只能引用已有 attempt、帮助文档与实现一致
  **Requirements:** change-lifecycle#runtime-attempt, delivery-governance#stable-external-action

## 4. 多仓 Business MR 发布与精确合入恢复

- [ ] 4.1 规范化 Archive input，使每个 Business MR 绑定仓库、head/base、平台身份、批准快照、发布 head、merge commit 和核对时间。
  **Blocked by:** 3.6
  **Acceptance:** digest tests 对扫描顺序稳定，对任一 MR 增删、替换、分支或 commit 变化敏感
  **Requirements:** delivery-governance#multi-repo-proof
- [ ] 4.2 把 Business push 与 MR create-or-recover 的 Intent/Receipt 逐项写入 Archive Journal，并从首个未确认动作恢复。
  **Blocked by:** 4.1
  **Acceptance:** 两仓发布中第二仓失败后恢复不会重复第一仓逻辑副作用，且明确不宣称跨仓回滚
  **Requirements:** delivery-governance#stable-external-action, delivery-governance#multi-repo-proof
- [ ] 4.3 将 `await-business-merge` 的 webhook、主动 refresh 和启动补偿统一为平台权威查询与同一 observation。
  **Blocked by:** 4.2
  **Acceptance:** 三种入口对相同 MR 状态产生相同 Journal/Run 投影且不创建独立 Post-merge Run
  **Requirements:** post-merge-automation#archive-protocol, delivery-governance#multi-repo-proof
- [ ] 4.4 让精确 merge checkout 与 post-merge Evidence 绑定逐 MR proof 和每仓最终检出 commit，并在 target drift 时保持冻结输入。
  **Blocked by:** 4.3
  **Acceptance:** 多仓、同仓多个 MR、目标分支继续前进和 merge commit 漂移测试通过
  **Requirements:** delivery-governance#multi-repo-proof
- [ ] 4.5 增加不同 Runner 的响应丢失与未知副作用恢复测试，要求先查询远端再复用、重试或 fail-closed。
  **Blocked by:** 4.4
  **Acceptance:** push/MR 创建在每个故障点注入中至多产生一个逻辑结果，非等价远端状态不被覆盖
  **Requirements:** delivery-governance#stable-external-action, delivery-governance#multi-repo-proof

## 5. OpenSpec 关闭事务与候选验证

- [ ] 5.1 定义 `SpecificationClosureJournal` 的 prepared/applying/reconciling/rollback/committed 状态、文件 CAS identity 和预期后置条件。
  **Blocked by:** 4.5
  **Acceptance:** schema/golden tests 证明相同 plan 可重算，未知或倒退状态被拒绝
  **Requirements:** specification-authority#closure-journal
- [ ] 5.2 在官方 archive 前捕获活动 change、预期归档、受影响主规格和允许文件的 before manifest，并先持久化 prepared Journal。
  **Blocked by:** 5.1
  **Acceptance:** 故障注入证明官方命令执行前总存在可恢复计划，输入漂移时零规格副作用
  **Requirements:** specification-authority#closure-journal
- [ ] 5.3 包装官方 OpenSpec `archive --yes --json`，记录 applying 结果且不以退出码或活动目录消失直接签发 Closure Result。
  **Blocked by:** 5.2
  **Acceptance:** 目录已移动但进程中断的 fixture 可被下一次恢复识别，不触发第二次盲 archive
  **Requirements:** specification-authority#closure-candidate, specification-authority#closure-journal
- [ ] 5.4 实现唯一归档、活动 change 消失、Purpose、受影响主规格、全 Store 严格校验和允许 diff 的后置 Validator。
  **Blocked by:** 5.3
  **Acceptance:** 每项条件各有失败 fixture，全部满足时才产生相同 planDigest 的候选 Closure Result
  **Requirements:** specification-authority#closure-candidate
- [ ] 5.5 实现 CAS 安全的继续/回滚/人工修复决策；并发文件变化时禁止覆盖，隔离 checkout 外不得写入。
  **Blocked by:** 5.4
  **Acceptance:** partial archive 可继续或回滚，CAS mismatch 返回可定位 blocker，开发者工作树摘要保持不变
  **Requirements:** specification-authority#closure-journal
- [ ] 5.6 把候选 Closure Result、路径 audit 和关闭 commit 接入 Archive Journal，保持 Specification Service 兼容但移除其终态含义。
  **Blocked by:** 5.5
  **Acceptance:** Provider contract tests 与 production composition 证明 close 只完成候选 Work，不直接 completed Run
  **Requirements:** specification-authority#closure-candidate, post-merge-automation#archive-protocol
- [ ] 5.7 建立 OpenSpec archive 全边界故障矩阵，覆盖响应丢失、Receipt 写入前中断和相同 plan 重放。
  **Blocked by:** 5.6
  **Acceptance:** 每个边界恢复后恰好一个归档目录、严格有效主规格和一个逻辑 Closure Result
  **Requirements:** specification-authority#closure-candidate, specification-authority#closure-journal

## 6. 最终 Change MR 发布、等待与终态证明

- [ ] 6.1 把关闭候选普通 push 和最终 MR create-or-recover/create-or-adopt 拆成 `publish-final` Work，并冻结 repository/head/base、closure plan 和 audit digest。
  **Blocked by:** 5.7
  **Acceptance:** 发布测试覆盖非强制 push、远端 OID fence、MR 响应丢失、人工创建的 open/merged MR、源分支删除和唯一 tuple 恢复
  **Requirements:** delivery-governance#stable-external-action, post-merge-automation#final-head-drift
- [ ] 6.2 实现 `await-final-merge` 全状态平台发现与刷新，对 open、closed-unmerged、merged 和查询故障产生稳定采用、等待或 blocker。
  **Blocked by:** 6.1
  **Acceptance:** Agent 创建、人工创建、人工已合入三种来源从 webhook、reconcile 和显式 refresh 得到相同 Run projection
  **Requirements:** change-lifecycle#archive-terminal, post-merge-automation#final-head-drift
- [ ] 6.3 实现 final head/base 漂移的 publication supersede、新 attempt 和候选归档重新严格验证。
  **Blocked by:** 6.2
  **Acceptance:** 等待中新增提交不会沿用旧 Receipt；等价重新验证可继续，越界差异 fail-closed
  **Requirements:** post-merge-automation#final-head-drift, change-lifecycle#runtime-attempt
- [ ] 6.4 实现 `FinalMergeProof`，绑定 MR identity、冻结 head、base、merge commit、closure/audit digest，并核对目标远端。
  **Blocked by:** 6.3
  **Acceptance:** 精确匹配、错误 head、错误 base、缺 merge commit 和目标远端不包含 commit 的测试分别通过/失败
  **Requirements:** change-lifecycle#archive-terminal, post-merge-automation#final-head-drift
- [ ] 6.5 实现 `archive.finalize` 和 ArchiveCompletionReceipt，只有有效 FinalMergeProof 才接受 terminal observation。
  **Blocked by:** 6.4
  **Acceptance:** 领域、Service 和进程外测试证明 MR ready 不能完成、精确 merged 可以完成、重复 finalize 幂等
  **Requirements:** change-lifecycle#archive-terminal
- [ ] 6.6 删除或 fence `completeChangeRunArchive` 中“发布 Receipt 后立即 complete”的路径，并保留旧 definition 的只读恢复。
  **Blocked by:** 6.5
  **Acceptance:** 架构测试找不到新生产调用，旧完成历史仍可查询且不会重放远端动作
  **Requirements:** change-lifecycle#archive-terminal, post-merge-automation#archive-protocol

## 7. Task 阶段门禁、清理与可观测性

- [ ] 7.1 在 Design validator 拒绝 Workflow follow-up checkbox 和依赖未来 Verify/Archive/MR/terminal 事实的 tracked task，并输出可定位修复建议。
  **Blocked by:** 6.6
  **Acceptance:** 正反 Tasks fixtures 覆盖 Build 内验收、归档后事实、最终 MR 合入和自然语言歧义
  **Requirements:** change-lifecycle#build-only-tasks
- [ ] 7.2 在 planning review 投影中展示每个 task 的 Build scope、验收、依赖和 Requirement mappings，纳入可信 Design 决策内容。
  **Blocked by:** 7.1
  **Acceptance:** proposalHash 对语义变化敏感，对 checkbox 状态和格式噪声稳定
  **Requirements:** change-lifecycle#build-only-tasks
- [ ] 7.3 实现 managed resource registry、Windows 有界退避和 `cleanup_pending`，只登记并清理精确受管路径。
  **Blocked by:** 7.2
  **Acceptance:** EBUSY/共享冲突测试保留主结果、登记待清理资源且不触碰未登记目录
  **Requirements:** post-merge-automation#managed-cleanup
- [ ] 7.4 将精确 GC 接入 Runner 启动和显式 reconcile，并为关键/非关键资源定义 finalize 守卫。
  **Blocked by:** 7.3
  **Acceptance:** 过期受管资源可由另一 Runner 清理，活动租约和 Workspace/仓库根永不删除
  **Requirements:** post-merge-automation#managed-cleanup
- [ ] 7.5 扩展 accepted trajectory、OTLP 和 Dashboard 投影，统一报告 Archive Work、attempt、最终 MR 等待、supersede、merge proof 和 cleanup 状态。
  **Blocked by:** 7.4
  **Acceptance:** telemetry golden fixtures 证明本地 Desktop 与 SigNoz 接收同一事件语义且不泄露路径、正文或凭据
  **Requirements:** post-merge-automation#archive-protocol, post-merge-automation#managed-cleanup

## 8. Definition 迁移与历史完整性

- [ ] 8.1 让 lifecycle registry 同时保留历史 definition snapshot 和新默认版本，禁止相同版本内容静默改变。
  **Blocked by:** 7.5
  **Acceptance:** 恢复测试区分 same、compatible migration、completed history 和 migration required
  **Requirements:** change-lifecycle#archive-terminal
- [ ] 8.2 实现按 phase 的只读迁移 planner，验证 planning/task/evidence/Archive 外部事实能否唯一映射到新协议。
  **Blocked by:** 8.1
  **Acceptance:** Open/Design、Build/Verify、Archive 未发布、Archive 部分发布、歧义和 completed fixtures 全部输出预期计划且零副作用
  **Requirements:** post-merge-automation#archive-protocol, specification-authority#historical-integrity
- [ ] 8.3 实现受控 migration apply、旧 definition 审计链接和崩溃恢复，禁止两套 coordinator 双写。
  **Blocked by:** 8.2
  **Acceptance:** 在每个持久化边界注入崩溃后重复 apply 幂等，只有一个活动 Archive authority
  **Requirements:** post-merge-automation#archive-protocol
- [ ] 8.4 实现 append-only integrity audit，识别旧 terminal Receipt 与后来发布/合入 head 不一致并记录处置状态。
  **Blocked by:** 8.3
  **Acceptance:** 任务 0.2 fixture 产生 finding，原 Receipt 摘要不变，相同审计不追加重复 finding
  **Requirements:** specification-authority#historical-integrity
- [ ] 8.5 用当前 Change Run 的去身份化 snapshot 演练从旧 definition 迁移到新协议，验证规划批准和已完成 Build facts 的保留边界。
  **Blocked by:** 8.4
  **Acceptance:** rehearsal 在临时状态根完成且不修改真实 Run，输出唯一迁移计划和新 Archive next action
  **Requirements:** change-lifecycle#archive-terminal, post-merge-automation#archive-protocol

## 9. 文档和完整集成验证

- [ ] 9.1 更新 Runtime、Specification、Delivery、Post-merge、CLI、Runner、Telemetry 和自举文档，明确最终 MR 合入终态、preflight、attempt、Journal、恢复和清理语义。
  **Blocked by:** 8.5
  **Acceptance:** 文档命令冒烟测试使用公共 CLI/production composition，且全文不再把 final MR ready 描述为 completed
  **Requirements:** change-lifecycle#archive-terminal, delivery-governance#side-effect-preflight, specification-authority#closure-journal
- [ ] 9.2 新增 fresh clone/no `node_modules` E2E，验证显式 Store、依赖自举、公共 CLI 和 production composition 完成模拟 Archive 协议。
  **Blocked by:** 9.1
  **Acceptance:** 隔离 clone 中测试通过，未使用测试旁路或机器默认 Store
  **Requirements:** specification-authority#closure-candidate, post-merge-automation#archive-protocol
- [ ] 9.3 运行多仓、跨 Runner、平台响应丢失、OpenSpec 中断、final head drift 和 Windows cleanup 的统一故障矩阵。
  **Blocked by:** 9.2
  **Acceptance:** 每个边界都有 Intent/Receipt/reconcile 证明，无重复逻辑副作用、越界写入或错误 terminal
  **Requirements:** delivery-governance#stable-external-action, delivery-governance#multi-repo-proof, post-merge-automation#managed-cleanup
- [ ] 9.4 运行领域、contract、Provider、CLI、migration、architecture、telemetry、package 和 tracer 套件并修复发现的问题。
  **Blocked by:** 9.3
  **Acceptance:** `npm run verify`、`npm run test:package-e2e`、`npm run test:tracer-e2e` 和生产依赖审计全部通过
  **Requirements:** change-lifecycle#archive-terminal, specification-authority#closure-candidate, post-merge-automation#archive-protocol

## Workflow follow-up

- 四类规划产物严格校验并经可信用户批准后才进入 Build；当前 Change 分支保持公开，每次 commit 立即 push。
- Build 完成后由 Change Run 的 Verify phase 生成正式 Evidence 与验证报告；这些不是 tracked task。
- 原则上创建一个 Business MR；只有存在独立仓库或可验证拆分理由时登记多个，并冻结完整集合。
- Business MR 全部由人合入后，同一 Change Run 运行新 Archive 协议并关闭规格；最终 Change MR 可以由 Runtime 创建/恢复，也可以由人手工 push、创建和合入，Runtime 只采用精确匹配的远端事实。
- 最终 Change MR 由人合入后，Runtime 核对精确 FinalMergeProof 并 finalize；此前 Run 必须保持 `archive/waiting`。
- 归档后只清理 registry 中的受管临时资源；保留正式 Evidence、Receipt、Journal 和历史完整性 finding。
