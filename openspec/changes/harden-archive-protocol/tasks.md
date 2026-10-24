# Tasks

## 0. 固定简化边界和上游证据

- [x] 0.1 为当前 Archive 等待 Business MR、Webhook/Inbox/Runner 组合和 `run start --help` 副作用建立去身份化基线测试，记录计划删除或修复的公共行为。
      **Blocked by:** None
      **Acceptance:** 测试分别证明当前 Run 会等待 merge、生产组合暴露 webhook runner、帮助请求可能装配 composition；fixture 不依赖开发机已有状态
      **Requirements:** change-lifecycle#archive-publication-terminal, platform-event-processing#retirement, post-merge-automation#retirement, runtime-foundation#readonly-cli
- [x] 0.2 更新 Comet 0.5.0 采用映射，固定 Classic preflight、官方 archive 后置校验、Native 本地 Journal、finish create-or-reuse PR 和 resume probe 的采用/排除边界。
      **Blocked by:** 0.1
      **Acceptance:** `npm run check:provenance` 通过；映射明确不采用 merge wait、Comet 产品外壳和单仓状态根，不新增未登记运行时依赖
      **Requirements:** specification-authority#closure-journal, delivery-governance#publication-receipt

## 1. 建立发布即完成的最小纵切

- [x] 1.1 定义版本化 `PublicationReceipt` 与 item contract，绑定 Change/generation、Delivery snapshot、Verify evidence、规格关闭摘要及每个 repository/base/head/published OID/MR/provenance。
      **Blocked by:** 0.2
      **Acceptance:** schema、canonical digest、扫描顺序和隐私 contract tests 通过；任一 item 缺失或 OID 不匹配被拒绝
      **Requirements:** delivery-governance#publication-receipt
- [x] 1.2 将内置 lifecycle definition 的 Archive 收敛为 `preflight → specification.close → delivery.publish → archive.complete`，以完整 Publication Receipt 接受 terminal observation。
      **Blocked by:** 1.1
      **Acceptance:** 纯领域测试证明 MR open/merged/closed 均不参与终态判断，Receipt 完整时 completed，缺失时 blocked，重复 observation 幂等
      **Requirements:** change-lifecycle#archive-publication-terminal
- [x] 1.3 建立单仓生产 composition tracer：消费当前 Verify evidence，关闭规格、普通 push、创建或复用最终 MR、核对精确 head/base/OID 并完成 Run。
      **Blocked by:** 1.2
      **Acceptance:** E2E 不启动监听端口、不查询 merge 状态、不依赖 Post-merge workflow；Runtime 创建和人工创建 MR 均收敛到一个 Publication Receipt
      **Requirements:** change-lifecycle#archive-publication-terminal, delivery-governance#publication-receipt

## 2. 收紧 OpenSpec 本地关闭事务

- [x] 2.1 定义窄范围 `SpecificationClosureJournal`，只包含 prepared/applying/rolling-back/rolled-back/committed、关闭计划、文件 CAS identity 和预期后置条件。
      **Blocked by:** 1.3
      **Acceptance:** schema/golden tests 拒绝未知版本、倒退状态、跨 Change 输入和 checkout 外路径
      **Requirements:** specification-authority#closure-journal
- [x] 2.2 在官方 `openspec archive --yes --json` 前持久化 prepared Journal，并在隔离 checkout 中执行；不以退出码或目录移动单独签发 Closure Receipt。
      **Blocked by:** 2.1
      **Acceptance:** 命令前、目录移动后和 Receipt 前故障注入均留下可解释状态，开发者工作树摘要不变
      **Requirements:** specification-authority#closure-journal, specification-authority#closure-candidate
- [x] 2.3 验证唯一归档、活动 change 消失、Purpose、受影响规格、全 Store strict 和允许 diff；按 CAS 安全继续、回滚或进入人工修复。
      **Blocked by:** 2.2
      **Acceptance:** 每个后置条件有独立失败 fixture；相同计划重放只产生一个逻辑归档和 Closure Receipt，并发修改不被覆盖
      **Requirements:** specification-authority#closure-journal, specification-authority#closure-candidate

## 3. 扩展多仓 Finish 与响应丢失恢复

- [x] 3.1 将单仓 tracer 扩展为完整 Delivery snapshot：逐仓普通 push、MR create-or-recover/create-or-adopt，并为业务项和规格项生成顺序无关的 Publication Receipt。
      **Blocked by:** 2.3
      **Acceptance:** 默认一个及显式多个 Business MR 均通过；同仓多个 MR 保留独立 item；不等待任何 MR merge
      **Requirements:** delivery-governance#publication-receipt, delivery-governance#stable-publication
- [ ] 3.2 为 push 和 MR 创建的未知结果实现 observe-before-retry，采用唯一 repository/head/base/head OID 匹配并拒绝零歧义之外的远端状态。
      **Blocked by:** 3.1
      **Acceptance:** 每个响应丢失点最多形成一个逻辑远端结果；人工 MR 记录 `human-created` 且不伪造 Action Intent
      **Requirements:** delivery-governance#stable-publication
- [ ] 3.3 在第二仓失败、进程退出和不同短生命周期执行者恢复时从首个未确认 item 继续，保持已发布项不可回滚且禁止 force-push/rebase/delete/auto-merge。
      **Blocked by:** 3.2
      **Acceptance:** 多仓故障矩阵无重复逻辑副作用；失败诊断精确指向 item，恢复不依赖原开发者或 Runner identity
      **Requirements:** delivery-governance#publication-receipt, delivery-governance#stable-publication

## 4. 建立非阻塞最终一致性审查

- [ ] 4.1 定义 `ConsistencyReviewRequest/Receipt`，按 Publication Receipt 比较业务 MR 当前 head/state，输出 `no-spec-impact | spec-update-required | uncertain` 和有界证据。
      **Blocked by:** 3.3
      **Acceptance:** contract tests 证明结果不改原 Run/Receipt，不包含 MR body、完整 diff、凭据或绝对路径，并可关联后续 Change
      **Requirements:** consistency-reconciliation#pull-reconcile, consistency-reconciliation#impact-review
- [ ] 4.2 实现显式 `change reconcile [--change]` 与 `run start` 参数解析后的有界 Workspace reconcile；平台故障只产生诊断，不阻断新任务。
      **Blocked by:** 4.1
      **Acceptance:** head 未变为 no-op；命令执行后退出且无 Timer/端口；`--help` 不 boot composition；网络失败不创建等待 Run
      **Requirements:** consistency-reconciliation#pull-reconcile, runtime-foundation#readonly-cli
- [ ] 4.3 增加窄范围 Consistency Review Service，通过现有 Skill Registry 固定解析并快照 `to-spec`，执行语义影响审查；把 `uncertain` 或 `spec-update-required` 交给可信人工决定，不新增 lifecycle phase/Work，也不得仅按路径自动宣称无影响。
      **Blocked by:** 4.2
      **Acceptance:** 实现/测试/流水线变化、API/配置/权限变化及混合歧义 fixture 产生预期 verdict 和证据映射
      **Requirements:** consistency-reconciliation#impact-review
- [ ] 4.4 对确认需要修正的结果启动普通后续 OpenSpec change，引用原 Change、Publication Receipt 和受影响 MR；不得编辑归档目录或重开原 Run。
      **Blocked by:** 4.3
      **Acceptance:** 后续 Change 经过标准 Open/Design 门禁，原 Run trajectory 和归档摘要在前后保持不变
      **Requirements:** consistency-reconciliation#follow-up-change, specification-authority#semantic-compensation

## 5. 删除 Webhook、Event Inbox、Runner 和 Post-merge 产品链

- [ ] 5.1 删除 `platformEvents`、webhook secret、Inbox Runner 与 `postMerge.runnerIdentity` 配置，保留 GitHub API 凭据于 Delivery Provider，并提供旧字段的明确删除诊断。
      **Blocked by:** 4.4
      **Acceptance:** 新示例和自举配置无监听/lease/poll 参数；旧配置 fail-fast 指向替代的 `change reconcile`，不静默忽略
      **Requirements:** platform-event-processing#retirement, plugin-composition#event-stack-retirement
- [ ] 5.2 删除 `runner start`、`event status/replay/retry`、HTTP Webhook Route、验签 Adapter、Event Inbox Store/Service/Runner 及其生产插件和状态写入口。
      **Blocked by:** 5.1
      **Acceptance:** 公共 CLI/production catalog 不再暴露相关入口；架构检查和依赖扫描找不到运行时引用；普通项目 composition 可启动
      **Requirements:** platform-event-processing#retirement, runtime-foundation#short-lived-runtime, plugin-composition#event-stack-retirement
- [ ] 5.3 删除 Post-merge workflow、Coordinator/Actions、exact-merge checkout、Evidence profile 和启动补偿，把仍需的 publish/closure 原语收归 Archive、Delivery 与 Specification owner。
      **Blocked by:** 5.2
      **Acceptance:** 生产代码不存在独立 Post-merge Run/状态机/Telemetry；Archive tracer 与多仓恢复测试继续通过
      **Requirements:** post-merge-automation#retirement, runtime-foundation#short-lived-runtime
- [ ] 5.4 删除平台事件与 Post-merge 专用测试、文档和 OTel 属性，新增负向架构测试防止无当前 Change 的 webhook/daemon 基础设施重新进入核心组合。
      **Blocked by:** 5.3
      **Acceptance:** 文档只描述短生命周期 publish/reconcile；Telemetry 仅包含有界 Publication/Consistency 字段；负向 fixture 能拒绝新监听入口
      **Requirements:** development-telemetry#publication-consistency, plugin-composition#event-stack-retirement

## 6. 前置流程门禁与完整验证

- [ ] 6.1 在 Design validator 拒绝依赖 Verify、Archive、MR 合入或一致性审查结果的 tracked checkbox，并在规划投影展示 Build scope、验收与 Requirement mappings。
      **Blocked by:** 5.4
      **Acceptance:** 正反 Tasks fixture 覆盖 Build 内验收和 future-phase 事实；proposal hash 对语义变化敏感、对 checkbox 状态噪声稳定
      **Requirements:** change-lifecycle#build-only-tasks
- [ ] 6.2 修正 CLI boot 顺序，使 help/version/未知参数/缺失参数在 composition 前完成；将 0.1 基线转为零 reconcile、零 Run、零持久写入。
      **Blocked by:** 6.1
      **Acceptance:** 公共进程外测试覆盖 `run start --help`、`change reconcile --help`、缺失 change、未知 flag 和正常启动
      **Requirements:** runtime-foundation#readonly-cli
- [ ] 6.3 更新 Runtime、Specification、Delivery、CLI、Desktop/OTLP、自举和上游采用文档，运行 OpenSpec strict、架构、来源、单元、E2E、package、tracer 和生产依赖验证。
      **Blocked by:** 6.2
      **Acceptance:** `openspec validate harden-archive-protocol --strict --no-interactive`、Repoctopus Provider validation、`npm run check:provenance`、`npm run verify`、`npm run test:package-e2e`、`npm run test:tracer-e2e` 与生产依赖审计全部通过
      **Requirements:** change-lifecycle#archive-publication-terminal, delivery-governance#publication-receipt, consistency-reconciliation#pull-reconcile

## Workflow follow-up

- 四类 OpenSpec 产物 strict 校验并经可信用户批准后才进入 Build；当前 Change 分支保持公开，每次 commit 立即 push。
- Build 完成后由 Verify phase 生成正式 Evidence 与验证报告；这些不是 tracked task。
- Archive 发布全部业务 MR 和最终规格 MR，完整 Publication Receipt 验证后完成 Run，不等待任何 MR 合入。
- 后续远端变化由下一次任务或显式 `change reconcile` 拉取；需要修正规格时建立新的普通 OpenSpec change。
- 清理只处理本次命令明确创建的隔离 checkout，并在同一命令 `finally` 中有界重试；不为此建立通用资源注册表或 daemon GC。
